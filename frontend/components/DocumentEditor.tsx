import { useRef } from "react";

import { MemoEditor, type MemoEditorHandle } from "./MemoEditor";

interface Props {
  body: string;
  onBodyChange: (body: string) => void;
  onOpenLink: (link: string) => void;
  onTitleChange: (title: string) => void;
  title: string;
}

export function DocumentEditor({ body, onBodyChange, onOpenLink, onTitleChange, title }: Props) {
  const memoEditor = useRef<MemoEditorHandle>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  return (
    <div className="document-body">
      <input
        aria-label="タイトル"
        className="title-input"
        onChange={(event) => {
          onTitleChange(event.target.value);
        }}
        onKeyDown={(event) => {
          const titleInput = event.currentTarget;
          const isAtEnd = titleInput.selectionStart === titleInput.value.length && titleInput.selectionEnd === titleInput.value.length;
          const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
          const movesToBody = event.key === "Enter" || event.key === "ArrowDown";
          if (!movesToBody || !isAtEnd || hasModifier || event.nativeEvent.isComposing || !memoEditor.current) {
            return;
          }
          event.preventDefault();
          memoEditor.current.focusAtStart();
        }}
        placeholder="無題"
        ref={titleInput}
        value={title}
      />
      <MemoEditor
        ref={memoEditor}
        value={body}
        onChange={onBodyChange}
        onNavigateBackward={() => {
          const input = titleInput.current;
          if (!input) {
            return;
          }
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }}
        onOpenLink={onOpenLink}
      />
    </div>
  );
}
