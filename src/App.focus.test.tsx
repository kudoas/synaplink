import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./api";
import type { NoteDocument, NoteSummary } from "./types";

vi.mock(import("./api"), () => ({
  api: {
    chooseVault: vi.fn(), createNote: vi.fn(), deleteNote: vi.fn(), getVault: vi.fn(), listNotes: vi.fn(),
    readNote: vi.fn(), saveNote: vi.fn(), setVault: vi.fn(),
  },
}));

const oldNote: NoteDocument = { body: "既存の本文", id: "old.txt", links: [], modifiedAt: 1, revision: "old-r1", title: "既存のメモ" };
const newNote: NoteDocument = { body: "", id: "new.txt", links: [], modifiedAt: 2, revision: "new-r1", title: "無題" };
const summary = (note: NoteDocument): NoteSummary => ({ ...note, preview: note.body });

function deferred<Value>() {
  let finish: (value: Value) => void = vi.fn();
  // oxlint-disable-next-line promise/avoid-new -- These cases control creation and list refresh independently.
  const promise = new Promise<Value>((resolve) => { finish = resolve; });
  return { promise, resolve: finish };
}

async function renderVault() {
  await act(async () => { render(<App />); await Promise.resolve(); });
}

describe("new-note focus", () => {
  // oxlint-disable-next-line vitest/no-hooks -- Every case has its own vault and controlled polling timer.
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.mocked(api.getVault).mockResolvedValue("/focus-audit");
    vi.mocked(api.listNotes).mockResolvedValue([summary(oldNote)]);
    vi.mocked(api.readNote).mockResolvedValue(oldNote);
    vi.mocked(api.createNote).mockResolvedValue(newNote);
    vi.mocked(api.chooseVault).mockResolvedValue(null);
  });
  // oxlint-disable-next-line vitest/no-hooks -- A failure must not leak timers or editors to another suite.
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("作成と一覧更新の成功後だけタイトルをfocusして初期タイトルを選択する", async () => {
    const creation = deferred<NoteDocument>();
    const listing = deferred<NoteSummary[]>();
    vi.mocked(api.createNote).mockReturnValue(creation.promise);
    await renderVault();
    vi.mocked(api.listNotes).mockReturnValue(listing.promise);
    const create = screen.getByRole("button", { name: /新しいメモ/u });
    create.focus();
    fireEvent.click(create);
    expect(document.activeElement).toBe(create);
    await act(async () => { creation.resolve(newNote); await creation.promise; });
    expect(document.activeElement).toBe(create);
    await act(async () => { listing.resolve([summary(oldNote), summary(newNote)]); await listing.promise; });
    const title = screen.getByRole<HTMLInputElement>("textbox", { name: "タイトル" });

    expect(document.activeElement).toBe(title);
    expect({ end: title.selectionEnd, start: title.selectionStart, value: title.value }).toStrictEqual({ end: 2, start: 0, value: "無題" });
  });

  it("通常選択・poll・保存先選択のキャンセルではfocusを奪わない", async () => {
    await renderVault();
    vi.mocked(api.listNotes).mockResolvedValue([summary(oldNote), summary(newNote)]);
    fireEvent.click(screen.getByRole("button", { name: /新しいメモ/u }));
    await act(async () => { await Promise.resolve(); });
    const search = screen.getByPlaceholderText("メモを検索");
    search.focus();
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(document.activeElement).toBe(search);

    const vault = screen.getByTitle("保存先を変更");
    vault.focus();
    await act(async () => { fireEvent.click(vault); await Promise.resolve(); });
    expect(document.activeElement).toBe(vault);
    const existing = screen.getByRole("button", { name: /既存のメモ/u });
    existing.focus();
    await act(async () => { fireEvent.click(existing); await Promise.resolve(); });
    expect(document.activeElement).toBe(existing);
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(oldNote.title);
  });

  it("作成後の一覧更新に失敗してもfocus要求を残さない", async () => {
    await renderVault();
    vi.mocked(api.listNotes).mockRejectedValueOnce(new Error("listing failed"));
    const create = screen.getByRole("button", { name: /新しいメモ/u });
    create.focus();
    await act(async () => { fireEvent.click(create); await Promise.resolve(); });

    expect(screen.getByText("Error: listing failed")).toBeInTheDocument();
    expect(document.activeElement).toBe(create);
    const existing = screen.getByRole("button", { name: /既存のメモ/u });
    existing.focus();
    await act(async () => { fireEvent.click(existing); await Promise.resolve(); });
    expect(document.activeElement).toBe(existing);
  });

  it("作成中に別の移動要求が来たら古い作成結果でfocusしない", async () => {
    const creation = deferred<NoteDocument>();
    vi.mocked(api.createNote).mockReturnValue(creation.promise);
    await renderVault();
    fireEvent.click(screen.getByRole("button", { name: /新しいメモ/u }));
    const existing = screen.getByRole("button", { name: /既存のメモ/u });
    existing.focus();
    fireEvent.click(existing);
    await act(async () => { creation.resolve(newNote); await creation.promise; });

    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(oldNote.title);
    expect(document.activeElement).toBe(existing);
  });
});
