# Repository Guide

## Structure

- `frontend/`: React、TypeScript、CodeMirrorで構成するUI
- `backend/`: TauriとRustで構成するローカルファイル操作
- `dist/`、`backend/target/`: 生成物のため編集・コミットしない

## Development

ツールはmise、JavaScript依存関係はpnpmで管理します。依存バージョンは `package.json` で完全固定し、変更時は `pnpm-lock.yaml` も更新してください。

```sh
mise install
pnpm install --frozen-lockfile
pnpm tauri dev
```

## Validation

変更後は対象に応じて次を実行してください。

```sh
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path backend/Cargo.toml -- --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml
pnpm tauri build --bundles app
```

## Application Invariants

- メモ形式は1行目がタイトル、2行目以降が本文のUTF-8プレーンテキストを維持する
- 自動保存ではプログラムによるエディター同期とユーザー編集を区別する
- 保存処理では外部変更との競合判定を、同一内容の書き込み省略より先に行う
