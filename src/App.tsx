import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { DocumentEditor, type DocumentEditorHandle } from "./components/DocumentEditor";
import { EditConflictDialog } from "./components/EditConflictDialog";
import { SaveStatus } from "./components/SaveStatus";
import { filterNotes, findLatestNote } from "./note-search";
import { useNavigationHistory } from "./use-navigation-history";
import type { NoteDocument, NoteScanIssue, NoteSummary } from "./types";
import { useShutdownGuard } from "./use-shutdown-guard";
import {
  type AbortedNavigation,
  type NavigationResult,
  useAutosavedDocument,
} from "./use-autosaved-document";

export function App() {
  const [vault, setVault] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [scanIssues, setScanIssues] = useState<NoteScanIssue[]>([]);
  const [search, setSearch] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const externalReadGeneration = useRef(0);
  const editorNavigationGeneration = useRef(0);
  const notesRef = useRef<NoteSummary[]>([]);
  const documentEditor = useRef<DocumentEditorHandle>(null);
  const pendingTitleFocus = useRef<string | null>(null);
  const notesScope = useRef({ isChangingVault: false });
  const notesRequestGeneration = useRef(0);
  const appliedNotesRequestGeneration = useRef(0);
  const { canGoBack, canGoForward, destination, move, reset: resetHistory, visit } = useNavigationHistory();

  const replaceNotes = useCallback((next: NoteSummary[], issues: NoteScanIssue[] = []) => {
    notesRef.current = next;
    setNotes(next);
    setScanIssues(issues);
  }, []);

  const loadNotes = useCallback(async () => {
    const scope = notesScope.current;
    if (scope.isChangingVault) {
      throw new Error("保存先の変更中は一覧を取得できません");
    }
    const generation = notesRequestGeneration.current + 1;
    notesRequestGeneration.current = generation;
    try {
      let issues: NoteScanIssue[] = [];
      const next = await api.listNotes((reportedIssues) => { issues = reportedIssues; });
      if (notesScope.current === scope && generation >= appliedNotesRequestGeneration.current) {
        appliedNotesRequestGeneration.current = generation;
        replaceNotes(next, issues);
      }
    } catch (error) {
      if (notesScope.current === scope && generation >= appliedNotesRequestGeneration.current) {
        throw error;
      }
    }
  }, [replaceNotes]);

  const refreshNotes = useCallback(async () => {
    if (notesScope.current.isChangingVault) {
      return;
    }
    try {
      await loadNotes();
    } catch (error) {
      setError(String(error));
    }
  }, [loadNotes]);

  const noteAutosave = useAutosavedDocument<NoteDocument>({
    mergeSaved: (local, saved) => ({
      ...local,
      links: saved.links,
      modifiedAt: saved.modifiedAt,
      revision: saved.revision,
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

  const shutdownReady = useShutdownGuard({
    onError: (shutdownError) => { setError(String(shutdownError)); },
    requestNavigation: noteAutosave.requestNavigation,
  });

  const {
    acceptExternal,
    conflict,
    document: draft,
    edit,
    isNavigating,
    load,
    overwriteConflict,
    requestNavigation,
    saveState,
    synchronize,
  } = noteAutosave;

  const invalidateExternalRead = useCallback(() => {
    externalReadGeneration.current += 1;
  }, []);

  const loadDocument = useCallback(
    (note: NoteDocument | null) => {
      invalidateExternalRead();
      pendingTitleFocus.current = null;
      if (!note) {
        resetHistory();
      }
      load(note);
    },
    [invalidateExternalRead, load, resetHistory],
  );

  useEffect(() => {
    const scope = notesScope.current;
    void (async () => {
      try {
        const currentVault = await api.getVault();
        if (notesScope.current !== scope) {
          return;
        }
        setVault(currentVault);
        if (currentVault) {
          await loadNotes();
        }
      } catch (error) {
        if (notesScope.current === scope) {
          setError(String(error));
        }
      }
    })();
  }, [loadNotes]);

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

  const visibleNotes = useMemo(() => filterNotes(notes, search), [notes, search]);

  useEffect(() => {
    if (!isNavigating && draft?.id === pendingTitleFocus.current && documentEditor.current) {
      pendingTitleFocus.current = null;
      documentEditor.current.focusTitle();
    }
  }, [draft?.id, isNavigating]);

  const requestEditorNavigation = useCallback(
    (action: (isCurrent: () => boolean) => NavigationResult | Promise<NavigationResult>) => {
      const generation = editorNavigationGeneration.current + 1;
      editorNavigationGeneration.current = generation;
      invalidateExternalRead();
      void requestNavigation(
        (): NavigationResult | Promise<NavigationResult> =>
          action(() => editorNavigationGeneration.current === generation),
      );
    },
    [invalidateExternalRead, requestNavigation],
  );

  const chooseVault = () => {
    requestEditorNavigation(async (isCurrent) => {
      let canRefresh = true;
      const abandonVault = (failure: unknown): AbortedNavigation => {
        canRefresh = false;
        setVault(null);
        replaceNotes([]);
        loadDocument(null);
        return {
          error: `保存先を確認できないため、保存先を選び直してください。${String(failure)}`,
          status: "abort",
        };
      };
      const restoreVault = async (): Promise<AbortedNavigation | void> => {
        if (!vault) {
          return abandonVault("元の保存先がありません");
        }
        try {
          await api.setVault(vault);
        } catch (rollbackError) {
          return abandonVault(rollbackError);
        }
      };
      const selected = await api.chooseVault();
      if (!selected || !isCurrent()) {
        return;
      }
      // Invalidate old reads and pause polling until the backend vault is settled.
      notesScope.current = { isChangingVault: true };
      try {
        await api.setVault(selected);
        if (!isCurrent()) {
          return await restoreVault();
        }
        let issues: NoteScanIssue[] = [];
        const selectedNotes = await api.listNotes((reportedIssues) => { issues = reportedIssues; }).catch(async (error: unknown) => {
          const abort = await restoreVault();
          if (abort) {
            return abort;
          }
          throw error;
        });
        if (!Array.isArray(selectedNotes)) {
          return selectedNotes;
        }
        if (!isCurrent()) {
          return await restoreVault();
        }
        setVault(selected);
        replaceNotes(selectedNotes, issues);
        loadDocument(null);
        setSearch("");
        setError(null);
      } finally {
        notesScope.current = { isChangingVault: !canRefresh };
      }
    });
  };

  const openNote = (id: string) => {
    requestEditorNavigation(async (isCurrent) => {
      const note = await api.readNote(id);
      if (isCurrent()) {
        loadDocument(note);
        visit(note.id, search, search);
      }
    });
  };

  const createNote = () => {
    requestEditorNavigation(async (isCurrent) => {
      const note = await api.createNote();
      if (!isCurrent()) {
        return;
      }
      await loadNotes();
      if (!isCurrent()) {
        return;
      }
      loadDocument(note);
      pendingTitleFocus.current = note.id;
      visit(note.id, search, search);
    });
  };

  const openLink = (link: string) => {
    requestEditorNavigation(async (isCurrent) => {
      if (!isCurrent()) {
        return;
      }
      const latest = findLatestNote(filterNotes(notesRef.current, link));
      if (!latest || latest.id === draft?.id) {
        setSearch(link);
        if (draft) {
          visit(draft.id, search, link);
        }
        return;
      }
      const note = await api.readNote(latest.id);
      if (isCurrent()) {
        loadDocument(note);
        visit(note.id, search, link);
        setSearch(link);
      }
    });
  };

  const moveInHistory = (offset: -1 | 1) => {
    const target = destination(offset);
    if (!target) {
      return;
    }
    requestEditorNavigation(async (isCurrent) => {
      const note = await api.readNote(target.entry.noteId);
      if (isCurrent() && move(target, search)) {
        loadDocument(note);
        setSearch(target.entry.search);
        setError(null);
      }
    });
  };

  const removeNote = () => {
    if (!draft || !window.confirm(`「${draft.title || "無題"}」をゴミ箱へ移動しますか？`)) {
      return;
    }
    const noteId = draft.id;
    requestEditorNavigation(async (isCurrent) => {
      await api.deleteNote(noteId);
      if (!isCurrent()) {
        return;
      }
      await loadNotes();
      if (!isCurrent()) {
        return;
      }
      loadDocument(null);
    });
  };

  const retrySave = () => {
    requestEditorNavigation(() => {
      setError(null);
    });
  };

  const discardFailedDraft = () => {
    if (
      saveState !== "error" ||
      isNavigating ||
      !window.confirm("未保存の編集内容を破棄して閉じますか？この操作で編集内容は失われます。")
    ) {
      return;
    }
    loadDocument(null);
    setError(null);
  };

  if (!shutdownReady) {
    return (
      <main className="empty-view">
        <div>
          <h1>終了時保存を準備しています…</h1>
          {error && <p className="error-message">{error}</p>}
        </div>
      </main>
    );
  }

  if (!vault) {
    return (
      <main className="welcome-view">
        <section>
          <h1>Synaplink</h1>
          <p>メモを保存するフォルダーを選んでください。</p>
          <button onClick={chooseVault}>
            メモの保存先を選ぶ
          </button>
          {error && <p className="error-message">{error}</p>}
        </section>
      </main>
    );
  }

  const sidebarToggleLabel = isSidebarCollapsed ? "サイドメニューを開く" : "サイドメニューを閉じる";
  return (
    <div className={isSidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <aside className="sidebar" aria-label="サイドメニュー">
        <header className="sidebar-header">
          <div className="sidebar-brand">
            <button
              type="button"
              className="sidebar-toggle"
              aria-controls="sidebar-content"
              aria-expanded={!isSidebarCollapsed}
              aria-label={sidebarToggleLabel}
              title={sidebarToggleLabel}
              onClick={() => { setIsSidebarCollapsed((collapsed) => !collapsed); }}
            >
              <span aria-hidden="true">{isSidebarCollapsed ? "›" : "‹"}</span>
            </button>
            <strong hidden={isSidebarCollapsed}>Synaplink</strong>
          </div>
          <button hidden={isSidebarCollapsed} onClick={createNote}>新しいメモ</button>
        </header>
        <div className="sidebar-content" id="sidebar-content" hidden={isSidebarCollapsed}>
          <nav className="history-navigation" aria-label="メモの移動履歴">
            <button
              aria-label="戻る"
              disabled={!canGoBack || conflict !== null}
              onClick={() => { moveInHistory(-1); }}
              title="前のメモに戻る"
            >
              ← 戻る
            </button>
            <button
              aria-label="進む"
              disabled={!canGoForward || conflict !== null}
              onClick={() => { moveInHistory(1); }}
              title="次のメモに進む"
            >
              進む →
            </button>
          </nav>
          <div className="search-box">
            <input
              type="search"
              aria-label="メモを検索"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              aria-describedby="search-scope"
              placeholder="メモを検索"
            />
          </div>
          <p className="search-hint" id="search-scope">
            タイトル・本文の抜粋・リンク名を検索（全文検索は非対応）
          </p>
          <div className="note-list">
            {visibleNotes.map((note) => {
              const modifiedAt = new Date(note.modifiedAt);
              return (
                <button
                  className="note-row"
                  aria-current={draft?.id === note.id}
                  key={note.id}
                  onClick={() => {
                    openNote(note.id);
                  }}
                >
                  <strong>{note.title.trim() || "無題"}</strong>
                  <time dateTime={modifiedAt.toISOString()}>
                    {modifiedAt.toLocaleDateString("ja-JP", { day: "numeric", month: "short" })}
                  </time>
                  {note.preview && <span className="note-preview">{note.preview}</span>}
                </button>
              );
            })}
            {visibleNotes.length === 0 && (
              <p className="empty-list">
                {search.trim() ? "検索条件に一致するメモがありません" : "メモがありません"}
              </p>
            )}
          </div>
          {scanIssues.length > 0 && (
            <section className="note-scan-warning" role="status" aria-label="メモ一覧の読込警告">
              <p>読み込めない項目があります（{scanIssues.length}件）。読み込めたメモは利用できます。</p>
              <details>
                <summary>対象と理由を表示</summary>
                <pre>{scanIssues.map((issue) => `${issue.path}\n${issue.message}`).join("\n\n")}</pre>
              </details>
              <button type="button" onClick={() => { void refreshNotes(); }}>一覧を再読込</button>
            </section>
          )}
          <footer className="vault-path" title={vault}>
            <span>{vault.split("/").pop()}</span>
            <button aria-label="保存先を変更" title="保存先を変更" onClick={chooseVault}>変更…</button>
          </footer>
        </div>
      </aside>

      {draft ? (
        <main className="document-view">
          <header className="document-toolbar">
            <SaveStatus state={saveState} />
            <button disabled={isNavigating} onClick={removeNote}>
              ゴミ箱へ
            </button>
          </header>
          {saveState === "error" && (
            <section className="save-error-panel" role="alert">
              <p>保存を完了できませんでした。編集内容はこの画面に残っています。</p>
              <p>保存先や外部ファイルを確認して再試行するか、必要な内容を控えてから編集を破棄して閉じてください。</p>
              <div className="save-error-actions">
                <button onClick={retrySave}>保存を再試行</button>
                <button onClick={discardFailedDraft}>編集を破棄して閉じる</button>
              </div>
            </section>
          )}
          {isNavigating ? (
            <p className="document-transition">移動先を読み込み中…</p>
          ) : (
            <DocumentEditor
              body={draft.body}
              onBodyChange={(body) => {
                edit((current) => ({ ...current, body }));
              }}
              onOpenLink={openLink}
              onTitleChange={(title) => {
                edit((current) => ({ ...current, title }));
              }}
              ref={documentEditor}
              title={draft.title}
              onOpenUrlError={(openError) => { setError(`URLを開けませんでした: ${String(openError)}`); }}
            />
          )}
        </main>
      ) : (
        <main className="empty-view">
          <div>
            <h1>メモを選んでください</h1>
          </div>
        </main>
      )}

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
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
