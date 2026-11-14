import { basicSetup } from "codemirror";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { parseLinks } from "../link-parser";
import { parseUrls } from "../url-parser";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onNavigateBackward: () => void;
  onOpenLink: (link: string) => void;
  ref?: Ref<MemoEditorHandle>;
}

export interface MemoEditorHandle {
  focusAtStart: () => void;
}

function interactiveDecorations(view: EditorView): DecorationSet {
  const content = view.state.doc.toString();
  return Decoration.set(
    [
      ...parseLinks(content).map((link) =>
        Decoration.mark({
          attributes: { "data-link": link.displayName, title: "クリックして検索" },
          class: "cm-wikilink",
        }).range(link.from, link.to),
      ),
      ...parseUrls(content).map((url) =>
        Decoration.mark({
          attributes: { "data-url": url.url, title: "クリックしてブラウザで開く" },
          class: "cm-zettel-link",
        }).range(url.from, url.to),
      ),
    ],
    true,
  );
}

const interactivePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = interactiveDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = interactiveDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function MemoEditor({ value, onChange, onNavigateBackward, onOpenLink, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const createStateRef = useRef<((doc: string) => EditorState) | null>(null);
  const initialValue = useRef(value);
  const changeHandler = useRef(onChange);
  const navigateBackwardHandler = useRef(onNavigateBackward);
  const linkHandler = useRef(onOpenLink);

  useEffect(() => {
    changeHandler.current = onChange;
    navigateBackwardHandler.current = onNavigateBackward;
    linkHandler.current = onOpenLink;
  }, [onChange, onNavigateBackward, onOpenLink]);

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
    const createState = (doc: string) => EditorState.create({
      doc,
      extensions: [
        navigateBackwardKeymap,
        basicSetup,
        interactivePlugin,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            changeHandler.current(update.state.doc.toString());
          }
        }),
        EditorView.domEventHandlers({
          click(event) {
            if (event.button !== 0) {
              return false;
            }
            const target = event.target instanceof HTMLElement ? event.target : null;
            const url = target?.closest<HTMLElement>(".cm-zettel-link")?.dataset.url;
            if (!url) {
              const link = target?.closest<HTMLElement>(".cm-wikilink")?.dataset.link;
              if (!link) {
                return false;
              }
              event.preventDefault();
              linkHandler.current(link);
              return true;
            }
            event.preventDefault();
            void openUrl(url).catch(() => null);
            return true;
          },
          mousedown(event) {
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (target?.closest(".cm-zettel-link")) {
              return false;
            }

            return false;
          },
        }),
        EditorView.theme({
          "&": { backgroundColor: "transparent", height: "100%" },
          "&.cm-focused": { outline: "none" },
          ".cm-content": { padding: "20px 4px 120px" },
          ".cm-gutters": { display: "none" },
          ".cm-scroller": { fontFamily: "var(--font-body)", lineHeight: "1.8" },
          ".cm-wikilink": {
            backgroundColor: "var(--accent-soft)",
            borderRadius: "4px",
            color: "var(--accent)",
            cursor: "pointer",
          },
          ".cm-zettel-link": {
            color: "var(--accent)",
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
          },
        }),
      ],
    });
    createStateRef.current = createState;
    const view = new EditorView({ parent: host.current, state: createState(initialValue.current) });
    editor.current = view;
    return () => {
      editor.current = null;
      createStateRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = editor.current;
    const createState = createStateRef.current;
    if (!view || !createState || view.state.doc.toString() === value) {
      return;
    }
    // External replacements start a new undo history; value echoes from user edits do not.
    const state = createState(value);
    const selection = EditorSelection.create(
      view.state.selection.ranges.map((range) => EditorSelection.range(
        Math.min(range.anchor, state.doc.length),
        Math.min(range.head, state.doc.length),
      )),
      view.state.selection.mainIndex,
    );
    view.setState(state.update({ selection }).state);
  }, [value]);

  return <div className="memo-editor" ref={host} />;
}
