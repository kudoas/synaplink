# ウィンドウを閉じる操作とCmd+Qを保存完了まで待たせる

[M04の測定](README.md#m04700msの保存待機中にアンマウントすると保存呼出しは0回だった)では、保存待機中のアンマウント後に保存関数が呼ばれなかった。本変更は、macOSのウィンドウcloseとアプリの終了メニュー・Cmd+Qを、保存後の一覧更新まで完了してから終了する経路へ接続する。起点は`95d7c7a`。実装の正本は[終了時のnative処理](../../../src-tauri/src/shutdown.rs)と[frontendの接続hook](../../../src/use-shutdown-guard.ts)である。

## native側で終了を止め、保存完了の要求IDを照合する

フロントエンドはlistenerを登録してから`register_shutdown_guard`を呼ぶ。登録が完了するまで、Appは初期化待ちを表示して編集操作を公開しない。native側はこの登録前にはcloseを許可するため、JavaScriptの初期化自体が失敗した状態で通常のcloseを妨げない。

登録後のclose・quit要求はnative側のgateに要求IDを保持し、ウィンドウcloseと`RunEvent::ExitRequested`を同期的に止める。フロントエンドがイベントを取りこぼしても、再登録時の応答からpending要求を取得する。連打は同じIDへまとめる。

要求を受けたフロントエンドは、[既存の移動前保存処理](../../../src/use-autosaved-document.ts#L365)を使って、進行中の保存と保存後コールバックを待つ。待機中に編集が増えた場合も、その内容が保存されるまでnativeへの完了承認を送らない。承認後は実際の終了でAppがアンマウントされるまで編集を再開しない。

保存失敗・競合では完了承認を送らず、終了要求だけを取り消して編集内容を保持する。既存の再試行・競合解決後、closeまたはCmd+Qを改めて操作できる。native側も現在の要求IDと一致しない完了通知を拒否する。

## macOSの既定Quitだけを独自メニュー項目へ差し替える

調査対象のlockfile解決版は、Tauri 2.12.5、tauri-runtime-wry 2.12.3、tao 0.37.2、muda 0.20.0。ローカルのCargo registry sourceで以下を確認した。

| 対象 | 確認した実装 |
| --- | --- |
| `tauri/src/app.rs` | `RunEvent::ExitRequested`のAPIは終了を止める。`AppHandle::exit`はruntimeの終了要求を発行する |
| `tauri-runtime-wry/src/lib.rs` | close要求後、同期的なprevent信号を確認してからウィンドウを閉じる |
| `muda/src/platform_impl/macos/mod.rs` | 既定のQuitはAppKitの`terminate:` selectorを使う |
| `tao/src/platform_impl/macos/app_delegate.rs` | `applicationWillTerminate`から`AppState::exit`を呼ぶ |

したがって`RunEvent::ExitRequested`だけを追加して、既定のCmd+Qも保存待ちになるとは扱わない。macOSでは`Menu::default`で得たアプリsubmenuの既定Quitだけを、同じ表示名・位置と`CmdOrCtrl+Q`を持つ独自のMenuItemに差し替える。About・Services・Hideなどの他の既定項目は残し、独自Quitのイベントを同じ保存gateへ送る。

## 確認済みの範囲

フロントエンドの終了hook・API・App待機分岐の試験では、次を確認した。

- 700msの保存待機中でも、close要求は保存を即座に開始し、完了前にはnativeの完了承認を呼ばない。
- 保存後の一覧更新中に増えた編集も保存し、完了承認後は編集を受け付けない。
- 保存失敗・競合では終了要求を取り消し、本文を保持する。失敗後の再要求と、完了承認IPCが失敗した後の再要求を処理できる。
- listenerとnative登録の完了前には編集UIを公開しない。遅れて完了したlistener登録をアンマウント後に解除し、React StrictModeでも古いlistenerを残さない。

Rustのgate単体試験では、登録前のclose許可、連打時のID共有、再登録によるpending回収、古いIDの完了拒否、対応するIDの承認後だけ終了を許可することを確認した。これらは状態遷移・hook・APIの試験であり、実際のmacOSウィンドウやキー操作の測定ではない。

## 実機確認と保護対象外

実Tauriアプリでのclose・Cmd+Q、既定メニュー項目の操作、IME未確定文字を含む操作は未確認。実データを使わない専用vaultで、入力直後の各操作が最終本文の保存を待つこと、外部競合や保存先エラーでは終了せず編集を残すことを確認する必要がある。

この実装は全終了経路の保証を主張しない。macOS DockやシステムがAppKitへ直接送るterminate、OSの強制終了、クラッシュ、電源断は保護対象外。frontend登録後にJavaScriptが応答不能になった場合も、未保存状態をnative側だけで判断せず終了を止め続けるため、復旧できない場合はOSの強制終了が必要になる。強制終了時の未保存内容は保証しない。

また、Appのアンマウント時に非同期保存を開始する処理は追加していない。保存完了を待てるnative要求の段階で止める方式であり、改修を撤回する場合はnativeのgate接続・Quit差し替えと、frontendのhook接続を一緒に戻す。
