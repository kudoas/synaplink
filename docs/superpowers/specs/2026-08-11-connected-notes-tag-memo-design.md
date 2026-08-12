# Connected Notes Tag Memo Design

## Summary

Add an editable body to each `CONNECTED NOTES` tag page. The body belongs to the tag itself, not to an ordinary note. It is stored as dedicated UTF-8 plain text inside the selected vault, does not appear in the sidebar or note search results, and uses the same autosave and conflict behavior as ordinary notes.

## Goals

- Let a user write free-form text about the active tag above its connected-note results.
- Keep tag memo data with the selected vault so it moves and backs up with the vault.
- Reuse the ordinary note editor, autosave state, external-change detection, and conflict-resolution behavior.
- Keep tag memos out of ordinary note lists, text search, and tag search results.
- Preserve tag memo data even when no ordinary note currently references that tag.

## Non-goals

- Listing or searching tag memos.
- Adding a separate title to a tag memo; the active tag is its fixed heading.
- Treating tag memos as ordinary `NoteDocument` values.
- Deleting a tag memo file when its body becomes empty.
- Making an otherwise unreachable tag memo discoverable when no ordinary note or tag memo links to it.

## User Experience

The tag page retains its back button, `CONNECTED NOTES` eyebrow, and `#tag` heading. Directly below the heading it shows the shared body editor and the normal save-status indicator. A divider separates the editable body from the existing connected-note cards.

The sentence describing how many notes are connected is removed. Connected-note cards appear directly below the tag memo body. Selecting a card still opens the corresponding ordinary note.

Opening a tag from either an ordinary note or another tag memo opens the same tag page. Tags inside a tag memo are decorated and clickable, but the tag memo is never included as a connected-note result.

While the tag memo is loading, its editor remains unavailable so an empty placeholder cannot overwrite existing content. If the tag has never had a memo, loading resolves to a blank editor without creating a file.

## Tag Identity

Tag memos use the same identity rules as existing tag search. The leading `#` is removed, then the tag is normalized with the existing Unicode NFKC and lowercase normalization. Spellings such as `#Apple`, `#APPLE`, and `#Ａｐｐｌｅ` therefore share one tag memo and one connected-note result set. The page heading continues to use the spelling through which the user opened the page.

## Storage

Tag memo bodies are stored under the selected vault:

```text
<vault>/.synaplink/tag-notes/<sha256-of-normalized-tag>.txt
```

The file contains only the body as UTF-8 plain text. The hash is the lowercase hexadecimal SHA-256 digest of the normalized tag encoded as UTF-8. A deterministic hash avoids filesystem escaping, path traversal, case-sensitivity, Unicode filename normalization, and filename-length problems.

The hidden directories and file are created lazily on the first save of a non-empty body. Merely opening a tag page does not mutate the vault. Saving a blank body for a tag that has never had a file remains a no-op. Once a file exists, clearing the body atomically writes an empty file rather than deleting it.

Ordinary notes retain their existing first-line-title and subsequent-lines-body format. Tag memo files are a separate data type and do not change that invariant. The ordinary note scanner only reads `.txt` files directly under the vault, so nested tag memo files cannot enter ordinary note lists or search results.

## Backend Interface

Add dedicated read and save commands rather than special-casing ordinary note commands.

```text
read_tag_memo(tag) -> TagMemoDocument
save_tag_memo(input) -> SaveTagMemoResult
```

`TagMemoDocument` contains the requested display tag, body, optional revision, and existence state. A missing file is represented by an empty body, no revision, and `exists: false`; it is not an error.

`SaveTagMemoInput` contains the tag, body, expected optional revision, and optional overwrite flag. `SaveTagMemoResult` mirrors the ordinary note saved/conflict result and returns the current tag memo on conflict.

The backend resolves the path from the normalized tag and never accepts a caller-provided path. It rejects an empty tag. Before skipping an identical write, it compares the expected revision with the current revision, preserving the application's conflict-detection invariant. Writes use the existing atomic-write behavior. A first save expecting no file conflicts if another process created the file in the meantime. An external deletion is represented as a current non-existent document and also participates in conflict resolution.

## Frontend Architecture and Data Flow

Replace the results-only presentation with a focused `ConnectedNotesPage` component. It renders the tag heading, tag memo editor, save state, and connected-note cards. The application continues to own navigation between ordinary notes and tag pages.

Reuse `MemoEditor` directly because a tag memo has no editable title. Extract the autosave timer, save states, external synchronization rules, and conflict presentation into shared units that accept ordinary-note or tag-memo load/save adapters. Programmatic editor synchronization must continue to be distinguished from user edits.

When a tag page opens, connected-note search and tag memo loading run independently. The result cards may render as soon as search completes, but editing remains disabled until the tag memo read succeeds.

While the page is open and locally saved, poll the tag memo revision at the same cadence used for ordinary note refresh. A changed external revision reloads the editor only when there are no local edits. When local edits exist, the save command detects the mismatch and returns the shared conflict flow.

Autosave starts after the existing 700 ms debounce. A navigation request made while the tag memo is dirty or saving becomes pending: save immediately, navigate after a successful save, and remain on the page on conflict or error. This applies to the back button, connected-note cards, and tags clicked inside the tag memo.

## Error Handling

- A tag memo read failure displays the existing error UI and leaves editing disabled rather than presenting a writable empty body.
- A save failure retains the local body, marks the document as having a save error, and does not navigate away.
- A conflict offers the same choices as an ordinary note: load the external content or overwrite it with the local content.
- Directory creation, non-UTF-8 external content, and atomic-write failures are reported without altering ordinary note results.
- Failure to load connected-note results does not discard a successfully loaded tag memo body, and failure to load the tag memo does not hide successfully loaded result cards.

## Testing

Frontend tests cover:

- Rendering the body editor above result cards without the result-count sentence.
- Loading an existing tag memo and showing a blank editor for a missing one.
- Keeping programmatic synchronization from triggering autosave.
- Debounced save, save status, and shared conflict actions.
- Waiting for a successful save before back, result-card, or inline-tag navigation.
- Keeping local input and staying on the page after save failure or conflict.
- Navigating from a tag in the tag memo without adding that memo to result cards.

Backend tests cover:

- Reusing one path for tags equivalent under existing normalization.
- Producing deterministic hashed paths without accepting caller-controlled paths.
- Avoiding directories and files when an untouched or never-created memo is blank.
- Creating a file on the first non-empty save and retaining an empty file after clearing it.
- Excluding nested tag memo files from ordinary note scans and tag search.
- Checking conflicts before identical-write short-circuiting, including first-create and external-delete races.
- Reading and writing UTF-8 bodies atomically and reporting invalid UTF-8.

## Acceptance Criteria

- A user can open `#りんご`, edit its body above the connected-note cards, leave, return, and see the saved body.
- The tag memo never appears in the sidebar, ordinary text search, or connected-note cards.
- Equivalent normalized tag spellings open the same saved body.
- Opening a tag without typing creates no hidden data; clearing an existing body preserves an empty file.
- External edits cannot be silently overwritten, and local text remains available when saving fails.
- Existing ordinary note format, autosave synchronization, conflict checking, and connected-note selection continue to work.
