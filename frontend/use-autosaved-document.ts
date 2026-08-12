import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/* oxlint-disable eslint/id-length -- T is required by the shared public generic interface. */

export type SaveState = "saved" | "dirty" | "saving" | "error";

export interface VersionedDocument {
  revision: string | null;
}

export type PersistResult<T> = { status: "saved"; document: T } | { status: "conflict"; current: T };

interface Options<T extends VersionedDocument> {
  persist: (document: T, expectedRevision: string | null, overwrite: boolean) => Promise<PersistResult<T>>;
  mergeSaved: (local: T, saved: T) => T;
  onError: (error: unknown) => void;
  onSaved?: (document: T) => void | Promise<void>;
  delay?: number;
}

type PersistRequest = { overwrite: false } | { expectedRevision: string | null; overwrite: true };
type SaveCurrency<T> = { status: "current" } | { document: T; status: "retry" } | { status: "stop" };

export interface AutosavedDocumentController<T extends VersionedDocument> {
  document: T | null;
  saveState: SaveState;
  conflict: T | null;
  load: (document: T | null) => void;
  edit: (update: (document: T) => T) => void;
  synchronize: (document: T) => void;
  acceptExternal: () => void;
  overwriteConflict: () => Promise<void>;
  requestNavigation: (navigate: () => void) => Promise<void>;
}

