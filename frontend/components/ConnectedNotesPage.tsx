import type { NoteSummary, TagMemoDocument } from "../types";
import type { SaveState } from "../use-autosaved-document";
import { MemoEditor } from "./MemoEditor";
import { SaveStatus } from "./SaveStatus";

interface Props {
  tag: string;
  memo: TagMemoDocument | null;
  notes: NoteSummary[];
  saveState: SaveState;
  onBack: () => void;
  onBodyChange: (body: string) => void;
  onOpenTag: (tag: string) => void;
  onSelect: (id: string) => void;
}

export function ConnectedNotesPage({ memo, notes, onBack, onBodyChange, onOpenTag, onSelect, saveState, tag }: Props) {
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
          <SaveStatus state={saveState} />
        </div>
      </header>
      <section className="tag-memo-editor" aria-label={`#${tag} のメモ`}>
        {memo ? (
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
