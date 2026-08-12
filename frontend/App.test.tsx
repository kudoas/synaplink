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

function editBody(container: HTMLElement, body: string) {
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!);
  act(() => {
    view!.dispatch({ changes: { from: 0, insert: body, to: view!.state.doc.length }, userEvent: "input.type" });
  });
}

describe(App, () => {
  // oxlint-disable-next-line vitest/no-hooks -- API doubles must not leak calls or implementations between App cases.
  beforeEach(() => vi.resetAllMocks());
  // oxlint-disable-next-line vitest/no-hooks -- Fake timers must not leak into unrelated suites.
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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
});
