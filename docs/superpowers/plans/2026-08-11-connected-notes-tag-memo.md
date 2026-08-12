# Connected Notes Tag Memo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conflict-safe, autosaved body to each `CONNECTED NOTES` tag page without exposing tag memos as ordinary notes.

**Architecture:** Store one UTF-8 body per normalized tag under `.synaplink/tag-notes/`, addressed by a deterministic SHA-256 filename and accessed through dedicated Tauri commands. Introduce a generic frontend autosave controller and shared save/conflict presentation, adapt ordinary notes to it first, then build a `ConnectedNotesPage` that combines the shared editor with the existing tag results.

**Tech Stack:** React 19, TypeScript 5.9, CodeMirror 6, Vitest and Testing Library, Tauri 2, Rust, SHA-256, pnpm, Cargo

## Global Constraints

- Ordinary notes remain UTF-8 plain text with the title on the first line and the body on subsequent lines.
- Tag memo bodies are UTF-8 plain text at `<vault>/.synaplink/tag-notes/<sha256-of-normalized-tag>.txt`.
- Tag identity must reuse the existing Unicode NFKC and lowercase normalization.
- Opening or saving an untouched blank tag memo must not create directories or files.
- Clearing an existing tag memo must retain an empty file.
- Autosave remains debounced by exactly 700 ms and must detect external conflicts before skipping an identical write.
- Programmatic CodeMirror synchronization must not be treated as a user edit.
- Tag memos must never enter the sidebar, ordinary search, or connected-note results.
- Tags inside tag memos navigate to other tag pages but do not alter connected-note indexing.
- Navigation requested while dirty or saving waits for a successful save; conflict or error keeps the user on the current page.
- Do not add dependencies or change pinned versions in `package.json` or `backend/Cargo.toml`.
- Do not edit or commit `dist/`, `backend/target/`, or `.superpowers/`.

## File Map

- Modify `backend/src/lib.rs`: tag memo domain types, hashed path resolution, lazy read/save helpers, Tauri commands, and Rust tests.
- Modify `frontend/types.ts`: tag memo wire types.
- Modify `frontend/api.ts`: `readTagMemo` and `saveTagMemo` Tauri adapters.
- Create `frontend/api.test.ts`: command-name and payload contract tests.
- Create `frontend/use-autosaved-document.ts`: shared autosave, conflict, synchronization, and pending-navigation controller.
- Create `frontend/use-autosaved-document.test.tsx`: fake-timer and race-behavior tests for the controller.
- Create `frontend/components/SaveStatus.tsx`: shared localized save-state display.
- Create `frontend/components/EditConflictDialog.tsx`: shared conflict choices.
- Create `frontend/components/ConnectedNotesPage.tsx`: tag heading, body editor, save state, and result cards.
- Create `frontend/components/ConnectedNotesPage.test.tsx`: tag-page layout and interaction tests.
- Modify `frontend/App.tsx`: use two autosave controllers and orchestrate note/tag loading, polling, and navigation.
- Modify `frontend/App.test.tsx`: end-to-end frontend tests for load, save, conflict, and navigation.
- Modify `frontend/styles.css`: approved single-page tag memo layout.
- Modify `README.md`: document editable tag pages in the feature list.
- Delete `frontend/components/TagResults.tsx` and `frontend/components/TagResults.test.tsx` after their behavior is covered by `ConnectedNotesPage`.

---

### Task 1: Add Dedicated Tag Memo Storage and Tauri Commands

**Files:**
- Modify: `backend/src/lib.rs:28-72`
- Modify: `backend/src/lib.rs:138-288`
- Modify: `backend/src/lib.rs:319-410`
- Test: `backend/src/lib.rs:413-end`

**Interfaces:**
- Consumes: existing `normalize_tag(&str) -> String`, `revision(&str) -> String`, `atomic_write(&Path, &str) -> Result<(), String>`, and `current_vault(&State<AppState>)`.
- Produces: `TagMemoDocument`, `SaveTagMemoInput`, `SaveTagMemoResult`, Tauri commands `read_tag_memo(tag, state)` and `save_tag_memo(input, state)`.

- [ ] **Step 1: Write failing storage and conflict tests**

Add focused tests that exercise helpers without constructing Tauri state:

