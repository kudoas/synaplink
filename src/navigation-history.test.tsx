import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { App } from "./App";
import type { NoteDocument, SaveResult } from "./types";

vi.mock(import("./api"), () => ({
  api: {
    chooseVault: vi.fn(), createNote: vi.fn(), deleteNote: vi.fn(), getVault: vi.fn(),
    listNotes: vi.fn(), readNote: vi.fn(), saveNote: vi.fn(), setVault: vi.fn(),
  },
}));

const first: NoteDocument = {
  body: "[[関連]]", id: "first.txt", links: [{ displayName: "関連", normalizedName: "関連" }], modifiedAt: 1, revision: "a1", title: "メモA",
};
const second: NoteDocument = { body: "関連の本文", id: "second.txt", links: [], modifiedAt: 2, revision: "b1", title: "メモB" };
const third: NoteDocument = { body: "別の本文", id: "third.txt", links: [], modifiedAt: 3, revision: "c1", title: "メモC" };

function deferred<Value>() {
  let finish: (value: Value) => void = vi.fn();
  // oxlint-disable-next-line promise/avoid-new -- The test controls completion of a save or destination read.
  const promise = new Promise<Value>((resolve) => { finish = resolve; });
  return { promise, resolve: finish };
}

function mockVault(initial: NoteDocument[] = [first, second, third]) {
  const notes = initial.map((note) => ({ ...note }));
  vi.mocked(api.getVault).mockResolvedValue("/vault");
  vi.mocked(api.listNotes).mockImplementation(async () => {
    await Promise.resolve();
    return notes.map((note) => ({ ...note, preview: note.body }));
  });
  vi.mocked(api.readNote).mockImplementation(async (id) => {
    await Promise.resolve();
    const note = notes.find((candidate) => candidate.id === id);
    if (!note) { throw new Error("missing note"); }
    return note;
  });
  vi.mocked(api.saveNote).mockImplementation(async (input) => {
    await Promise.resolve();
    const index = notes.findIndex((note) => note.id === input.id);
    const note = { ...notes[index], body: input.body, revision: "saved", title: input.title };
    notes[index] = note;
    return { note, status: "saved" };
  });
  vi.mocked(api.deleteNote).mockImplementation(async (id) => {
    await Promise.resolve();
    const index = notes.findIndex((note) => note.id === id);
    notes.splice(index, 1);
  });
  return notes;
}

async function waitForTitle(title: string) {
  await waitFor(() => {
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue(title);
  });
}

async function openNote(title: string) {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(title, "u") }));
  await waitForTitle(title);
}

async function clickWikiLink() {
  const link = await waitFor(() => {
    const element = document.querySelector(".cm-wikilink");
    if (!element) { throw new Error("Wiki link is not ready"); }
    return element;
  });
  fireEvent.click(link);
}

const backButton = () => screen.getByRole("button", { name: "戻る" });
const forwardButton = () => screen.getByRole("button", { name: "進む" });

