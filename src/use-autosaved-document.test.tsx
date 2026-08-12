import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosavedDocument } from "./use-autosaved-document";

interface TestDocument {
  body: string;
  revision: string | null;
  exists: boolean;
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolveDeferred: (value: Value) => void = vi.fn();
  // oxlint-disable-next-line promise/avoid-new -- Tests need explicit control over in-flight persistence.
  const promise = new Promise<Value>((resolve) => {
    resolveDeferred = resolve;
  });
  return { promise, resolve: resolveDeferred };
}

describe(useAutosavedDocument, () => {
  // oxlint-disable-next-line vitest/no-hooks -- Fake timers are reset after every contract case.
  beforeEach(() => vi.useFakeTimers());
  // oxlint-disable-next-line vitest/no-hooks -- Fake timers must not leak into unrelated suites.
  afterEach(() => vi.useRealTimers());

  it("loads programmatic content without saving and debounces user edits by 700ms", async () => {
    const persist = vi.fn().mockResolvedValue({
      document: { body: "edited", exists: true, revision: "r2" },
      status: "saved",
    });
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError: vi.fn(), persist }),
    );
    act(() => {
      result.current.load({ body: "loaded", exists: true, revision: "r1" });
    });
    expect(persist).not.toHaveBeenCalled();
    act(() => {
      result.current.edit((current) => ({ ...current, body: "edited" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(699);
    });
    expect(persist).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(persist).toHaveBeenCalledExactlyOnceWith({ body: "edited", exists: true, revision: "r1" }, "r1", false);
  });

  it("saves immediately before pending navigation", async () => {
    const navigate = vi.fn();
    const persist = vi.fn().mockResolvedValue({
      document: { body: "edited", exists: true, revision: "r2" },
      status: "saved",
    });
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError: vi.fn(), persist }),
    );
    act(() => {
      result.current.load({ body: "old", exists: true, revision: "r1" });
    });
    act(() => {
      result.current.edit((current) => ({ ...current, body: "edited" }));
    });
    await act(async () => result.current.requestNavigation(navigate));
    expect(persist.mock.calls).toStrictEqual([[{ body: "edited", exists: true, revision: "r1" }, "r1", false]]);
    expect(navigate.mock.calls).toStrictEqual([[]]);
  });

  it("非同期遷移中は編集を受け付けず完了まで待つ", async () => {
    const destination = deferred<void>();
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({
        mergeSaved: (_local, saved) => saved,
        onError: vi.fn(),
        persist: vi.fn(),
      }),
    );
    act(() => {
      result.current.load({ body: "source", exists: true, revision: "r1" });
    });
    let navigation = Promise.resolve();
    act(() => {
      navigation = result.current.requestNavigation(async () => destination.promise);
    });

    expect({ navigating: result.current.isNavigating }).toStrictEqual({ navigating: true });
    act(() => {
      result.current.edit((current) => ({ ...current, body: "late edit" }));
    });
    expect(result.current.document?.body).toBe("source");
    let navigationFinished = false;
    void navigation.then(() => {
      navigationFinished = true;
      return null;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect({ navigationFinished }).toStrictEqual({ navigationFinished: false });

    await act(async () => {
      destination.resolve();
      await navigation;
    });
    expect({ navigating: result.current.isNavigating }).toStrictEqual({ navigating: false });
  });

  it("進行中の遷移後に最新の遷移だけをcurrentとして実行する", async () => {
    const firstDestination = deferred<void>();
    const latestDestination = deferred<void>();
    const latestStarted = vi.fn();
    let firstWasCurrent: boolean | null = null;
    let latestWasCurrent: boolean | null = null;
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({
        mergeSaved: (_local, saved) => saved,
        onError: vi.fn(),
        persist: vi.fn(),
      }),
    );
    act(() => {
      result.current.load({ body: "source", exists: true, revision: "r1" });
    });
    let navigationGeneration = 0;
    const requestNavigation = async (navigate: (isCurrent: () => boolean) => Promise<void>) => {
      const generation = navigationGeneration + 1;
      navigationGeneration = generation;
      await result.current.requestNavigation(async () => {
        await navigate(() => navigationGeneration === generation);
      });
    };
    let firstNavigation = Promise.resolve();
    let latestNavigation = Promise.resolve();
    act(() => {
      firstNavigation = requestNavigation(async (isCurrent) => {
        await firstDestination.promise;
        firstWasCurrent = isCurrent();
      });
      latestNavigation = requestNavigation(async (isCurrent) => {
        latestStarted();
        await latestDestination.promise;
        latestWasCurrent = isCurrent();
      });
    });

    expect(latestStarted).not.toHaveBeenCalled();
    await act(async () => {
      firstDestination.resolve();
      await firstDestination.promise;
      await Promise.resolve();
    });
    expect({ firstWasCurrent, latestStarted: latestStarted.mock.calls }).toStrictEqual({
      firstWasCurrent: false,
      latestStarted: [[]],
    });
    await act(async () => {
      latestDestination.resolve();
      await Promise.all([firstNavigation, latestNavigation]);
    });
    expect({ latestWasCurrent }).toStrictEqual({ latestWasCurrent: true });
  });

  it("unsafeな遷移中止はqueued遷移を実行せず両requestを完了する", async () => {
    const destination = deferred<void>();
    const unsafeError = new Error("rollback failed");
    const latestNavigate = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({
        mergeSaved: (_local, saved) => saved,
        onError,
        persist: vi.fn(),
      }),
    );
    act(() => {
      result.current.load({ body: "source", exists: true, revision: "r1" });
    });
    let firstNavigation = Promise.resolve();
    let latestNavigation = Promise.resolve();
    act(() => {
      firstNavigation = result.current.requestNavigation(async () => {
        await destination.promise;
        return { error: unsafeError, status: "abort" };
      });
      latestNavigation = result.current.requestNavigation(latestNavigate);
    });

    await act(async () => {
      destination.resolve();
      await Promise.all([firstNavigation, latestNavigation]);
    });

    expect({
      errorCalls: onError.mock.calls,
      latestCalls: latestNavigate.mock.calls,
      navigating: result.current.isNavigating,
    }).toStrictEqual({ errorCalls: [[unsafeError]], latestCalls: [], navigating: false });
  });

  it("keeps navigation pending off after a conflict", async () => {
    const navigate = vi.fn();
    const external = { body: "external", exists: true, revision: "r2" };
    const persist = vi.fn().mockResolvedValue({ current: external, status: "conflict" });
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError: vi.fn(), persist }),
    );
    act(() => {
      result.current.load({ body: "local", exists: true, revision: "r1" });
    });
    act(() => {
      result.current.edit((current) => ({ ...current, body: "local edit" }));
    });
    await act(async () => result.current.requestNavigation(navigate));
    expect(result.current.conflict).toStrictEqual(external);
    expect(result.current.document).toStrictEqual({ body: "local edit", exists: true, revision: "r1" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("ignores an in-flight save result after loading another document", async () => {
    const firstSave = deferred<{ document: TestDocument; status: "saved" }>();
    const onSaved = vi.fn();
    const persist = vi.fn().mockReturnValue(firstSave.promise);
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError: vi.fn(), onSaved, persist }),
    );
    act(() => {
      result.current.load({ body: "document A", exists: true, revision: "a1" });
      result.current.edit((current) => ({ ...current, body: "edited A" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    act(() => {
      result.current.load({ body: "document B", exists: true, revision: "b1" });
    });
    await act(async () => {
      firstSave.resolve({ document: { body: "edited A", exists: true, revision: "a2" }, status: "saved" });
      await firstSave.promise;
    });
    expect(result.current.document).toStrictEqual({ body: "document B", exists: true, revision: "b1" });
    expect(result.current.saveState).toBe("saved");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("saves edits to a newly loaded document after the stale save finishes", async () => {
    const firstSave = deferred<{ document: TestDocument; status: "saved" }>();
    const persist = vi
      .fn()
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce({ document: { body: "edited B", exists: true, revision: "b2" }, status: "saved" });
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError: vi.fn(), persist }),
    );
    act(() => {
      result.current.load({ body: "document A", exists: true, revision: "a1" });
      result.current.edit((current) => ({ ...current, body: "edited A" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    act(() => {
      result.current.load({ body: "document B", exists: true, revision: "b1" });
      result.current.edit((current) => ({ ...current, body: "edited B" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    act(() => {
      firstSave.resolve({ document: { body: "edited A", exists: true, revision: "a2" }, status: "saved" });
    });
    await act(async () => {
      await firstSave.promise;
    });
    expect(persist).toHaveBeenLastCalledWith({ body: "edited B", exists: true, revision: "b1" }, "b1", false);
    expect(result.current.document).toStrictEqual({ body: "edited B", exists: true, revision: "b2" });
    expect(result.current.saveState).toBe("saved");
  });

  it("synchronizes only while saved", () => {
    const persist = vi.fn();
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError: vi.fn(), persist }),
    );
    act(() => {
      result.current.load({ body: "old", exists: true, revision: "r1" });
    });
    act(() => {
      result.current.synchronize({ body: "external", exists: true, revision: "r2" });
    });
    expect(result.current.document?.body).toBe("external");
    act(() => {
      result.current.edit((current) => ({ ...current, body: "local" }));
    });
    act(() => {
      result.current.synchronize({ body: "newer external", exists: true, revision: "r3" });
    });
    expect(result.current.document?.body).toBe("local");
  });

  it("retains local content after a save error", async () => {
    const onError = vi.fn();
    const persist = vi.fn().mockRejectedValue(new Error("disk full"));
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError, persist }),
    );
    act(() => {
      result.current.load({ body: "old", exists: true, revision: "r1" });
    });
    act(() => {
      result.current.edit((current) => ({ ...current, body: "local" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(result.current.document?.body).toBe("local");
    expect(result.current.saveState).toBe("error");
    expect(onError.mock.calls).toStrictEqual([[expect.any(Error)]]);
  });

  it("cancels pending navigation after persistence rejects", async () => {
    const navigate = vi.fn();
    const onError = vi.fn();
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce({ document: { body: "retry", exists: true, revision: "r2" }, status: "saved" });
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError, persist }),
    );
    act(() => {
      result.current.load({ body: "old", exists: true, revision: "r1" });
      result.current.edit((current) => ({ ...current, body: "local" }));
    });
    await act(async () => result.current.requestNavigation(navigate));
    expect(result.current.document?.body).toBe("local");
    expect(result.current.saveState).toBe("error");
    act(() => {
      result.current.edit((current) => ({ ...current, body: "retry" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("cancels pending navigation after onSaved rejects", async () => {
    const navigate = vi.fn();
    const onError = vi.fn();
    const onSaved = vi.fn().mockRejectedValueOnce(new Error("refresh failed"));
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ document: { body: "local", exists: true, revision: "r2" }, status: "saved" })
      .mockResolvedValueOnce({ document: { body: "retry", exists: true, revision: "r3" }, status: "saved" });
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError, onSaved, persist }),
    );
    act(() => {
      result.current.load({ body: "old", exists: true, revision: "r1" });
      result.current.edit((current) => ({ ...current, body: "local" }));
    });
    await act(async () => result.current.requestNavigation(navigate));
    expect(result.current.saveState).toBe("error");
    expect(onError.mock.calls).toStrictEqual([[expect.any(Error)]]);
    act(() => {
      result.current.edit((current) => ({ ...current, body: "retry" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("overwrites against the external revision", async () => {
    const external = { body: "external", exists: true, revision: "r2" };
    const persist = vi
      .fn()
      .mockResolvedValueOnce({ current: external, status: "conflict" })
      .mockResolvedValueOnce({ document: { body: "local", exists: true, revision: "r3" }, status: "saved" });
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError: vi.fn(), persist }),
    );
    act(() => {
      result.current.load({ body: "local", exists: true, revision: "r1" });
    });
    act(() => {
      result.current.edit((current) => ({ ...current, body: "local" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    await act(async () => {
      await result.current.overwriteConflict();
    });
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ body: "local" }), "r2", true);
  });

  it("preserves a second edit made while saving", async () => {
    let resolveFirst: (value: { status: "saved"; document: TestDocument }) => void = vi.fn();
    // oxlint-disable-next-line promise/avoid-new -- A manually resolved save is required to exercise in-flight edits.
    const firstSave = new Promise<{ status: "saved"; document: TestDocument }>((resolve) => {
      resolveFirst = resolve;
    });
    const persist = vi
      .fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce({ document: { body: "second", exists: true, revision: "r3" }, status: "saved" });
    const mergeSaved = vi.fn((local: TestDocument, saved: TestDocument) => ({
      ...local,
      exists: saved.exists,
      revision: saved.revision,
    }));
    const navigate = vi.fn();
    const { result } = renderHook(() => useAutosavedDocument<TestDocument>({ mergeSaved, onError: vi.fn(), persist }));
    act(() => {
      result.current.load({ body: "old", exists: true, revision: "r1" });
    });
    act(() => {
      result.current.edit((current) => ({ ...current, body: "first" }));
    });
    let navigation = Promise.resolve();
    act(() => {
      navigation = result.current.requestNavigation(navigate);
    });
    act(() => {
      result.current.edit((current) => ({ ...current, body: "second" }));
    });
    act(() => {
      resolveFirst({ document: { body: "first", exists: true, revision: "r2" }, status: "saved" });
    });
    await act(async () => {
      await navigation;
    });
    expect(mergeSaved).toHaveBeenCalledWith(
      expect.objectContaining({ body: "second" }),
      expect.objectContaining({ revision: "r2" }),
    );
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ body: "second" }), "r2", false);
    expect(navigate.mock.calls).toStrictEqual([[]]);
  });

  it("joins an already in-flight save before navigating", async () => {
    const firstSave = deferred<{ document: TestDocument; status: "saved" }>();
    const navigate = vi.fn();
    const persist = vi.fn().mockReturnValue(firstSave.promise);
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError: vi.fn(), persist }),
    );
    act(() => {
      result.current.load({ body: "old", exists: true, revision: "r1" });
      result.current.edit((current) => ({ ...current, body: "edited" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(result.current.saveState).toBe("saving");
    let navigation = Promise.resolve();
    act(() => {
      navigation = result.current.requestNavigation(navigate);
    });
    expect(persist.mock.calls).toStrictEqual([[{ body: "edited", exists: true, revision: "r1" }, "r1", false]]);
    act(() => {
      firstSave.resolve({ document: { body: "edited", exists: true, revision: "r2" }, status: "saved" });
    });
    await act(async () => {
      await navigation;
    });
    expect(navigate.mock.calls).toStrictEqual([[]]);
  });

  it("uses the latest pending navigation request", async () => {
    const firstSave = deferred<{ document: TestDocument; status: "saved" }>();
    const firstNavigate = vi.fn();
    const latestNavigate = vi.fn();
    const persist = vi.fn().mockReturnValue(firstSave.promise);
    const { result } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError: vi.fn(), persist }),
    );
    act(() => {
      result.current.load({ body: "old", exists: true, revision: "r1" });
      result.current.edit((current) => ({ ...current, body: "edited" }));
    });
    let firstNavigation = Promise.resolve();
    let latestNavigation = Promise.resolve();
    act(() => {
      firstNavigation = result.current.requestNavigation(firstNavigate);
      latestNavigation = result.current.requestNavigation(latestNavigate);
    });
    act(() => {
      firstSave.resolve({ document: { body: "edited", exists: true, revision: "r2" }, status: "saved" });
    });
    await act(async () => {
      await Promise.all([firstNavigation, latestNavigation]);
    });
    expect(firstNavigate).not.toHaveBeenCalled();
    expect(latestNavigate.mock.calls).toStrictEqual([[]]);
  });

  it("does not run save callbacks or navigation after unmount", async () => {
    const firstSave = deferred<{ document: TestDocument; status: "saved" }>();
    const navigate = vi.fn();
    const onError = vi.fn();
    const onSaved = vi.fn();
    const persist = vi.fn().mockReturnValue(firstSave.promise);
    const { result, unmount } = renderHook(() =>
      useAutosavedDocument<TestDocument>({ mergeSaved: (_local, saved) => saved, onError, onSaved, persist }),
    );
    act(() => {
      result.current.load({ body: "old", exists: true, revision: "r1" });
      result.current.edit((current) => ({ ...current, body: "edited" }));
    });
    let navigation = Promise.resolve();
    act(() => {
      navigation = result.current.requestNavigation(navigate);
    });
    unmount();
    act(() => {
      firstSave.resolve({ document: { body: "edited", exists: true, revision: "r2" }, status: "saved" });
    });
    await act(async () => {
      await navigation;
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
