# Zettel Memo

macOS向けの、ローカルファーストなツェッテルカステン・メモアプリです。メモは通常のUTF-8プレーンテキストとして保存され、本文中の `#タグ` で関連するメモを横断できます。

## 特徴

- 任意のローカルフォルダをメモの保存先に指定
- 1メモ = 1つの `.txt` ファイル
- 1行目をタイトル、2行目以降を本文として表示
- `#りんご` のような日本語タグに対応
- タグから関連メモを一覧表示
- 自動保存と外部変更時の競合検知
- 外部エディターで追加・編集した `.txt` も読み込み

## タグ記法

`#` の直後に日本語、英数字、ハイフン、アンダースコアを記述します。空白や句読点でタグが終了します。

```text
りんごは #果物 のひとつ。
品種については #青森_りんご にまとめる。
```

タグとして扱いたくない場合は `\#りんご` と書きます。タグ比較ではUnicodeのNFKC正規化と英字の小文字化を行います。

## 開発

必要なツールは [mise](https://mise.jdx.dev/) で導入できます。

```sh
mise install
pnpm install
pnpm tauri dev
```

Web UIのみを起動する場合は `pnpm dev` を使います。ただし、ローカルファイル操作にはTauriランタイムが必要です。

## テストとビルド

```sh
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --bundles app
```

TypeScriptはOxlintの全カテゴリと型情報付きチェックを使用します。相互に矛盾するルールや、React・Tauriの設計と両立しないルールのみ `.oxlintrc.json` で明示的に除外しています。Rustはrustfmtに加え、Clippyの `all`、`pedantic`、`nursery`、`cargo` と安全性に関するrestrictionルールをdenyで実行します。

## データ形式

アプリが作成するファイル名はUUIDです。本文は独自メタデータを含まないプレーンテキストです。

```text
メモのタイトル
ここから本文です。#りんご #果物
```

保存先フォルダ以外のキャッシュや設定を削除しても、メモ本文からタグ情報を再構築できます。
