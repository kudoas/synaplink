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
});

describe("link normalization", () => {
  it("nfkcと小文字でリンク名を正規化する", () => {
    expect(normalizeLink("ＡＰＰＬＥ")).toBe("apple");
  });

  it("正規化後に重複するリンクを最初の表記で一意化する", () => {
    expect(uniqueLinks("[[ＡＰＰＬＥ]] [[apple]]").map((link) => link.displayName)).toStrictEqual(["ＡＰＰＬＥ"]);
  });
});
