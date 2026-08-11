import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { App } from "./App";

vi.mock(import("./api"), () => ({
  api: {
    chooseVault: vi.fn(),
    createNote: vi.fn(),
    deleteNote: vi.fn(),
    getVault: vi.fn(),
    listNotes: vi.fn(),
    readNote: vi.fn(),
    saveNote: vi.fn(),
    searchTag: vi.fn(),
    setVault: vi.fn(),
  },
}));

describe(App, () => {
  it("本文のタグを通常クリックするとCONNECTED NOTESへ移動する", async () => {
    vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
    vi.mocked(api.listNotes).mockResolvedValue([
      {
        id: "apple.txt",
        modifiedAt: 1,
        preview: "本文の #りんご",
        revision: "revision-1",
        tags: [{ displayName: "りんご", normalizedName: "りんご" }],
        title: "りんごのメモ",
      },
    ]);
    vi.mocked(api.readNote).mockResolvedValue({
      body: "本文の #りんご",
      id: "apple.txt",
      modifiedAt: 1,
      revision: "revision-1",
      tags: [{ displayName: "りんご", normalizedName: "りんご" }],
      title: "りんごのメモ",
    });
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
});
