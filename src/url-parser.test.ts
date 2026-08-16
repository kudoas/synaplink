import { describe, expect, it } from "vitest";

import { parseUrls } from "./url-parser";

describe(parseUrls, () => {
  it("httpsのURLだけを位置情報付きで抽出する", () => {
    expect(parseUrls("参照 https://example.com/a?q=1#top と http://localhost:3000/x")).toStrictEqual([
      { from: 3, to: 32, url: "https://example.com/a?q=1#top" },
    ]);
  });

  it.each([
    ["https://example.com/path。", "https://example.com/path"],
    ["https://example.com/path,", "https://example.com/path"],
    ["https://example.com/path）", "https://example.com/path"],
    ["https://example.com/path］", "https://example.com/path"],
    ["https://example.com/path｝", "https://example.com/path"],
  ])("url末尾の句読点や閉じ括弧を除外する: %s", (content, expected) => {
    expect(parseUrls(content)).toStrictEqual([{ from: 0, to: expected.length, url: expected }]);
  });

  it("url内で対応する括弧が閉じている場合は末尾の括弧を保持する", () => {
    const url = "https://en.wikipedia.org/wiki/Function_(mathematics)";

    expect(parseUrls(url)).toStrictEqual([{ from: 0, to: url.length, url }]);
  });

  it.each([
    "https://example.com/（メモ）",
    "https://example.com/［メモ］",
    "https://example.com/｛メモ｝",
  ])("url内で対応する全角括弧が閉じている場合は保持する: %s", (url) => {
    expect(parseUrls(url)).toStrictEqual([{ from: 0, to: url.length, url }]);
  });

  it("クエリ文字列とフラグメントをURLに含める", () => {
    const url = "https://example.com/search?q=メモ#結果";

    expect(parseUrls(url)).toStrictEqual([{ from: 0, to: url.length, url }]);
  });

  it("非対応スキーム、www表記、不完全なURLを無視する", () => {
    expect(parseUrls("http://example.com www.example.com mailto:memo@example.com ftp://example.com https://")).toStrictEqual([]);
  });

  it("別のトークンや非対応URLの途中にあるhttp表記を無視する", () => {
    expect(parseUrls("xhttps://example.com ftp://https://example.com")).toStrictEqual([]);
  });

  it("大文字のスキームを開くURLでは小文字に正規化する", () => {
    expect(parseUrls("HTTPS://example.com")).toStrictEqual([{ from: 0, to: 19, url: "https://example.com" }]);
  });
});
