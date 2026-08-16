import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { App } from "./App";
import type { NoteDocument, NoteSummary, SaveResult } from "./types";

vi.mock(import("./api"), () => ({
  api: {
    chooseVault: vi.fn(),
    createNote: vi.fn(),
    deleteNote: vi.fn(),
    getVault: vi.fn(),
    listNotes: vi.fn(),
    readNote: vi.fn(),
    saveNote: vi.fn(),
    setVault: vi.fn(),
  },
}));

const source: NoteDocument = {
  body: "本文の [[りんご]]",
  id: "source.txt",
  links: [{ displayName: "りんご", normalizedName: "りんご" }],
  modifiedAt: 10,
  revision: "source-r1",
  title: "リンク元",
};

const older: NoteDocument = {
  body: "古い本文",
  id: "older.txt",
  links: [],
  modifiedAt: 20,
  revision: "older-r1",
  title: "古いりんご",
};

const newest: NoteDocument = {
  body: "新しい本文",
  id: "newest.txt",
  links: [],
  modifiedAt: 30,
  revision: "newest-r1",
  title: "最新のりんご",
};

const summaryOf = (note: NoteDocument): NoteSummary => ({
  id: note.id,
  links: note.links,
  modifiedAt: note.modifiedAt,
  preview: note.body,
  revision: note.revision,
  title: note.title,
});

function mockVault(notes: NoteDocument[] = [source, older, newest]) {
  vi.mocked(api.getVault).mockResolvedValue("/vault");
  vi.mocked(api.listNotes).mockResolvedValue(notes.map((note) => summaryOf(note)));
  vi.mocked(api.readNote).mockImplementation(async (id) => {
    await Promise.resolve();
    const note = notes.find((candidate) => candidate.id === id);
    if (!note) {
      throw new Error("missing note");
    }
    return note;
  });
  vi.mocked(api.saveNote).mockImplementation(async (input) => {
    await Promise.resolve();
    const note = notes.find((candidate) => candidate.id === input.id)!;
    return { note: { ...note, body: input.body, title: input.title }, status: "saved" };
  });
}

function resetTest() {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
}

function deferred<Value>() {
  let resolveDeferred: (value: Value) => void = vi.fn();
  // oxlint-disable-next-line promise/avoid-new -- This test controls an in-flight save.
  const promise = new Promise<Value>((resolve) => {
    resolveDeferred = resolve;
  });
  return { promise, resolve: resolveDeferred };
}

async function openSource() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /リンク元/u }));
  await screen.findByDisplayValue("リンク元");
}


const baseNote: NoteDocument = {
  body: "本文の [[りんご]]",
  id: "apple.txt",
  links: [{ displayName: "りんご", normalizedName: "りんご" }],
  modifiedAt: 1,
  revision: "revision-1",
  title: "りんごのメモ",
};

const baseSummary: NoteSummary = {
  id: baseNote.id,
  links: baseNote.links,
  modifiedAt: baseNote.modifiedAt,
  preview: baseNote.body,
  revision: baseNote.revision,
  title: baseNote.title,
};

const nextDocument: NoteDocument = {
  ...baseNote,
  body: "次の本文",
  id: "next.txt",
  links: [],
  revision: "next-r1",
  title: "次のメモ",
};

const nextSummary: NoteSummary = {
  ...baseSummary,
  id: nextDocument.id,
  links: nextDocument.links,
  revision: nextDocument.revision,
  title: nextDocument.title,
};

async function editBody(container: HTMLElement, body: string) {
  const view = await vi.waitFor(() => {
    const editor = container.querySelector<HTMLElement>(".cm-editor");
    if (!editor) {
      throw new Error("CodeMirror editor is not ready");
    }
    const editorView = EditorView.findFromDOM(editor);
    if (!editorView) {
      throw new Error("CodeMirror view is not ready");
    }
    return editorView;
  });
  act(() => {
    view.dispatch({ changes: { from: 0, insert: body, to: view.state.doc.length }, userEvent: "input.type" });
  });
}

