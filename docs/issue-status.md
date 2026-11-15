# 課題の対応状況

2026-11-15、main `cc5f73dc595098afaa0d912cd3df3ba9e46a29e2` を確認した。[初回調査](investigations/2026-11-14/README.md)の15件にはすべて対応する実装がmainへ入った。現時点で、この15件に対する追加のコード修正待ちはない。M04の終了保護は実機での確認が残っており、効果確認まで完了したとは扱わない。

この文書は現在の対応状況と次の確認事項の正本である。過去の入力・観測値は各調査記録、保存・復旧の仕様は運用文書を参照する。今回行ったのは既知課題との照合とCI・マージ状態の確認であり、新しい網羅的な不具合探索や実機操作ではない。「未知の不具合がない」という結論は出していない。

## 調査した15件への対応はmainへ反映済み

| 対象 | 反映済みの対応 | 根拠 |
| --- | --- | --- |
| M01・M03・M05 | 保存待ち中の再編集、保存失敗からの復旧、古い一覧応答を修正 | [#37](https://github.com/kudoas/synaplink/pull/37)、[#38](https://github.com/kudoas/synaplink/pull/38)、[#40](https://github.com/kudoas/synaplink/pull/40) |
| M02・M07・M09 | 保存中の外部変更の復元・保持、アクセス権限の保持、リンク保存の拒否 | [#36](https://github.com/kudoas/synaplink/pull/36)、[#50](https://github.com/kudoas/synaplink/pull/50) |
| M04 | close・終了メニュー・Cmd+Qを保存完了まで待機させる実装。実機確認は未完了 | [#51](https://github.com/kudoas/synaplink/pull/51)、[検証範囲](investigations/2026-11-14/shutdown-save-guard.md) |
| M06・M15 | 外部同期時のUndo履歴とWikiリンク探索を修正 | [#49](https://github.com/kudoas/synaplink/pull/49)、[#39](https://github.com/kudoas/synaplink/pull/39) |
| M08 | 読込失敗の対象・理由・再試行を表示し、正常なメモを利用可能にする | [#56](https://github.com/kudoas/synaplink/pull/56) |
| M10 | 検索範囲と検索未一致の表示を明確にする。全文検索は追加していない | [#53](https://github.com/kudoas/synaplink/pull/53) |
| M11・M12・M13・M14 | 折り返し行の↑、競合と新規作成のフォーカス、URL起動失敗の通知を修正 | [#54](https://github.com/kudoas/synaplink/pull/54)、[#57](https://github.com/kudoas/synaplink/pull/57)、[#55](https://github.com/kudoas/synaplink/pull/55) |

戻る・進むボタンも[#48](https://github.com/kudoas/synaplink/pull/48)で反映済み。これらのPRはすべてマージ済みである。[修正前の再計測と統合検証](investigations/2026-11-15/README.md)は対象コミットを固定した記録として残す。

最新mainの[CI](https://github.com/kudoas/synaplink/actions/runs/43685917358)は成功している。frontend 159テスト、Rust 33テスト、lint・型チェック・fmt・clippy、Web build、macOS app buildを確認した。このCI成功は実Tauriのキー操作やOSとの接続を測定した証拠ではない。

## 次は実機での確認を優先する

以下は未検証のタスクであり、既に不具合が再現したという意味ではない。優先度は、影響と残る不確実性から決めた作業順である。実データを使わず、専用vaultで確認する。

| 優先度 | 確認対象 | 完了を判断する観測 |
| --- | --- | --- |
| 高 | 実Tauriで入力直後のclose・Cmd+Q・終了メニュー | 最終本文が保存されてから終了する。保存失敗・競合では終了せず、編集内容が残る。保存中の追加編集も含める |
| 中 | 実WebKit・日本語IME・VoiceOver | 変換確定時のキーがタイトル移動や競合の選択肢を誤操作しない。競合内容が読み上げられ、背景操作が抑止され、解決後にフォーカスが戻る |
| 中 | 実OSのファイル権限拒否とURL起動失敗 | ネイティブ画面に対象・理由が表示され、正常なメモと編集中の内容を維持する。原因解消後に再試行できる |

既存の検証は、実ファイルを使うRust試験、APIをモックしたfrontend試験、agent-browserのChromium操作を組み合わせたもの。実WebKit・実IPC・OS操作をつないだ一連の確認は、これらからは結論を出せない。

## 仕様上の制限と保存保証の範囲を区別する

- 検索はタイトル・本文の抜粋・リンク名が対象で、全文検索は非対応。これは[現行仕様](../README.md#検索欄でメモを絞り込む)であり、修正漏れとは扱わない。
- シンボリックリンクのメモは読み込めるが、保存を拒否する。[保存・復旧手順](operations/note-save-recovery.md)を参照する。
- DockやOSの直接terminate、強制終了、クラッシュ、電源断は終了時保存の保護対象外。終了保護を実装したことから、これらへの保護を推定しない。
- 交換前に開いた古いファイルへ外部アプリが検証後も書き続ける場合は、完全な競合保護を保証しない。所有者・ACL・拡張属性の引継ぎも保証範囲外である。詳細は[保存保証の限界](operations/note-save-recovery.md#保証の限界を分ける)を参照する。

これらの制約を広げる場合は、必要な振る舞いを先に決め、再現条件と完了条件を用意して別の変更として扱う。
