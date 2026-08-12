import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosavedDocument } from "./use-autosaved-document";

interface TestDocument {
  body: string;
  revision: string | null;
  exists: boolean;
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
    expect(navigate).not.toHaveBeenCalled();
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
});
