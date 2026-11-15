# mainに残る課題と対応状況（2026-11-15）

対象は `354715662687d349351d28773a825f470b02aaed`。前回調査の15件をmainの実装・テストと照合した結果、8件は修正が入り、M04は終了待機を実装済みで実機確認が残る。未対応の6件は、今回の再計測でも同じ結果になった。次の対応は、読込失敗の通知（M08）と競合画面のキーボード操作（M12）を優先する。

本書は、このコミットに対する残課題と実装タスクの記録である。[11月14日の調査](../2026-11-14/README.md)は変更前の観測記録として残す。新しいPRが作られたことと、mainへ反映されたことは区別する。

## 今回も再現した6件を修正単位に分けた

優先度は、観測した影響から付けた作業順の判断であり、発生頻度や損失額の測定値ではない。各行は独立して検証できる。M12とM13はフォーカス制御の変更として同じPRで扱うが、完了条件は分ける。

| 優先度 | ID | 現行mainでの観測事実 | 対応方針と完了条件 | 着手状況 |
| --- | --- | --- | --- | --- |
| 高 | M08 | UTF-8の正常メモと1byte `0xff`のメモの2ファイルに対し、`scan_notes`は成功して正常メモ1件だけを返した | 有効なメモを開ける状態を維持し、読めなかった対象と理由を通知する。修復後の再読込で警告が消え、古い保存先の応答が警告を戻さないことを確認する | [#56](https://github.com/kudoas/synaplink/pull/56) 作成済み・未マージ |
| 高 | M12 | 競合表示直後のフォーカスは本文に残り、Tabを4回押すと背面の保存先変更ボタンへ出た | 初期フォーカス、ダイアログ内の循環、背面操作の抑止、解決後の復帰を確認する。外部読込・上書きは従来どおり動くこと | [#57](https://github.com/kudoas/synaplink/pull/57) 作成済み・未マージ |
| 中 | M11 | 折り返された論理1行の下段（行上端から465.75 CSS px）で↑を押すと、タイトル欄へ移った | 表示上の先頭行だけでタイトルへ移り、折り返し下段では本文内を移動する。複数選択・範囲選択・IME中は従来の保護を維持する | [#54](https://github.com/kudoas/synaplink/pull/54) 作成済み・未マージ |
| 中 | M14 | URL起動APIを1回失敗させても、エラートーストは0件だった | 起動失敗を利用者へ通知する。通常のURL起動とWikiリンク操作は維持する | [#55](https://github.com/kudoas/synaplink/pull/55) 作成済み・未マージ |
| 低 | M13 | 新規メモのタイトルが「無題」になった後も、フォーカスは新規作成ボタンに残った | 新規作成成功後だけタイトルへフォーカスし、失敗・通常読込・ポーリングでは入力中のフォーカスを奪わない | [#57](https://github.com/kudoas/synaplink/pull/57) 作成済み・未マージ |
| 低 | M10 | 本文2行目だけの語を検索すると表示0件、「メモがありません」と表示。検索欄の説明参照はなかった | 検索範囲を画面と支援技術へ伝え、空の保存先と検索未一致を区別する。検索対象自体は変更しない | [#53](https://github.com/kudoas/synaplink/pull/53) 作成済み・未マージ |

PRの反映順は #54 → #55 → #57。同じエディタの型・テストを段階的に更新するための依存で、#53・#56は独立している。この文書の対象mainには、これらの修正はまだ含まれない。

M08の一次記録は[実ファイル試験出力](evidence/scan-notes-output.txt)、入力は[再現試験](evidence/scan-notes.repro.rs)。M10〜M14の一次記録は[ブラウザ結果JSON](evidence/browser-result.json)、入力は[専用モック画面](evidence/browser-fixture.html)。これらは問題が再現したことを確認する試験であり、テスト成功を修正完了とは扱わない。

### M10は全文検索の不具合とは扱わない

[READMEの検索仕様](../../../README.md#検索欄でメモを絞り込む)と[filterNotes](../../../src/note-search.ts)は、タイトル・本文プレビュー・リンク名を検索対象としている。本文プレビューは最初の空でない行の先頭90文字。今回の語はその外にあるため、表示0件は現行仕様に一致する。

一方、検索欄にはこの範囲の説明がなく、検索未一致も「メモがありません」と表示される。今回はこの表示を修正する。全文検索の導入には検索対象・IPC転送量・一覧更新への影響を別途判断する必要があるため、本対応には含めない。

## 修正済み8件は実装と回帰試験で確認する

ここでいう修正済みはmainへの実装反映と回帰試験を指し、実データでの効果や実環境の全経路を確認したという意味ではない。今回のmainで既存frontendテスト137件が成功した（[出力](evidence/frontend-tests.txt)）。mainの[CI](https://github.com/kudoas/synaplink/actions/runs/43542330883)も成功しており、Rustテスト・静的チェック・macOS app buildを含む。

| ID | mainへ入った変更 | 対応と根拠 |
| --- | --- | --- |
| M01 | [#37](https://github.com/kudoas/synaplink/pull/37) | 保存後コールバック待ち中の追加編集を保存へ進める。[use-autosaved-document.test.tsx](../../../src/use-autosaved-document.test.tsx)の追加編集ケース |
| M02 | [#50](https://github.com/kudoas/synaplink/pull/50) | 原子的交換で実際の退避内容を確認し、競合時に復元または保持する。[safe_save.rs](../../../src-tauri/src/safe_save.rs)の交換直前書込・復元失敗・第三者更新の試験 |
| M03 | [#38](https://github.com/kudoas/synaplink/pull/38) | 保存失敗の再試行と、内容を控えた上で破棄して閉じる経路を提供。[App.test.tsx](../../../src/App.test.tsx)の保存失敗後の再試行・破棄ケース |
| M05 | [#40](https://github.com/kudoas/synaplink/pull/40) | 保存先と一覧要求の世代を照合し、遅れた旧一覧を適用しない。[App.test.tsx](../../../src/App.test.tsx)の保存先移動・rollbackケース |
| M06 | [#49](https://github.com/kudoas/synaplink/pull/49) | 実際の外部本文置換時だけUndo/Redo履歴を切り替える。同値の保存応答では維持。[MemoEditor.test.tsx](../../../src/components/MemoEditor.test.tsx)の外部更新・同値応答ケース |
| M07 | [#36](https://github.com/kudoas/synaplink/pull/36) | 元ファイルのアクセス権限を一時ファイルへ適用。Rustの0600・0640・0444保存試験 |
| M09 | [#50](https://github.com/kudoas/synaplink/pull/50) | シンボリックリンク保存を拒否し、リンクの通常ファイルへの置換を防ぐ。初回確認後のリンク差替えも試験 |
| M15 | [#39](https://github.com/kudoas/synaplink/pull/39) | Wikiリンクの閉じ括弧探索を行内へ制限。[変更前後の測定](../2026-11-14/fixes/M15-link-parser.md) |

戻る・進むボタンは[#48](https://github.com/kudoas/synaplink/pull/48)で実装済み。旧調査の15件とは別の機能追加で、保存失敗時の履歴保持・検索語復元を[navigation-history.test.tsx](../../../src/navigation-history.test.tsx)で確認している。

## M04は実装済みだが終了操作の実機確認が残る

[#51](https://github.com/kudoas/synaplink/pull/51)は、close・終了メニュー・Cmd+Qを保存完了まで待たせる。frontend hook/APIとRust gateの試験はあるが、実Tauriのウィンドウを閉じる操作・Cmd+Q・メニュー・IME未確定入力の操作は未確認である。[終了保護の記録](../2026-11-14/shutdown-save-guard.md)を検証手順と保証範囲の正本とする。

実機確認では、専用vaultへの入力直後の終了が最終本文の保存を待つこと、保存先エラー・外部競合では終了せず内容を保持することを観測する。DockやOSの直接terminate、強制終了、クラッシュ、電源断は対象外である。これらを「現行mainで再現した未修正不具合」に数えない。

M02/M09の保存処理にも保証範囲がある。交換前に開いた古いファイル記述子へ、検証後も外部アプリが書き続ける場合などは保護を保証しない。[保存・復旧手順](../../operations/note-save-recovery.md)に従い、復旧ファイルを元メモと比較するまで削除しない。

## 修正PRは統合状態でも検証した

対象mainへ #53 `4d9dfa7`、#54 `d3bc9ef`、#55 `64ea520`、#56 `367d3f8`、#57 `0f16870` の差分を重ねた専用worktreeで検証した。各PRに含まれる先行コミットも反映し、共通の親差分は重複させていない。frontend 159テスト、Rust 33テスト、lint・型チェック・fmt・clippy・Web build・`pnpm tauri build --bundles app`が成功した。実アプリは起動していない。

統合中に、M11の新規テストへM14の必須callbackを渡す必要があることを検出し、#55へ反映した。また#57のCIでは、保存APIの呼出開始を待つだけの既存テストが、失敗処理の完了前に回復ボタンを押そうとして失敗した。回復ボタンの表示を待つよう修正し、その後のCIは成功した。これらのため、エディタ型の更新順を上記スタックへ整理している。

agent-browserの統合画面でも、読込警告を出したまま正常メモを開けること、URL起動失敗の表示、新規タイトルへのfocus・全選択、競合の見出しへの初期focus・背景inert・Tab循環、解決後の背景復帰、再読込での警告解除と本文維持を確認した。Tauri APIはモックであり、競合応答の文書とモックの保存文書を一致させた条件で解決後の本文を確認している。実IPC・WebKit・読み上げ・実IMEの確認へ一般化しない。

## 再計測はmainの専用worktreeと一時データで行った

| 項目 | 条件 |
| --- | --- |
| 対象 | `354715662687d349351d28773a825f470b02aaed`、実装は変更せず再計測（Rust試験用モジュールだけ一時追加） |
| 環境 | macOS 27.2（26B123）、arm64、Rust 1.97.1 |
| frontend | Node.js 26.13.1、pnpm 12.18.0、Vitest 5.1.0、jsdom 31.0.0 |
| ブラウザ | agent-browserからChromium 157.0.8103.52、viewport 1280×633 CSS px |
| ファイル操作 | `tempfile`による一時vault。正常UTF-8と1byte `0xff`の2ファイル |
| UI/API | [fixture](evidence/browser-fixture.html)でTauri APIをモックし、mainのAppをそのまま表示。終了guard登録もモック |

ブラウザの寸法はこのviewport・入力・1回の操作に対する記録で、他の画面幅や発生頻度に一般化しない。URLの実OS起動や実IPCの順序、スクリーンリーダーの読み上げは測定していない。frontend既存試験はjsdomであり、ブラウザの測定とは別である。

### ブラウザの入力と観測を再実行する

1. 対象コミットの専用worktreeへ本ディレクトリを配置し、指定版ツールで`pnpm install --frozen-lockfile`を実行する。
2. `agent-browser`スキルを読み、`pnpm dev --host 127.0.0.1 --port 1426 --strictPort`を起動する。
3. `agent-browser --session remaining-main open http://127.0.0.1:1426/docs/investigations/2026-11-15/evidence/browser-fixture.html`で開き、snapshotで操作対象を確認する。
4. 「深部検索語」を検索し、`.note-row`の件数・一覧文言・入力欄の`aria-describedby`を取得する。「調査」で検索し直して調査用メモを開く。
5. `https://example.com`をクリックし、`window.__auditCalls`のURL起動呼出回数と`.error-toast`の件数を取得する。
6. 新規作成後、タイトルが「無題」であることと`document.activeElement.className`を取得する。
7. 「折り返し表示を調べるための長い本文。」を改行なしで40回入力し、Control+Endで末尾へ移動する。`.cm-line`と選択Rangeの矩形差を取得し、下段にいることを確認してからArrowUpを押し、activeElementを取得する。
8. `window.__auditConflict=true`を設定して本文を変更し、競合表示を待つ。初期フォーカスの内外判定と、Tabを4回押した各移動先を取得する。
9. 測定用のbrowser sessionとdev serverを終了する。

### 実ファイル試験を現行の非公開関数へ接続する

専用worktreeの`src-tauri/src/lib.rs`末尾へ、次のモジュールだけを一時追加して実行した。試験後はこの追加を取り除き、元のソースと一致することを確認した。

```rust
#[cfg(test)]
mod remaining_main_audit {
    include!("../../docs/investigations/2026-11-15/evidence/scan-notes.repro.rs");
}
```

```sh
cargo test --manifest-path src-tauri/Cargo.toml remaining_main_audit -- --nocapture
```

この再現試験は現行の「正常メモ1件のみを成功として返す」挙動をassertしている。M08の修正後に同じ試験が失敗することは、修正の失敗を意味しない。修正後の期待値は各PRの回帰試験を参照する。
