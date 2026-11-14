import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./api";
import { useShutdownGuard } from "./use-shutdown-guard";

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
vi.mock(import("./use-shutdown-guard"), () => ({ useShutdownGuard: vi.fn() }));

describe("app shutdown registration", () => {
  it("終了保護の登録前には保存先選択や新規編集を操作できない", async () => {
    cleanup();
    vi.resetAllMocks();
    vi.mocked(api.getVault).mockResolvedValue("/test-vault");
    vi.mocked(api.listNotes).mockResolvedValue([]);
    vi.mocked(useShutdownGuard).mockReturnValue(false);
    const { rerender } = render(<App />);

    expect(screen.getByRole("heading", { name: "終了時保存を準備しています…" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(api.saveNote).not.toHaveBeenCalled();
    vi.mocked(useShutdownGuard).mockReturnValue(true);
    rerender(<App />);
    const createButton = await screen.findByRole("button", { name: /新しいメモ/u });
    expect(createButton).toBeInTheDocument();
  });
});