describe(App, () => {
  it("wikiリンク検索と同じ候補から更新日時が最も新しいメモを開く", async () => {
    resetTest();
    mockVault();
    await openSource();

    fireEvent.click(document.querySelector(".cm-wikilink")!, { button: 0 });

    expect(screen.getByPlaceholderText("メモを検索")).toHaveValue("りんご");
    await screen.findByDisplayValue("最新のりんご");
    expect(api.readNote).toHaveBeenLastCalledWith("newest.txt");
    expect(screen.getByRole("button", { name: /古いりんご/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /最新のりんご/u })).toBeInTheDocument();
  });

  it("クリック元が最新なら再読込せず検索結果だけを絞り込む", async () => {
    resetTest();
    mockVault([{ ...source, modifiedAt: 40 }, older, newest]);
    await openSource();
    vi.mocked(api.readNote).mockClear();

    fireEvent.click(document.querySelector(".cm-wikilink")!, { button: 0 });

    expect(screen.getByPlaceholderText("メモを検索")).toHaveValue("りんご");
    await screen.findByDisplayValue("リンク元");
    expect(api.readNote).not.toHaveBeenCalled();
  });

  it("一致する概要がない場合は検索語と現在のメモを維持する", async () => {
    resetTest();
    mockVault([source]);
    vi.mocked(api.listNotes).mockResolvedValue([{ ...summaryOf(source), links: [], preview: "本文" }]);
    await openSource();
    vi.mocked(api.readNote).mockClear();

    fireEvent.click(document.querySelector(".cm-wikilink")!, { button: 0 });

    expect(screen.getByPlaceholderText("メモを検索")).toHaveValue("りんご");
    await screen.findByDisplayValue("リンク元");
    expect(screen.getByText("メモがありません")).toBeInTheDocument();
    expect(api.readNote).not.toHaveBeenCalled();
  });

  it("編集中なら保存完了後にWikiリンクの移動を始める", async () => {
    resetTest();
    mockVault();
    const pendingSave = deferred<SaveResult>();
    vi.mocked(api.saveNote).mockReturnValue(pendingSave.promise);
    await openSource();
    const editor = EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!;
    editor.dispatch({ changes: { from: 0, insert: "追記 " }, userEvent: "input.type" });

    fireEvent.click(document.querySelector(".cm-wikilink")!, { button: 0 });

    await waitFor(() => {
      // oxlint-disable-next-line vitest/prefer-called-once -- Explicit count reads clearly in this wait assertion.
      expect(api.saveNote).toHaveBeenCalledTimes(1);
    });
    // oxlint-disable-next-line vitest/prefer-called-once -- This count excludes the pending navigation read.
    expect(api.readNote).toHaveBeenCalledTimes(1);
    act(() => {
      pendingSave.resolve({ note: { ...source, body: editor.state.doc.toString(), revision: "source-r2" }, status: "saved" });
    });
    await screen.findByDisplayValue("最新のりんご");
    expect(api.readNote).toHaveBeenLastCalledWith("newest.txt");
  });

  it("保存でクリック元が最新になった場合は更新後の一覧を使って同じメモを維持する", async () => {
    resetTest();
    mockVault();
    const savedSource = { ...source, modifiedAt: 40, revision: "source-r2" };
    vi.mocked(api.listNotes)
      .mockReset()
      .mockResolvedValueOnce([source, older, newest].map((note) => summaryOf(note)))
      .mockResolvedValue([savedSource, older, newest].map((note) => summaryOf(note)));
    vi.mocked(api.saveNote).mockResolvedValue({ note: savedSource, status: "saved" });
    await openSource();
    vi.mocked(api.readNote).mockClear();
    const editor = EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!;
    editor.dispatch({ changes: { from: 0, insert: "追記 " }, userEvent: "input.type" });

    fireEvent.click(document.querySelector(".cm-wikilink")!, { button: 0 });

    await waitFor(() => {
      expect(api.listNotes).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByPlaceholderText("メモを検索")).toHaveValue("りんご");
    expect(api.readNote).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("リンク元")).toBeInTheDocument();
  });

  it("専用の関連画面と右側パネルを表示しない", async () => {
    resetTest();
    mockVault();
    await openSource();

    expect(screen.queryByText("CONNECTED NOTES")).not.toBeInTheDocument();
    expect(screen.queryByText("CONNECTIONS")).not.toBeInTheDocument();
    expect(screen.queryByText(/#タグを書くと/u)).not.toBeInTheDocument();
    expect(document.querySelector(".connections-panel")).toBeNull();
  });

  it("通常メモを700ms後に保存する", async () => {
    resetTest();
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([baseSummary]);
    vi.mocked(api.readNote).mockResolvedValue(baseNote);
    vi.mocked(api.saveNote).mockResolvedValue({
      note: { ...baseNote, body: "編集後", revision: "r2" },
      status: "saved",
    });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    vi.useFakeTimers();
    await editBody(container, "編集後");

    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(api.saveNote).toHaveBeenCalledExactlyOnceWith({
      body: "編集後",
      expectedRevision: baseNote.revision,
      id: baseNote.id,
      title: baseNote.title,
    });
  });

  it("競合時に外部の内容を読み込む", async () => {
    resetTest();
    const external = { ...baseNote, body: "外部の本文", revision: "r2", title: "外部のタイトル" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([baseSummary]);
    vi.mocked(api.readNote).mockResolvedValue(baseNote);
    vi.mocked(api.saveNote).mockResolvedValue({ current: external, status: "conflict" });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    vi.useFakeTimers();
    await editBody(container, "ローカルの本文");
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
    resetTest();
    const external = { ...baseNote, body: "外部の本文", revision: "r2" };
    const saved = { ...baseNote, body: "ローカルの本文", revision: "r3" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([baseSummary]);
    vi.mocked(api.readNote).mockResolvedValue(baseNote);
    vi.mocked(api.saveNote)
      .mockResolvedValueOnce({ current: external, status: "conflict" })
      .mockResolvedValueOnce({ note: saved, status: "saved" });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    vi.useFakeTimers();
    await editBody(container, "ローカルの本文");
    await act(async () => vi.advanceTimersByTimeAsync(700));
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: "現在の編集で上書き" }));

    await waitFor(() => {
      expect(api.saveNote).toHaveBeenCalledTimes(2);
    });
    expect(api.saveNote).toHaveBeenLastCalledWith({
      body: "ローカルの本文",
      expectedRevision: external.revision,
      id: baseNote.id,
      overwrite: true,
      title: baseNote.title,
    });
    await expect(screen.findByText("保存済み")).resolves.toBeInTheDocument();
  });

  it("未保存の通常メモを即時保存してから選択先へ移動する", async () => {
    resetTest();
    let finishSave: (result: Awaited<ReturnType<typeof api.saveNote>>) => void = vi.fn();
    // oxlint-disable-next-line promise/avoid-new -- The pending save proves navigation waits for persistence.
    const pendingSave = new Promise<Awaited<ReturnType<typeof api.saveNote>>>((resolve) => {
      finishSave = resolve;
    });
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([baseSummary, nextSummary]);
    vi.mocked(api.readNote).mockResolvedValueOnce(baseNote).mockResolvedValueOnce(nextDocument);
    vi.mocked(api.saveNote).mockReturnValue(pendingSave);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    await editBody(container, "移動前の編集");

    fireEvent.click(screen.getByRole("button", { name: /次のメモ/u }));

    expect(api.saveNote).toHaveBeenCalledExactlyOnceWith({
      body: "移動前の編集",
      expectedRevision: baseNote.revision,
      id: baseNote.id,
      title: baseNote.title,
    });
    expect(api.readNote).toHaveBeenCalledExactlyOnceWith(baseNote.id);
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(baseNote.title);
    await act(async () => {
      finishSave({ note: { ...baseNote, body: "移動前の編集", revision: "revision-2" }, status: "saved" });
      await pendingSave;
    });
    await expect(screen.findByRole("textbox", { name: "タイトル" })).resolves.toHaveValue(nextDocument.title);
    expect(api.readNote).toHaveBeenLastCalledWith(nextDocument.id);
  });

  it("保存後の一覧更新に失敗したら選択先へ移動しない", async () => {
    resetTest();
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes)
      .mockResolvedValueOnce([baseSummary, nextSummary])
      .mockRejectedValueOnce(new Error("refresh failed"));
    vi.mocked(api.readNote).mockResolvedValueOnce(baseNote).mockResolvedValueOnce(nextDocument);
    vi.mocked(api.saveNote).mockResolvedValue({
      note: { ...baseNote, body: "移動前の編集", revision: "revision-2" },
      status: "saved",
    });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    await editBody(container, "移動前の編集");

    fireEvent.click(screen.getByRole("button", { name: /次のメモ/u }));

    await expect(screen.findByText("Error: refresh failed")).resolves.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(baseNote.title);
    expect(api.readNote).toHaveBeenCalledExactlyOnceWith(baseNote.id);
  });

  it("未保存内容と一覧更新を完了してから保存先選択を開く", async () => {
    resetTest();
    const pendingSave = deferred<Awaited<ReturnType<typeof api.saveNote>>>();
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([baseSummary]);
    vi.mocked(api.readNote).mockResolvedValue(baseNote);
    vi.mocked(api.saveNote).mockReturnValue(pendingSave.promise);
    vi.mocked(api.chooseVault).mockResolvedValue(null);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    await waitFor(() => {
      expect(container.querySelector(".document-view .cm-editor")).not.toBeNull();
    });
    await editBody(container, "保存先変更前の編集");

    fireEvent.click(screen.getByTitle("保存先を変更"));

    expect(api.chooseVault).not.toHaveBeenCalled();
    await act(async () => {
      pendingSave.resolve({
        note: { ...baseNote, body: "保存先変更前の編集", revision: "revision-2" },
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
    resetTest();
    const external = { ...baseNote, body: "外部の本文", revision: "revision-2" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([baseSummary]);
    vi.mocked(api.readNote).mockResolvedValue(baseNote);
    vi.mocked(api.saveNote).mockResolvedValue({ current: external, status: "conflict" });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    await editBody(container, "保存先変更前の編集");

    fireEvent.click(screen.getByTitle("保存先を変更"));

    await expect(screen.findByRole("dialog")).resolves.toBeInTheDocument();
    expect(api.chooseVault).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(baseNote.title);
  });

  it("保存エラー時は保存先選択を開かない", async () => {
    resetTest();
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([baseSummary]);
    vi.mocked(api.readNote).mockResolvedValue(baseNote);
    vi.mocked(api.saveNote).mockRejectedValue(new Error("save failed"));
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    await editBody(container, "保存先変更前の編集");

    fireEvent.click(screen.getByTitle("保存先を変更"));

    await expect(screen.findByText("Error: save failed")).resolves.toBeInTheDocument();
    expect(api.chooseVault).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(baseNote.title);
  });

  it("別のメモを読み込んだ直後に完了した古い外部読込を無視する", async () => {
    resetTest();
    const externalRead = deferred<NoteDocument>();
    const nextRead = deferred<NoteDocument>();
    const external = { ...baseNote, body: "古い外部読込", revision: "revision-2", title: "古い外部タイトル" };
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([{ ...baseSummary, revision: external.revision }, nextSummary]);
    vi.mocked(api.readNote)
      .mockResolvedValueOnce(baseNote)
      .mockReturnValueOnce(externalRead.promise)
      .mockReturnValueOnce(nextRead.promise);
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    await waitFor(() => {
      expect(api.readNote).toHaveBeenNthCalledWith(2, baseNote.id);
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
    resetTest();
    const pendingSave = deferred<Awaited<ReturnType<typeof api.saveNote>>>();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([baseSummary]);
    vi.mocked(api.readNote).mockResolvedValue(baseNote);
    vi.mocked(api.saveNote).mockReturnValue(pendingSave.promise);
    vi.mocked(api.deleteNote).mockResolvedValue();
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    await editBody(container, "削除前の編集");

    fireEvent.click(screen.getByRole("button", { name: "ゴミ箱へ" }));

    expect(api.deleteNote).not.toHaveBeenCalled();
    await act(async () => {
      pendingSave.resolve({ note: { ...baseNote, body: "削除前の編集", revision: "revision-2" }, status: "saved" });
      await pendingSave.promise;
    });
    await waitFor(() => {
      expect(api.deleteNote).toHaveBeenCalledExactlyOnceWith(baseNote.id);
    });
    await expect(screen.findByText("メモを選んでください")).resolves.toBeInTheDocument();
  });

  it("進行中の保存を完了してから確認済みメモをゴミ箱へ移動する", async () => {
    resetTest();
    const pendingSave = deferred<Awaited<ReturnType<typeof api.saveNote>>>();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([baseSummary]);
    vi.mocked(api.readNote).mockResolvedValue(baseNote);
    vi.mocked(api.saveNote).mockReturnValue(pendingSave.promise);
    vi.mocked(api.deleteNote).mockResolvedValue();
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    vi.useFakeTimers();
    await editBody(container, "保存中の編集");
    await act(async () => vi.advanceTimersByTimeAsync(700));

    fireEvent.click(screen.getByRole("button", { name: "ゴミ箱へ" }));

    expect(api.deleteNote).not.toHaveBeenCalled();
    vi.useRealTimers();
    await act(async () => {
      pendingSave.resolve({ note: { ...baseNote, body: "保存中の編集", revision: "revision-2" }, status: "saved" });
      await pendingSave.promise;
    });
    await waitFor(() => {
      expect(api.deleteNote).toHaveBeenCalledExactlyOnceWith(baseNote.id);
    });
  });

  it("削除前の保存が競合したらメモをゴミ箱へ移動しない", async () => {
    resetTest();
    const external = { ...baseNote, body: "外部の本文", revision: "revision-2" };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([baseSummary]);
    vi.mocked(api.readNote).mockResolvedValue(baseNote);
    vi.mocked(api.saveNote).mockResolvedValue({ current: external, status: "conflict" });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    await editBody(container, "削除前の編集");

    fireEvent.click(screen.getByRole("button", { name: "ゴミ箱へ" }));

    await expect(screen.findByRole("dialog")).resolves.toBeInTheDocument();
    expect(api.deleteNote).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(baseNote.title);
  });

  it("削除前の保存が失敗したらメモをゴミ箱へ移動しない", async () => {
    resetTest();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([baseSummary]);
    vi.mocked(api.readNote).mockResolvedValue(baseNote);
    vi.mocked(api.saveNote).mockRejectedValue(new Error("save failed"));
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
    await screen.findByRole("textbox", { name: "タイトル" });
    await editBody(container, "削除前の編集");

    fireEvent.click(screen.getByRole("button", { name: "ゴミ箱へ" }));

    await expect(screen.findByText("Error: save failed")).resolves.toBeInTheDocument();
    expect(api.deleteNote).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(baseNote.title);
  });
});
