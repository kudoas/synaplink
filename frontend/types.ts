export interface TagReference {
  normalizedName: string;
  displayName: string;
}

export interface NoteSummary {
  id: string;
  title: string;
  preview: string;
  modifiedAt: number;
  revision: string;
  tags: TagReference[];
}

export interface NoteDocument {
  id: string;
  title: string;
  body: string;
  modifiedAt: number;
  revision: string;
  tags: TagReference[];
}

export interface SaveNoteInput {
  id: string;
  title: string;
  body: string;
  expectedRevision: string;
  overwrite?: boolean;
}

export type SaveResult = { status: "saved"; note: NoteDocument } | { status: "conflict"; current: NoteDocument };

export interface TagMemoDocument {
  tag: string;
  body: string;
  revision: string | null;
  exists: boolean;
}

export interface SaveTagMemoInput {
  tag: string;
  body: string;
  expectedRevision: string | null;
  overwrite?: boolean;
}

export type SaveTagMemoResult =
  | { status: "saved"; memo: TagMemoDocument }
  | { status: "conflict"; current: TagMemoDocument };
