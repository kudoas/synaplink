import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { DocumentEditor } from "./components/DocumentEditor";
import { TagResults } from "./components/TagResults";
import { uniqueTags } from "./tag-parser";
import type { NoteDocument, NoteSummary } from "./types";

type SaveState = "saved" | "dirty" | "saving" | "error";

export function App() {
  const [vault, setVault] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [draft, setDraft] = useState<NoteDocument | null>(null);
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagResults, setTagResults] = useState<NoteSummary[]>([]);
  const [conflict, setConflict] = useState<NoteDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshNotes = useCallback(async () => {
    try {
      setNotes(await api.listNotes());
    } catch (error) {
      setError(String(error));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const currentVault = await api.getVault();
        setVault(currentVault);
        if (currentVault) {
          setNotes(await api.listNotes());
        }
      } catch (error) {
        setError(String(error));
      }
    })();
  }, []);

  useEffect(() => {
    if (!vault) {
      return;
    }
    const interval = window.setInterval(() => void refreshNotes(), 2500);
    return () => {
      window.clearInterval(interval);
    };
  }, [refreshNotes, vault]);

  useEffect(() => {
    if (!draft || saveState !== "saved") {
      return;
    }
    const latest = notes.find((note) => note.id === draft.id);
    if (latest && latest.revision !== draft.revision) {
      void api
        .readNote(draft.id)
        .then(setDraft)
        .catch((error) => {
          setError(String(error));
        });
    }
  }, [draft, notes, saveState]);

  useEffect(() => {
    if (!draft || saveState !== "dirty" || conflict) {
      return;
    }
    const timeout = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const result = await api.saveNote({
          body: draft.body,
          expectedRevision: draft.revision,
          id: draft.id,
          title: draft.title,
        });
        if (result.status === "conflict") {
          setConflict(result.current);
          setSaveState("dirty");
          return;
        }
        setDraft(result.note);
        setSaveState("saved");
        await refreshNotes();
      } catch (error) {
        setSaveState("error");
        setError(String(error));
      }
    }, 700);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [conflict, draft, refreshNotes, saveState]);

  const visibleNotes = useMemo(() => {
    const query = search.trim().normalize("NFKC").toLocaleLowerCase();
    if (!query) {
      return notes;
    }
    return notes.filter((note) =>
      [note.title, note.preview, ...note.tags.map((tag) => tag.displayName)]
        .join(" ")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [notes, search]);

  const tags = useMemo(() => uniqueTags(draft?.body ?? ""), [draft?.body]);

  const chooseVault = async () => {
    const selected = await api.chooseVault();
    if (!selected) {
      return;
    }
    try {
      await api.setVault(selected);
      setVault(selected);
      setDraft(null);
      setActiveTag(null);
      await refreshNotes();
    } catch (error) {
      setError(String(error));
    }
  };

  const openNote = async (id: string) => {
    if (saveState === "dirty" || saveState === "saving") {
      return;
    }
    try {
      setDraft(await api.readNote(id));
      setActiveTag(null);
      setSaveState("saved");
    } catch (error) {
      setError(String(error));
    }
  };

  const createNote = async () => {
    try {
      const note = await api.createNote();
      setDraft(note);
      setActiveTag(null);
      setSaveState("saved");
      await refreshNotes();
    } catch (error) {
      setError(String(error));
    }
  };

  const openTag = async (tag: string) => {
    try {
      setTagResults(await api.searchTag(tag));
      setActiveTag(tag);
    } catch (error) {
      setError(String(error));
    }
  };

  const removeNote = async () => {
    if (!draft || !window.confirm(`「${draft.title || "無題"}」をゴミ箱へ移動しますか？`)) {
      return;
    }
    try {
      await api.deleteNote(draft.id);
      setDraft(null);
      await refreshNotes();
    } catch (error) {
      setError(String(error));
    }
  };

  const overwriteConflict = async () => {
    if (!draft) {
      return;
    }
    try {
      const result = await api.saveNote({
        body: draft.body,
        expectedRevision: conflict?.revision ?? draft.revision,
        id: draft.id,
        overwrite: true,
        title: draft.title,
      });
      if (result.status === "saved") {
        setDraft(result.note);
        setConflict(null);
        setSaveState("saved");
        await refreshNotes();
      }
    } catch (error) {
      setError(String(error));
    }
  };

  if (!vault) {
    return (
      <div className="welcome-shell">
        <section className="welcome-card">
          <div className="brand-mark">Z</div>
          <span className="eyebrow">LOCAL-FIRST NOTES</span>
          <h1>考えを、つなげる。</h1>
          <p>プレーンテキストと #タグだけの、静かなツェッテルカステン。</p>
          <button className="primary-button" onClick={() => void chooseVault()}>
            メモの保存先を選ぶ
          </button>
          {error && <p className="error-message">{error}</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="brand">
            <span className="brand-mark small">Z</span>
            <strong>Synaplink</strong>
          </div>
          <button className="icon-button" title="保存先を変更" onClick={() => void chooseVault()}>
            ⋯
          </button>
        </header>
        <div className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="メモを検索"
          />
        </div>
        <button className="new-note-button" onClick={() => void createNote()}>
          <span>＋</span> 新しいメモ
        </button>
        <div className="note-list">
          {visibleNotes.map((note) => (
            <button className={`note-row ${draft?.id === note.id ? "active" : ""}`} key={note.id} onClick={() => void openNote(note.id)}>
              <strong>{note.title.trim() || "無題"}</strong>
              <p>{note.preview || "本文はまだありません。"}</p>
              <time>{new Date(note.modifiedAt).toLocaleDateString("ja-JP", { day: "numeric", month: "short" })}</time>
            </button>
          ))}
          {visibleNotes.length === 0 && <p className="empty-list">メモがありません</p>}
        </div>
        <footer className="vault-path" title={vault}>
          ◉ {vault.split("/").pop()}
        </footer>
      </aside>

      {activeTag ? (
        <TagResults
          tag={activeTag}
          notes={tagResults}
          onBack={() => {
            setActiveTag(null);
          }}
          onSelect={(id) => void openNote(id)}
        />
      ) : draft ? (
        <main className="document-view">
          <header className="document-toolbar">
            <span className={`save-status ${saveState}`}>
              {saveState === "saved" ? "保存済み" : saveState === "saving" ? "保存中…" : saveState === "error" ? "保存エラー" : "未保存"}
            </span>
            <button className="delete-button" onClick={() => void removeNote()}>
              ゴミ箱へ
            </button>
          </header>
          <DocumentEditor
            body={draft.body}
            onBodyChange={(body) => {
              setDraft((current) => (current ? { ...current, body } : current));
              setSaveState("dirty");
            }}
            onOpenTag={(tag) => void openTag(tag)}
            onTitleChange={(title) => {
              setDraft({ ...draft, title });
              setSaveState("dirty");
            }}
            title={draft.title}
          />
        </main>
      ) : (
        <main className="empty-view">
          <div>
            <span>✦</span>
            <h1>メモを選んでください</h1>
            <p>または、新しい考えを書き始めましょう。</p>
          </div>
        </main>
      )}

      <aside className="connections-panel">
        <span className="eyebrow">CONNECTIONS</span>
        <h2>このメモのタグ</h2>
        <div className="tag-list">
          {tags.map((tag) => (
            <button key={tag.normalizedName} onClick={() => void openTag(tag.displayName)}>
              #{tag.displayName}
              <span>→</span>
            </button>
          ))}
          {tags.length === 0 && <p>#タグを書くと、関連するメモがここに現れます。</p>}
        </div>
        <div className="hint-card">
          <strong>ヒント</strong>
          <p>
            本文に <code>#りんご</code> のように書くと、メモ同士がつながります。
          </p>
        </div>
      </aside>

      {conflict && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true">
            <span className="eyebrow">EDIT CONFLICT</span>
            <h2>外部でメモが変更されました</h2>
            <p>現在の編集を残すか、外部で変更された内容を読み込んでください。</p>
            <div className="modal-actions">
              <button
                onClick={() => {
                  setDraft(conflict);
                  setConflict(null);
                  setSaveState("saved");
                }}
              >
                外部の内容を読む
              </button>
              <button className="primary-button" onClick={() => void overwriteConflict()}>
                現在の編集で上書き
              </button>
            </div>
          </section>
        </div>
      )}

      {error && (
        <button
          className="error-toast"
          onClick={() => {
            setError(null);
          }}
        >
          {error}
          <span>×</span>
        </button>
      )}
    </div>
  );
}
