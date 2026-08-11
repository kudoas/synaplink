import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { api } from "./api";

vi.mock(import("@tauri-apps/api/core"), () => ({ invoke: vi.fn() }));
vi.mock(import("@tauri-apps/plugin-dialog"), () => ({ open: vi.fn() }));

describe("tag memo api", () => {
  it("reads a tag memo by display tag", async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue({ body: "本文", exists: true, revision: "r1", tag: "りんご" });
    await api.readTagMemo("りんご");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("read_tag_memo", { tag: "りんご" });
  });

  it("saves with an optional expected revision", async () => {
    vi.mocked(invoke).mockReset();
    const input = { body: "本文", expectedRevision: null, tag: "りんご" };
    vi.mocked(invoke).mockResolvedValue({ memo: { ...input, exists: true, revision: "r1" }, status: "saved" });
    await api.saveTagMemo(input);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("save_tag_memo", { input });
  });
});
