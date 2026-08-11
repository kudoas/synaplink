import { render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { MemoEditor } from "./MemoEditor";

describe(MemoEditor, () => {
  it("外部から本文を同期しても変更を通知しない", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<MemoEditor value="最初の本文" onChange={onChange} onOpenTag={vi.fn()} />);

    rerender(<MemoEditor value="別のメモの本文" onChange={onChange} onOpenTag={vi.fn()} />);

    expect(container.querySelector(".cm-content")).toHaveTextContent("別のメモの本文");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("エディター上の編集を1回通知する", () => {
    const onChange = vi.fn();
    const { container } = render(<MemoEditor value="本文" onChange={onChange} onOpenTag={vi.fn()} />);
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
});
