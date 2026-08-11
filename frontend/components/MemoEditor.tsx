import { basicSetup } from "codemirror";
import { Annotation, EditorState, Prec, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { parseTags } from "../tag-parser";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onNavigateBackward: () => void;
  onOpenTag: (tag: string) => void;
  ref?: Ref<MemoEditorHandle>;
}

export interface MemoEditorHandle {
  focusAtStart: () => void;
}

function tagDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const tag of parseTags(view.state.doc.toString())) {
    builder.add(
      tag.from,
      tag.to,
      Decoration.mark({
        attributes: { "data-tag": tag.displayName, title: "クリックで関連メモを表示" },
        class: "cm-zettel-tag",
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
      if (update.docChanged || update.viewportChanged) {
        this.decorations = tagDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const externalValueSync = Annotation.define<boolean>();

export function MemoEditor({ value, onChange, onNavigateBackward, onOpenTag, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const initialValue = useRef(value);
  const changeHandler = useRef(onChange);
  const navigateBackwardHandler = useRef(onNavigateBackward);
  const tagHandler = useRef(onOpenTag);

  useEffect(() => {
    changeHandler.current = onChange;
    navigateBackwardHandler.current = onNavigateBackward;
    tagHandler.current = onOpenTag;
  }, [onChange, onNavigateBackward, onOpenTag]);

  useImperativeHandle(ref, () => ({
    focusAtStart() {
      const view = editor.current;
      if (!view) {
        return;
      }
      view.dispatch({ scrollIntoView: true, selection: { anchor: 0 } });
      view.focus();
    },
  }));

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const navigateBackwardKeymap = Prec.highest(
      keymap.of([
        {
          key: "ArrowUp",
          run(view) {
            const { selection } = view.state;
            if (
              view.compositionStarted ||
              selection.ranges.length !== 1 ||
              !selection.main.empty ||
              view.state.doc.lineAt(selection.main.head).number !== 1
            ) {
              return false;
            }
            navigateBackwardHandler.current();
            return true;
          },
        },
      ]),
    );
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          navigateBackwardKeymap,
          basicSetup,
          tagPlugin,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            const isExternalValueSync = update.transactions.some((transaction) => transaction.annotation(externalValueSync));
            if (update.docChanged && !isExternalValueSync) {
              changeHandler.current(update.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            mousedown(event) {
              const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".cm-zettel-tag") : null;
              const tag = target?.dataset.tag;
              if (!tag) {
                return false;
              }
              event.preventDefault();
              tagHandler.current(tag);
              return true;
            },
          }),
          EditorView.theme({
            "&": { backgroundColor: "transparent", height: "100%" },
            ".cm-content": { padding: "20px 4px 120px" },
            ".cm-focused": { outline: "none" },
            ".cm-gutters": { display: "none" },
            ".cm-scroller": { fontFamily: "var(--font-body)", lineHeight: "1.8" },
            ".cm-zettel-tag": {
              backgroundColor: "var(--accent-soft)",
              borderRadius: "4px",
              color: "var(--accent)",
              cursor: "pointer",
            },
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value) {
      return;
    }
    view.dispatch({
      annotations: externalValueSync.of(true),
      changes: { from: 0, insert: value, to: view.state.doc.length },
    });
  }, [value]);

  return <div className="memo-editor" ref={host} />;
}
