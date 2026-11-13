# 再現・計測で確認した課題（2026-11-14）

保存処理、外部ファイル操作、画面操作について、15件の観測結果を記録した。保存後の一覧更新を待つ間の再編集では、追加した本文が10秒後も保存されなかった（M01）。実ファイルの保存中に外部編集を書き込んだ試験では、その内容が残らず、保存成功が返った（M02）。

本書は「どの条件で何が起き、その根拠はどこにあるか」を確認するための調査記録である。現行仕様の正本は実装と既存仕様書に置き、本書では対象コミットに対する入力、観測値、実装上の対応箇所を示す。改修案の採否や利用頻度は評価していない。

## 対象と測定条件を固定した

| 項目 | 条件 |
| --- | --- |
| 対象コミット | `68b7c4357ecbf61281d8f80bfe0c5ab8938564f7` |
| 記録日 | 2026-11-14、JST |
| OS・CPUアーキテクチャ | macOS 27.2（26B123）、arm64 |
| フロントエンド | Node.js 26.7.0、Vitest 4.1.10、jsdom 30.0.1 |
| Rust | rustc 1.97.1、cargo 1.97.1、releaseビルド、テスト1並列 |
| ブラウザ | Chromium 157.0.8103.38、Tauri APIをモック化したWeb UI。viewportは未固定（記録値`null`） |
| ファイル操作 | ローカルの一時ディレクトリ、umask `022`。実際のメモは使用していない |
| 時間の扱い | フロントエンドの700ms・10秒は偽タイマー。Rustの処理時間は`Instant`による実時間 |

保存・読込・検索などの入力に対する返り値、呼出回数、ファイル内容、DOM、フォーカスを観測した。「計測」にはこれらの機能試験を含む。コードを読んだだけの懸念は課題一覧に入れていない。

以下の条件は本記録の範囲外である。

- 配布用Tauriアプリの終了操作、実IPCの応答順序、OSの既定ブラウザ起動。
- 実際の利用での発生頻度、低速ストレージ、画面の停止時間、スクリーンリーダーの読み上げ。
- 各試験の条件外への影響の一般化。時間計測は各入力1回で、平均・分散・因果的な改善効果を表していない。

## 15件の結果と根拠を対応付けた

| ID | 観測した結果 | 計測方法・一次記録 |
| --- | --- | --- |
| M01 | 再編集後、偽タイマーで10秒進めても保存は初回の1回のみ | hook試験、[frontend-output.txt](evidence/frontend-output.txt) |
| M02 | 保存中に書き込んだ外部編集が残らず、`Saved`が返る | 実ファイル試験、[rust-output.txt](evidence/rust-output.txt) |
| M03 | 表示中メモの外部削除後、編集の保存・他メモ選択・保存先変更が失敗する | Appモック試験＋実ファイル試験、両出力 |
| M04 | 保存待機中のアンマウント後、保存呼出しは0回 | hook試験、frontend出力 |
| M05 | 新保存先の一覧表示後に旧応答を返すと、旧一覧に置き換わる | 応答順を制御したApp試験、frontend出力 |
| M06 | 外部同期直後のUndoで旧本文に戻り、変更通知が発生する | CodeMirror試験、frontend出力 |
| M07 | 権限`0600`のファイルを置換保存すると`0644`になる | 実ファイル試験、Rust出力 |
| M08 | 不正UTF-8のメモを含む2ファイルから、成功として1件だけ返る | 実ファイル試験、Rust出力 |
| M09 | メモとして読めたシンボリックリンクが、保存後は通常ファイルになる | 実ファイル試験、Rust出力 |
| M10 | 本文2行目にある検索語で、一覧の表示行数が0になる | Web UI試験、[browser-result.json](evidence/browser-result.json) |
| M11 | 折り返し下段から↑を押すと、タイトル欄にフォーカスが移る | Web UI試験、browser結果 |
| M12 | 競合ダイアログ出現後も本文にフォーカスがあり、Tabで背面へ移る | Web UI試験、browser結果 |
| M13 | 新規メモ表示後も「新しいメモ」ボタンにフォーカスが残る | Web UI試験、browser結果 |
| M14 | URL起動処理を1回失敗させても、エラートーストは0件 | Web UI試験、browser結果 |
| M15 | 未閉鎖リンクの320,000 bytesで、Rust解析1回が約3.20秒 | 関数単体計測、Rust出力・[link-parser-output.jsonl](evidence/link-parser-output.jsonl) |

出力のテスト成功は、「問題が起きない」ことを意味しない。再現用の機能試験では、変更前の観測結果をassertで確認している。M06などの観測結果を望ましい仕様とするかは、本調査では決めていない。

## M01〜M06：保存状態と画面遷移を制御して再現した

