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

  it("タグメモとタグ検索APIを公開しない", () => {
    expect(Object.keys(api)).not.toStrictEqual(expect.arrayContaining(["readTagMemo", "saveTagMemo", "searchTag"]));
  });
});
