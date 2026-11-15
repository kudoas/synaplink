# macOSの権限拒否とURL起動失敗をOS直接呼出しで確認した

2026-11-15、`cc5f73d`の実装に対して、macOSの権限拒否4件とURL起動失敗1件を確認した。いずれも想定したエラーを返し、ファイルの原文を保持し、権限復元後の再試行に成功した。今回の範囲で追加修正を要する不具合は再現していない。

この記録が答える問いは「実OSの拒否が既存Rust実装でエラーになり、元データを保持して再試行できるか」である。RustからOSを直接呼ぶ試験であり、Tauriの実IPC・ネイティブ画面・URLクリックからの通知は未検証。現在の残課題の正本は[課題の対応状況](../../../issue-status.md)を参照する。

## 実行条件と証拠

| 条件 | 値 |
| --- | --- |
| 実装の基準コミット | `cc5f73dc595098afaa0d912cd3df3ba9e46a29e2`（`279d29d`は文書のみの追加） |
| OS | macOS 27.2 / build 26B123 / Darwin 27.2.0 |
| ユーザー | UID 501、非root。各試験も`/usr/bin/id -u`でrootでないことを検査 |
| Rust | `rustc 1.97.1 (8bab26f4f 2026-07-14)` |
| JavaScript検証環境 | Node 26.13.1 / pnpm 12.20.0、独立node_modules/store、npm.flatt.tech経由でinstall |
| 対象データ | 各試験が生成した専用`tempfile::tempdir`内の固定文字列。ユーザーのvault・設定は未使用 |
| 試験コード | [native_io_tests.rs](../../../../src-tauri/src/native_io_tests.rs) |
| 生ログ | [rust-probes.txt](rust-probes.txt)、[環境出力](environment.json) |

この試験は環境依存のため、macOS限定・通常は`ignored`とした。標準のRust試験33件とは別に明示実行する5件であり、通常CIの成功だけではこの5件を検証済みと扱わない。

## 権限拒否4件は原文保持と復権後の再試行を確認した

`chmod`相当の`fs::set_permissions`で、現在のユーザーが所有する一時ファイル・ディレクトリのmodeを変更した。まず標準ライブラリの実読込・実書込が`PermissionDenied`になることを検査し、モックによるエラー注入と区別した。権限はスコープ終了時に復元する。

| 入力・拒否条件 | 観測した結果 | 原文保持・再試行の観測 |
| --- | --- | --- |
| 正常な`valid.txt`とmode `000`の`denied.txt` | `scan_notes`は正常1件、失敗1件。失敗には対象パスと`Permission denied (os error 13)` | 権限復元後は2件・失敗0件。両方の本文が入力と一致 |
| 初回読込後、保存対象をmode `000`へ変更 | `save_note_at_path`は`Permission denied (os error 13)`を含むエラー | 復元直後の原文が入力と一致。同じ保存要求の再試行が成功し、新本文に一致。残るファイルは1件 |
| vaultのmodeを`0500`へ変更 | 読込一覧は1件。保存は一時ファイル作成時に`Permission denied (os error 13)` | 元本文は入力と一致、残るファイルは元メモ1件のみ。mode復元後の保存成功・新本文一致 |
| vaultのmodeを`000`へ変更 | 一覧は部分成功ではなく「保存先フォルダを読み込めません」の全体エラー | mode復元後は1件・失敗0件。本文は入力と一致 |

確認したのはPOSIX modeによる拒否である。ACL、所有者の変更、ディスク容量不足、ネットワークファイルシステムの挙動へは一般化していない。

## 未登録URLのOS拒否とアプリのscope拒否は別の経路

URL試験は毎回UUIDを含む専用schemeを作り、[url-handler.swift](url-handler.swift)からCoreServicesの`LSCopyDefaultHandlerForURLScheme`を読取専用で呼ぶ。登録handlerが存在すれば試験を止める。未登録の応答を確認した後にだけ、既存の`tauri_plugin_opener::open_url`へURLを渡し、`Error::Io`が返ることを確認した。handler・既定ブラウザの設定は変更していない。

使用中の`tauri-plugin-opener 2.7.3`は`open 5.4.5`へ処理を渡す。macOSの`open::that_detached`は`/usr/bin/open`の終了を待つ実装であり、このOS起動エラーを呼出元へ返す。起動を受け付けたブラウザでページの読込に失敗する状況は、本試験の対象外である。確認した依存ソースはCargoが取得した`open-5.4.5/src/lib.rs`（SHA-256 `8452f7b0d75cbcc99c0581bea839c4042eae57f4b9d10e1d9b5c75042deb9b1f`）と`tauri-plugin-opener-2.7.3/src/open.rs`（`847426f99a3ca11c2bce458c3368f678ec05f41fb65331fc384067e0e978d939`）。対象バージョンは[Cargo.lock](../../../../src-tauri/Cargo.lock)で固定されている。

アプリの[opener権限](../../../../src-tauri/capabilities/default.json)は`https://*`のみを許可する。そのため、上記の未登録schemeをアプリ画面から渡す場合はOS呼出しより先にscopeで拒否される。`http://`クリックの実IPC拒否も、OSのLaunchServices拒否と同じものとして数えない。

## 再実行する

macOS上の非rootユーザーとXcode Command Line ToolsのSwiftが必要になる。テストは権限変更を専用の一時ディレクトリ内に限定し、URLは登録handler不在を先に確認する。

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline native_io -- --ignored
```

通常の検証は`cargo fmt -- --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`を実施した。frontendは159件、lint・型チェック・Web buildも成功。Tauri macOS app buildも成功した。

## 実IPCと画面の確認は続ける

OS直接呼出しでデータ保持と復旧が確認できたため、保存処理のコード変更は加えていない。次は隔離identifierのTauriアプリ・専用vaultを使い、権限拒否時に対象と理由が表示されること、正常メモと編集中の内容が残ること、権限復元後に再試行できることを画面と実IPCの両方で観測する。実IPCを通した記録が得られるまでは、[残課題](../../../issue-status.md)の実機確認完了とは扱わない。
