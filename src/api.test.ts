import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { api } from "./api";

vi.mock(import("@tauri-apps/api/core"), () => ({ invoke: vi.fn() }));
vi.mock(import("@tauri-apps/plugin-dialog"), () => ({ open: vi.fn() }));

describe("note api", () => {
  it("メモの保存をバックエンドへ渡す", async () => {
    vi.mocked(invoke).mockReset().mockResolvedValue({ status: "saved" });
    const input = { body: "本文", expectedRevision: "r1", id: "note.txt", title: "題名" };

    await api.saveNote(input);

    expect(invoke).toHaveBeenCalledExactlyOnceWith("save_note", { input });
  });

  it("一覧の部分読込失敗を同じ応答のコールバックへ渡す", async () => {
    const issues = [{ message: "invalid UTF-8", path: "/vault/invalid.txt" }];
    const notes = [{ id: "valid.txt" }];
    vi.mocked(invoke).mockReset().mockResolvedValue({ issues, notes });
    const onIssues = vi.fn();

    const result = await api.listNotes(onIssues);

    expect(result).toStrictEqual(notes);
    expect(onIssues).toHaveBeenCalledExactlyOnceWith(issues);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("list_notes");
    await expect(api.listNotes()).resolves.toStrictEqual(notes);
  });

  it("タグメモとタグ検索APIを公開しない", () => {
    expect(Object.keys(api)).not.toStrictEqual(expect.arrayContaining(["readTagMemo", "saveTagMemo", "searchTag"]));
  });
});
