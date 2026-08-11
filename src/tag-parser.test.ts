import { describe, expect, it } from "vitest";

import { normalizeTag, parseTags, uniqueTags } from "./tag-parser";

describe(parseTags, () => {
  it("日本語、英数字、ハイフン、アンダースコアを抽出する", () => {
    expect(parseTags("#りんご、#Red-Apple #foo_bar").map((tag) => tag.displayName)).toStrictEqual(["りんご", "Red-Apple", "foo_bar"]);
  });

  it("エスケープ済みタグと空タグを無視する", () => {
    expect(parseTags(String.raw`\#りんご # #みかん`).map((tag) => tag.displayName)).toStrictEqual(["みかん"]);
  });

  it("同一タグの表記を維持しながら重複を除く", () => {
    expect(uniqueTags("#Apple #ＡＰＰＬＥ").map((tag) => tag.displayName)).toStrictEqual(["Apple"]);
  });

  it("nFKCと英字小文字化で比較用の名前を作る", () => {
    expect(normalizeTag("ＡＰＰＬＥ")).toBe("apple");
  });
});