```rust
#[test]
fn tag_memo_path_reuses_existing_tag_normalization() {
    let vault = Path::new("/vault");
    assert_eq!(
        tag_memo_path(vault, "#ＡＰＰＬＥ").unwrap(),
        tag_memo_path(vault, "apple").unwrap()
    );
    assert!(tag_memo_path(vault, "#").is_err());
}

#[test]
fn blank_missing_tag_memo_does_not_create_storage() {
    let directory = tempfile::tempdir().unwrap();
    let path = tag_memo_path(directory.path(), "りんご").unwrap();
    let result = save_tag_memo_at_path(
        &SaveTagMemoInput {
            tag: "りんご".to_string(),
            body: String::new(),
            expected_revision: None,
            overwrite: None,
        },
        &path,
    )
    .unwrap();
    let SaveTagMemoResult::Saved { memo } = result else {
        panic!("blank missing memo must be treated as saved");
    };
    assert!(!memo.exists);
    assert!(!directory.path().join(".synaplink").exists());
}

#[test]
fn creates_then_retains_an_empty_tag_memo_file() {
    let directory = tempfile::tempdir().unwrap();
    let path = tag_memo_path(directory.path(), "りんご").unwrap();
    let created = save_tag_memo_at_path(
        &SaveTagMemoInput {
            tag: "りんご".to_string(),
            body: "赤い果物".to_string(),
            expected_revision: None,
            overwrite: None,
        },
        &path,
    )
    .unwrap();
    let SaveTagMemoResult::Saved { memo: created } = created else {
        panic!("first write must save");
    };
    let cleared = save_tag_memo_at_path(
        &SaveTagMemoInput {
            tag: "りんご".to_string(),
            body: String::new(),
            expected_revision: created.revision,
            overwrite: None,
        },
        &path,
    )
    .unwrap();
    let SaveTagMemoResult::Saved { memo: cleared } = cleared else {
        panic!("clearing must save");
    };
    assert!(cleared.exists);
    assert_eq!(fs::read_to_string(path).unwrap(), "");
}

#[test]
fn tag_memo_checks_conflict_before_identical_write() {
    let directory = tempfile::tempdir().unwrap();
    let path = tag_memo_path(directory.path(), "りんご").unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    atomic_write(&path, "外部の本文").unwrap();
    let result = save_tag_memo_at_path(
        &SaveTagMemoInput {
            tag: "りんご".to_string(),
            body: "外部の本文".to_string(),
            expected_revision: Some("stale".to_string()),
            overwrite: None,
        },
        &path,
    )
    .unwrap();
    assert!(matches!(result, SaveTagMemoResult::Conflict { .. }));
}

#[test]
fn tag_memo_detects_first_create_and_external_delete_races() {
    let directory = tempfile::tempdir().unwrap();
    let path = tag_memo_path(directory.path(), "りんご").unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    atomic_write(&path, "external").unwrap();
    let first_create = save_tag_memo_at_path(
        &SaveTagMemoInput {
            tag: "りんご".to_string(),
            body: "local".to_string(),
            expected_revision: None,
            overwrite: None,
        },
        &path,
    )
    .unwrap();
    assert!(matches!(first_create, SaveTagMemoResult::Conflict { .. }));

    let expected = Some(revision("external"));
    fs::remove_file(&path).unwrap();
    let external_delete = save_tag_memo_at_path(
        &SaveTagMemoInput {
            tag: "りんご".to_string(),
            body: "local".to_string(),
            expected_revision: expected,
            overwrite: None,
        },
        &path,
    )
    .unwrap();
    let SaveTagMemoResult::Conflict { current } = external_delete else {
        panic!("external deletion must conflict");
    };
    assert!(!current.exists);
    assert_eq!(current.revision, None);
}

#[test]
fn tag_memo_reports_invalid_utf8() {
    let directory = tempfile::tempdir().unwrap();
    let path = tag_memo_path(directory.path(), "りんご").unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, [0xff, 0xfe]).unwrap();
    assert!(tag_memo_from_path("りんご", &path)
        .unwrap_err()
        .contains("タグメモを読み込めません"));
}
```

Extend `scan_notes` coverage by writing `<vault>/ordinary.txt` and `.synaplink/tag-notes/tag.txt`, then assert `scan_notes` returns exactly one summary whose `id` is `ordinary.txt`.

- [ ] **Step 2: Run the targeted Rust tests and verify failure**

Run:

```bash
cargo test --manifest-path backend/Cargo.toml tag_memo -- --nocapture
```

Expected: compilation fails because `tag_memo_path`, `SaveTagMemoInput`, and `save_tag_memo_at_path` do not exist.

- [ ] **Step 3: Define the backend wire types and deterministic path**

