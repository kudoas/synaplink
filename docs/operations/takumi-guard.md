# CIのnpm依存をTakumi Guard経由で取得する

[CI workflow](../../.github/workflows/ci.yml)は、checkout直後に[公式のsetup-takumi-guard-npm Action](https://github.com/flatt-security/setup-takumi-guard-npm/tree/14f07d0cbc739b42a1b7c70a04c2b84cd1318ddd)を実行する。pnpmの初回呼出しより先にレジストリを設定し、その後のnpm依存取得を`https://npm.flatt.tech/`へ向ける。Actionはv1.4.0のコミットSHAに固定している。

## 匿名モードで実行し、認証情報を追加しない

`bot-id`を渡さない[匿名モード](https://shisho.dev/docs/t/guard/quickstart/npm/#anonymous-mode)を使用する。新しいGitHub SecretsやShisho Cloudアカウントは必要ない。`GITHUB_TOKEN`の権限は`contents: read`のみで、`id-token: write`は付与しない。forkからのPRも通常の`pull_request`イベントで検査する。

匿名モードは既知の悪性パッケージの取得を遮断する。組織単位のダウンロード追跡・侵害通知は利用しない。全パッケージの安全性を保証する仕組みではなく、Rust依存、GitHub Actions自体、npmレジストリを経由しない取得はこの設定の対象外である。

## 過去のpnpmストアを復元しない

CIのpnpmストアを`runner.temp`配下に置き、`actions/setup-node`のpnpmキャッシュは使用しない。ストア内のパッケージを再利用するとレジストリへの取得要求が発生しないため、過去のキャッシュを復元して検査を通過したと扱わないためである。同じジョブ内でインストール済みのパッケージを再利用するたびに、Guardが再検査するという保証はない。

Rustのビルドキャッシュは維持する。npm依存の取得時間が増える可能性はあるが、その影響は未計測。Guardが取得を拒否した場合や到達できない場合、レジストリを切り替えて自動継続する設定は入れていない。

## 導入時の確認とCIで確認する事項

導入時にはpnpm 12.0.0-rc.6で、Actionが設定する`pnpm_config_registry`が`https://npm.flatt.tech/`として読み取られ、`pnpm_config_store_dir`が指定した一時パスとして読み取られることを確認した。公式のブロック確認用パッケージ`@panda-guard/test-malicious`への匿名メタデータ要求はHTTP 403と`Package blocked by security policy`を返した。確認用パッケージはインストール・実行していない。

2026-11-14、macOS arm64・Node.js 26.7.0で、`package.json`・`pnpm-lock.yaml`・`pnpm-workspace.yaml`を一時ディレクトリへコピーし、新規ストアと同じレジストリ環境変数を指定して`pnpm install --frozen-lockfile --ignore-scripts`を実行した。結果は再利用0件・取得147件で成功した。これは依存取得の確認であり、GitHub Actions本体の実行やライフサイクルスクリプトの確認ではない。

ローカルの構文検証だけではGitHub Actions上の動作確認にはならない。PRのCIログで、Guardの匿名モード設定がpnpmセットアップより先に完了することと、`pnpm install --frozen-lockfile`および既存の検証が成功することを確認する。fork PRの実行結果は、実際のfork PRで別途確認する必要がある。

撤回する場合は、GuardのActionと`Use a fresh pnpm store`ステップを削除する。以前の取得時間へ戻す必要があれば、`actions/setup-node`の`cache: pnpm`も復元する。ローカルのレジストリ設定やロックファイルを変更する手順は不要。
