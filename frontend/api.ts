import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  NoteDocument,
  NoteSummary,
  SaveNoteInput,
  SaveResult,
  SaveTagMemoInput,
  SaveTagMemoResult,
  TagMemoDocument,
} from "./types";

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
  readTagMemo: async (tag: string) => invoke<TagMemoDocument>("read_tag_memo", { tag }),
  saveNote: async (input: SaveNoteInput) => invoke<SaveResult>("save_note", { input }),
  saveTagMemo: async (input: SaveTagMemoInput) => invoke<SaveTagMemoResult>("save_tag_memo", { input }),
  searchTag: async (tag: string) => invoke<NoteSummary[]>("search_tag", { tag }),
  setVault: async (path: string) => invoke<void>("set_vault", { path }),
};
