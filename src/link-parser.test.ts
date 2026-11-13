import { describe, expect, it } from "vitest";
import { normalizeLink, parseLinks, uniqueLinks } from "./link-parser";

describe(parseLinks, () => {
  it("同じ行のWikiリンクを括弧を含む範囲で抽出する", () => {
    expect(parseLinks("本文 [[りんご]] と [[ Red Apple ]]。 ")).toStrictEqual([
      { displayName: "りんご", from: 3, normalizedName: "りんご", to: 10 },
      { displayName: "Red Apple", from: 13, normalizedName: "red apple", to: 28 },
    ]);
  });

  it("空、未閉鎖、改行を含む候補を無視する", () => {
    expect(parseLinks("[[]] [[   ]] [[未閉鎖\n[[改行\nリンク]] [[有効]]").map((link) => link.displayName)).toStrictEqual([
      "有効",
    ]);
  });

  it("奇数個のバックスラッシュでエスケープされた開始括弧だけを無視する", () => {
    expect(parseLinks(String.raw`\[[無効]] \\[[有効]]`).map((link) => link.displayName)).toStrictEqual(["有効"]);
  });

  it("旧タグを無視し、エイリアス風の文字列を内容として扱う", () => {
    expect(parseLinks("#りんご [[りんご|Apple]]").map((link) => link.displayName)).toStrictEqual(["りんご|Apple"]);
  });

  it("未閉鎖行が多数あっても後続行のリンクとUTF-16位置を保持する", () => {
    const prefix = "[[未閉鎖\r\n".repeat(80000);
    const content = `${prefix}😀 [[ ＡＰＰＬＥ ]]\r\n[[最後]]`;
    const lastFrom = content.indexOf("[[最後]]");
    expect(parseLinks(content)).toStrictEqual([
      { displayName: "ＡＰＰＬＥ", from: prefix.length + 3, normalizedName: "apple", to: content.indexOf("]]", prefix.length) + 2 },
      { displayName: "最後", from: lastFrom, normalizedName: "最後", to: content.length },
    ]);
  });

  it("同じ行の入れ子風の括弧とエスケープ、空の最終行を従来どおり扱う", () => {
    const content = `${String.raw`\[[無効]] [[外側 [[内側]] [[次]]`}\n`;
    expect(parseLinks(content).map((link) => link.displayName)).toStrictEqual(["外側 [[内側", "次"]);
  });
});

describe("link normalization", () => {
  it("nfkcと小文字でリンク名を正規化する", () => {
    expect(normalizeLink("ＡＰＰＬＥ")).toBe("apple");
  });

  it("正規化後に重複するリンクを最初の表記で一意化する", () => {
    expect(uniqueLinks("[[ＡＰＰＬＥ]] [[apple]]").map((link) => link.displayName)).toStrictEqual(["ＡＰＰＬＥ"]);
  });
});
