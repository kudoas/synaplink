import type { NoteSummary } from "../types";

interface Props {
  tag: string;
  notes: NoteSummary[];
  onBack: () => void;
  onSelect: (id: string) => void;
}

export function TagResults({ tag, notes, onBack, onSelect }: Props) {
  return (
    <main className="results-view">
      <button className="back-button" onClick={onBack}>
        ← メモに戻る
      </button>
      <div className="results-heading">
        <span className="eyebrow">CONNECTED NOTES</span>
        <h1>#{tag}</h1>
        <p>{notes.length}件のメモが、この言葉でつながっています。</p>
      </div>
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
