export interface LinkReference {
  normalizedName: string;
  displayName: string;
}

export interface NoteSummary {
  id: string;
  title: string;
  preview: string;
  modifiedAt: number;
  revision: string;
  links: LinkReference[];
}

export interface NoteScanIssue {
  path: string;
  message: string;
}

export interface NoteScanResult {
  notes: NoteSummary[];
  issues: NoteScanIssue[];
}

export interface NoteDocument {
  id: string;
  title: string;
  body: string;
  modifiedAt: number;
  revision: string;
  links: LinkReference[];
}

export interface SaveNoteInput {
  id: string;
  title: string;
  body: string;
  expectedRevision: string;
  overwrite?: boolean;
}

export type SaveResult = { status: "saved"; note: NoteDocument } | { status: "conflict"; current: NoteDocument };
