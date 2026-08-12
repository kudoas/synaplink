import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { App } from "./App";
import type { NoteDocument, NoteSummary } from "./types";

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

function editBody(container: HTMLElement, body: string) {
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!);
  act(() => {
    view!.dispatch({ changes: { from: 0, insert: body, to: view!.state.doc.length }, userEvent: "input.type" });
  });
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolveDeferred: (value: Value) => void = vi.fn();
  // oxlint-disable-next-line promise/avoid-new -- Tests need explicit control over in-flight operations.
  const promise = new Promise<Value>((resolve) => {
    resolveDeferred = resolve;
  });
  return { promise, resolve: resolveDeferred };
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
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await waitFor(() => {
      expect(container.querySelector(".cm-zettel-tag")).not.toBeNull();
    });

    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);

    await expect(screen.findByText("CONNECTED NOTES")).resolves.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "#りんご" })).toBeInTheDocument();
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
