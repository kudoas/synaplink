import { useCallback, useRef, useState } from "react";

interface HistoryEntry {
  noteId: string;
  search: string;
}

interface HistoryState {
  entries: HistoryEntry[];
  index: number;
}

interface HistoryDestination {
  entry: HistoryEntry;
  index: number;
}

export function useNavigationHistory() {
  const [history, setHistory] = useState<HistoryState>({ entries: [], index: -1 });
  const historyRef = useRef(history);

  const updateHistory = useCallback((next: HistoryState) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  const visit = useCallback((noteId: string, sourceSearch: string, targetSearch: string) => {
    const { current } = historyRef;
    const entries = [...current.entries];
    const source = current.index < 0 ? null : entries.at(current.index);
    if (source?.noteId === noteId) {
      entries[current.index] = { noteId, search: targetSearch };
      updateHistory({ entries, index: current.index });
      return;
    }
    if (source) {
      entries[current.index] = { ...source, search: sourceSearch };
    }
    const nextEntries = [...entries.slice(0, current.index + 1), { noteId, search: targetSearch }];
    updateHistory({ entries: nextEntries, index: nextEntries.length - 1 });
  }, [updateHistory]);

  const destination = useCallback((offset: -1 | 1): HistoryDestination | null => {
    const { current } = historyRef;
    const index = current.index + offset;
    const entry = index < 0 ? null : current.entries.at(index);
    return entry ? { entry, index } : null;
  }, []);

  const move = useCallback((target: HistoryDestination, sourceSearch: string) => {
    const { current } = historyRef;
    if (current.entries.at(target.index) !== target.entry) {
      return false;
    }
    const entries = [...current.entries];
    const source = current.index < 0 ? null : entries.at(current.index);
    if (source) {
      entries[current.index] = { ...source, search: sourceSearch };
    }
    updateHistory({ entries, index: target.index });
    return true;
  }, [updateHistory]);

  const reset = useCallback(() => {
    updateHistory({ entries: [], index: -1 });
  }, [updateHistory]);

  return {
    canGoBack: history.index > 0,
    canGoForward: history.index >= 0 && history.index < history.entries.length - 1,
    destination,
    move,
    reset,
    visit,
  };
}
