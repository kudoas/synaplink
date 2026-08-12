import type { NoteSummary, TagMemoDocument } from "../types";
import type { SaveState } from "../use-autosaved-document";
import { MemoEditor } from "./MemoEditor";
import { SaveStatus } from "./SaveStatus";

export type TagMemoState = "error" | "loading" | "ready";

interface Props {
  isNavigating: boolean;
  tag: string;
  memo: TagMemoDocument | null;
  memoState: TagMemoState;
  notes: NoteSummary[];
  saveState: SaveState;
  onBack: () => void;
  onBodyChange: (body: string) => void;
  onOpenTag: (tag: string) => void;
  onSelect: (id: string) => void;
}

export function ConnectedNotesPage({
  isNavigating,
  memo,
  memoState,
  notes,
  onBack,
  onBodyChange,
  onOpenTag,
  onSelect,
  saveState,
  tag,
}: Props) {
  return (
    <main className="results-view connected-notes-page">
      <button
        className="back-button"
        onClick={() => {
          onBack();
        }}
      >
        ← メモに戻る
      </button>
      <header className="results-heading tag-memo-heading">
        <span className="eyebrow">CONNECTED NOTES</span>
        <div className="tag-memo-title-row">
          <h1>#{tag}</h1>
          {memoState === "ready" ? (
            <SaveStatus state={saveState} />
          ) : (
            <span className={`tag-memo-state ${memoState}`}>
              {memoState === "error" ? "読み込みエラー" : "読み込み中…"}
            </span>
          )}
        </div>
      </header>
      <section className="tag-memo-editor" aria-label={`#${tag} のメモ`}>
        {isNavigating ? (
          <p className="tag-memo-loading">移動先を読み込み中…</p>
        ) : memoState === "error" ? (
          <p className="tag-memo-loading error">タグメモを読み込めませんでした。</p>
        ) : memoState === "ready" && memo ? (
          <MemoEditor
            value={memo.body}
            onChange={onBodyChange}
            onNavigateBackward={() => void 0}
            onOpenTag={onOpenTag}
          />
        ) : (
          <p className="tag-memo-loading">タグメモを読み込み中…</p>
        )}
      </section>
      <div className="result-grid">
        {notes.map((note) => (
          <button
            className="result-card"
            key={note.id}
            onClick={() => {
              onSelect(note.id);
            }}
          >
            <time>{new Date(note.modifiedAt).toLocaleDateString("ja-JP")}</time>
            <h2>{note.title.trim() || "無題"}</h2>
            <p>{note.preview || "本文はまだありません。"}</p>
          </button>
        ))}
      </div>
    </main>
  );
}
