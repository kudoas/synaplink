# 実 WebKit・日本語 IME・VoiceOver の確認記録

2026-11-15、main `279d29d`（アプリコードは `cc5f73d` と同じ）を対象に、設定を変更せず検証環境を確認した。VoiceOver は2回とも停止中だった。入力ソースと Accessibility 権限は実行条件・時刻によって異なる結果が返ったため、実機操作時に改めて確認する。変換確定時の誤操作防止や読み上げの成功は未検証である。

この文書は、[課題の対応状況](../../../issue-status.md#次は実機での確認を優先する)にある実 WebKit・IME・VoiceOver の個別記録である。アプリの仕様や全課題の対応状況は複製しない。実機操作の結果は、対象アプリ・入力方法・観測値を添えて追記する。

## 接続エラーを伴う入力ソース情報は実機操作の前提にしない

同梱の [Swift スクリプト](read-environment.swift)を2回実行した。画面の生成、キー送信、設定変更、Accessibility 権限の要求は行わない。

| 実行条件と時刻（UTC） | 現在の入力ソースの返却値 | Swift プロセスの AX 権限 | VoiceOver | 標準エラー |
| --- | --- | --- | --- | --- |
| sandbox 内 / 07:59:37 | `com.apple.inputmethod.Kotoeri.RomajiTyping.Japanese` | false | false | hiservices 接続エラー2行 |
| sandbox 外 / 08:05:21 | `com.apple.keylayout.ABC` | true | false | 出力なし |

生の結果は [sandbox 内 JSON](evidence/environment.json)・[標準エラー](evidence/environment-stderr.txt)と、[sandbox 外 JSON](evidence/environment-outside-sandbox.json)に残した。両方とも終了コードは0。別の時刻・実行条件の測定であり、差の原因は切り分けていない。sandbox 内の入力ソース情報は接続エラーを伴うため、これだけで実機が日本語入力中だったとは判断しない。実際にキーを送る前に、対象アプリの入力メニューと composition イベントを確認する。

macOS は2回とも 27.2 / build 26B123、システム WebKit bundle は `22625.2.8.11.9` だった。framework のインストール版を示すもので、実行中のアプリや操作成功の証拠にはしない。

`NSWorkspace.isVoiceOverEnabled` は VoiceOver が動作中かを返す。[Apple の定義](https://developer.apple.com/documentation/appkit/nsworkspace/isvoiceoverenabled)に従い、停止中という事実だけを記録した。`AXIsProcessTrusted` は[呼び出したプロセスの信頼状態](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrusted)であり、CUA の権限や VoiceOver の読み上げ能力を測る API ではない。

## agent-browser の確認だけで macOS WebKit 検証済みとは扱わない

インストール済み agent-browser は `0.42.0`。スキルと CLI の `--help`、同梱 README を確認した。デスクトップの公開された engine 指定は `chrome`、`lightpanda`、`obscura` で、README の WebKit 操作経路は iOS Simulator の Mobile Safari である。[公式の iOS 手順](https://agent-browser.dev/ios)は Xcode、Simulator runtime、Appium と XCUITest driver を必要とする。

この端末では active developer directory が CommandLineTools で、`xcodebuild -version` と `xcrun --find simctl` は失敗した。`appium` も PATH 上に見つからなかった。依存する開発環境を新設したり、Safari のリモート操作設定を変更したりはしていない。

CLI の help に Safari WebDriver への言及があり、固定タグ `v0.42.0` の[一次ソースにも SafariDriver の起動処理](https://github.com/vercel-labs/agent-browser/blob/v0.42.0/cli/src/native/webdriver/safari.rs)が存在する。そのため「Safari を一切サポートしない」とは断定しない。一方で、その文言だけを根拠に macOS WKWebView を操作できるとも判断しない。別ブラウザ操作手段への置換は行っていない。

## 実機操作では変換中の状態とフォーカスを対で観測する

次の表は実行手順と判定条件であり、実行結果ではない。デスクトップ操作は担当を一人に集約し、識別子と名前を分けたテスト用アプリ、架空の UTF-8 メモだけを使う。既存の Synaplink、実 vault、設定ファイルには触れない。

| 対象 | 操作 | 成功を判断する観測 |
| --- | --- | --- |
| タイトルの変換確定 | タイトル末尾へ移動し、単キーでローマ字を入力。変換候補を出して Enter で確定する | 変換中であったことを composition イベントで確認し、確定直後もタイトルにフォーカスがある。確定済みの状態で次の Enter を押すと本文へ移る |
| 本文先頭の候補操作 | 本文の最上段で単キー入力から変換候補を出し、上矢印を押す | IME の候補操作中にタイトルへ移らず、編集中の文字と本文フォーカスを保つ |
| 折り返し下段の上移動 | 改行なしで折り返す本文の下段にキャレットを置いて上矢印 | 上の表示行へ移り、本文フォーカスを保つ。本文最上段からはタイトル末尾へ戻る |
| 競合画面の初期状態 | テストメモを編集中に、同じテストファイルを外部変更して保存する | 非破壊の見出しにフォーカスがあり、選択肢が勝手に実行されない。変換確定 Enter による誤実行も別途確認する |
| 競合中の背景抑止と復帰 | Tab / Shift+Tab と背景へのフォーカス操作を試し、競合を解決する | 操作可能なフォーカスが競合内に収まり、解決後に利用可能な入力欄・操作へ戻る |
| VoiceOver | ユーザーが有効化を許可した検証環境で、競合内容を読み進める | 見出し・説明・選択肢の実際の発話を記録し、背景へ移らないことと解決後の復帰を確認する。AX tree の存在だけでは合格にしない |

IME の証拠には、入力元の単キー操作、`compositionstart` / `compositionupdate` / `compositionend`、関連する `keydown` の `key`・`isComposing`・`isTrusted` と、その前後のフォーカスを対応付ける。`isTrusted=true` だけでは IME が動いた証拠にならない。`typeText` や貼り付け、合成 `KeyboardEvent`、Chromium での成功も実 IME の代用にしない。

VoiceOver の有効化や入力ソースの切り替えは、この記録の読み取りスクリプトには含めない。読み上げが必要な段階では、設定変更の範囲と復元方法を明示して別途実施する。

## 読み取り結果を再現する

リポジトリのルートから次を実行する。Swift 6.4.2 と CommandLineTools で実行できた。module cache は一時領域へ置く。

```sh
swift -module-cache-path /private/tmp/synaplink-native-module-cache \
  docs/investigations/2026-11-15/native-accessibility/read-environment.swift
```

指定したテストアプリの AX tree を読む [read-accessibility.swift](read-accessibility.swift)も用意した。PID と bundle identifier の完全一致を確認し、元の `com.kudoas.synaplink` は拒否する。AX 属性の設定や操作は行わない。Swift の `-warnings-as-errors` でコンパイル成功、元 bundle と PID 不一致の拒否を確認した。まだテストアプリの AX 出力は取得していない。

```sh
swiftc -warnings-as-errors -module-cache-path /private/tmp/synaplink-native-module-cache \
  docs/investigations/2026-11-15/native-accessibility/read-accessibility.swift \
  -o /private/tmp/synaplink-read-accessibility
/private/tmp/synaplink-read-accessibility <テストアプリPID> <テスト用bundle-identifier>
```

最大500ノード、深さ12、各属性2048文字に制限する。制限に達した結果には `truncated=true` を付ける。部分的な AX tree に背景要素が見えないことだけでは、背景操作の抑止や VoiceOver の読み上げを確認できない。

この調査はドキュメントと読み取りスクリプトのみの変更で、アプリの動作を変えない。frontend の依存インストールやアプリ試験の再実行はしていない。実機のキー操作・VoiceOver の結果が揃うまで、対応状況の完了条件は未達のままとする。
