import type { SaveState } from "../use-autosaved-document";

export function SaveStatus({ state }: { state: SaveState }) {
  const label = state === "saved" ? "保存済み" : state === "saving" ? "保存中…" : state === "error" ? "保存エラー" : "未保存";
  return <span className={`save-status ${state}`}>{label}</span>;
}
