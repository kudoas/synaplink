import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shutdownApi, type ShutdownRequest } from "./shutdown-api";
import { useAutosavedDocument, type PersistResult } from "./use-autosaved-document";
import { useShutdownGuard } from "./use-shutdown-guard";

vi.mock(import("./shutdown-api"), () => ({
  shutdownApi: {
    cancel: vi.fn(),
    complete: vi.fn(),
    isNative: vi.fn(),
    listen: vi.fn(),
    register: vi.fn(),
  },
}));

interface Document {
  body: string;
  revision: string;
}

function deferred<Value>() {
  let finish: (value: Value) => void = vi.fn();
  // oxlint-disable-next-line promise/avoid-new -- Tests control persistence and IPC completion explicitly.
  const promise = new Promise<Value>((resolve) => { finish = resolve; });
  return { promise, resolve: finish };
}

// oxlint-disable-next-line eslint/init-declarations -- beforeEach installs the listener callback.
let emitRequest: (request: ShutdownRequest) => void;
// oxlint-disable-next-line eslint/init-declarations -- beforeEach creates an isolated unlisten mock.
let unlisten: () => void;

describe(useShutdownGuard, () => {
  // oxlint-disable-next-line vitest/no-hooks -- Each case starts with independent native mocks and timers.
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    emitRequest = vi.fn();
    unlisten = vi.fn();
    vi.mocked(shutdownApi.isNative).mockReturnValue(true);
    vi.mocked(shutdownApi.cancel).mockResolvedValue();
    vi.mocked(shutdownApi.complete).mockResolvedValue();
    vi.mocked(shutdownApi.register).mockResolvedValue(null);
    vi.mocked(shutdownApi.listen).mockImplementation(async (handler) => {
      emitRequest = handler;
      await Promise.resolve();
      return unlisten;
    });
  });

  // oxlint-disable-next-line vitest/no-hooks -- Cleanup releases the native-exit hold before restoring timers.
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("ブラウザ表示ではnativeの終了listenerを登録しない", () => {
    vi.mocked(shutdownApi.isNative).mockReturnValue(false);
    const { result } = renderHook(() => useShutdownGuard({ onError: vi.fn(), requestNavigation: vi.fn() }));

    expect({ ready: result.current }).toStrictEqual({ ready: true });
    expect(shutdownApi.listen).not.toHaveBeenCalled();
  });

  it("listenerとnative登録が完了するまで編集UIを解放しない", async () => {
    const listener = deferred<() => void>();
    const registration = deferred<ShutdownRequest | null>();
    vi.mocked(shutdownApi.listen).mockReturnValue(listener.promise);
    vi.mocked(shutdownApi.register).mockReturnValue(registration.promise);
    const { result } = renderHook(() => useShutdownGuard({ onError: vi.fn(), requestNavigation: vi.fn() }));
    expect({ ready: result.current }).toStrictEqual({ ready: false });
    expect(shutdownApi.register).not.toHaveBeenCalled();

    await act(async () => { listener.resolve(unlisten); await listener.promise; });
    expect({ ready: result.current }).toStrictEqual({ ready: false });
    await act(async () => { registration.resolve(null); await registration.promise; });
    expect({ ready: result.current }).toStrictEqual({ ready: true });
  });

  it("700ms以内のclose要求でも保存を待ち、承認後は編集を再開しない", async () => {
    const saved = deferred<PersistResult<Document>>();
    const persist = vi.fn().mockReturnValue(saved.promise);
    const { result, unmount } = renderHook(() => {
      const autosave = useAutosavedDocument<Document>({ mergeSaved: (_local, document) => document, onError: vi.fn(), persist });
      const ready = useShutdownGuard({ onError: vi.fn(), requestNavigation: autosave.requestNavigation });
      return { ...autosave, ready };
    });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      result.current.load({ body: "old", revision: "r1" });
      result.current.edit((document) => ({ ...document, body: "last edit" }));
      emitRequest({ id: "close-1" });
      emitRequest({ id: "close-1" });
    });
    expect(persist).toHaveBeenCalledExactlyOnceWith({ body: "last edit", revision: "r1" }, "r1", false);
    expect(shutdownApi.complete).not.toHaveBeenCalled();

    await act(async () => { saved.resolve({ document: { body: "last edit", revision: "r2" }, status: "saved" }); await saved.promise; });
    expect(shutdownApi.complete).toHaveBeenCalledExactlyOnceWith("close-1");
    act(() => { result.current.edit((document) => ({ ...document, body: "too late" })); });
    expect({ body: result.current.document?.body, navigating: result.current.isNavigating }).toStrictEqual({ body: "last edit", navigating: true });
    unmount();
    expect(unlisten).toHaveBeenCalledExactlyOnceWith();
  });

  it("保存後の一覧更新待ちに再編集してcloseしても最新の本文を保存する", async () => {
    const afterSave = deferred<void>();
    const persist = vi.fn().mockImplementation(async (document: Document) => { await Promise.resolve(); return { document: { ...document, revision: "r2" }, status: "saved" as const }; });
    const { result } = renderHook(() => {
      const autosave = useAutosavedDocument<Document>({ mergeSaved: (local, saved) => ({ ...local, revision: saved.revision }), onError: vi.fn(), onSaved: async () => afterSave.promise, persist });
      useShutdownGuard({ onError: vi.fn(), requestNavigation: autosave.requestNavigation });
      return autosave;
    });
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.load({ body: "old", revision: "r1" }); result.current.edit((document) => ({ ...document, body: "first" })); });
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => { result.current.edit((document) => ({ ...document, body: "latest" })); emitRequest({ id: "close-latest" }); });
    expect(shutdownApi.complete).not.toHaveBeenCalled();

    await act(async () => { afterSave.resolve(); await afterSave.promise; });

    expect(persist.mock.calls).toStrictEqual([
      [{ body: "first", revision: "r1" }, "r1", false],
      [{ body: "latest", revision: "r2" }, "r2", false],
    ]);
    expect(shutdownApi.complete).toHaveBeenCalledExactlyOnceWith("close-latest");
  });

  it("保存失敗時は終了せず内容を保持し、closeを再試行できる", async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce({ document: { body: "last edit", revision: "r2" }, status: "saved" });
    const { result } = renderHook(() => {
      const autosave = useAutosavedDocument<Document>({ mergeSaved: (_local, saved) => saved, onError: vi.fn(), persist });
      useShutdownGuard({ onError: vi.fn(), requestNavigation: autosave.requestNavigation });
      return autosave;
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      result.current.load({ body: "old", revision: "r1" });
      result.current.edit((document) => ({ ...document, body: "last edit" }));
      emitRequest({ id: "failed" });
      await Promise.resolve();
    });
    expect({ body: result.current.document?.body, state: result.current.saveState }).toStrictEqual({ body: "last edit", state: "error" });
    expect(shutdownApi.complete).not.toHaveBeenCalled();
    expect(shutdownApi.cancel).toHaveBeenCalledExactlyOnceWith("failed");

    await act(async () => { emitRequest({ id: "retry" }); await Promise.resolve(); });
    expect(shutdownApi.complete).toHaveBeenCalledExactlyOnceWith("retry");
  });

  it("競合中はcloseを繰り返しても上書き・終了せず解決を待つ", async () => {
    const external = { body: "external", revision: "r2" };
    const persist = vi.fn().mockResolvedValue({ current: external, status: "conflict" });
    const { result } = renderHook(() => {
      const autosave = useAutosavedDocument<Document>({ mergeSaved: (_local, saved) => saved, onError: vi.fn(), persist });
      useShutdownGuard({ onError: vi.fn(), requestNavigation: autosave.requestNavigation });
      return autosave;
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      result.current.load({ body: "local", revision: "r1" });
      result.current.edit((document) => ({ ...document, body: "local edit" }));
      emitRequest({ id: "first" });
      await Promise.resolve();
    });
    await act(async () => { emitRequest({ id: "second" }); await Promise.resolve(); });

    expect({ body: result.current.document?.body, conflict: result.current.conflict }).toStrictEqual({ body: "local edit", conflict: external });
    expect(persist).toHaveBeenCalledExactlyOnceWith({ body: "local edit", revision: "r1" }, "r1", false);
    expect(shutdownApi.complete).not.toHaveBeenCalled();
    expect(vi.mocked(shutdownApi.cancel).mock.calls).toStrictEqual([["first"], ["second"]]);
  });

  it("listenerが取りこぼしたpending要求を登録応答から回収する", async () => {
    vi.mocked(shutdownApi.register).mockResolvedValue({ id: "pending" });
    const requestNavigation = vi.fn().mockImplementation(async (action: () => Promise<void>) => action());
    renderHook(() => useShutdownGuard({ onError: vi.fn(), requestNavigation }));
    await act(async () => { await Promise.resolve(); });

    expect(requestNavigation.mock.calls).toStrictEqual([[expect.any(Function)]]);
    expect(shutdownApi.complete).toHaveBeenCalledExactlyOnceWith("pending");
  });

  it("listener登録に失敗した場合は編集UIを解放しない", async () => {
    const error = new Error("listener unavailable");
    const onError = vi.fn();
    vi.mocked(shutdownApi.listen).mockRejectedValue(error);
    const { result } = renderHook(() => useShutdownGuard({ onError, requestNavigation: vi.fn() }));
    await act(async () => { await Promise.resolve(); });

    expect({ ready: result.current }).toStrictEqual({ ready: false });
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(shutdownApi.register).not.toHaveBeenCalled();
  });

  it("登録前にunmountした場合は遅れて届くlistenerを解除する", async () => {
    const listener = deferred<() => void>();
    vi.mocked(shutdownApi.listen).mockReturnValue(listener.promise);
    const { unmount } = renderHook(() => useShutdownGuard({ onError: vi.fn(), requestNavigation: vi.fn() }));
    unmount();
    await act(async () => { listener.resolve(unlisten); await listener.promise; });

    expect(unlisten).toHaveBeenCalledExactlyOnceWith();
    expect(shutdownApi.register).not.toHaveBeenCalled();
  });

  it("native承認IPCに失敗した場合も要求を取り消し再試行できる", async () => {
    const onError = vi.fn();
    const error = new Error("complete IPC failed");
    const requestNavigation = vi.fn().mockImplementation(async (action: () => Promise<void>) => action());
    vi.mocked(shutdownApi.complete).mockRejectedValueOnce(error).mockResolvedValueOnce();
    renderHook(() => useShutdownGuard({ onError, requestNavigation }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { emitRequest({ id: "failed" }); await Promise.resolve(); });

    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(shutdownApi.cancel).toHaveBeenCalledExactlyOnceWith("failed");
    await act(async () => { emitRequest({ id: "retry" }); await Promise.resolve(); });
    expect(vi.mocked(shutdownApi.complete).mock.calls).toStrictEqual([["failed"], ["retry"]]);
  });

  it("開発時のStrictMode再登録で古いlistenerを残さない", async () => {
    const first = deferred<() => void>();
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();
    vi.mocked(shutdownApi.listen).mockReturnValueOnce(first.promise).mockResolvedValueOnce(stopSecond);
    const { result, unmount } = renderHook(
      () => useShutdownGuard({ onError: vi.fn(), requestNavigation: vi.fn() }),
      { wrapper: StrictMode },
    );
    await act(async () => { await Promise.resolve(); });
    await act(async () => { first.resolve(stopFirst); await first.promise; });

    expect({ ready: result.current, registrations: vi.mocked(shutdownApi.register).mock.calls }).toStrictEqual({ ready: true, registrations: [[]] });
    expect(stopFirst).toHaveBeenCalledExactlyOnceWith();
    unmount();
    expect(stopSecond).toHaveBeenCalledExactlyOnceWith();
  });
});
