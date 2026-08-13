import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { NoteDocument, NoteSummary, SaveNoteInput, SaveResult } from "./types";

export const api = {
  chooseVault: async () => {
    const selected = await open({ directory: true, multiple: false, title: "メモの保存先を選択" });
    return typeof selected === "string" ? selected : null;
  },
  createNote: async () => invoke<NoteDocument>("create_note"),
  deleteNote: async (id: string) => invoke<void>("delete_note", { id }),
  getVault: async () => invoke<string | null>("get_vault"),
  listNotes: async () => invoke<NoteSummary[]>("list_notes"),
  readNote: async (id: string) => invoke<NoteDocument>("read_note", { id }),
  saveNote: async (input: SaveNoteInput) => invoke<SaveResult>("save_note", { input }),
  setVault: async (path: string) => invoke<void>("set_vault", { path }),
};
