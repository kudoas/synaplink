# Standard Tauri Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the React application to `src/` and the native Tauri crate to `src-tauri/` so the repository follows the conventional Tauri project layout.

**Architecture:** Keep all application behavior unchanged. This is a path-only migration: Vite continues to build the React view, while the Tauri CLI discovers the Rust host in `src-tauri/` from the repository root.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Tauri 2, Rust, pnpm 11.21.0

## Global Constraints

- Preserve UTF-8 plain-text note behavior and all autosave invariants.
- Do not modify or commit generated `dist/` or `src-tauri/target/` artifacts.
- Keep exact dependency versions and leave `pnpm-lock.yaml` unchanged.

---

### Task 1: Move source trees and update path configuration

**Files:**
- Move: `frontend/` to `src/`
- Move: `backend/` to `src-tauri/`
- Modify: `package.json`
- Modify: `.oxlintrc.json`
- Modify: `AGENTS.md`
- Modify: `index.html`
- Modify: `tsconfig.json`
- Modify: `vite.config.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Consumes: Vite source root and Tauri CLI project discovery conventions
- Produces: `pnpm dev`, `pnpm tauri dev`, frontend validation, and Rust validation from the repository root

- [ ] **Step 1: Create the migration branch**

```bash
git switch -c agent/adopt-standard-tauri-layout
```

- [ ] **Step 2: Move the source directories**

```bash
mv frontend src
mv backend src-tauri
```

- [ ] **Step 3: Update repository path references**

Change the Tauri script to `tauri`; TypeScript, Vitest, HTML entrypoint, and Oxlint paths from `frontend` to `src`; and Cargo documentation and CI paths from `backend/Cargo.toml` to `src-tauri/Cargo.toml`. Update generated-artifact ignore paths to `src-tauri/target/`.

- [ ] **Step 4: Verify no stale tracked path references remain**

```bash
rg -n "frontend|backend/Cargo.toml|cd backend" --glob '!pnpm-lock.yaml' --glob '!docs/superpowers/plans/**'
```

Expected: no references to the old source directories.

- [ ] **Step 5: Run frontend validation**

```bash
pnpm lint
pnpm test
pnpm build
```

Expected: all commands exit successfully.

- [ ] **Step 6: Run Rust validation**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit successfully.

- [ ] **Step 7: Build the macOS application bundle**

```bash
pnpm tauri build --bundles app
```

Expected: the app bundle is produced under `src-tauri/target/release/bundle/macos/`.

- [ ] **Step 8: Commit the migration**

```bash
git add .github .gitignore .oxlintrc.json AGENTS.md README.md index.html package.json tsconfig.json vite.config.ts src src-tauri docs/superpowers/plans/2026-08-13-standard-tauri-layout.md
git commit -m "Adopt the standard Tauri project layout"
```
