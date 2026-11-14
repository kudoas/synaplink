import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { shutdownApi, type ShutdownRequest } from "./shutdown-api";

interface Options {
  onError: (error: unknown) => void;
  requestNavigation: (action: () => Promise<void>) => Promise<void>;
}

export function useShutdownGuard(options: Options): boolean {
  const [ready, setReady] = useState(() => !shutdownApi.isNative());
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!shutdownApi.isNative()) {
      return;
    }
    const lifecycle = { active: true };
    const isActive = (): boolean => lifecycle.active;
    let pendingId: string | null = null;
    let unlisten: (() => void) | null = null;
    let releaseApprovedExit: (() => void) | null = null;

    const handleRequest = async (request: ShutdownRequest) => {
      if (!isActive() || pendingId !== null) {
        return;
      }
      pendingId = request.id;
      const completion = { approved: false };
      try {
        await optionsRef.current.requestNavigation(async () => {
          if (!isActive()) {
            return;
          }
          await shutdownApi.complete(request.id);
          completion.approved = true;
          if (isActive()) {
            // Do not reopen editing between the IPC response and native exit.
            // oxlint-disable-next-line promise/avoid-new -- Native exit owns completion; cleanup releases it on unmount.
            await new Promise<void>((resolve) => {
              releaseApprovedExit = resolve;
            });
          }
        });
      } catch (error) {
        if (isActive()) {
          optionsRef.current.onError(error);
        }
      } finally {
        if (!completion.approved) {
          try {
            await shutdownApi.cancel(request.id);
          } catch (error) {
            if (isActive()) {
              optionsRef.current.onError(error);
            }
          }
        }
        pendingId = null;
      }
    };

    const initialize = async () => {
      try {
        unlisten = await shutdownApi.listen((request) => { void handleRequest(request); });
        if (!isActive()) {
          unlisten();
          return;
        }
        const pending = await shutdownApi.register();
        if (!isActive()) {
          return;
        }
        setReady(true);
        if (pending) {
          void handleRequest(pending);
        }
      } catch (error) {
        if (isActive()) {
          optionsRef.current.onError(error);
        }
      }
    };
    void initialize();
    return () => {
      lifecycle.active = false;
      unlisten?.();
      releaseApprovedExit?.();
    };
  }, []);

  return ready;
}
