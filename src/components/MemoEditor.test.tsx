import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import { describe, expect, it, vi } from "vitest";

import { MemoEditor, type MemoEditorHandle } from "./MemoEditor";

vi.mock(import("@tauri-apps/plugin-opener"), () => ({ openUrl: vi.fn() }));

describe(MemoEditor, () => {
  it("外部から本文を同期しても変更を通知しない", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <MemoEditor value="最初の本文" onChange={onChange} onNavigateBackward={vi.fn()} onOpenLink={vi.fn()} />,
    );

    rerender(<MemoEditor value="別のメモの本文" onChange={onChange} onNavigateBackward={vi.fn()} onOpenLink={vi.fn()} />);

    expect(container.querySelector(".cm-content")).toHaveTextContent("別のメモの本文");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("エディター上の編集を1回通知する", () => {
    const onChange = vi.fn();
    const { container } = render(<MemoEditor value="本文" onChange={onChange} onNavigateBackward={vi.fn()} onOpenLink={vi.fn()} />);
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    expect(editorElement).not.toBeNull();
    const view = EditorView.findFromDOM(editorElement!);
    expect(view).not.toBeNull();

    view!.dispatch({
      changes: { from: view!.state.doc.length, insert: "を編集" },
      userEvent: "input.type",
    });

    expect(onChange).toHaveBeenCalledExactlyOnceWith("本文を編集");
  });

  it("外部本文へ置き換えた後のUndoとRedoでは過去の本文を復元しない", () => {
    const onChange = vi.fn();
    const handlers = { handleNavigateBackward: vi.fn(), handleOpenLink: vi.fn() };
    const { container, rerender } = render(<MemoEditor value="元の本文" onChange={onChange} onNavigateBackward={handlers.handleNavigateBackward} onOpenLink={handlers.handleOpenLink} />);
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    view.dispatch({ changes: { from: view.state.doc.length, insert: "を編集" }, userEvent: "input.type" });
    onChange.mockClear();

    rerender(<MemoEditor value="外部で変更した本文" onChange={onChange} onNavigateBackward={handlers.handleNavigateBackward} onOpenLink={handlers.handleOpenLink} />);

    const didUndo = undo(view);
    const didRedo = redo(view);
    expect({ redo: didRedo, undo: didUndo }).toStrictEqual({ redo: false, undo: false });
    expect(view.state.doc.toString()).toBe("外部で変更した本文");
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector(".cm-editor")).toBe(view.dom);
  });

  it("同じ本文の保存応答では通常のUndoとRedoを保持する", () => {
    const onChange = vi.fn();
    const handlers = { handleNavigateBackward: vi.fn(), handleOpenLink: vi.fn() };
    const { container, rerender } = render(<MemoEditor value="本文" onChange={onChange} onNavigateBackward={handlers.handleNavigateBackward} onOpenLink={handlers.handleOpenLink} />);
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    view.dispatch({ changes: { from: view.state.doc.length, insert: "を編集" }, userEvent: "input.type" });
    rerender(<MemoEditor value="本文を編集" onChange={onChange} onNavigateBackward={handlers.handleNavigateBackward} onOpenLink={handlers.handleOpenLink} />);

    const didUndo = undo(view);
    const afterUndo = view.state.doc.toString();
    const didRedo = redo(view);
    expect({ afterUndo, document: view.state.doc.toString(), redo: didRedo, undo: didUndo }).toStrictEqual({
      afterUndo: "本文", document: "本文を編集", redo: true, undo: true,
    });
    expect(onChange.mock.calls).toStrictEqual([["本文を編集"], ["本文"], ["本文を編集"]]);
  });

  it("外部本文の取込後も選択範囲を本文の長さに収め、新しいユーザー編集だけUndoできる", () => {
    const onChange = vi.fn();
    const handlers = { handleNavigateBackward: vi.fn(), handleOpenLink: vi.fn() };
    const { container, rerender } = render(<MemoEditor value="長い本文を編集しています" onChange={onChange} onNavigateBackward={handlers.handleNavigateBackward} onOpenLink={handlers.handleOpenLink} />);
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(view.state.doc.length)], 1) });
    rerender(<MemoEditor value="短文" onChange={onChange} onNavigateBackward={handlers.handleNavigateBackward} onOpenLink={handlers.handleOpenLink} />);

    expect(view.state.selection.ranges.map((range) => range.head)).toStrictEqual([1, 2]);
    view.dispatch({ changes: { from: 2, insert: "を編集" }, userEvent: "input.type" });
    const didUndo = undo(view);
    const afterUndo = view.state.doc.toString();
    const didUndoAgain = undo(view);
    expect({ afterUndo, first: didUndo, second: didUndoAgain }).toStrictEqual({ afterUndo: "短文", first: true, second: false });
    expect(onChange.mock.calls).toStrictEqual([["短文を編集"], ["短文"]]);
  });

  it("本文先頭へフォーカスを移動する", () => {
    const ref = createRef<MemoEditorHandle>();
    const { container } = render(
      <MemoEditor ref={ref} value="本文" onChange={vi.fn()} onNavigateBackward={vi.fn()} onOpenLink={vi.fn()} />,
    );
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);
    view?.dispatch({ selection: { anchor: view.state.doc.length } });

    ref.current?.focusAtStart();

    expect(view?.state.selection.main.head).toBe(0);
    expect(document.activeElement).toBe(container.querySelector(".cm-content"));
  });

  it("本文の論理的な1行目で上矢印を押すと前の入力欄への移動を通知する", () => {
    const onNavigateBackward = vi.fn();
    const { container } = render(
      <MemoEditor value={"一行目\n二行目"} onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenLink={vi.fn()} />,
    );
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);
    view?.dispatch({ selection: { anchor: 2 } });
    view?.focus();

    fireEvent.keyDown(view!.contentDOM, { key: "ArrowUp" });

    expect(onNavigateBackward).toHaveBeenCalledWith();
  });

  it("本文の2行目では前の入力欄への移動を通知しない", () => {
    const onNavigateBackward = vi.fn();
    const { container } = render(
      <MemoEditor value={"一行目\n二行目"} onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenLink={vi.fn()} />,
    );
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);
    view?.dispatch({ selection: { anchor: 5 } });

    fireEvent.keyDown(view!.contentDOM, { key: "ArrowUp" });

    expect(onNavigateBackward).not.toHaveBeenCalled();
  });

  it("本文の1行目を選択中は前の入力欄への移動を通知しない", () => {
    const onNavigateBackward = vi.fn();
    const { container } = render(
      <MemoEditor value="一行目" onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenLink={vi.fn()} />,
    );
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);
    view?.dispatch({ selection: { anchor: 0, head: 2 } });

    fireEvent.keyDown(view!.contentDOM, { key: "ArrowUp" });

    expect(onNavigateBackward).not.toHaveBeenCalled();
  });

  it("本文でime変換中は前の入力欄への移動を通知しない", () => {
    const onNavigateBackward = vi.fn();
    const { container } = render(
      <MemoEditor value="一行目" onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenLink={vi.fn()} />,
    );
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);
    fireEvent.compositionStart(view!.contentDOM);

    fireEvent.keyDown(view!.contentDOM, { key: "ArrowUp" });

    expect(onNavigateBackward).not.toHaveBeenCalled();
  });

  it("空の本文から前の入力欄への移動を通知する", () => {
    const onNavigateBackward = vi.fn();
    const { container } = render(
      <MemoEditor value="" onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenLink={vi.fn()} />,
    );
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);

    fireEvent.keyDown(view!.contentDOM, { key: "ArrowUp" });

    expect(onNavigateBackward).toHaveBeenCalledWith();
  });

  it("本文で複数キャレットがある場合は前の入力欄への移動を通知しない", () => {
    const onNavigateBackward = vi.fn();
    const { container } = render(
      <MemoEditor value="一行目" onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenLink={vi.fn()} />,
    );
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);
    view?.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(2)]) });
    expect(view?.state.selection.ranges).toHaveLength(2);

    fireEvent.keyDown(view!.contentDOM, { key: "ArrowUp" });

    expect(onNavigateBackward).not.toHaveBeenCalled();
  });

  it("本文で修飾キー付きの上矢印を押しても前の入力欄への移動を通知しない", () => {
    const onNavigateBackward = vi.fn();
    const { container } = render(
      <MemoEditor value="一行目" onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenLink={vi.fn()} />,
    );
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);

    fireEvent.keyDown(view!.contentDOM, { key: "ArrowUp", metaKey: true });

    expect(onNavigateBackward).not.toHaveBeenCalled();
  });

  it("本文のWikiリンクを左クリックすると検索を通知する", () => {
    const onOpenLink = vi.fn();
    const { container } = render(
      <MemoEditor value="本文の [[りんご]]" onChange={vi.fn()} onNavigateBackward={vi.fn()} onOpenLink={onOpenLink} />,
    );
    const link = container.querySelector<HTMLElement>(".cm-wikilink");
    expect(link).not.toBeNull();

    fireEvent.click(link!, { button: 0 });

    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith("りんご");
  });

  it("wikiリンクは左クリック以外では検索を通知せず、旧タグは装飾しない", () => {
    const onOpenLink = vi.fn();
    const { container } = render(
      <MemoEditor value="[[りんご]] #みかん" onChange={vi.fn()} onNavigateBackward={vi.fn()} onOpenLink={onOpenLink} />,
    );
    const link = container.querySelector<HTMLElement>(".cm-wikilink");

    fireEvent.click(link!, { button: 2 });

    expect(onOpenLink).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".cm-wikilink")).toHaveLength(1);
  });

  it("本文のhttpsのURLだけをリンクとして装飾する", () => {
    const { container } = render(
      <MemoEditor
        value="http://example.com と https://example.com/path。"
        onChange={vi.fn()}
        onNavigateBackward={vi.fn()}
        onOpenLink={vi.fn()}
      />,
    );

    expect([...container.querySelectorAll(".cm-zettel-link")].map((link) => link.textContent)).toStrictEqual([
      "https://example.com/path",
    ]);
  });

  it("非対応スキームとwww表記をリンクとして装飾しない", () => {
    const { container } = render(
      <MemoEditor
        value="www.example.com ftp://example.com mailto:memo@example.com"
        onChange={vi.fn()}
        onNavigateBackward={vi.fn()}
        onOpenLink={vi.fn()}
      />,
    );

    expect(container.querySelector(".cm-zettel-link")).toBeNull();
  });

  it("本文のURLを左クリックすると既定ブラウザで開く", () => {
    vi.mocked(openUrl).mockReset().mockResolvedValue();
    const onChange = vi.fn();
    const onOpenLink = vi.fn();
    const { container } = render(
      <MemoEditor
        value="https://example.com/path#section"
        onChange={onChange}
        onNavigateBackward={vi.fn()}
        onOpenLink={onOpenLink}
      />,
    );
    const link = container.querySelector<HTMLElement>(".cm-zettel-link");
    expect(link).not.toBeNull();

    fireEvent.mouseDown(link!, { button: 0 });
    expect(openUrl).not.toHaveBeenCalled();
    fireEvent.click(link!, { button: 0 });

    expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://example.com/path#section");
    expect(onChange).not.toHaveBeenCalled();
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it.each([1, 2])("本文のURLをボタン%dで押しても既定ブラウザで開かない", (button) => {
    vi.mocked(openUrl).mockReset().mockResolvedValue();
    const { container } = render(
      <MemoEditor
        value="https://example.com"
        onChange={vi.fn()}
        onNavigateBackward={vi.fn()}
        onOpenLink={vi.fn()}
      />,
    );
    const link = container.querySelector<HTMLElement>(".cm-zettel-link");
    expect(link).not.toBeNull();

    fireEvent.mouseDown(link!, { button });
    fireEvent.click(link!, { button });

    expect(openUrl).not.toHaveBeenCalled();
  });

  it("urlを開けなくても未処理の拒否を残さない", async () => {
    vi.mocked(openUrl).mockReset().mockRejectedValue(new Error("open failed"));
    const { container } = render(
      <MemoEditor
        value="https://example.com"
        onChange={vi.fn()}
        onNavigateBackward={vi.fn()}
        onOpenLink={vi.fn()}
      />,
    );
    const link = container.querySelector<HTMLElement>(".cm-zettel-link");
    expect(link).not.toBeNull();

    fireEvent.click(link!, { button: 0 });
    await Promise.resolve();

    expect(container.querySelector(".cm-zettel-link")).toBeInTheDocument();
  });
});
