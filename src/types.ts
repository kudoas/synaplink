export type TagReference = {
  normalizedName: string;
  displayName: string;
};

export type NoteSummary = {
  id: string;
  title: string;
  preview: string;
  modifiedAt: number;
  revision: string;
  tags: TagReference[];
};

export type NoteDocument = {
  id: string;
  title: string;
  body: string;
  modifiedAt: number;
  revision: string;
  tags: TagReference[];
};

export type SaveNoteInput = {
  id: string;
  title: string;
  body: string;
  expectedRevision: string;
  overwrite?: boolean;
};

export type SaveResult =
  | { status: "saved"; note: NoteDocument }
  | { status: "conflict"; current: NoteDocument };
