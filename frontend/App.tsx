import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { DocumentEditor } from "./components/DocumentEditor";
import { EditConflictDialog } from "./components/EditConflictDialog";
import { SaveStatus } from "./components/SaveStatus";
import { filterNotes, findLatestNote } from "./note-search";
import type { NoteDocument, NoteSummary } from "./types";
import {
  type AbortedNavigation,
  type NavigationResult,
  useAutosavedDocument,
} from "./use-autosaved-document";

export function App() {
  const [vault, setVault] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const externalReadGeneration = useRef(0);
  const editorNavigationGeneration = useRef(0);
  const notesRef = useRef<NoteSummary[]>([]);

  const replaceNotes = useCallback((next: NoteSummary[]) => {
    notesRef.current = next;
    setNotes(next);
  }, []);

  const loadNotes = useCallback(async () => {
    replaceNotes(await api.listNotes());
  }, [replaceNotes]);

  const refreshNotes = useCallback(async () => {
    try {
      await loadNotes();
    } catch (error) {
      setError(String(error));
    }
  }, [loadNotes]);

  const noteAutosave = useAutosavedDocument<NoteDocument>({
    mergeSaved: (local, saved) => ({
      ...local,
      links: saved.links,
      modifiedAt: saved.modifiedAt,
      revision: saved.revision,
    }),
    onError: (saveError) => {
      setError(String(saveError));
    },
    onSaved: loadNotes,
    persist: async (note, expectedRevision, overwrite) => {
      const result = await api.saveNote({
        body: note.body,
        expectedRevision: expectedRevision ?? note.revision,
        id: note.id,
        ...(overwrite ? { overwrite: true } : {}),
        title: note.title,
      });
      return result.status === "saved"
        ? { document: result.note, status: "saved" }
        : { current: result.current, status: "conflict" };
    },
  });

  const {
    acceptExternal,
    conflict,
    document: draft,
    edit,
    isNavigating,
    load,
    overwriteConflict,
    requestNavigation,
    saveState,
    synchronize,
  } = noteAutosave;

  const invalidateExternalRead = useCallback(() => {
    externalReadGeneration.current += 1;
  }, []);

  const loadDocument = useCallback(
    (note: NoteDocument | null) => {
      invalidateExternalRead();
      load(note);
    },
    [invalidateExternalRead, load],
  );

  useEffect(() => {
    void (async () => {
      try {
        const currentVault = await api.getVault();
        setVault(currentVault);
        if (currentVault) {
          replaceNotes(await api.listNotes());
        }
      } catch (error) {
        setError(String(error));
      }
    })();
  }, [replaceNotes]);

  useEffect(() => {
    if (!vault) {
      return;
    }
    const interval = window.setInterval(() => void refreshNotes(), 2500);
    return () => {
      window.clearInterval(interval);
    };
  }, [refreshNotes, vault]);

  useEffect(() => {
    if (!draft || saveState !== "saved") {
      return;
    }
    const latest = notes.find((note) => note.id === draft.id);
    if (latest && latest.revision !== draft.revision) {
      const generation = externalReadGeneration.current + 1;
      externalReadGeneration.current = generation;
      void (async () => {
        try {
          const note = await api.readNote(draft.id);
          if (externalReadGeneration.current === generation && note.id === draft.id) {
            synchronize(note);
          }
        } catch (error) {
          if (externalReadGeneration.current === generation) {
            setError(String(error));
          }
        }
      })();
      return () => {
        if (externalReadGeneration.current === generation) {
          externalReadGeneration.current += 1;
        }
      };
    }
  }, [draft, notes, saveState, synchronize]);

  const visibleNotes = useMemo(() => filterNotes(notes, search), [notes, search]);

  const requestEditorNavigation = useCallback(
    (action: (isCurrent: () => boolean) => NavigationResult | Promise<NavigationResult>) => {
      const generation = editorNavigationGeneration.current + 1;
      editorNavigationGeneration.current = generation;
      invalidateExternalRead();
      void requestNavigation(
        (): NavigationResult | Promise<NavigationResult> =>
          action(() => editorNavigationGeneration.current === generation),
      );
    },
    [invalidateExternalRead, requestNavigation],
  );

  const chooseVault = () => {
    requestEditorNavigation(async (isCurrent) => {
      const restoreVault = async (): Promise<AbortedNavigation | void> => {
        if (!vault) {
          return;
        }
        try {
          await api.setVault(vault);
        } catch (rollbackError) {
          return { error: rollbackError, status: "abort" };
        }
      };
      const selected = await api.chooseVault();
      if (!selected || !isCurrent()) {
        return;
      }
      await api.setVault(selected);
      if (!isCurrent()) {
        return restoreVault();
      }
      const selectedNotes = await api.listNotes().catch(async (error: unknown) => {
        const abort = await restoreVault();
        if (abort) {
          return abort;
        }
        throw error;
      });
      if (!Array.isArray(selectedNotes)) {
        return selectedNotes;
      }
      if (!isCurrent()) {
        return restoreVault();
      }
      setVault(selected);
      replaceNotes(selectedNotes);
      loadDocument(null);
    });
  };

  const openNote = (id: string) => {
    requestEditorNavigation(async (isCurrent) => {
      const note = await api.readNote(id);
      if (isCurrent()) {
        loadDocument(note);
      }
    });
  };

  const createNote = () => {
    requestEditorNavigation(async (isCurrent) => {
      const note = await api.createNote();
      if (!isCurrent()) {
        return;
      }
      const latestNotes = await api.listNotes();
      if (!isCurrent()) {
        return;
      }
      replaceNotes(latestNotes);
      loadDocument(note);
    });
  };

  const openLink = (link: string) => {
    requestEditorNavigation(async (isCurrent) => {
      if (!isCurrent()) {
        return;
      }
      setSearch(link);
      const latest = findLatestNote(filterNotes(notesRef.current, link));
      if (!latest || latest.id === draft?.id) {
        return;
      }
      const note = await api.readNote(latest.id);
      if (isCurrent()) {
        loadDocument(note);
      }
    });
  };

  const removeNote = () => {
    if (!draft || !window.confirm(`「${draft.title || "無題"}」をゴミ箱へ移動しますか？`)) {
      return;
    }
    const noteId = draft.id;
    requestEditorNavigation(async (isCurrent) => {
      await api.deleteNote(noteId);
      if (!isCurrent()) {
        return;
      }
      const latestNotes = await api.listNotes();
      if (!isCurrent()) {
        return;
      }
      loadDocument(null);
      replaceNotes(latestNotes);
    });
  };

  if (!vault) {
    return (
      <div className="welcome-shell">
        <section className="welcome-card">
          <div className="brand-mark">Z</div>
          <span className="eyebrow">LOCAL-FIRST NOTES</span>
          <h1>考えを、つなげる。</h1>
          <p>プレーンテキストと [[リンク]] だけの、静かなツェッテルカステン。</p>
          <button className="primary-button" onClick={chooseVault}>
            メモの保存先を選ぶ
          </button>
          {error && <p className="error-message">{error}</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="brand">
            <span className="brand-mark small">Z</span>
            <strong>Synaplink</strong>
          </div>
          <button className="icon-button" title="保存先を変更" onClick={chooseVault}>
            ⋯
          </button>
        </header>
        <div className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="メモを検索"
          />
        </div>
        <button className="new-note-button" onClick={createNote}>
          <span>＋</span> 新しいメモ
        </button>
        <div className="note-list">
          {visibleNotes.map((note) => (
            <button
              className={`note-row ${draft?.id === note.id ? "active" : ""}`}
              key={note.id}
              onClick={() => {
                openNote(note.id);
              }}
            >
              <strong>{note.title.trim() || "無題"}</strong>
              <p>{note.preview || "本文はまだありません。"}</p>
              <time>{new Date(note.modifiedAt).toLocaleDateString("ja-JP", { day: "numeric", month: "short" })}</time>
            </button>
          ))}
          {visibleNotes.length === 0 && <p className="empty-list">メモがありません</p>}
        </div>
        <footer className="vault-path" title={vault}>
          ◉ {vault.split("/").pop()}
        </footer>
      </aside>

      {draft ? (
        <main className="document-view">
          <header className="document-toolbar">
            <SaveStatus state={saveState} />
            <button className="delete-button" disabled={isNavigating} onClick={removeNote}>
              ゴミ箱へ
            </button>
          </header>
          {isNavigating ? (
            <p className="document-transition">移動先を読み込み中…</p>
          ) : (
            <DocumentEditor
              body={draft.body}
              onBodyChange={(body) => {
                edit((current) => ({ ...current, body }));
              }}
              onOpenLink={openLink}
              onTitleChange={(title) => {
                edit((current) => ({ ...current, title }));
              }}
              title={draft.title}
            />
          )}
        </main>
      ) : (
        <main className="empty-view">
          <div>
            <span>✦</span>
            <h1>メモを選んでください</h1>
            <p>または、新しい考えを書き始めましょう。</p>
          </div>
        </main>
      )}

      {conflict && (
        <EditConflictDialog
          onAcceptExternal={acceptExternal}
          onOverwrite={() => {
            void overwriteConflict();
          }}
        />
      )}

      {error && (
        <button
          className="error-toast"
          onClick={() => {
            setError(null);
          }}
        >
          {error}
          <span>×</span>
        </button>
      )}
    </div>
  );
}
