import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { NoteDocument, NoteSummary, SaveNoteInput, SaveResult } from "./types";

export const api = {
  getVault: () => invoke<string | null>("get_vault"),
  setVault: (path: string) => invoke<void>("set_vault", { path }),
  listNotes: () => invoke<NoteSummary[]>("list_notes"),
  readNote: (id: string) => invoke<NoteDocument>("read_note", { id }),
  createNote: () => invoke<NoteDocument>("create_note"),
  saveNote: (input: SaveNoteInput) => invoke<SaveResult>("save_note", { input }),
  deleteNote: (id: string) => invoke<void>("delete_note", { id }),
  searchTag: (tag: string) => invoke<NoteSummary[]>("search_tag", { tag }),
  chooseVault: async () => {
    const selected = await open({ directory: true, multiple: false, title: "メモの保存先を選択" });
    return typeof selected === "string" ? selected : null;
  },
};
