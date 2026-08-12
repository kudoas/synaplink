import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { DocumentEditor } from "./DocumentEditor";

describe(DocumentEditor, () => {
  it.each(["Enter", "ArrowDown"])("タイトル末尾の%sで本文先頭へ移動する", (key) => {
    cleanup();
    const { container } = render(
      <DocumentEditor
        body="本文"
        onBodyChange={vi.fn()}
        onOpenTag={vi.fn()}
        onTitleChange={vi.fn()}
        title="タイトル"
      />,
    );
    const title = screen.getByRole<HTMLInputElement>("textbox", { name: "タイトル" });
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);
    title.focus();
    title.setSelectionRange(title.value.length, title.value.length);
    view?.dispatch({ selection: { anchor: view.state.doc.length } });

    fireEvent.keyDown(title, { key });

    expect(document.activeElement).toBe(view?.contentDOM);
    expect(view?.state.selection.main.head).toBe(0);
  });

  it("本文の論理的な1行目から上矢印でタイトル末尾へ移動する", () => {
    cleanup();
    const { container } = render(
      <DocumentEditor
        body={"一行目\n二行目"}
        onBodyChange={vi.fn()}
        onOpenTag={vi.fn()}
        onTitleChange={vi.fn()}
        title="タイトル"
      />,
    );
    const title = screen.getByRole<HTMLInputElement>("textbox", { name: "タイトル" });
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);
    view?.dispatch({ selection: { anchor: 2 } });
    view?.focus();

    fireEvent.keyDown(view!.contentDOM, { key: "ArrowUp" });

    expect(document.activeElement).toBe(title);
    expect(title.selectionStart).toBe(title.value.length);
    expect(title.selectionEnd).toBe(title.value.length);
  });

  it("タイトルでime変換中は本文へ移動しない", () => {
    cleanup();
    const { container } = render(
      <DocumentEditor
        body="本文"
        onBodyChange={vi.fn()}
        onOpenTag={vi.fn()}
        onTitleChange={vi.fn()}
        title="タイトル"
      />,
    );
    const title = screen.getByRole<HTMLInputElement>("textbox", { name: "タイトル" });
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);
    title.focus();
    title.setSelectionRange(title.value.length, title.value.length);

    fireEvent.keyDown(title, { isComposing: true, key: "Enter" });

    expect(document.activeElement).toBe(title);
    expect(document.activeElement).not.toBe(view?.contentDOM);
  });

  it("タイトルで修飾キー付きのenterを押しても本文へ移動しない", () => {
    cleanup();
    render(
      <DocumentEditor
        body="本文"
        onBodyChange={vi.fn()}
        onOpenTag={vi.fn()}
        onTitleChange={vi.fn()}
        title="タイトル"
      />,
    );
    const title = screen.getByRole<HTMLInputElement>("textbox", { name: "タイトル" });
    title.focus();
    title.setSelectionRange(title.value.length, title.value.length);

    fireEvent.keyDown(title, { key: "Enter", metaKey: true });

    expect(document.activeElement).toBe(title);
  });

  it.each(["Enter", "ArrowDown"])("タイトル途中の%sでは本文へ移動しない", (key) => {
    cleanup();
    render(
      <DocumentEditor
        body="本文"
        onBodyChange={vi.fn()}
        onOpenTag={vi.fn()}
        onTitleChange={vi.fn()}
        title="タイトル"
      />,
    );
    const title = screen.getByRole<HTMLInputElement>("textbox", { name: "タイトル" });
    title.focus();
    title.setSelectionRange(2, 2);

    fireEvent.keyDown(title, { key });

    expect(document.activeElement).toBe(title);
  });

  it("タイトルを選択中は本文へ移動しない", () => {
    cleanup();
    render(
      <DocumentEditor
        body="本文"
        onBodyChange={vi.fn()}
        onOpenTag={vi.fn()}
        onTitleChange={vi.fn()}
        title="タイトル"
      />,
    );
    const title = screen.getByRole<HTMLInputElement>("textbox", { name: "タイトル" });
    title.focus();
    title.setSelectionRange(title.value.length - 1, title.value.length);

    fireEvent.keyDown(title, { key: "Enter" });

    expect(document.activeElement).toBe(title);
  });

  it("空のタイトルから本文先頭へ移動する", () => {
    cleanup();
    const { container } = render(
      <DocumentEditor body="本文" onBodyChange={vi.fn()} onOpenTag={vi.fn()} onTitleChange={vi.fn()} title="" />,
    );
    const title = screen.getByRole<HTMLInputElement>("textbox", { name: "タイトル" });
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);
    title.focus();
    title.setSelectionRange(0, 0);

    fireEvent.keyDown(title, { key: "Enter" });

    expect(document.activeElement).toBe(view?.contentDOM);
    expect(view?.state.selection.main.head).toBe(0);
  });
});
