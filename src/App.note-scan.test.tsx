import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { App } from "./App";
import type { NoteDocument, NoteScanIssue, NoteSummary } from "./types";

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

const note: NoteDocument = {
  body: "読める本文",
  id: "valid.txt",
  links: [],
  modifiedAt: 1,
  revision: "valid-r1",
  title: "読めるメモ",
};
const summary: NoteSummary = { ...note, preview: note.body };
const issues: NoteScanIssue[] = [{ message: "invalid UTF-8", path: "/vault/invalid.txt" }];
const currentIssues: NoteScanIssue[] = [{ message: "permission denied", path: "/vault/current.txt" }];

function resetTest() {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.mocked(api.getVault).mockResolvedValue("/vault");
  vi.mocked(api.readNote).mockResolvedValue(note);
  vi.mocked(api.listNotes).mockImplementation(async (onIssues) => {
    await Promise.resolve();
    onIssues?.(issues);
    return [summary];
  });
}

function deferred<Value>() {
  let resolveDeferred: (value: Value) => void = vi.fn();
  // oxlint-disable-next-line promise/avoid-new -- Controls the ordering of list responses.
  const promise = new Promise<Value>((resolve) => { resolveDeferred = resolve; });
  return { promise, resolve: resolveDeferred };
}

async function openVault() {
  await act(async () => {
    render(<App />);
    await Promise.resolve();
  });
}

describe("メモ一覧の部分読込警告", () => {
  it("読めるメモを開けて再読込成功後に警告が消える", async () => {
    resetTest();
    await openVault();
    expect(screen.getByRole("status", { name: "メモ一覧の読込警告" })).toHaveTextContent("/vault/invalid.txt");
    fireEvent.click(screen.getByRole("button", { name: /読めるメモ/u }));
    const title = await screen.findByDisplayValue("読めるメモ");
    expect(title).toBeInTheDocument();
    vi.mocked(api.listNotes).mockImplementation(async (onIssues) => {
      await Promise.resolve();
      onIssues?.([]);
      return [summary];
    });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "一覧を再読込" })); await Promise.resolve(); });

    expect(screen.queryByRole("status", { name: "メモ一覧の読込警告" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("読めるメモ")).toBeInTheDocument();
  });

  it("再読込の全体失敗で警告と表示中メモを保持してエラーを知らせる", async () => {
    resetTest();
    await openVault();
    fireEvent.click(screen.getByRole("button", { name: /読めるメモ/u }));
    const title = await screen.findByDisplayValue("読めるメモ");
    vi.mocked(api.listNotes).mockRejectedValue(new Error("保存先フォルダを読み込めません"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "一覧を再読込" }));
      await Promise.resolve();
    });

    expect(screen.getByRole("status", { name: "メモ一覧の読込警告" })).toHaveTextContent("/vault/invalid.txt");
    expect(screen.getByRole("button", { name: /読めるメモ/u })).toBeInTheDocument();
    expect(title).toHaveValue("読めるメモ");
    expect(title).toBeEnabled();
    expect(screen.getByRole("button", { name: /保存先フォルダを読み込めません/u })).toBeInTheDocument();
  });

  it("古いポーリング応答の警告で新しい警告を上書きしない", async () => {
    resetTest();
    const oldPoll = deferred<NoteSummary[]>();
    let reportOldIssues: (reported: NoteScanIssue[]) => void = vi.fn();
    vi.mocked(api.listNotes)
      .mockResolvedValueOnce([summary])
      .mockImplementationOnce(async (onIssues) => {
        reportOldIssues = onIssues!;
        await Promise.resolve();
        return oldPoll.promise;
      })
      .mockImplementation(async (onIssues) => {
        await Promise.resolve();
        onIssues?.(currentIssues);
        return [summary];
      });
    vi.useFakeTimers();
    await openVault();
    await act(async () => vi.advanceTimersByTimeAsync(5000));

    await act(async () => {
      reportOldIssues(issues);
      oldPoll.resolve([summary]);
      await oldPoll.promise;
    });

    const warning = screen.getByRole("status", { name: "メモ一覧の読込警告" });
    expect(warning).toHaveTextContent("/vault/current.txt");
    expect(warning).not.toHaveTextContent("/vault/invalid.txt");
  });

  it("保存先変更後の旧応答に含まれる警告を反映しない", async () => {
    resetTest();
    const oldPoll = deferred<NoteSummary[]>();
    let reportOldIssues: (reported: NoteScanIssue[]) => void = vi.fn();
    vi.mocked(api.listNotes)
      .mockResolvedValueOnce([summary])
      .mockImplementationOnce(async (onIssues) => {
        reportOldIssues = onIssues!;
        await Promise.resolve();
        return oldPoll.promise;
      })
      .mockImplementation(async (onIssues) => {
        await Promise.resolve();
        onIssues?.([]);
        return [summary];
      });
    vi.mocked(api.chooseVault).mockResolvedValue("/vault-new");
    vi.mocked(api.setVault).mockImplementation(async () => { await Promise.resolve(); });
    vi.useFakeTimers();
    await openVault();
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    await act(async () => { fireEvent.click(screen.getByTitle("保存先を変更")); await Promise.resolve(); });

    await act(async () => {
      reportOldIssues(issues);
      oldPoll.resolve([summary]);
      await oldPoll.promise;
    });

    expect(screen.getByTitle("/vault-new")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "メモ一覧の読込警告" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /読めるメモ/u })).toBeInTheDocument();
  });
});
