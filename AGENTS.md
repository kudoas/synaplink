# Repository Guide

## Structure

- `src/`: UI built with React, TypeScript, and CodeMirror
- `src-tauri/`: Desktop host and local file operations built with Tauri and Rust
- `dist/` and `src-tauri/target/`: Generated artifacts; do not edit or commit them

## Development

Manage tools with mise and JavaScript dependencies with pnpm. Pin dependency versions exactly in `package.json`, and update `pnpm-lock.yaml` whenever they change.

```sh
mise install
pnpm install --frozen-lockfile
pnpm tauri dev
```

## Validation

After making changes, run the relevant commands below.

```sh
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --bundles app
```

## Application Invariants

- Keep the note format as UTF-8 plain text with the title on the first line and the body on subsequent lines
- During autosave, distinguish programmatic editor synchronization from user edits
- During save operations, check for conflicts with external changes before skipping an identical write