Add these types beside the ordinary note save types:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagMemoDocument {
    pub tag: String,
    pub body: String,
    pub revision: Option<String>,
    pub exists: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTagMemoInput {
    pub tag: String,
    pub body: String,
    pub expected_revision: Option<String>,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveTagMemoResult {
    Saved { memo: TagMemoDocument },
    Conflict { current: TagMemoDocument },
}

fn display_tag(value: &str) -> Result<String, String> {
    let tag = value.trim().trim_start_matches('#').to_string();
    if normalize_tag(&tag).is_empty() {
        return Err("タグが空です".to_string());
    }
    Ok(tag)
}

fn tag_memo_path(vault: &Path, tag: &str) -> Result<PathBuf, String> {
    let display = display_tag(tag)?;
    let normalized = normalize_tag(&display);
    let name = format!("{:x}.txt", Sha256::digest(normalized.as_bytes()));
    Ok(vault.join(".synaplink").join("tag-notes").join(name))
}
```

- [ ] **Step 4: Implement missing reads, lazy saves, and conflict ordering**

Use a missing file as a valid virtual document and create the parent only for a real write:

```rust
fn tag_memo_from_path(tag: &str, path: &Path) -> Result<TagMemoDocument, String> {
    let tag = display_tag(tag)?;
    match fs::read_to_string(path) {
        Ok(body) => Ok(TagMemoDocument {
            tag,
            revision: Some(revision(&body)),
            body,
            exists: true,
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(TagMemoDocument {
            tag,
            body: String::new(),
            revision: None,
            exists: false,
        }),
        Err(error) => Err(format!("タグメモを読み込めません: {error}")),
    }
}

fn save_tag_memo_at_path(
    input: &SaveTagMemoInput,
    path: &Path,
) -> Result<SaveTagMemoResult, String> {
    let current = tag_memo_from_path(&input.tag, path)?;
    if current.revision != input.expected_revision && input.overwrite != Some(true) {
        return Ok(SaveTagMemoResult::Conflict { current });
    }
    let body = input.body.replace("\r\n", "\n");
    if !current.exists && body.is_empty() {
        return Ok(SaveTagMemoResult::Saved { memo: current });
    }
    let body_revision = revision(&body);
    if current.revision.as_deref() == Some(body_revision.as_str()) {
        return Ok(SaveTagMemoResult::Saved { memo: current });
    }
    let parent = path.parent().ok_or_else(|| "保存先が不正です".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("タグメモの保存先を作成できません: {error}"))?;
    atomic_write(path, &body)?;
    Ok(SaveTagMemoResult::Saved {
        memo: tag_memo_from_path(&input.tag, path)?,
    })
}
```

Add commands that resolve paths internally:

```rust
#[tauri::command]
fn read_tag_memo(tag: String, state: State<'_, AppState>) -> Result<TagMemoDocument, String> {
    let vault = current_vault(&state)?;
    tag_memo_from_path(&tag, &tag_memo_path(&vault, &tag)?)
}

#[tauri::command]
fn save_tag_memo(
    input: SaveTagMemoInput,
    state: State<'_, AppState>,
) -> Result<SaveTagMemoResult, String> {
    let vault = current_vault(&state)?;
    save_tag_memo_at_path(&input, &tag_memo_path(&vault, &input.tag)?)
}
```

Register `read_tag_memo` and `save_tag_memo` in `tauri::generate_handler!` immediately after `save_note`.

- [ ] **Step 5: Run formatting, tests, and Clippy**

Run:

```bash
cargo fmt --manifest-path backend/Cargo.toml -- --check
cargo test --manifest-path backend/Cargo.toml
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
```

Expected: all commands exit 0; the new tests prove normalization, lazy creation, empty-file retention, nested exclusion, and conflict ordering.

- [ ] **Step 6: Commit the backend slice**

```bash
git add backend/src/lib.rs
git commit -m "Add tag memo storage commands"
```

---

### Task 2: Add the Frontend Tag Memo API Contract

**Files:**
- Modify: `frontend/types.ts:1-end`
- Modify: `frontend/api.ts:1-end`
- Create: `frontend/api.test.ts`

**Interfaces:**
- Consumes: backend commands `read_tag_memo` and `save_tag_memo` from Task 1.
- Produces: `TagMemoDocument`, `SaveTagMemoInput`, `SaveTagMemoResult`, `api.readTagMemo(tag)`, and `api.saveTagMemo(input)`.

- [ ] **Step 1: Write failing API contract tests**

```ts
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

vi.mock(import("@tauri-apps/api/core"), () => ({ invoke: vi.fn() }));
vi.mock(import("@tauri-apps/plugin-dialog"), () => ({ open: vi.fn() }));

describe("tag memo api", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("reads a tag memo by display tag", async () => {
    vi.mocked(invoke).mockResolvedValue({ tag: "りんご", body: "本文", revision: "r1", exists: true });
    await api.readTagMemo("りんご");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("read_tag_memo", { tag: "りんご" });
  });

  it("saves with an optional expected revision", async () => {
    const input = { tag: "りんご", body: "本文", expectedRevision: null };
    vi.mocked(invoke).mockResolvedValue({ status: "saved", memo: { ...input, revision: "r1", exists: true } });
    await api.saveTagMemo(input);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("save_tag_memo", { input });
  });
});
```

- [ ] **Step 2: Run the API test and verify failure**

Run:

```bash
pnpm test -- frontend/api.test.ts
```

Expected: FAIL because the methods and types do not exist.

- [ ] **Step 3: Add exact frontend types and adapters**

Append to `frontend/types.ts`:

```ts
export interface TagMemoDocument {
  tag: string;
  body: string;
  revision: string | null;
  exists: boolean;
}

export interface SaveTagMemoInput {
  tag: string;
  body: string;
  expectedRevision: string | null;
  overwrite?: boolean;
}

export type SaveTagMemoResult =
  | { status: "saved"; memo: TagMemoDocument }
  | { status: "conflict"; current: TagMemoDocument };
```

Add to `api` with the new type imports:

```ts
readTagMemo: async (tag: string) => invoke<TagMemoDocument>("read_tag_memo", { tag }),
saveTagMemo: async (input: SaveTagMemoInput) => invoke<SaveTagMemoResult>("save_tag_memo", { input }),
```

- [ ] **Step 4: Run the targeted test, lint, and build**

```bash
pnpm test -- frontend/api.test.ts
pnpm lint
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the contract slice**

```bash
git add frontend/types.ts frontend/api.ts frontend/api.test.ts
git commit -m "Add frontend tag memo API"
```

---

### Task 3: Extract Shared Autosave and Conflict Units

**Files:**
- Create: `frontend/use-autosaved-document.ts`
- Create: `frontend/use-autosaved-document.test.tsx`
- Create: `frontend/components/SaveStatus.tsx`
- Create: `frontend/components/EditConflictDialog.tsx`

**Interfaces:**
- Consumes: any document with `revision: string | null` and an adapter returning `PersistResult<T>`.
- Produces: `useAutosavedDocument<T>()`, `SaveState`, `SaveStatus`, and `EditConflictDialog` for both ordinary notes and tag memos.

- [ ] **Step 1: Write failing controller tests with fake timers**

Use `renderHook` and `act` to prove the behavioral contract:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosavedDocument } from "./use-autosaved-document";

interface TestDocument { body: string; revision: string | null; exists: boolean }

describe(useAutosavedDocument, () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads programmatic content without saving and debounces user edits by 700ms", async () => {
    const persist = vi.fn().mockResolvedValue({
      status: "saved",
      document: { body: "edited", revision: "r2", exists: true },
    });
    const { result } = renderHook(() => useAutosavedDocument<TestDocument>({ persist, mergeSaved: (_, saved) => saved, onError: vi.fn() }));
    act(() => result.current.load({ body: "loaded", revision: "r1", exists: true }));
    expect(persist).not.toHaveBeenCalled();
    act(() => result.current.edit((current) => ({ ...current, body: "edited" })));
    await act(() => vi.advanceTimersByTimeAsync(699));
    expect(persist).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(persist).toHaveBeenCalledExactlyOnceWith(
      { body: "edited", revision: "r1", exists: true },
      "r1",
      false,
    );
  });

  it("saves immediately before pending navigation", async () => {
    const navigate = vi.fn();
    const persist = vi.fn().mockResolvedValue({ status: "saved", document: { body: "edited", revision: "r2", exists: true } });
    const { result } = renderHook(() => useAutosavedDocument<TestDocument>({ persist, mergeSaved: (_, saved) => saved, onError: vi.fn() }));
    act(() => result.current.load({ body: "old", revision: "r1", exists: true }));
    act(() => result.current.edit((current) => ({ ...current, body: "edited" })));
    await act(async () => result.current.requestNavigation(navigate));
    expect(persist).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("keeps navigation pending off after a conflict", async () => {
    const navigate = vi.fn();
    const external = { body: "external", revision: "r2", exists: true };
    const persist = vi.fn().mockResolvedValue({ status: "conflict", current: external });
    const { result } = renderHook(() => useAutosavedDocument<TestDocument>({ persist, mergeSaved: (_, saved) => saved, onError: vi.fn() }));
    act(() => result.current.load({ body: "local", revision: "r1", exists: true }));
    act(() => result.current.edit((current) => ({ ...current, body: "local edit" })));
    await act(async () => result.current.requestNavigation(navigate));
    expect(result.current.conflict).toEqual(external);
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

Add the remaining contract cases with explicit assertions:

```tsx
it("synchronizes only while saved", () => {
  const persist = vi.fn();
  const { result } = renderHook(() => useAutosavedDocument<TestDocument>({ persist, mergeSaved: (_, saved) => saved, onError: vi.fn() }));
  act(() => result.current.load({ body: "old", revision: "r1", exists: true }));
  act(() => result.current.synchronize({ body: "external", revision: "r2", exists: true }));
  expect(result.current.document?.body).toBe("external");
  act(() => result.current.edit((current) => ({ ...current, body: "local" })));
  act(() => result.current.synchronize({ body: "newer external", revision: "r3", exists: true }));
  expect(result.current.document?.body).toBe("local");
});

it("retains local content after a save error", async () => {
  const onError = vi.fn();
  const persist = vi.fn().mockRejectedValue(new Error("disk full"));
  const { result } = renderHook(() => useAutosavedDocument<TestDocument>({ persist, mergeSaved: (_, saved) => saved, onError }));
  act(() => result.current.load({ body: "old", revision: "r1", exists: true }));
  act(() => result.current.edit((current) => ({ ...current, body: "local" })));
  await act(() => vi.advanceTimersByTimeAsync(700));
  expect(result.current.document?.body).toBe("local");
  expect(result.current.saveState).toBe("error");
  expect(onError).toHaveBeenCalledOnce();
});

it("overwrites against the external revision", async () => {
  const external = { body: "external", revision: "r2", exists: true };
  const persist = vi.fn()
    .mockResolvedValueOnce({ status: "conflict", current: external })
    .mockResolvedValueOnce({ status: "saved", document: { body: "local", revision: "r3", exists: true } });
  const { result } = renderHook(() => useAutosavedDocument<TestDocument>({ persist, mergeSaved: (_, saved) => saved, onError: vi.fn() }));
  act(() => result.current.load({ body: "local", revision: "r1", exists: true }));
  act(() => result.current.edit((current) => ({ ...current, body: "local" })));
  await act(() => vi.advanceTimersByTimeAsync(700));
  await act(() => result.current.overwriteConflict());
  expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ body: "local" }), "r2", true);
});
```

Cover edits made during an in-flight save with a deferred promise:

```tsx
it("preserves a second edit made while saving", async () => {
  let resolveFirst!: (value: { status: "saved"; document: TestDocument }) => void;
  const firstSave = new Promise<{ status: "saved"; document: TestDocument }>((resolve) => { resolveFirst = resolve; });
  const persist = vi.fn()
    .mockReturnValueOnce(firstSave)
    .mockResolvedValueOnce({ status: "saved", document: { body: "second", revision: "r3", exists: true } });
  const mergeSaved = vi.fn((local: TestDocument, saved: TestDocument) => ({ ...local, revision: saved.revision, exists: saved.exists }));
  const navigate = vi.fn();
  const { result } = renderHook(() => useAutosavedDocument<TestDocument>({ persist, mergeSaved, onError: vi.fn() }));
  act(() => result.current.load({ body: "old", revision: "r1", exists: true }));
  act(() => result.current.edit((current) => ({ ...current, body: "first" })));
  let navigation!: Promise<void>;
  act(() => { navigation = result.current.requestNavigation(navigate); });
  act(() => result.current.edit((current) => ({ ...current, body: "second" })));
  await act(async () => resolveFirst({ status: "saved", document: { body: "first", revision: "r2", exists: true } }));
  await act(async () => navigation);
  expect(mergeSaved).toHaveBeenCalledWith(expect.objectContaining({ body: "second" }), expect.objectContaining({ revision: "r2" }));
  expect(persist).toHaveBeenCalledTimes(2);
  expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ body: "second" }), "r2", false);
  expect(navigate).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the controller tests and verify failure**

```bash
pnpm test -- frontend/use-autosaved-document.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the generic controller contract**

Use this public interface exactly:

```ts
export type SaveState = "saved" | "dirty" | "saving" | "error";
export interface VersionedDocument { revision: string | null }
export type PersistResult<T> =
  | { status: "saved"; document: T }
  | { status: "conflict"; current: T };

interface Options<T extends VersionedDocument> {
  persist: (document: T, expectedRevision: string | null, overwrite: boolean) => Promise<PersistResult<T>>;
  mergeSaved: (local: T, saved: T) => T;
  onError: (error: unknown) => void;
  onSaved?: (document: T) => void | Promise<void>;
  delay?: number;
}

export interface AutosavedDocumentController<T extends VersionedDocument> {
  document: T | null;
  saveState: SaveState;
  conflict: T | null;
  load: (document: T | null) => void;
  edit: (update: (document: T) => T) => void;
  synchronize: (document: T) => void;
  acceptExternal: () => void;
  overwriteConflict: () => Promise<void>;
  requestNavigation: (navigate: () => void) => Promise<void>;
}
```

Implement one `persistCurrent` callback used by both the 700 ms effect and `requestNavigation`. Capture an edit-generation counter before awaiting `persist`; if the counter changes, call `mergeSaved(latestLocal, savedDocument)`, keep state `dirty`, and save again before executing pending navigation. On conflict or error, clear pending navigation and retain the local document. `load` and `synchronize` must update CodeMirror through props without calling `edit`.

- [ ] **Step 4: Implement shared presentation components**

`SaveStatus` maps the shared state without owning behavior:

```tsx
import type { SaveState } from "../use-autosaved-document";

export function SaveStatus({ state }: { state: SaveState }) {
  const label = state === "saved" ? "保存済み" : state === "saving" ? "保存中…" : state === "error" ? "保存エラー" : "未保存";
  return <span className={`save-status ${state}`}>{label}</span>;
}
```

`EditConflictDialog` contains no document-specific state:

```tsx
interface Props {
  onAcceptExternal: () => void;
  onOverwrite: () => void;
}

export function EditConflictDialog({ onAcceptExternal, onOverwrite }: Props) {
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true">
        <span className="eyebrow">EDIT CONFLICT</span>
        <h2>外部でメモが変更されました</h2>
        <p>現在の編集を残すか、外部で変更された内容を読み込んでください。</p>
        <div className="modal-actions">
          <button onClick={onAcceptExternal}>外部の内容を読む</button>
          <button className="primary-button" onClick={onOverwrite}>現在の編集で上書き</button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Run controller tests, full frontend tests, lint, and build**

```bash
pnpm test -- frontend/use-autosaved-document.test.tsx
pnpm test
pnpm lint
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the shared units**

```bash
git add frontend/use-autosaved-document.ts frontend/use-autosaved-document.test.tsx frontend/components/SaveStatus.tsx frontend/components/EditConflictDialog.tsx
git commit -m "Extract shared autosave controls"
```

---

### Task 4: Adapt Ordinary Notes to the Shared Autosave Controller

**Files:**
- Modify: `frontend/App.tsx:1-199`
- Modify: `frontend/App.tsx:258-343`
- Modify: `frontend/App.test.tsx`

**Interfaces:**
- Consumes: `useAutosavedDocument<NoteDocument>`, `SaveStatus`, `EditConflictDialog`, and existing ordinary note API methods.
- Produces: proven ordinary-note integration and a navigation wrapper reusable by the tag page in Task 5.

- [ ] **Step 1: Add failing ordinary-note regression tests**

Extend the API mock with every existing method and add these cases:

```tsx
it("通常メモを700ms後に保存する", async () => {
  vi.useFakeTimers();
  vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
  vi.mocked(api.listNotes).mockResolvedValue([summary]);
  vi.mocked(api.readNote).mockResolvedValue(document);
  vi.mocked(api.saveNote).mockResolvedValue({ status: "saved", note: { ...document, body: "編集後", revision: "r2" } });
  const { container } = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: document.title }));
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!);
  act(() => view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: "編集後" }, userEvent: "input.type" }));
  await act(() => vi.advanceTimersByTimeAsync(700));
  expect(api.saveNote).toHaveBeenCalledExactlyOnceWith({
    id: document.id,
    title: document.title,
    body: "編集後",
    expectedRevision: document.revision,
  });
  vi.useRealTimers();
});
```

Add a conflict test that makes `api.saveNote` return `{ status: "conflict", current: external }`, then clicks both shared dialog actions and checks load/overwrite behavior. Add a navigation test proving a note selection requested while dirty runs after immediate save.

- [ ] **Step 2: Run the App tests and verify failure against the new contract**

```bash
pnpm test -- frontend/App.test.tsx
```

Expected: the new save and navigation expectations fail until `App` uses the shared controller.

- [ ] **Step 3: Replace ordinary-note save state with an adapter**

Map the ordinary API result into `PersistResult<NoteDocument>`:

```tsx
const noteAutosave = useAutosavedDocument<NoteDocument>({
  persist: async (note, expectedRevision, overwrite) => {
    const result = await api.saveNote({
      id: note.id,
      title: note.title,
      body: note.body,
      expectedRevision: expectedRevision ?? note.revision,
      ...(overwrite ? { overwrite: true } : {}),
    });
    return result.status === "saved"
      ? { status: "saved", document: result.note }
      : { status: "conflict", current: result.current };
  },
  mergeSaved: (local, saved) => ({ ...local, modifiedAt: saved.modifiedAt, revision: saved.revision, tags: saved.tags }),
  onError: (error) => setError(String(error)),
  onSaved: refreshNotes,
});
```

Call `noteAutosave.load(note)` after reads and creation, `noteAutosave.edit` from title/body changes, and `noteAutosave.synchronize` for external refreshes. Replace the inline save label and conflict modal with `SaveStatus` and `EditConflictDialog`.

- [ ] **Step 4: Route ordinary-note navigation through the controller**

Use one callback instead of silently dropping dirty navigation:

```tsx
const navigateFromNote = (action: () => void) => {
  void noteAutosave.requestNavigation(action);
};
```

Wrap sidebar selection, new-note creation, vault changes, and ordinary-note tag opening with this callback. A save error or conflict must leave the current editor and requested destination unchanged.

- [ ] **Step 5: Run regression tests and frontend validation**

```bash
pnpm test -- frontend/App.test.tsx
pnpm test
pnpm lint
pnpm build
```

Expected: all existing editor/navigation tests and new autosave tests pass.

- [ ] **Step 6: Commit the ordinary-note refactor**

```bash
git add frontend/App.tsx frontend/App.test.tsx
git commit -m "Reuse autosave controller for notes"
```

---

### Task 5: Build and Integrate the Editable Connected Notes Page

**Files:**
- Create: `frontend/components/ConnectedNotesPage.tsx`
- Create: `frontend/components/ConnectedNotesPage.test.tsx`
- Modify: `frontend/App.tsx`
- Modify: `frontend/App.test.tsx`
- Modify: `frontend/styles.css:75-121`
- Modify: `README.md:5-14`
- Delete: `frontend/components/TagResults.tsx`
- Delete: `frontend/components/TagResults.test.tsx`

**Interfaces:**
- Consumes: tag memo API from Task 2, shared controller and presentation from Task 3, and ordinary-note navigation from Task 4.
- Produces: complete editable `CONNECTED NOTES` flow with independent result/memo loading, polling, conflict resolution, and approved layout.

- [ ] **Step 1: Write failing presentational tests**

Create `ConnectedNotesPage.test.tsx` with a saved memo and one result:

```tsx
it("タグ本文を検索結果より上に表示し件数説明を出さない", () => {
  const { container } = render(
    <ConnectedNotesPage
      memo={{ tag: "りんご", body: "秋に食べ比べたい", revision: "r1", exists: true }}
      notes={[{ id: "1.txt", modifiedAt: 1, preview: "甘い", revision: "n1", tags: [], title: "紅玉" }]}
      saveState="saved"
      tag="りんご"
      onBack={vi.fn()}
      onBodyChange={vi.fn()}
      onOpenTag={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByRole("heading", { level: 1, name: "#りんご" })).toBeInTheDocument();
  expect(screen.queryByText(/件のメモが/u)).not.toBeInTheDocument();
  const editor = container.querySelector(".tag-memo-editor");
  const grid = container.querySelector(".result-grid");
  expect(editor?.compareDocumentPosition(grid!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});
```

Add explicit loading and callback coverage:

```tsx
it("読み込み中は編集を開始できない", () => {
  const { container } = render(
    <ConnectedNotesPage tag="りんご" memo={null} notes={[]} saveState="saved" onBack={vi.fn()} onBodyChange={vi.fn()} onOpenTag={vi.fn()} onSelect={vi.fn()} />,
  );
  expect(screen.getByText("タグメモを読み込み中…")).toBeInTheDocument();
  expect(container.querySelector(".cm-editor")).toBeNull();
});

it("戻る・関連メモ・本文タグの操作を通知する", () => {
  const onBack = vi.fn();
  const onOpenTag = vi.fn();
  const onSelect = vi.fn();
  const { container } = render(
    <ConnectedNotesPage
      tag="りんご"
      memo={{ tag: "りんご", body: "#果物", revision: "r1", exists: true }}
      notes={[{ id: "1.txt", modifiedAt: 1, preview: "甘い", revision: "n1", tags: [], title: "紅玉" }]}
      saveState="saved"
      onBack={onBack}
      onBodyChange={vi.fn()}
      onOpenTag={onOpenTag}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "← メモに戻る" }));
  fireEvent.click(screen.getByRole("button", { name: /紅玉/u }));
  fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
  expect(onBack).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith("1.txt");
  expect(onOpenTag).toHaveBeenCalledWith("果物");
});
```

- [ ] **Step 2: Write failing App integration tests**

Extend the `api` mock with `readTagMemo` and `saveTagMemo`. Update the existing tag-navigation test so `readTagMemo("りんご")` resolves alongside `searchTag("りんご")`. Add cases that:

- edit the tag body through CodeMirror and expect `saveTagMemo` after 700 ms;
- verify a missing memo opens blank without calling `saveTagMemo`;
- request another tag while dirty, resolve save, then expect the second tag to load;
- return conflict and verify the shared conflict dialog blocks navigation;
- reject `readTagMemo` while `searchTag` succeeds and verify cards remain visible while editing stays unavailable;
- advance 2500 ms in saved state, return a newer revision, and verify programmatic synchronization causes no save.

Use this saved response shape consistently:

```ts
const tagMemo = { tag: "りんご", body: "秋の候補", revision: "tag-r1", exists: true };
vi.mocked(api.readTagMemo).mockResolvedValue(tagMemo);
vi.mocked(api.saveTagMemo).mockResolvedValue({
  status: "saved",
  memo: { ...tagMemo, body: "秋の候補を追加", revision: "tag-r2" },
});
```

Drive the core autosave case through CodeMirror:

```tsx
it("タグメモ本文を700ms後に保存する", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const summary = {
    id: "apple.txt",
    modifiedAt: 1,
    preview: "本文の #りんご",
    revision: "note-r1",
    tags: [{ displayName: "りんご", normalizedName: "りんご" }],
    title: "りんごのメモ",
  };
  vi.mocked(api.getVault).mockResolvedValue("/tmp/notes");
  vi.mocked(api.listNotes).mockResolvedValue([summary]);
  vi.mocked(api.readNote).mockResolvedValue({ ...summary, body: "本文の #りんご" });
  vi.mocked(api.searchTag).mockResolvedValue([summary]);
  vi.mocked(api.readTagMemo).mockResolvedValue({ tag: "りんご", body: "秋の候補", revision: "tag-r1", exists: true });
  vi.mocked(api.saveTagMemo).mockResolvedValue({
    status: "saved",
    memo: { tag: "りんご", body: "秋の候補を追加", revision: "tag-r2", exists: true },
  });
  const { container } = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /りんごのメモ/u }));
  await waitFor(() => expect(container.querySelector(".cm-zettel-tag")).not.toBeNull());
  fireEvent.mouseDown(container.querySelector(".cm-zettel-tag")!);
  await screen.findByRole("heading", { level: 1, name: "#りんご" });
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".tag-memo-editor .cm-editor")!);
  act(() => view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: "秋の候補を追加" }, userEvent: "input.type" }));
  await act(() => vi.advanceTimersByTimeAsync(700));
  expect(api.saveTagMemo).toHaveBeenCalledExactlyOnceWith({
    tag: "りんご",
    body: "秋の候補を追加",
    expectedRevision: "tag-r1",
  });
  vi.useRealTimers();
});
```

Name the other integration tests `存在しないタグメモを開くだけでは保存しない`, `保存成功後に別タグへ移動する`, `競合時は別タグへ移動しない`, `タグメモ読込失敗でも関連メモを表示する`, and `外部同期をユーザー編集として保存しない`. For each one, assert both its expected UI/API result and that the prohibited `saveTagMemo` or navigation call did not occur.

- [ ] **Step 3: Run the component and App tests to verify failure**

```bash
pnpm test -- frontend/components/ConnectedNotesPage.test.tsx frontend/App.test.tsx
```

Expected: FAIL because `ConnectedNotesPage` and the tag memo API integration are absent.

- [ ] **Step 4: Implement the approved page component**

Use body-only `MemoEditor`; do not render a title input or result-count sentence:

```tsx
interface Props {
  tag: string;
  memo: TagMemoDocument | null;
  notes: NoteSummary[];
  saveState: SaveState;
  onBack: () => void;
  onBodyChange: (body: string) => void;
  onOpenTag: (tag: string) => void;
  onSelect: (id: string) => void;
}

export function ConnectedNotesPage(props: Props) {
  return (
    <main className="results-view connected-notes-page">
      <button className="back-button" onClick={props.onBack}>← メモに戻る</button>
      <header className="results-heading tag-memo-heading">
        <span className="eyebrow">CONNECTED NOTES</span>
        <div className="tag-memo-title-row">
          <h1>#{props.tag}</h1>
          <SaveStatus state={props.saveState} />
        </div>
      </header>
      <section className="tag-memo-editor" aria-label={`#${props.tag} のメモ`}>
        {props.memo ? (
          <MemoEditor
            value={props.memo.body}
            onChange={props.onBodyChange}
            onNavigateBackward={() => undefined}
            onOpenTag={props.onOpenTag}
          />
        ) : (
          <p className="tag-memo-loading">タグメモを読み込み中…</p>
        )}
      </section>
      <div className="result-grid">
        {props.notes.map((note) => (
          <button className="result-card" key={note.id} onClick={() => props.onSelect(note.id)}>
            <time>{new Date(note.modifiedAt).toLocaleDateString("ja-JP")}</time>
            <h2>{note.title.trim() || "無題"}</h2>
            <p>{note.preview || "本文はまだありません。"}</p>
          </button>
        ))}
      </div>
    </main>
  );
}
```

Keep the result-card semantics and Japanese fallbacks exactly as shown so existing behavior remains covered after deleting `TagResults`.

- [ ] **Step 5: Integrate independent loading, tag autosave, polling, and navigation**

Create a second controller with the tag adapter:

```tsx
const tagMemoAutosave = useAutosavedDocument<TagMemoDocument>({
  persist: async (memo, expectedRevision, overwrite) => {
    const result = await api.saveTagMemo({
      tag: memo.tag,
      body: memo.body,
      expectedRevision,
      ...(overwrite ? { overwrite: true } : {}),
    });
    return result.status === "saved"
      ? { status: "saved", document: result.memo }
      : { status: "conflict", current: result.current };
  },
  mergeSaved: (local, saved) => ({ ...local, exists: saved.exists, revision: saved.revision }),
  onError: (error) => setError(String(error)),
});
```

When opening a tag, set the heading immediately, clear the prior memo, then launch independent reads:

```tsx
const tagRequest = useRef(0);

const loadTagPage = (tag: string) => {
  const request = ++tagRequest.current;
  setActiveTag(tag);
  setTagResults([]);
  tagMemoAutosave.load(null);
  void api.searchTag(tag)
    .then((notes) => { if (tagRequest.current === request) setTagResults(notes); })
    .catch((error) => { if (tagRequest.current === request) setError(String(error)); });
  void api.readTagMemo(tag)
    .then((memo) => { if (tagRequest.current === request) tagMemoAutosave.load(memo); })
    .catch((error) => { if (tagRequest.current === request) setError(String(error)); });
};

useEffect(() => {
  if (!activeTag || tagMemoAutosave.saveState !== "saved") {
    return;
  }
  const interval = window.setInterval(() => {
    const request = tagRequest.current;
    void api.readTagMemo(activeTag)
      .then((memo) => { if (tagRequest.current === request) tagMemoAutosave.synchronize(memo); })
      .catch((error) => { if (tagRequest.current === request) setError(String(error)); });
  }, 2500);
  return () => window.clearInterval(interval);
}, [activeTag, tagMemoAutosave.saveState, tagMemoAutosave.synchronize]);
```

Select the active navigation controller:

```tsx
const requestEditorNavigation = (action: () => void) => {
  const controller = activeTag ? tagMemoAutosave : noteAutosave;
  void controller.requestNavigation(action);
};
```

Use it for back, result cards, and tags clicked inside the tag memo. Render `EditConflictDialog` with the conflict and actions from whichever controller is active.

- [ ] **Step 6: Apply the approved visual hierarchy and remove the old component**

Add styles that keep the tag memo above the grid and give it normal-note writing space:

```css
.connected-notes-page { display: flex; flex-direction: column; }
.tag-memo-heading { margin-bottom: 0; }
.tag-memo-title-row { display: flex; align-items: flex-end; justify-content: space-between; }
.tag-memo-editor { min-height: 180px; margin-bottom: 24px; border-bottom: 1px solid var(--line); }
.tag-memo-editor .memo-editor { min-height: 180px; }
.tag-memo-loading { padding: 28px 4px; color: var(--muted); font-size: 12px; }
.connected-notes-page .result-grid { padding-bottom: 40px; }
```

Remove `.results-heading p` styling if it is no longer used. Delete `TagResults.tsx` and its test only after imports and coverage have moved to `ConnectedNotesPage`.

Add this English feature bullet to `README.md`:

```markdown
- Write dedicated notes on tag pages without mixing them into ordinary notes
```

- [ ] **Step 7: Run focused and complete validation**

Run every repository-required check:

```bash
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path backend/Cargo.toml -- --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml
pnpm tauri build --bundles app
```

Expected: every command exits 0. Confirm the Tauri command produces a macOS `.app` bundle without modifying or staging `dist/` or `backend/target/`.

- [ ] **Step 8: Inspect scope and commit the integrated feature**

```bash
git status --short
git diff --check
git diff --stat
git add README.md frontend/App.tsx frontend/App.test.tsx frontend/components/ConnectedNotesPage.tsx frontend/components/ConnectedNotesPage.test.tsx frontend/components/TagResults.tsx frontend/components/TagResults.test.tsx frontend/styles.css
git commit -m "Add editable connected notes pages"
```

Expected: only intended source and test files are staged; `.superpowers/`, `dist/`, and `backend/target/` remain unstaged.
