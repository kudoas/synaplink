import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectedNotesPage } from "./ConnectedNotesPage";

const savedMemo = { body: "秋に食べ比べたい", exists: true, revision: "r1", tag: "りんご" };
const taggedMemo = { ...savedMemo, body: "#果物" };
const longMemo = { ...savedMemo, body: "本文\n".repeat(200) };

describe(ConnectedNotesPage, () => {
  // oxlint-disable-next-line vitest/no-hooks -- CodeMirror instances must be destroyed between component cases.
  afterEach(cleanup);

  it("タグ本文を検索結果より上に表示し件数説明を出さない", () => {
    const { container } = render(
      <ConnectedNotesPage
        isNavigating={false}
        memo={savedMemo}
        memoState="ready"
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

  it("長いタグ本文をページ全体のスクロールに含める", () => {
    render(
      <ConnectedNotesPage
        isNavigating={false}
        memo={longMemo}
        memoState="ready"
        notes={[]}
        saveState="saved"
        tag="りんご"
        onBack={vi.fn()}
        onBodyChange={vi.fn()}
        onOpenTag={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const region = screen.getByRole("region", { name: "#りんご のメモ" });
    expect(region).not.toHaveAttribute("style");
    expect(region.parentElement).toHaveClass("results-view");
  });

  it("読み込み中は編集を開始できない", () => {
    const { container } = render(
      <ConnectedNotesPage
        isNavigating={false}
        memo={null}
        memoState="loading"
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

  it("読み込み失敗時は保存済みや読み込み中と表示しない", () => {
    const { container } = render(
      <ConnectedNotesPage
        isNavigating={false}
        memo={null}
        memoState="error"
        notes={[]}
        saveState="saved"
        tag="りんご"
        onBack={vi.fn()}
        onBodyChange={vi.fn()}
        onOpenTag={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("読み込みエラー")).toBeInTheDocument();
    expect(screen.getByText("タグメモを読み込めませんでした。")).toBeInTheDocument();
    expect(screen.queryByText("保存済み")).not.toBeInTheDocument();
    expect(screen.queryByText("タグメモを読み込み中…")).not.toBeInTheDocument();
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("遷移中は元のタグメモを編集できない", () => {
    const { container } = render(
      <ConnectedNotesPage
        isNavigating
        memo={savedMemo}
        memoState="ready"
        notes={[]}
        saveState="saved"
        tag="りんご"
        onBack={vi.fn()}
        onBodyChange={vi.fn()}
        onOpenTag={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("移動先を読み込み中…")).toBeInTheDocument();
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("戻る・関連メモ・本文タグの操作を通知する", () => {
    const onBack = vi.fn();
    const onOpenTag = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <ConnectedNotesPage
        isNavigating={false}
        memo={taggedMemo}
        memoState="ready"
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