export function useAutosavedDocument<T extends VersionedDocument>({
  persist,
  mergeSaved,
  onError,
  onSaved,
  delay = 700,
}: Options<T>): AutosavedDocumentController<T> {
  const [document, setDocument] = useState<T | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<T | null>(null);

  const documentRef = useRef<T | null>(null);
  const saveStateRef = useRef<SaveState>("saved");
  const conflictRef = useRef<T | null>(null);
  const editGenerationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);

  const persistRef = useRef(persist);
  const mergeSavedRef = useRef(mergeSaved);
  const onErrorRef = useRef(onError);
  const onSavedRef = useRef(onSaved);

  useLayoutEffect(() => {
    persistRef.current = persist;
    mergeSavedRef.current = mergeSaved;
    onErrorRef.current = onError;
    onSavedRef.current = onSaved;
  }, [mergeSaved, onError, onSaved, persist]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
      pendingNavigationRef.current = null;
    };
  }, []);

  const updateDocument = useCallback((next: T | null) => {
    documentRef.current = next;
    setDocument(next);
  }, []);

  const updateSaveState = useCallback((next: SaveState) => {
    saveStateRef.current = next;
    setSaveState(next);
  }, []);

  const updateConflict = useCallback((next: T | null) => {
    conflictRef.current = next;
    setConflict(next);
  }, []);

  const classifySave = useCallback((loadGeneration: number): SaveCurrency<T> => {
    if (!mountedRef.current) {
      return { status: "stop" };
    }
    if (loadGenerationRef.current === loadGeneration) {
      return { status: "current" };
    }
    const latestDocument = documentRef.current;
    if (saveStateRef.current === "dirty" && latestDocument) {
      return { document: latestDocument, status: "retry" };
    }
    return { status: "stop" };
  }, []);

  const persistCurrent = useCallback(
    async (request?: PersistRequest): Promise<void> => {
      if (inFlightRef.current) {
        return inFlightRef.current;
      }

      const run = async (): Promise<void> => {
        let currentRequest: PersistRequest = request ?? { overwrite: false };
        let documentToSave = documentRef.current;

        while (documentToSave) {
          const generationAtStart = editGenerationRef.current;
          const loadGenerationAtStart = loadGenerationRef.current;
          updateSaveState("saving");

          try {
            const expectedRevision =
              "expectedRevision" in currentRequest ? currentRequest.expectedRevision : documentToSave.revision;
            // oxlint-disable-next-line eslint/no-await-in-loop -- Navigation requires serial saves with the new revision.
            const result = await persistRef.current(documentToSave, expectedRevision, currentRequest.overwrite);
            const persistenceCurrency = classifySave(loadGenerationAtStart);
            if (persistenceCurrency.status === "stop") {
              return;
            }
            if (persistenceCurrency.status === "retry") {
              currentRequest = { overwrite: false };
              documentToSave = persistenceCurrency.document;
              continue;
            }
            if (result.status === "conflict") {
              pendingNavigationRef.current = null;
              updateConflict(result.current);
              updateSaveState("dirty");
              return;
            }

            const latestLocal = documentRef.current;
            if (!latestLocal) {
              pendingNavigationRef.current = null;
              updateSaveState("saved");
              return;
            }

            const changedWhileSaving = editGenerationRef.current !== generationAtStart;
            updateDocument(changedWhileSaving ? mergeSavedRef.current(latestLocal, result.document) : result.document);
            updateConflict(null);
            if (changedWhileSaving) {
              updateSaveState("dirty");
            }

            // oxlint-disable-next-line eslint/no-await-in-loop -- The save callback must finish before navigation.
            await onSavedRef.current?.(result.document);
            const callbackCurrency = classifySave(loadGenerationAtStart);
            if (callbackCurrency.status === "stop") {
              return;
            }
            if (callbackCurrency.status === "retry") {
              currentRequest = { overwrite: false };
              documentToSave = callbackCurrency.document;
              continue;
            }
            if (editGenerationRef.current === generationAtStart) {
              updateSaveState("saved");
              const navigate = pendingNavigationRef.current;
              pendingNavigationRef.current = null;
              navigate?.();
              return;
            }
            updateSaveState("dirty");
            if (pendingNavigationRef.current) {
              currentRequest = { overwrite: false };
              documentToSave = documentRef.current;
            } else {
              return;
            }
          } catch (error) {
            const errorCurrency = classifySave(loadGenerationAtStart);
            if (errorCurrency.status === "stop") {
              return;
            }
            if (errorCurrency.status === "retry") {
              currentRequest = { overwrite: false };
              documentToSave = errorCurrency.document;
              continue;
            }
            pendingNavigationRef.current = null;
            updateSaveState("error");
            onErrorRef.current(error);
            return;
          }
        }
      };

      const inFlight = run();
      inFlightRef.current = inFlight;
      try {
        await inFlight;
      } finally {
        if (inFlightRef.current === inFlight) {
          inFlightRef.current = null;
        }
      }
    },
    [classifySave, updateConflict, updateDocument, updateSaveState],
  );

  useEffect(() => {
    if (!document || saveState !== "dirty" || conflict) {
      return;
    }
    const timeout = window.setTimeout(() => void persistCurrent(), delay);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [conflict, delay, document, persistCurrent, saveState]);

  const load = useCallback(
    (next: T | null) => {
      loadGenerationRef.current += 1;
      pendingNavigationRef.current = null;
      updateConflict(null);
      updateDocument(next);
      updateSaveState("saved");
    },
    [updateConflict, updateDocument, updateSaveState],
  );

  const edit = useCallback(
    (update: (document: T) => T) => {
      const {current} = documentRef;
      if (!current) {
        return;
      }
      editGenerationRef.current += 1;
      updateDocument(update(current));
      updateSaveState("dirty");
    },
    [updateDocument, updateSaveState],
  );

  const synchronize = useCallback(
    (next: T) => {
      if (saveStateRef.current !== "saved") {
        return;
      }
      updateDocument(next);
    },
    [updateDocument],
  );

  const acceptExternal = useCallback(() => {
    const { current } = conflictRef;
    if (!current) {
      return;
    }
    updateDocument(current);
    updateConflict(null);
    updateSaveState("saved");
  }, [updateConflict, updateDocument, updateSaveState]);

  const overwriteConflict = useCallback(async () => {
    const currentConflict = conflictRef.current;
    if (!currentConflict) {
      return;
    }
    updateConflict(null);
    await persistCurrent({ expectedRevision: currentConflict.revision, overwrite: true });
  }, [persistCurrent, updateConflict]);

  const requestNavigation = useCallback(
    async (navigate: () => void) => {
      if (!documentRef.current || saveStateRef.current === "saved") {
        navigate();
        return;
      }
      if (conflictRef.current) {
        pendingNavigationRef.current = null;
        return;
      }
      pendingNavigationRef.current = navigate;
      await persistCurrent();
    },
    [persistCurrent],
  );

  return {
    acceptExternal,
    conflict,
    document,
    edit,
    load,
    overwriteConflict,
    requestNavigation,
    saveState,
    synchronize,
  };
}
