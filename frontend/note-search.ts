import type { NoteSummary } from "./types";

const normalizeSearch = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase();

export function filterNotes(notes: NoteSummary[], search: string): NoteSummary[] {
  const query = normalizeSearch(search);
  if (!query) {
    return notes;
  }
  return notes.filter((note) =>
    [note.title, note.preview, ...note.links.map((link) => link.displayName)]
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .includes(query),
  );
}

export function findLatestNote(notes: NoteSummary[]): NoteSummary | null {
  let latest: NoteSummary | null = null;
  for (const note of notes) {
    if (!latest || note.modifiedAt > latest.modifiedAt) {
      latest = note;
    }
  }
  return latest;
}
