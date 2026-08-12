import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectedNotesPage } from "./ConnectedNotesPage";

const savedMemo = { body: "秋に食べ比べたい", exists: true, revision: "r1", tag: "りんご" };
const taggedMemo = { ...savedMemo, body: "#果物" };

describe(ConnectedNotesPage, () => {
  // oxlint-disable-next-line vitest/no-hooks -- CodeMirror instances must be destroyed between component cases.
  afterEach(cleanup);

  it("タグ本文を検索結果より上に表示し件数説明を出さない", () => {
    const { container } = render(
      <ConnectedNotesPage
        memo={savedMemo}
        notes={[{ id: "1.txt", modifiedAt: 1, preview: "甘い", revision: "n1", tags: [], title: "紅玉" }]}
        saveState="saved"
        tag="りんご"
        onBack={vi.fn()}
        onBodyChange={vi.fn()}
        onOpenTag={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "#りんご" })).toBeInTheDocument();
    expect(screen.queryByText(/件のメモが/u)).not.toBeInTheDocument();
    const editor = container.querySelector(".tag-memo-editor");
    const grid = container.querySelector(".result-grid");
    expect(editor?.compareDocumentPosition(grid!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("読み込み中は編集を開始できない", () => {
    const { container } = render(
      <ConnectedNotesPage
        memo={null}
        notes={[]}
        saveState="saved"
        tag="りんご"
        onBack={vi.fn()}
        onBodyChange={vi.fn()}
        onOpenTag={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("タグメモを読み込み中…")).toBeInTheDocument();
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("戻る・関連メモ・本文タグの操作を通知する", () => {
    const onBack = vi.fn();
    const onOpenTag = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <ConnectedNotesPage
        memo={taggedMemo}
        notes={[{ id: "1.txt", modifiedAt: 1, preview: "甘い", revision: "n1", tags: [], title: "紅玉" }]}
        saveState="saved"
        tag="りんご"
        onBack={onBack}
        onBodyChange={vi.fn()}
        onOpenTag={onOpenTag}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "← メモに戻る" }));
    fireEvent.click(screen.getByRole("button", { name: /紅玉/u }));
    fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
    expect(onBack).toHaveBeenCalledExactlyOnceWith();
    expect(onSelect).toHaveBeenCalledWith("1.txt");
    expect(onOpenTag).toHaveBeenCalledWith("果物");
  });
});