describe("note navigation history", () => {
  // oxlint-disable-next-line vitest/no-hooks -- Every case owns its rendered app and API mocks.
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("空画面と最初のメモでは戻る・進むを無効にする", async () => {
    mockVault();
    render(<App />);
    await screen.findByText("メモを選んでください");
    expect(backButton()).toBeDisabled();
    expect(forwardButton()).toBeDisabled();
    await openNote("メモA");
    expect(backButton()).toBeDisabled();
    expect(forwardButton()).toBeDisabled();
  });

  it("wikiリンク移動を戻る・進むと検索語と選択メモを復元する", async () => {
    mockVault();
    render(<App />);
    const search = await screen.findByPlaceholderText("メモを検索");
    fireEvent.change(search, { target: { value: "メモA" } });
    await openNote("メモA");
    await clickWikiLink();
    await waitForTitle("メモB");
    expect(search).toHaveValue("関連");
    fireEvent.click(backButton());
    await waitForTitle("メモA");
    expect(search).toHaveValue("メモA");
    expect(backButton()).toBeDisabled();
    fireEvent.click(forwardButton());
    await waitForTitle("メモB");
    expect(search).toHaveValue("関連");
    expect(forwardButton()).toBeDisabled();
  });

  it("戻った後に別のメモを開くと進む履歴を破棄する", async () => {
    mockVault();
    render(<App />);
    await openNote("メモA");
    await openNote("メモB");
    fireEvent.click(backButton());
    await waitForTitle("メモA");
    await openNote("メモC");
    expect(forwardButton()).toBeDisabled();
    fireEvent.click(backButton());
    await waitForTitle("メモA");
    expect(backButton()).toBeDisabled();
    fireEvent.click(forwardButton());
    await waitForTitle("メモC");
  });

  it("wikiリンク先の読込失敗では検索語と選択メモを変更しない", async () => {
    mockVault();
    render(<App />);
    const search = await screen.findByPlaceholderText("メモを検索");
    fireEvent.change(search, { target: { value: "メモA" } });
    await openNote("メモA");
    vi.mocked(api.readNote).mockRejectedValueOnce(new Error("link read failed"));
    await clickWikiLink();
    await screen.findByText("Error: link read failed");
    expect(screen.getByRole("textbox", { name: "タイトル" })).toHaveValue("メモA");
    expect(search).toHaveValue("メモA");
    expect(backButton()).toBeDisabled();
    expect(forwardButton()).toBeDisabled();
  });

  it("同じメモの再選択は重複を追加せず進む履歴も保持する", async () => {
    mockVault();
    render(<App />);
    await openNote("メモA");
    await openNote("メモB");
    fireEvent.click(backButton());
    await waitForTitle("メモA");
    await openNote("メモA");
    expect(backButton()).toBeDisabled();
    expect(forwardButton()).toBeEnabled();
    fireEvent.click(forwardButton());
    await waitForTitle("メモB");
  });

  it("同じメモを維持するwiki検索は履歴を増やさず検索語だけ更新する", async () => {
    mockVault([{ ...first, modifiedAt: 10 }, second, third]);
    render(<App />);
    await openNote("メモA");
    await clickWikiLink();
    expect(screen.getByPlaceholderText("メモを検索")).toHaveValue("関連");
    expect(backButton()).toBeDisabled();
    await openNote("メモB");
    fireEvent.click(backButton());
    await waitForTitle("メモA");
    expect(backButton()).toBeDisabled();
    expect(screen.getByPlaceholderText("メモを検索")).toHaveValue("関連");
  });

  it("新規作成したメモも戻る・進むで再び開ける", async () => {
    const notes = mockVault();
    const created = { ...third, id: "created.txt", title: "新規メモ" };
    vi.mocked(api.createNote).mockImplementation(async () => {
      await Promise.resolve();
      notes.push(created);
      return created;
    });
    render(<App />);
    await openNote("メモA");
    fireEvent.click(screen.getByRole("button", { name: /新しいメモ/u }));
    await waitForTitle("新規メモ");
    expect(backButton()).toBeEnabled();
    fireEvent.click(backButton());
    await waitForTitle("メモA");
    fireEvent.click(forwardButton());
    await waitForTitle("新規メモ");
    expect(forwardButton()).toBeDisabled();
  });

  it("未保存メモでは保存完了まで履歴の読込とcursor移動を待つ", async () => {
    mockVault();
    render(<App />);
    await openNote("メモA");
    await openNote("メモB");
    const pending = deferred<SaveResult>();
    vi.mocked(api.saveNote).mockReturnValueOnce(pending.promise);
    vi.mocked(api.readNote).mockClear();
    fireEvent.change(screen.getByLabelText("タイトル"), { target: { value: "編集したメモB" } });
    fireEvent.click(backButton());
    expect(api.readNote).not.toHaveBeenCalled();
    expect(forwardButton()).toBeDisabled();
    await act(async () => {
      pending.resolve({ note: { ...second, title: "編集したメモB" }, status: "saved" });
      await pending.promise;
    });
    await waitForTitle("メモA");
    expect(api.saveNote).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: second.id, title: "編集したメモB" }));
    expect(forwardButton()).toBeEnabled();
  });

  it("保存失敗ではメモと履歴位置を保ち破棄closeで履歴を消す", async () => {
    mockVault();
    render(<App />);
    await openNote("メモA");
    await openNote("メモB");
    vi.mocked(api.saveNote).mockRejectedValueOnce(new Error("save failed"));
    vi.mocked(api.readNote).mockClear();
    fireEvent.change(screen.getByLabelText("タイトル"), { target: { value: "未保存メモB" } });
    fireEvent.click(backButton());
    await screen.findByText("Error: save failed");
    expect(api.readNote).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("未保存メモB")).toBeInTheDocument();
    expect(forwardButton()).toBeDisabled();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "編集を破棄して閉じる" }));
    await screen.findByText("メモを選んでください");
    expect(backButton()).toBeDisabled();
    expect(forwardButton()).toBeDisabled();
  });

  it("保存競合では履歴を進めず解決後に同じ戻り先へ移動できる", async () => {
    mockVault();
    render(<App />);
    await openNote("メモA");
    await openNote("メモB");
    vi.mocked(api.saveNote).mockResolvedValueOnce({ current: second, status: "conflict" });
    vi.mocked(api.readNote).mockClear();
    fireEvent.change(screen.getByLabelText("タイトル"), { target: { value: "競合するメモB" } });
    fireEvent.click(backButton());
    await screen.findByRole("dialog");
    expect(api.readNote).not.toHaveBeenCalled();
    expect(backButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "外部の内容を読む" }));
    fireEvent.click(backButton());
    await waitForTitle("メモA");
    expect(forwardButton()).toBeEnabled();
  });

  it("履歴先の読込失敗では検索語とcursorを保ち再試行できる", async () => {
    mockVault();
    render(<App />);
    await openNote("メモA");
    await openNote("メモB");
    await openNote("メモC");
    fireEvent.change(screen.getByPlaceholderText("メモを検索"), { target: { value: "メモ" } });
    vi.mocked(api.readNote).mockRejectedValueOnce(new Error("missing note"));
    fireEvent.click(backButton());
    await screen.findByText("Error: missing note");
    expect(screen.getByDisplayValue("メモC")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("メモを検索")).toHaveValue("メモ");
    expect(forwardButton()).toBeDisabled();
    fireEvent.click(backButton());
    await waitForTitle("メモB");
    expect(forwardButton()).toBeEnabled();
    expect(screen.queryByText("Error: missing note")).not.toBeInTheDocument();
  });

  it("履歴読込中の新しいメモ選択が勝ち古い移動先を記録しない", async () => {
    mockVault();
    render(<App />);
    await openNote("メモA");
    await openNote("メモB");
    await openNote("メモC");
    const pending = deferred<NoteDocument>();
    vi.mocked(api.readNote).mockReturnValueOnce(pending.promise);
    fireEvent.click(backButton());
    fireEvent.click(screen.getByRole("button", { name: /メモA/u }));
    await act(async () => {
      pending.resolve(second);
      await pending.promise;
    });
    await waitForTitle("メモA");
    fireEvent.click(backButton());
    await waitForTitle("メモC");
    expect(forwardButton()).toBeEnabled();
  });

  it("現在のメモを削除すると空画面に戻り履歴も消す", async () => {
    mockVault();
    render(<App />);
    await openNote("メモA");
    await openNote("メモB");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "ゴミ箱へ" }));
    await screen.findByText("メモを選んでください");
    expect(backButton()).toBeDisabled();
    expect(forwardButton()).toBeDisabled();
  });

  it("保存先を変えると検索語と履歴をリセットする", async () => {
    mockVault();
    render(<App />);
    await openNote("メモA");
    await openNote("メモB");
    fireEvent.change(screen.getByPlaceholderText("メモを検索"), { target: { value: "メモB" } });
    vi.mocked(api.chooseVault).mockResolvedValue("/another-vault");
    vi.mocked(api.setVault).mockImplementation(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByTitle("保存先を変更"));
    await screen.findByTitle("/another-vault");
    expect(screen.getByPlaceholderText("メモを検索")).toHaveValue("");
    expect(backButton()).toBeDisabled();
    expect(forwardButton()).toBeDisabled();
    await openNote("メモA");
    expect(backButton()).toBeDisabled();
  });
});
