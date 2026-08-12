import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { App } from "./App";
import type { NoteDocument, NoteSummary, TagMemoDocument } from "./types";

vi.mock(import("./api"), () => ({
  api: {
    chooseVault: vi.fn(),
    createNote: vi.fn(),
    deleteNote: vi.fn(),
    getVault: vi.fn(),
    listNotes: vi.fn(),
    readNote: vi.fn(),
    readTagMemo: vi.fn(),
    saveNote: vi.fn(),
    saveTagMemo: vi.fn(),
    searchTag: vi.fn(),
    setVault: vi.fn(),
  },
}));

const document: NoteDocument = {
  body: "本文の #りんご",
  id: "apple.txt",
  modifiedAt: 1,
  revision: "revision-1",
  tags: [{ displayName: "りんご", normalizedName: "りんご" }],
  title: "りんごのメモ",
};

const summary: NoteSummary = {
  id: document.id,
  modifiedAt: document.modifiedAt,
  preview: document.body,
  revision: document.revision,
  tags: document.tags,
  title: document.title,
};

const nextDocument: NoteDocument = {
  ...document,
  body: "次の本文",
  id: "next.txt",
  revision: "next-r1",
  title: "次のメモ",
};

const nextSummary: NoteSummary = {
  ...summary,
  id: nextDocument.id,
  revision: nextDocument.revision,
  title: nextDocument.title,
};

const tagMemo: TagMemoDocument = {
  body: "秋の候補",
  exists: true,
  revision: "tag-r1",
  tag: "りんご",
};

function editBody(container: HTMLElement, body: string) {
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!);
  act(() => {
    view!.dispatch({ changes: { from: 0, insert: body, to: view!.state.doc.length }, userEvent: "input.type" });
  });
}

interface Deferred<Value> {
  promise: Promise<Value>;
  reject: (error: unknown) => void;
  resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let rejectDeferred: (error: unknown) => void = vi.fn();
  let resolveDeferred: (value: Value) => void = vi.fn();
  // oxlint-disable-next-line promise/avoid-new -- Tests need explicit control over in-flight operations.
  const promise = new Promise<Value>((resolve, reject) => {
    rejectDeferred = reject;
    resolveDeferred = resolve;
  });
  return { promise, reject: rejectDeferred, resolve: resolveDeferred };
}

