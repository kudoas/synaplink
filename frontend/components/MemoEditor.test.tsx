import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { MemoEditor, type MemoEditorHandle } from "./MemoEditor";

describe(MemoEditor, () => {
  it("外部から本文を同期しても変更を通知しない", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <MemoEditor value="最初の本文" onChange={onChange} onNavigateBackward={vi.fn()} onOpenTag={vi.fn()} />,
    );

    rerender(<MemoEditor value="別のメモの本文" onChange={onChange} onNavigateBackward={vi.fn()} onOpenTag={vi.fn()} />);

    expect(container.querySelector(".cm-content")).toHaveTextContent("別のメモの本文");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("エディター上の編集を1回通知する", () => {
    const onChange = vi.fn();
    const { container } = render(<MemoEditor value="本文" onChange={onChange} onNavigateBackward={vi.fn()} onOpenTag={vi.fn()} />);
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

  it("本文先頭へフォーカスを移動する", () => {
    const ref = createRef<MemoEditorHandle>();
    const { container } = render(
      <MemoEditor ref={ref} value="本文" onChange={vi.fn()} onNavigateBackward={vi.fn()} onOpenTag={vi.fn()} />,
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
      <MemoEditor value={"一行目\n二行目"} onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenTag={vi.fn()} />,
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
      <MemoEditor value={"一行目\n二行目"} onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenTag={vi.fn()} />,
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
      <MemoEditor value="一行目" onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenTag={vi.fn()} />,
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
      <MemoEditor value="一行目" onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenTag={vi.fn()} />,
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
      <MemoEditor value="" onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenTag={vi.fn()} />,
    );
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);

    fireEvent.keyDown(view!.contentDOM, { key: "ArrowUp" });

    expect(onNavigateBackward).toHaveBeenCalledWith();
  });

  it("本文で複数キャレットがある場合は前の入力欄への移動を通知しない", () => {
    const onNavigateBackward = vi.fn();
    const { container } = render(
      <MemoEditor value="一行目" onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenTag={vi.fn()} />,
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
      <MemoEditor value="一行目" onChange={vi.fn()} onNavigateBackward={onNavigateBackward} onOpenTag={vi.fn()} />,
    );
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);

    fireEvent.keyDown(view!.contentDOM, { key: "ArrowUp", metaKey: true });

    expect(onNavigateBackward).not.toHaveBeenCalled();
  });

  it("本文のタグを通常クリックすると関連メモの表示を通知する", () => {
    const onOpenTag = vi.fn();
    const { container } = render(
      <MemoEditor value="本文の #りんご" onChange={vi.fn()} onNavigateBackward={vi.fn()} onOpenTag={onOpenTag} />,
    );
    const tag = container.querySelector<HTMLElement>(".cm-zettel-tag");
    expect(tag).not.toBeNull();

    fireEvent.mouseDown(tag!);

    expect(onOpenTag).toHaveBeenCalledWith("りんご");
  });
});
