import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { DocumentEditor } from "./components/DocumentEditor";
import { EditConflictDialog } from "./components/EditConflictDialog";
import { SaveStatus } from "./components/SaveStatus";
import { TagResults } from "./components/TagResults";
import { uniqueTags } from "./tag-parser";
import type { NoteDocument, NoteSummary } from "./types";
import { useAutosavedDocument } from "./use-autosaved-document";

export function App() {
  const [vault, setVault] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagResults, setTagResults] = useState<NoteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const externalReadGeneration = useRef(0);

  const loadNotes = useCallback(async () => {
    setNotes(await api.listNotes());
  }, []);

  const refreshNotes = useCallback(async () => {
    try {
      await loadNotes();
    } catch (error) {
      setError(String(error));
    }
  }, [loadNotes]);

  const {
    acceptExternal,
    conflict,
    document: draft,
    edit,
    load,
    overwriteConflict,
    requestNavigation,
    saveState,
    synchronize,
  } = useAutosavedDocument<NoteDocument>({
    mergeSaved: (local, saved) => ({
      ...local,
      modifiedAt: saved.modifiedAt,
      revision: saved.revision,
      tags: saved.tags,
    }),
    onError: (saveError) => {
      setError(String(saveError));
    },
    onSaved: loadNotes,
    persist: async (note, expectedRevision, overwrite) => {
      const result = await api.saveNote({
        body: note.body,
        expectedRevision: expectedRevision ?? note.revision,
        id: note.id,
        ...(overwrite ? { overwrite: true } : {}),
        title: note.title,
      });
      return result.status === "saved"
        ? { document: result.note, status: "saved" }
        : { current: result.current, status: "conflict" };
    },
  });

  const invalidateExternalRead = useCallback(() => {
    externalReadGeneration.current += 1;
  }, []);

  const loadDocument = useCallback(
    (note: NoteDocument | null) => {
      invalidateExternalRead();
      load(note);
    },
    [invalidateExternalRead, load],
  );

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
      const generation = externalReadGeneration.current + 1;
      externalReadGeneration.current = generation;
      void (async () => {
        try {
          const note = await api.readNote(draft.id);
          if (externalReadGeneration.current === generation && note.id === draft.id) {
            synchronize(note);
          }
        } catch (error) {
          if (externalReadGeneration.current === generation) {
            setError(String(error));
          }
        }
      })();
      return () => {
        if (externalReadGeneration.current === generation) {
          externalReadGeneration.current += 1;
        }
      };
    }
  }, [draft, notes, saveState, synchronize]);

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

  const navigateFromNote = useCallback(
    (action: () => void) => {
      invalidateExternalRead();
      void requestNavigation(action);
    },
    [invalidateExternalRead, requestNavigation],
  );

  const chooseVault = () => {
    navigateFromNote(() => {
      void (async () => {
        try {
          const selected = await api.chooseVault();
          if (!selected) {
            return;
          }
          await api.setVault(selected);
          setVault(selected);
          loadDocument(null);
          setActiveTag(null);
          await refreshNotes();
        } catch (error) {
          setError(String(error));
        }
      })();
    });
  };

  const openNote = (id: string) => {
    navigateFromNote(() => {
      void (async () => {
        try {
          const note = await api.readNote(id);
          loadDocument(note);
          setActiveTag(null);
        } catch (error) {
          setError(String(error));
        }
      })();
    });
  };

  const createNote = () => {
    navigateFromNote(() => {
      void (async () => {
        try {
          const note = await api.createNote();
          loadDocument(note);
          setActiveTag(null);
          await refreshNotes();
        } catch (error) {
          setError(String(error));
        }
      })();
    });
  };

  const openTag = (tag: string) => {
    navigateFromNote(() => {
      void (async () => {
        try {
          const results = await api.searchTag(tag);
          setTagResults(results);
          setActiveTag(tag);
        } catch (error) {
          setError(String(error));
        }
      })();
    });
  };

  const removeNote = () => {
    if (!draft || !window.confirm(`「${draft.title || "無題"}」をゴミ箱へ移動しますか？`)) {
      return;
    }
    const noteId = draft.id;
    navigateFromNote(() => {
      void (async () => {
        try {
          await api.deleteNote(noteId);
          loadDocument(null);
          await refreshNotes();
        } catch (error) {
          setError(String(error));
        }
      })();
    });
  };

  if (!vault) {
    return (
      <div className="welcome-shell">
        <section className="welcome-card">
          <div className="brand-mark">Z</div>
          <span className="eyebrow">LOCAL-FIRST NOTES</span>
          <h1>考えを、つなげる。</h1>
          <p>プレーンテキストと #タグだけの、静かなツェッテルカステン。</p>
          <button className="primary-button" onClick={chooseVault}>
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
          <button className="icon-button" title="保存先を変更" onClick={chooseVault}>
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
        <button className="new-note-button" onClick={createNote}>
          <span>＋</span> 新しいメモ
        </button>
        <div className="note-list">
          {visibleNotes.map((note) => (
            <button
              className={`note-row ${draft?.id === note.id ? "active" : ""}`}
              key={note.id}
              onClick={() => {
                openNote(note.id);
              }}
            >
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
          onSelect={openNote}
        />
      ) : draft ? (
        <main className="document-view">
          <header className="document-toolbar">
            <SaveStatus state={saveState} />
            <button className="delete-button" onClick={removeNote}>
              ゴミ箱へ
            </button>
          </header>
          <DocumentEditor
            body={draft.body}
            onBodyChange={(body) => {
              edit((current) => ({ ...current, body }));
            }}
            onOpenTag={openTag}
            onTitleChange={(title) => {
              edit((current) => ({ ...current, title }));
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
            <button
              key={tag.normalizedName}
              onClick={() => {
                openTag(tag.displayName);
              }}
            >
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
        <EditConflictDialog
          onAcceptExternal={acceptExternal}
          onOverwrite={() => {
            void overwriteConflict();
          }}
        />
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