describe(App, () => {
  // oxlint-disable-next-line vitest/no-hooks -- API doubles must not leak calls or implementations between App cases.
  beforeEach(() => vi.resetAllMocks());
  // oxlint-disable-next-line vitest/no-hooks -- Fake timers must not leak into unrelated suites.
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("本文のタグを通常クリックするとCONNECTED NOTESへ移動する", async () => {
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.searchTag).mockResolvedValue([
      {
        id: "connected.txt",
        modifiedAt: 2,
        preview: "赤い果物",
        revision: "revision-2",
        tags: [{ displayName: "りんご", normalizedName: "りんご" }],
        title: "関連メモ",
      },
    ]);
    vi.mocked(api.readTagMemo).mockResolvedValue(tagMemo);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });

    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);

    await expect(screen.findByText("CONNECTED NOTES")).resolves.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "#りんご" })).toBeInTheDocument();
  });

  it("タグメモ本文を700ms後に保存する", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.searchTag).mockResolvedValue([summary]);
    vi.mocked(api.readTagMemo).mockResolvedValue(tagMemo);
    vi.mocked(api.saveTagMemo).mockResolvedValue({
      memo: { ...tagMemo, body: "秋の候補を追加", revision: "tag-r2" },
      status: "saved",
    });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await screen.findByRole("heading", { level: 1, name: "#りんご" });
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".tag-memo-editor .cm-editor")!);
    act(() => {
      view!.dispatch({
        changes: { from: 0, insert: "秋の候補を追加", to: view!.state.doc.length },
        userEvent: "input.type",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(api.saveTagMemo).toHaveBeenCalledExactlyOnceWith({
      body: "秋の候補を追加",
      expectedRevision: "tag-r1",
      tag: "りんご",
    });
  });

  it("存在しないタグメモを開くだけでは保存しない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.searchTag).mockResolvedValue([summary]);
    vi.mocked(api.readTagMemo).mockResolvedValue({ body: "", exists: false, revision: null, tag: "りんご" });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await screen.findByRole("heading", { level: 1, name: "#りんご" });
    await waitFor(() => {
      const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".tag-memo-editor .cm-editor")!);
      expect(view?.state.doc.toString()).toBe("");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(api.saveTagMemo).not.toHaveBeenCalled();
  });

  it("保存成功後に別タグへ移動する", async () => {
    const pendingSave = deferred<Awaited<ReturnType<typeof api.saveTagMemo>>>();
    const nextTagMemo = { body: "果物のメモ", exists: true, revision: "fruit-r1", tag: "果物" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.searchTag).mockResolvedValue([summary]);
    vi.mocked(api.readTagMemo).mockResolvedValueOnce({ ...tagMemo, body: "#果物" }).mockResolvedValueOnce(nextTagMemo);
    vi.mocked(api.saveTagMemo).mockReturnValue(pendingSave.promise);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await screen.findByRole("heading", { level: 1, name: "#りんご" });
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".tag-memo-editor .cm-editor")!);
    act(() => {
      view!.dispatch({ changes: { from: 0, insert: "#果物 追記", to: view!.state.doc.length }, userEvent: "input.type" });
    });
    fireEvent.mouseDown(container.querySelector(".tag-memo-editor .cm-zettel-tag")!);

    expect(api.saveTagMemo).toHaveBeenCalledExactlyOnceWith({
      body: "#果物 追記",
      expectedRevision: "tag-r1",
      tag: "りんご",
    });
    expect(api.readTagMemo).toHaveBeenCalledExactlyOnceWith("りんご");
    await act(async () => {
      pendingSave.resolve({ memo: { ...tagMemo, body: "#果物 追記", revision: "tag-r2" }, status: "saved" });
      await pendingSave.promise;
    });

    await expect(screen.findByRole("heading", { level: 1, name: "#果物" })).resolves.toBeInTheDocument();
    expect(api.readTagMemo).toHaveBeenLastCalledWith("果物");
    expect(api.searchTag).toHaveBeenLastCalledWith("果物");
  });

  it("競合時は別タグへ移動しない", async () => {
    const external = { ...tagMemo, body: "外部のタグ本文", revision: "tag-r2" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.searchTag).mockResolvedValue([summary]);
    vi.mocked(api.readTagMemo).mockResolvedValue({ ...tagMemo, body: "#果物" });
    vi.mocked(api.saveTagMemo).mockResolvedValue({ current: external, status: "conflict" });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await screen.findByRole("heading", { level: 1, name: "#りんご" });
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".tag-memo-editor .cm-editor")!);
    act(() => {
      view!.dispatch({ changes: { from: 0, insert: "#果物 編集", to: view!.state.doc.length }, userEvent: "input.type" });
    });
    fireEvent.mouseDown(container.querySelector(".tag-memo-editor .cm-zettel-tag")!);

    await expect(screen.findByRole("dialog")).resolves.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "#りんご" })).toBeInTheDocument();
    expect(api.readTagMemo).toHaveBeenCalledExactlyOnceWith("りんご");
    expect(api.searchTag).toHaveBeenCalledExactlyOnceWith("りんご");
  });

  it("タグメモ読込失敗でも関連メモを表示する", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const connected = { ...summary, id: "connected.txt", title: "関連メモ" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.searchTag).mockResolvedValue([connected]);
    vi.mocked(api.readTagMemo).mockRejectedValue(new Error("tag memo read failed"));
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);

    await expect(screen.findByRole("button", { name: /関連メモ/u })).resolves.toBeInTheDocument();
    await expect(screen.findByText("Error: tag memo read failed")).resolves.toBeInTheDocument();
    expect({
      editorMissing: container.querySelector(".tag-memo-editor .cm-editor") === null,
      errorVisible: screen.getByText("読み込みエラー") instanceof HTMLElement,
      headingVisible: screen.getByRole("heading", { level: 1, name: "#りんご" }) instanceof HTMLElement,
      loadingMissing: screen.queryByText("タグメモを読み込み中…") === null,
      savedMissing: screen.queryByText("保存済み") === null,
      unavailableVisible: screen.getByText("タグメモを読み込めませんでした。") instanceof HTMLElement,
    }).toStrictEqual({
      editorMissing: true,
      errorVisible: true,
      headingVisible: true,
      loadingMissing: true,
      savedMissing: true,
      unavailableVisible: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.readTagMemo).toHaveBeenCalledExactlyOnceWith("りんご");
    expect(api.saveTagMemo).not.toHaveBeenCalled();
  });

  it("外部同期をユーザー編集として保存しない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const external = { ...tagMemo, body: "外部の更新", revision: "tag-r2" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.searchTag).mockResolvedValue([summary]);
    vi.mocked(api.readTagMemo).mockResolvedValueOnce(tagMemo).mockResolvedValueOnce(external);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await screen.findByRole("heading", { level: 1, name: "#りんご" });
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await waitFor(() => {
      const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".tag-memo-editor .cm-editor")!);
      expect(view?.state.doc.toString()).toBe("外部の更新");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(api.readTagMemo).toHaveBeenCalledTimes(2);
    expect(api.saveTagMemo).not.toHaveBeenCalled();
  });

  it("逆順で完了したタグメモpollから最新の内容を保持する", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const firstPoll = deferred<TagMemoDocument>();
    const latestPoll = deferred<TagMemoDocument>();
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.searchTag).mockResolvedValue([summary]);
    vi.mocked(api.readTagMemo)
      .mockResolvedValueOnce(tagMemo)
      .mockReturnValueOnce(firstPoll.promise)
      .mockReturnValueOnce(latestPoll.promise);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(api.readTagMemo).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(api.readTagMemo).toHaveBeenCalledTimes(3);
    await act(async () => {
      latestPoll.resolve({ ...tagMemo, body: "最新の外部更新", revision: "tag-r3" });
      await latestPoll.promise;
      firstPoll.resolve({ ...tagMemo, body: "古い外部更新", revision: "tag-r2" });
      await firstPoll.promise;
    });

    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".tag-memo-editor .cm-editor")!);
    expect(view?.state.doc.toString()).toBe("最新の外部更新");
    expect(api.saveTagMemo).not.toHaveBeenCalled();
  });

  it("関連メモの読込中は編集できず失敗時はタグページに留まる", async () => {
    const destination = deferred<NoteDocument>();
    const connected = { ...nextSummary, id: "connected.txt", title: "関連先" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValueOnce(document).mockReturnValueOnce(destination.promise);
    vi.mocked(api.searchTag).mockResolvedValue([connected]);
    vi.mocked(api.readTagMemo).mockResolvedValue(tagMemo);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await screen.findByRole("button", { name: /関連先/u });
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /関連先/u }));

    await expect(screen.findByText("移動先を読み込み中…")).resolves.toBeInTheDocument();
    expect(container.querySelector(".tag-memo-editor .cm-editor")).toBeNull();
    await act(async () => {
      destination.reject(new Error("destination read failed"));
      await destination.promise.catch(() => null);
    });
    await expect(screen.findByText("Error: destination read failed")).resolves.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "#りんご" })).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".tag-memo-editor .cm-editor")!);
    expect({ body: view?.state.doc.toString(), saveCalls: vi.mocked(api.saveTagMemo).mock.calls }).toStrictEqual({
      body: tagMemo.body,
      saveCalls: [],
    });
  });

  it("関連メモより後に選んだsidebarメモだけを開く", async () => {
    const firstDestination = deferred<NoteDocument>();
    const latestDestination = deferred<NoteDocument>();
    const connected = { ...nextSummary, id: "connected.txt", title: "関連先" };
    const connectedDocument = { ...nextDocument, id: connected.id, title: connected.title };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary, nextSummary]);
    vi.mocked(api.readNote)
      .mockResolvedValueOnce(document)
      .mockReturnValueOnce(firstDestination.promise)
      .mockReturnValueOnce(latestDestination.promise);
    vi.mocked(api.searchTag).mockResolvedValue([connected]);
    vi.mocked(api.readTagMemo).mockResolvedValue(tagMemo);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await screen.findByRole("button", { name: /関連先/u });

    fireEvent.click(screen.getByRole("button", { name: /関連先/u }));
    fireEvent.click(screen.getByRole("button", { name: /次のメモ/u }));

    expect(api.readNote).toHaveBeenCalledTimes(2);
    expect(api.readNote).toHaveBeenLastCalledWith(connected.id);
    await act(async () => {
      firstDestination.resolve(connectedDocument);
      await firstDestination.promise;
    });
    await waitFor(() => {
      expect(api.readNote).toHaveBeenNthCalledWith(3, nextDocument.id);
    });
    expect(screen.getByRole("heading", { level: 1, name: "#りんご" })).toBeInTheDocument();
    await act(async () => {
      latestDestination.resolve(nextDocument);
      await latestDestination.promise;
    });

    await expect(screen.findByRole("textbox", { name: "タイトル" })).resolves.toHaveValue(nextDocument.title);
  });

  it("新規メモ作成中は編集できず失敗時はタグページに留まる", async () => {
    const creation = deferred<NoteDocument>();
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.searchTag).mockResolvedValue([summary]);
    vi.mocked(api.readTagMemo).mockResolvedValue(tagMemo);
    vi.mocked(api.createNote).mockReturnValue(creation.promise);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /新しいメモ/u }));

    await expect(screen.findByText("移動先を読み込み中…")).resolves.toBeInTheDocument();
    await act(async () => {
      creation.reject(new Error("create failed"));
      await creation.promise.catch(() => null);
    });
    await expect(screen.findByText("Error: create failed")).resolves.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "#りんご" })).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });
    expect(api.saveTagMemo).not.toHaveBeenCalled();
  });

  it("保存先変更失敗時はタグページに留まる", async () => {
    const vaultChange = deferred<void>();
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.searchTag).mockResolvedValue([summary]);
    vi.mocked(api.readTagMemo).mockResolvedValue(tagMemo);
    vi.mocked(api.chooseVault).mockResolvedValue("/tmp/other");
    vi.mocked(api.setVault).mockReturnValue(vaultChange.promise);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });

    fireEvent.click(screen.getByTitle("保存先を変更"));

    await expect(screen.findByText("移動先を読み込み中…")).resolves.toBeInTheDocument();
    await act(async () => {
      vaultChange.reject(new Error("vault change failed"));
      await vaultChange.promise.catch(() => null);
    });
    await expect(screen.findByText("Error: vault change failed")).resolves.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "#りんご" })).toBeInTheDocument();
    expect(screen.getByTitle("保存先を変更")).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });
  });

  it("保存先変更中のpollを破棄しrollback後も元のタグメモを保存する", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const newVaultNotes = deferred<NoteSummary[]>();
    const poll = deferred<TagMemoDocument>();
    const vaultState = { current: "/tmp/notes" };
    const notesByVault = new Map([
      ["/tmp/notes", Promise.resolve([summary])],
      ["/tmp/other", newVaultNotes.promise],
    ]);
    vi.mocked(api.getVault).mockResolvedValue(vaultState.current);
    vi.mocked(api.listNotes).mockImplementation(async () => {
      const selectedNotes = await notesByVault.get(vaultState.current)!;
      return selectedNotes;
    });
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.searchTag).mockResolvedValue([summary]);
    vi.mocked(api.readTagMemo).mockResolvedValueOnce(tagMemo).mockReturnValueOnce(poll.promise);
    vi.mocked(api.chooseVault).mockResolvedValue("/tmp/other");
    // oxlint-disable-next-line typescript/promise-function-async -- The mock must update its state synchronously.
    vi.mocked(api.setVault).mockImplementation((selected): Promise<void> => {
      vaultState.current = selected;
      return Promise.resolve();
    });
    vi.mocked(api.saveTagMemo).mockResolvedValue({
      memo: { ...tagMemo, body: "rollback後の編集", revision: "tag-r2" },
      status: "saved",
    });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    fireEvent.click(screen.getByTitle("保存先を変更"));
    await screen.findByText("移動先を読み込み中…");
    await waitFor(() => {
      expect(api.setVault).toHaveBeenCalledWith("/tmp/other");
    });
    await act(async () => {
      poll.resolve({ ...tagMemo, body: "別vaultの本文", revision: "other-r1" });
      await poll.promise;
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(api.readTagMemo).toHaveBeenCalledTimes(2);
    await act(async () => {
      newVaultNotes.reject(new Error("new vault list failed"));
      await newVaultNotes.promise.catch(() => null);
    });
    await screen.findByText("Error: new vault list failed");
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });
    const restoredView = EditorView.findFromDOM(container.querySelector<HTMLElement>(".tag-memo-editor .cm-editor")!);
    expect({ body: restoredView?.state.doc.toString(), vaultCalls: vi.mocked(api.setVault).mock.calls }).toStrictEqual({
      body: tagMemo.body,
      vaultCalls: [["/tmp/other"], ["/tmp/notes"]],
    });
    editBody(container, "rollback後の編集");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(api.saveTagMemo).toHaveBeenCalledExactlyOnceWith({
      body: "rollback後の編集",
      expectedRevision: "tag-r1",
      tag: "りんご",
    });
  });

  it("保存先rollback失敗時はqueued遷移を止めてエラーを保持する", async () => {
    const newVaultNotes = deferred<NoteSummary[]>();
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValueOnce([summary, nextSummary]).mockReturnValueOnce(newVaultNotes.promise);
    vi.mocked(api.readNote).mockResolvedValueOnce(document).mockResolvedValueOnce(nextDocument);
    vi.mocked(api.searchTag).mockResolvedValue([summary]);
    vi.mocked(api.readTagMemo).mockResolvedValue(tagMemo);
    vi.mocked(api.chooseVault).mockResolvedValue("/tmp/other");
    vi.mocked(api.setVault).mockResolvedValueOnce().mockRejectedValueOnce(new Error("rollback failed"));
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    await waitFor(() => {
      expect(container.querySelector(".tag-memo-editor .cm-editor")).not.toBeNull();
    });

    fireEvent.click(screen.getByTitle("保存先を変更"));
    await screen.findByText("移動先を読み込み中…");
    await waitFor(() => {
      expect(api.setVault).toHaveBeenCalledWith("/tmp/other");
    });
    fireEvent.click(screen.getByRole("button", { name: /次のメモ/u }));
    await act(async () => {
      newVaultNotes.reject(new Error("new vault list failed"));
      await newVaultNotes.promise.catch(() => null);
    });

    await expect(screen.findByText("Error: rollback failed")).resolves.toBeInTheDocument();
    expect({
      heading: screen.getByRole("heading", { level: 1, name: "#りんご" }).textContent,
      readNoteCalls: vi.mocked(api.readNote).mock.calls,
    }).toStrictEqual({ heading: "#りんご", readNoteCalls: [[document.id]] });
  });

  it("通常メモを700ms後に保存する", async () => {
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.saveNote).mockResolvedValue({
      note: { ...document, body: "編集後", revision: "r2" },
      status: "saved",
    });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    vi.useFakeTimers();
    editBody(container, "編集後");

    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(api.saveNote).toHaveBeenCalledExactlyOnceWith({
      body: "編集後",
      expectedRevision: document.revision,
      id: document.id,
      title: document.title,
    });
  });

  it("競合時に外部の内容を読み込む", async () => {
    const external = { ...document, body: "外部の本文", revision: "r2", title: "外部のタイトル" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.saveNote).mockResolvedValue({ current: external, status: "conflict" });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    vi.useFakeTimers();
    editBody(container, "ローカルの本文");
    await act(async () => vi.advanceTimersByTimeAsync(700));
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: "外部の内容を読む" }));

    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(external.title);
    await waitFor(() => {
      const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!);
      expect(view?.state.doc.toString()).toBe(external.body);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("競合時に現在の編集で上書きする", async () => {
    const external = { ...document, body: "外部の本文", revision: "r2" };
    const saved = { ...document, body: "ローカルの本文", revision: "r3" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.saveNote)
      .mockResolvedValueOnce({ current: external, status: "conflict" })
      .mockResolvedValueOnce({ note: saved, status: "saved" });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    vi.useFakeTimers();
    editBody(container, "ローカルの本文");
    await act(async () => vi.advanceTimersByTimeAsync(700));
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: "現在の編集で上書き" }));

    await waitFor(() => {
      expect(api.saveNote).toHaveBeenCalledTimes(2);
    });
    expect(api.saveNote).toHaveBeenLastCalledWith({
      body: "ローカルの本文",
      expectedRevision: external.revision,
      id: document.id,
      overwrite: true,
      title: document.title,
    });
    await expect(screen.findByText("保存済み")).resolves.toBeInTheDocument();
  });

  it("未保存の通常メモを即時保存してから選択先へ移動する", async () => {
    let finishSave: (result: Awaited<ReturnType<typeof api.saveNote>>) => void = vi.fn();
    // oxlint-disable-next-line promise/avoid-new -- The pending save proves navigation waits for persistence.
    const pendingSave = new Promise<Awaited<ReturnType<typeof api.saveNote>>>((resolve) => {
      finishSave = resolve;
    });
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary, nextSummary]);
    vi.mocked(api.readNote).mockResolvedValueOnce(document).mockResolvedValueOnce(nextDocument);
    vi.mocked(api.saveNote).mockReturnValue(pendingSave);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    editBody(container, "移動前の編集");

    fireEvent.click(screen.getByRole("button", { name: /次のメモ/u }));

    expect(api.saveNote).toHaveBeenCalledExactlyOnceWith({
      body: "移動前の編集",
      expectedRevision: document.revision,
      id: document.id,
      title: document.title,
    });
    expect(api.readNote).toHaveBeenCalledExactlyOnceWith(document.id);
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(document.title);
    await act(async () => {
      finishSave({ note: { ...document, body: "移動前の編集", revision: "revision-2" }, status: "saved" });
      await pendingSave;
    });
    await expect(screen.findByRole("textbox", { name: "タイトル" })).resolves.toHaveValue(nextDocument.title);
    expect(api.readNote).toHaveBeenLastCalledWith(nextDocument.id);
  });

  it("保存後の一覧更新に失敗したら選択先へ移動しない", async () => {
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes)
      .mockResolvedValueOnce([summary, nextSummary])
      .mockRejectedValueOnce(new Error("refresh failed"));
    vi.mocked(api.readNote).mockResolvedValueOnce(document).mockResolvedValueOnce(nextDocument);
    vi.mocked(api.saveNote).mockResolvedValue({
      note: { ...document, body: "移動前の編集", revision: "revision-2" },
      status: "saved",
    });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    editBody(container, "移動前の編集");

    fireEvent.click(screen.getByRole("button", { name: /次のメモ/u }));

    await expect(screen.findByText("Error: refresh failed")).resolves.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(document.title);
    expect(api.readNote).toHaveBeenCalledExactlyOnceWith(document.id);
  });

  it("未保存内容と一覧更新を完了してから保存先選択を開く", async () => {
    const pendingSave = deferred<Awaited<ReturnType<typeof api.saveNote>>>();
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.saveNote).mockReturnValue(pendingSave.promise);
    vi.mocked(api.chooseVault).mockResolvedValue(null);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    await waitFor(() => {
      expect(container.querySelector(".document-view .cm-editor")).not.toBeNull();
    });
    editBody(container, "保存先変更前の編集");

    fireEvent.click(screen.getByTitle("保存先を変更"));

    expect(api.chooseVault).not.toHaveBeenCalled();
    await act(async () => {
      pendingSave.resolve({
        note: { ...document, body: "保存先変更前の編集", revision: "revision-2" },
        status: "saved",
      });
      await pendingSave.promise;
    });
    await waitFor(() => {
      expect(api.chooseVault).toHaveBeenCalledExactlyOnceWith();
    });
    expect(vi.mocked(api.saveNote).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.chooseVault).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(api.listNotes).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(api.chooseVault).mock.invocationCallOrder[0],
    );
  });

  it("保存競合時は保存先選択を開かない", async () => {
    const external = { ...document, body: "外部の本文", revision: "revision-2" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.saveNote).mockResolvedValue({ current: external, status: "conflict" });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    editBody(container, "保存先変更前の編集");

    fireEvent.click(screen.getByTitle("保存先を変更"));

    await expect(screen.findByRole("dialog")).resolves.toBeInTheDocument();
    expect(api.chooseVault).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(document.title);
  });

  it("保存エラー時は保存先選択を開かない", async () => {
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.saveNote).mockRejectedValue(new Error("save failed"));
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    editBody(container, "保存先変更前の編集");

    fireEvent.click(screen.getByTitle("保存先を変更"));

    await expect(screen.findByText("Error: save failed")).resolves.toBeInTheDocument();
    expect(api.chooseVault).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(document.title);
  });

  it("別のメモを読み込んだ直後に完了した古い外部読込を無視する", async () => {
    const externalRead = deferred<NoteDocument>();
    const nextRead = deferred<NoteDocument>();
    const external = { ...document, body: "古い外部読込", revision: "revision-2", title: "古い外部タイトル" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([{ ...summary, revision: external.revision }, nextSummary]);
    vi.mocked(api.readNote)
      .mockResolvedValueOnce(document)
      .mockReturnValueOnce(externalRead.promise)
      .mockReturnValueOnce(nextRead.promise);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    await waitFor(() => {
      expect(api.readNote).toHaveBeenNthCalledWith(2, document.id);
    });

    fireEvent.click(screen.getByRole("button", { name: /次のメモ/u }));
    expect(api.readNote).toHaveBeenNthCalledWith(3, nextDocument.id);
    await act(async () => {
      nextRead.resolve(nextDocument);
      externalRead.resolve(external);
      await Promise.all([nextRead.promise, externalRead.promise]);
    });

    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(nextDocument.title);
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!);
    expect(view?.state.doc.toString()).toBe(nextDocument.body);
  });

  it("未保存内容を保存してから確認済みメモをゴミ箱へ移動する", async () => {
    const pendingSave = deferred<Awaited<ReturnType<typeof api.saveNote>>>();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.saveNote).mockReturnValue(pendingSave.promise);
    vi.mocked(api.deleteNote).mockResolvedValue();
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    editBody(container, "削除前の編集");

    fireEvent.click(screen.getByRole("button", { name: "ゴミ箱へ" }));

    expect(api.deleteNote).not.toHaveBeenCalled();
    await act(async () => {
      pendingSave.resolve({ note: { ...document, body: "削除前の編集", revision: "revision-2" }, status: "saved" });
      await pendingSave.promise;
    });
    await waitFor(() => {
      expect(api.deleteNote).toHaveBeenCalledExactlyOnceWith(document.id);
    });
    await expect(screen.findByText("メモを選んでください")).resolves.toBeInTheDocument();
  });

  it("進行中の保存を完了してから確認済みメモをゴミ箱へ移動する", async () => {
    const pendingSave = deferred<Awaited<ReturnType<typeof api.saveNote>>>();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.saveNote).mockReturnValue(pendingSave.promise);
    vi.mocked(api.deleteNote).mockResolvedValue();
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    vi.useFakeTimers();
    editBody(container, "保存中の編集");
    await act(async () => vi.advanceTimersByTimeAsync(700));

    fireEvent.click(screen.getByRole("button", { name: "ゴミ箱へ" }));

    expect(api.deleteNote).not.toHaveBeenCalled();
    vi.useRealTimers();
    await act(async () => {
      pendingSave.resolve({ note: { ...document, body: "保存中の編集", revision: "revision-2" }, status: "saved" });
      await pendingSave.promise;
    });
    await waitFor(() => {
      expect(api.deleteNote).toHaveBeenCalledExactlyOnceWith(document.id);
    });
  });

  it("削除前の保存が競合したらメモをゴミ箱へ移動しない", async () => {
    const external = { ...document, body: "外部の本文", revision: "revision-2" };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.saveNote).mockResolvedValue({ current: external, status: "conflict" });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    editBody(container, "削除前の編集");

    fireEvent.click(screen.getByRole("button", { name: "ゴミ箱へ" }));

    await expect(screen.findByRole("dialog")).resolves.toBeInTheDocument();
    expect(api.deleteNote).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(document.title);
  });

  it("削除前の保存が失敗したらメモをゴミ箱へ移動しない", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([summary]);
    vi.mocked(api.readNote).mockResolvedValue(document);
    vi.mocked(api.saveNote).mockRejectedValue(new Error("save failed"));
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    editBody(container, "削除前の編集");

    fireEvent.click(screen.getByRole("button", { name: "ゴミ箱へ" }));

    await expect(screen.findByText("Error: save failed")).resolves.toBeInTheDocument();
    expect(api.deleteNote).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(document.title);
  });
});
