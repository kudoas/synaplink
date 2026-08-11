# Synaplink

A local-first Zettelkasten note-taking app for macOS. Notes are stored as ordinary UTF-8 plain text, and `#tags` in the body connect related notes.

## Features

- Choose any local folder as the note vault
- Store each note in a single `.txt` file
- Display the first line as the title and subsequent lines as the body
- Support Unicode tags such as `#café`
- List related notes by tag
- Autosave changes and detect conflicts with external edits
- Load `.txt` files created or edited in external editors

## Tag Syntax

Tags begin with `#` followed by Unicode letters, numbers, hyphens, or underscores. Whitespace and punctuation end a tag.

```text
Apples are a type of #fruit.
Collect varieties under #green_apples.
```

Escape a hash as `\#apple` when it should not start a tag. Tag comparison uses Unicode NFKC normalization and lowercases letters.

## Development

Install the required tools with [mise](https://mise.jdx.dev/).

```sh
mise install
pnpm install
pnpm tauri dev
```

Use `pnpm dev` to start only the web UI. Local file operations require the Tauri runtime.

## Testing and Building

```sh
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path backend/Cargo.toml -- --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml
pnpm tauri build --bundles app
```

TypeScript uses every Oxlint category with type-aware checking. `.oxlintrc.json` explicitly excludes only conflicting rules and rules incompatible with the React or Tauri architecture. Rust uses rustfmt and denies Clippy's `all`, `pedantic`, `nursery`, `cargo`, and safety-related restriction rules.

## Data Format

The app uses UUIDs for generated file names. Note contents are plain text with no proprietary metadata.

```text
Note title
The body starts here. #apple #fruit
```

Even if caches or settings outside the vault are deleted, tag information can be rebuilt from the note contents.