### M01：一覧更新中の再編集が10秒後も未保存だった

[再現コード](evidence/frontend-hooks.repro.tsx)の`later edit remains dirty after 10 seconds following slow onSaved`で、次の順序を作った。

1. `body=old`を読み、`first`へ編集して700ms進める。
2. 保存を成功させ、保存後コールバック`onSaved`を未完了にする。
3. `second`へ再編集し、さらに700ms進める。
4. `onSaved`を完了させ、10,000ms進める。

最後の観測は`body=second`、`saveState=dirty`、保存関数の呼出回数1回だった。`second`を引数とする保存は呼ばれていない。10秒を超えた待機や、その後の追加操作はこの試験では行っていない。

対応する実装では、[進行中の保存があれば同じPromiseを返す](../../../src/use-autosaved-document.ts#L189)一方、`onSaved`後の再編集判定で、移動予約がない場合は処理を終了する。アプリは[一覧更新を`onSaved`に接続している](../../../src/App.tsx#L50)。実IPCの遅延時間は測定していない。

### M02：競合確認後に書いた外部編集が保存結果から消えた

[Rust再現コード](evidence/rust-repro.rs)の`external_write_during_atomic_save_is_lost`で、既存ファイルを読み、32MiBの`x`を本文として保存した。別スレッドは同じディレクトリに`.tmp`が現れた時点で、元ファイルへ`title\nEXTERNAL EDIT`を書き込んだ。

外部書込みスレッドの成功を確認した後、保存結果は`SaveResult::Saved`、最終ファイルに`EXTERNAL EDIT`は含まれなかった。出力は以下のとおり。

```text
external_edit_written=true conflict_reported=false external_edit_retained=false
```

[revision確認](../../../src-tauri/src/lib.rs#L337)は一時ファイル作成前に行われ、[rename](../../../src-tauri/src/lib.rs#L277)が元ファイルを置き換える。試験は処理窓を広げるため32MiBを使用したもので、一般的なサイズでの発生確率は示していない。

### M03：外部削除後の編集は保存できず、2種類の移動要求も実行されなかった

[App再現コード](evidence/frontend-app.repro.tsx)では、選択中メモを一覧応答から外した後もタイトル欄が残った。そのタイトルを編集し、保存APIをファイル不存在エラーにすると、700ms後に「保存エラー」が表示された。

続けて別メモを選択しても`readNote`は0回、保存先変更を押しても`chooseVault`は0回だった。編集中のタイトルは残った。`破棄|別名|コピー|再試行`に一致する名前のボタンは0件だった。この試験で新規作成ボタンの動作は測定していない。

別のRust試験では、実ファイルを削除してから`overwrite=true`で保存を呼んでも、ファイル不存在エラーが返り、ファイルは再作成されなかった。[保存処理の冒頭](../../../src-tauri/src/lib.rs#L338)で既存ファイルを読み、[画面遷移](../../../src/use-autosaved-document.ts#L361)は未保存時に保存処理を待つ。画面試験とファイル試験は別々に実行しており、実Tauriを通した一連の操作ではない。

### M04：700msの保存待機中にアンマウントすると保存呼出しは0回だった

[hook試験](evidence/frontend-hooks.repro.tsx)で本文を`old`から`lost`に編集し、タイマーを進める前にアンマウントした。続けて1,000ms進めた後、保存関数の呼出回数は0回だった。

[保存タイマーのcleanup](../../../src/use-autosaved-document.ts#L298)は`clearTimeout`を実行する。この測定はReactのアンマウントが対象であり、ウィンドウを閉じた際のファイル消失やOS終了処理を実測したものではない。

### M05：旧一覧を遅れて返すと、新保存先の表示と一覧が食い違った

[App試験](evidence/frontend-app.repro.tsx)で旧保存先の2,500ms周期の一覧応答を保留し、保存先を`/vault-new`へ変更した。新一覧の表示を確認後、保留していた旧一覧を返した。

観測時の保存先表示は`/vault-new`のまま、旧メモのボタンが存在し、新メモのボタンは存在しなかった。[一覧の置換](../../../src/App.tsx#L28)に対応する結果である。応答順序はモックが作っており、実Tauriでこの順序が発生する頻度や可能性は測定していない。

### M06：外部同期をUndoすると旧本文がユーザー変更として通知された

[CodeMirror試験](evidence/frontend-hooks.repro.tsx)で`old disk body`を表示し、Reactのpropsを`new external body`へ変更した。この同期では`onChange`は0回だった。直後に`undo(view)`を実行すると本文が`old disk body`に戻り、その文字列を引数として`onChange`が呼ばれた。

[外部同期のdispatch](../../../src/components/MemoEditor.tsx#L180)とUndo履歴の関係を確認した結果である。この試験は`MemoEditor`単体であり、その後のディスクへの自動保存は実行していない。

## M07〜M09：ファイル属性と一覧結果を実ファイルで確認した

| ID | 入力・操作 | 観測結果 | 対応する実装 |
| --- | --- | --- | --- |
| M07 | `secret.txt`を`0600`に設定してから`atomic_write`で置換 | `metadata.permissions().mode() & 0777`が`0644` | [一時ファイルを新規作成して置換](../../../src-tauri/src/lib.rs#L259) |
| M08 | UTF-8の`valid.txt`と1byteの`0xff`を持つ`invalid.txt`を作り`scan_notes`を実行 | `Ok`、返却件数1 | [個別読込のエラーを`filter_map`で除外](../../../src-tauri/src/lib.rs#L243) |
| M09 | vault外の一時ファイルへ向く`note.txt`のsymlinkを作り、一覧取得後に保存 | 一覧は1件。保存は`Saved`。保存後の`note.txt`はsymlinkではなく、リンク先本文は保存前のまま | [一覧の`is_file`](../../../src-tauri/src/lib.rs#L249)、[rename](../../../src-tauri/src/lib.rs#L277) |

再現コードは[rust-repro.rs](evidence/rust-repro.rs)の`existing_permissions_change_on_save`、`invalid_utf8_note_silently_disappears`、`symlink_note_save_replaces_link_not_target`。M07の権限値はumask `022`で得た値であり、別のumaskの値は測定していない。M08ではファイル権限エラーやディレクトリ列挙エラーは作っていない。

## M10〜M14：モックを使ったWeb UIで表示とフォーカスを測定した

[browser-result.json](evidence/browser-result.json)はブラウザから返った値を保存したもの。[browser-repro.js](evidence/browser-repro.js)には、使用したメモデータ、Tauri APIのモック、操作順を保存している。この観測は`agent-browser`必須ルールの適用前に既存Playwright接続で実施した。以後ブラウザを操作して再測定する際は、`agent-browser`スキルを読み、その手順に従う。

| ID | 入力・操作 | 観測結果 | 対応する実装 |
| --- | --- | --- | --- |
| M10 | 本文の1行目を「先頭の説明。」、2行目を「ここにだけ深部検索語があります。」として、「深部検索語」を検索 | `.note-row`は0件、表示文言は「メモがありません」 | [タイトル・preview・リンク名を検索](../../../src/note-search.ts#L10)。モックのpreviewは1行目だけ |
| M11 | 改行を含まない「折り返し表示を調べるための長い本文。」を40回入力し、下段へキャレットを移動して↑ | 押下前の論理行の高さは約489.55 CSS px、キャレットは行上端から約292.97 CSS px下。押下後は`INPUT`、`aria-label=タイトル` | [論理1行目のArrowUp処理](../../../src/components/MemoEditor.tsx#L91) |
| M12 | 本文編集中の保存に競合結果を返し、ダイアログ出現後にTabを4回押す | 出現時のフォーカスは本文。Tabの移動先は「外部の内容を読む」→「現在の編集で上書き」→`BODY`→背面の保存先変更ボタン | [競合ダイアログ](../../../src/components/EditConflictDialog.tsx#L8) |
| M13 | 「新しいメモ」をクリックし、タイトル欄の表示を待つ | タイトル値は「無題」。`document.activeElement.className`は`new-note-button` | [新規作成処理](../../../src/App.tsx#L205) |
| M14 | URLをクリックし、openerのモックをエラーにする | opener呼出し1回、`.error-toast`は0件 | [openerのcatch](../../../src/components/MemoEditor.tsx#L140) |

M10はフロントエンドが受け取った概要からの検索結果であり、Rustとの接続試験ではない。実装側の概要生成は[最初の非空行の先頭90文字](../../../src-tauri/src/lib.rs#L179)を返す。M11の寸法はviewport未固定の実行で得た値であり、他の画面幅に共通する値ではない。M14ではOSのブラウザ起動そのものは試していない。

## M15：未閉鎖リンクの入力を増やすと解析時間が増加した

入力はASCIIの`[[x\n`を指定回数繰り返した文字列。抽出結果は全条件で0リンクだった。Rustは抽出した`extract_links`、JavaScriptは実装の`parseLinks`を呼んだ。Rustはreleaseビルド、JavaScriptはNode.js 26.7.0で実行し、各入力につき1回だけ測定した。

| 反復数 | bytes | Rust実時間（ms） | JavaScript実時間（ms） |
| ---: | ---: | ---: | ---: |
| 10,000 | 40,000 | 48.885 | 3.595 |
| 20,000 | 80,000 | 195.859 | 12.436 |
| 40,000 | 160,000 | 767.882 | 49.390 |
| 80,000 | 320,000 | 3,198.144 | 200.652 |

出典は[Rust出力](evidence/rust-output.txt)と[JavaScript出力](evidence/link-parser-output.jsonl)。表示桁数は計測器の出力を保存したもので、同じ精度の再現性を保証しない。両実装の絶対速度の比較や、一般的なメモの応答時間への換算は行わない。

実装上は各候補について閉じ括弧を残りの文字列から探索している（[Rust](../../../src-tauri/src/lib.rs#L102)、[JavaScript](../../../src/link-parser.ts#L31)）。[一覧更新は2,500ms周期](../../../src/App.tsx#L104)で、[ファイル読込時にリンクを抽出](../../../src-tauri/src/lib.rs#L161)する。ただし、画面の停止時間や周期をまたぐ処理の挙動は本測定に含まれない。

## 通常データの一覧取得も同じ条件で記録した

比較用に、1ファイル1,024 bytes（`title\n`と1,018個の`x`）のメモを生成し、生成直後の一時フォルダで`scan_notes`を各1回実行した。

| ファイル数 | 返却件数 | 実時間（ms） |
| ---: | ---: | ---: |
| 1,000 | 1,000 | 26.438 |
| 5,000 | 5,000 | 98.429 |

出典は[rust-output.txt](evidence/rust-output.txt)の`scan_notes_timing`。生成直後でキャッシュが温まった条件であり、この値だけで通常データの性能課題とは判定していない。

## 再現コードと出力をリポジトリ内に残した

### フロントエンド：5件の機能試験

リポジトリルートで、プロジェクト指定のNode.jsと依存を用意して実行する。

```sh
pnpm exec vitest run --config docs/investigations/2026-11-14/evidence/vitest.config.mts --reporter=verbose
```

[保存した出力](evidence/frontend-output.txt)は2ファイル・5件成功。`*.repro.tsx`と専用configを使い、通常の`pnpm test`へ調査コードを追加していない。

### Rust：5件の機能試験と2件の計測

```sh
audit_run_dir=$(mktemp -d)
python3 docs/investigations/2026-11-14/evidence/prepare-rust.py --output "$audit_run_dir/rust"
cargo test --locked --release --manifest-path "$audit_run_dir/rust/Cargo.toml" -- --nocapture --test-threads=1
```

[prepare-rust.py](evidence/prepare-rust.py)は対象ソースのSHA-256を検査し、関連型・関数だけを一時crateへ抽出して[rust-repro.rs](evidence/rust-repro.rs)を追加する。Tauriのコマンドディスパッチは含まない。ソースが変わっていた場合は停止する。依存は添付の`Cargo.lock`に固定した。今回の再実行ではキャッシュ済みの依存を使うため`--offline`も付けた。

[保存した出力](evidence/rust-output.txt)は7件成功。M02の再現はスレッドの実行順に依存するため、外部書込みを検出できない実行は成功扱いにしない。再実行時も観測結果を確認する必要がある。

### JavaScript：未閉鎖リンクの解析時間

```sh
node --input-type=module -e 'import {parseLinks} from "./src/link-parser.ts"; for(const lines of [10000,20000,40000,80000]) {const text="[[x\n".repeat(lines);const start=performance.now();const links=parseLinks(text);console.log(JSON.stringify({lines,bytes:text.length,links:links.length,elapsedMs:Math.round((performance.now()-start)*1000)/1000}));}'
```

### 画面：保存した入力と操作順で照合する

プロジェクトの`pnpm dev --host 127.0.0.1`でWeb UIを起動し、`agent-browser`スキルに従って再測定する。[操作記録](evidence/browser-repro.js)のメモデータとモック条件を再現し、[browser-result.json](evidence/browser-result.json)の各項目と照合する。実vaultやOSの設定を使って代用しない。

## 未計測の指摘は課題一覧から除いた

前回の会話にあった、READMEの旧仕様、色のコントラスト、キーボード用リンク操作、フォーカス枠、支援技術への通知、競合時の文言評価は、この文書の15件には含めていない。本書に保存した再現・計測の出力だけでは、それぞれの利用上の結果を裏付けられないためである。

また、通常の`pnpm test`が別worktreeのテストを拾ったという前回の結果は、そのローカル配置に依存する。製品の課題件数には含めない。アプリ終了時の内容消失、Undo後のディスク上書き、実IPCの応答逆転についても、確認できたM04・M06・M05の範囲を超えて断定しない。

本調査の成果物は再現記録と分析であり、修正や効果確認は行っていない。後続の改修では、この入力・観測値を変更前の根拠として扱い、改修後の結果を別の記録として比較する。
