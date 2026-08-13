import { describe, expect, it } from "vitest";
import type { NoteSummary } from "./types";
import { filterNotes, findLatestNote } from "./note-search";

const notes: NoteSummary[] = [
  {
    id: "older.txt",
    links: [{ displayName: "ＲＥＤ ＡＰＰＬＥ", normalizedName: "red apple" }],
    modifiedAt: 10,
    preview: "赤い果物",
    revision: "r1",
    title: "果物",
  },
  {
    id: "newer.txt",
    links: [],
    modifiedAt: 20,
    preview: "本文にりんごがある",
    revision: "r2",
    title: "収穫メモ",
  },
];

describe(filterNotes, () => {
  it("タイトル、preview、リンク名をNFKCと小文字で部分一致検索する", () => {
    expect(filterNotes(notes, "red apple").map((note) => note.id)).toStrictEqual(["older.txt"]);
    expect(filterNotes(notes, "リンゴ").map((note) => note.id)).toStrictEqual([]);
    expect(filterNotes(notes, "りんご").map((note) => note.id)).toStrictEqual(["newer.txt"]);
    expect(filterNotes(notes, "収穫").map((note) => note.id)).toStrictEqual(["newer.txt"]);
  });

  it("空検索では入力順を保った全件を返す", () => {
    expect(filterNotes(notes, "  ")).toStrictEqual(notes);
  });
});

describe(findLatestNote, () => {
  it("入力順に依存せずmodifiedAtが最大のメモを返す", () => {
    expect(findLatestNote(notes)?.id).toBe("newer.txt");
  });

  it("空配列ではnullを返す", () => {
    expect(findLatestNote([])).toBeNull();
  });
});
