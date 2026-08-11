import { basicSetup } from "codemirror";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { parseTags } from "../tag-parser";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onOpenTag: (tag: string) => void;
};

function tagDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const tag of parseTags(view.state.doc.toString())) {
    builder.add(
      tag.from,
      tag.to,
      Decoration.mark({
        class: "cm-zettel-tag",
        attributes: { "data-tag": tag.displayName, title: "⌘クリックで関連メモを表示" },
      }),
    );
  }
  return builder.finish();
}

const tagPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tagDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = tagDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function MemoEditor({ value, onChange, onOpenTag }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const changeHandler = useRef(onChange);
  const tagHandler = useRef(onOpenTag);
  changeHandler.current = onChange;
  tagHandler.current = onOpenTag;

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          tagPlugin,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changeHandler.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            mousedown(event) {
              if (!event.metaKey) return false;
              const target = (event.target as HTMLElement).closest<HTMLElement>(".cm-zettel-tag");
              const tag = target?.dataset.tag;
              if (!tag) return false;
              event.preventDefault();
              tagHandler.current(tag);
              return true;
            },
          }),
          EditorView.theme({
            "&": { height: "100%", backgroundColor: "transparent" },
            ".cm-scroller": { fontFamily: "var(--font-body)", lineHeight: "1.8" },
            ".cm-content": { padding: "20px 4px 120px" },
            ".cm-gutters": { display: "none" },
            ".cm-focused": { outline: "none" },
            ".cm-zettel-tag": {
              color: "var(--accent)",
              backgroundColor: "var(--accent-soft)",
              borderRadius: "4px",
              cursor: "pointer",
            },
          }),
        ],
      }),
    });
    editor.current = view;
    return () => view.destroy();
  }, []);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div className="memo-editor" ref={host} />;
}
