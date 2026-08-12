use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager, State};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    vault_path: Option<String>,
}

#[derive(Default)]
struct AppData {
    vault: Option<PathBuf>,
}

struct AppState(Mutex<AppData>);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagReference {
    pub normalized_name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub modified_at: u64,
    pub revision: String,
    pub tags: Vec<TagReference>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    pub id: String,
    pub title: String,
    pub body: String,
    pub modified_at: u64,
    pub revision: String,
    pub tags: Vec<TagReference>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteInput {
    pub id: String,
    pub title: String,
    pub body: String,
    pub expected_revision: String,
    pub overwrite: Option<bool>,
}

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

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveResult {
    Saved { note: NoteDocument },
    Conflict { current: NoteDocument },
}

fn normalize_tag(value: &str) -> String {
    value.nfkc().collect::<String>().to_lowercase()
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

fn is_tag_character(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '-')
}

#[must_use]
pub fn extract_tags(content: &str) -> Vec<TagReference> {
    let mut tags = Vec::new();
    let chars: Vec<(usize, char)> = content.char_indices().collect();
    let mut cursor = 0;

    while cursor < chars.len() {
        let (byte_index, character) = chars[cursor];
        if character != '#' {
            cursor += 1;
            continue;
        }

        let escaped = content[..byte_index]
            .chars()
            .rev()
            .take_while(|candidate| *candidate == '\\')
            .count()
            % 2
            == 1;
        if escaped {
            cursor += 1;
            continue;
        }

        let start = cursor + 1;
        let mut end = start;
        while end < chars.len() && is_tag_character(chars[end].1) {
            end += 1;
        }

        if end > start {
            let start_byte = chars[start].0;
            let end_byte = chars.get(end).map_or(content.len(), |item| item.0);
            let display_name = content[start_byte..end_byte].to_string();
            tags.push(TagReference {
                normalized_name: normalize_tag(&display_name),
                display_name,
            });
            cursor = end;
        } else {
            cursor += 1;
        }
    }

    tags
}

fn unique_tags(content: &str) -> Vec<TagReference> {
    let mut seen = BTreeSet::new();
    extract_tags(content)
        .into_iter()
        .filter(|tag| seen.insert(tag.normalized_name.clone()))
        .collect()
}

fn revision(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

fn modified_at(path: &Path) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map_err(|error| format!("更新日時を取得できません: {error}"))?;
    modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .map_err(|_| "更新日時が扱える範囲を超えています".to_string())
}

fn split_document(content: &str) -> (String, String) {
    match content.split_once('\n') {
        Some((title, body)) => (title.trim_end_matches('\r').to_string(), body.to_string()),
        None => (content.trim_end_matches('\r').to_string(), String::new()),
    }
}

fn document_from_path(path: &Path) -> Result<NoteDocument, String> {
    let raw = fs::read_to_string(path).map_err(|error| format!("メモを読み込めません: {error}"))?;
    let (title, body) = split_document(&raw);
    let id = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "無効なファイル名です".to_string())?
        .to_string();
    Ok(NoteDocument {
        id,
        title,
        body: body.clone(),
        modified_at: modified_at(path)?,
        revision: revision(&raw),
        tags: unique_tags(&body),
    })
}

fn summary_from_document(note: NoteDocument) -> NoteSummary {
    let preview = note
        .body
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .chars()
        .take(90)
        .collect();
    NoteSummary {
        id: note.id,
        title: note.title,
        preview,
        modified_at: note.modified_at,
        revision: note.revision,
        tags: note.tags,
    }
}

fn resolve_note(vault: &Path, id: &str) -> Result<PathBuf, String> {
    let file_name = Path::new(id);
    if file_name.components().count() != 1
        || file_name.extension().and_then(|value| value.to_str()) != Some("txt")
    {
        return Err("無効なメモIDです".to_string());
    }
    Ok(vault.join(file_name))
}

fn current_vault(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .map_err(|_| "アプリ状態を取得できません".to_string())?
        .vault
        .clone()
        .ok_or_else(|| "保存先フォルダが選択されていません".to_string())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("設定フォルダを取得できません: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("設定フォルダを作成できません: {error}"))?;
    Ok(directory.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn store_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let raw = serde_json::to_vec_pretty(settings)
        .map_err(|error| format!("設定を変換できません: {error}"))?;
    fs::write(settings_path(app)?, raw).map_err(|error| format!("設定を保存できません: {error}"))
}

fn scan_notes(vault: &Path) -> Result<Vec<NoteSummary>, String> {
    let entries =
        fs::read_dir(vault).map_err(|error| format!("保存先フォルダを読み込めません: {error}"))?;
    let mut notes = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("txt")
        })
        .filter_map(|path| document_from_path(&path).ok())
        .map(summary_from_document)
        .collect::<Vec<_>>();
    notes.sort_by_key(|note| std::cmp::Reverse(note.modified_at));
    Ok(notes)
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "保存先が不正です".to_string())?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        Uuid::new_v4()
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("一時ファイルを作成できません: {error}"))?;
        file.write_all(content.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|error| format!("メモを書き込めません: {error}"))?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("メモを置き換えられません: {error}"))?;
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .ok();
        Ok(())
    })();
    if result.is_err() {
        fs::remove_file(&temporary).ok();
    }
    result
}

#[tauri::command]
fn get_vault(state: State<'_, AppState>) -> Option<String> {
    state.0.lock().ok().and_then(|data| {
        data.vault
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned())
    })
}

#[tauri::command]
fn set_vault(path: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let vault = PathBuf::from(&path);
    if !vault.is_dir() {
        return Err("選択した保存先フォルダが存在しません".to_string());
    }
    store_settings(
        &app,
        &Settings {
            vault_path: Some(path),
        },
    )?;
    state
        .0
        .lock()
        .map_err(|_| "アプリ状態を更新できません".to_string())?
        .vault = Some(vault);
    Ok(())
}

#[tauri::command]
fn list_notes(state: State<'_, AppState>) -> Result<Vec<NoteSummary>, String> {
    scan_notes(&current_vault(&state)?)
}

#[tauri::command]
fn read_note(id: String, state: State<'_, AppState>) -> Result<NoteDocument, String> {
    document_from_path(&resolve_note(&current_vault(&state)?, &id)?)
}

#[tauri::command]
fn create_note(state: State<'_, AppState>) -> Result<NoteDocument, String> {
    let vault = current_vault(&state)?;
    let path = vault.join(format!("{}.txt", Uuid::new_v4()));
    atomic_write(&path, "無題\n")?;
    document_from_path(&path)
}

fn save_note_at_path(input: &SaveNoteInput, path: &Path) -> Result<SaveResult, String> {
    let current = document_from_path(path)?;
    if current.revision != input.expected_revision && input.overwrite != Some(true) {
        return Ok(SaveResult::Conflict { current });
    }
    let body = input.body.replace("\r\n", "\n");
    let title = input.title.replace(['\r', '\n'], " ");
    let content = format!("{title}\n{body}");
    if revision(&content) == current.revision {
        return Ok(SaveResult::Saved { note: current });
    }
    atomic_write(path, &content)?;
    Ok(SaveResult::Saved {
        note: document_from_path(path)?,
    })
}

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
    let parent = path
        .parent()
        .ok_or_else(|| "保存先が不正です".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("タグメモの保存先を作成できません: {error}"))?;
    atomic_write(path, &body)?;
    Ok(SaveTagMemoResult::Saved {
        memo: tag_memo_from_path(&input.tag, path)?,
    })
}

#[tauri::command]
fn save_note(input: SaveNoteInput, state: State<'_, AppState>) -> Result<SaveResult, String> {
    let path = resolve_note(&current_vault(&state)?, &input.id)?;
    save_note_at_path(&input, &path)
}

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

#[tauri::command]
fn delete_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let path = resolve_note(&current_vault(&state)?, &id)?;
    trash::delete(path).map_err(|error| format!("メモをゴミ箱へ移動できません: {error}"))
}

#[tauri::command]
fn search_tag(tag: String, state: State<'_, AppState>) -> Result<Vec<NoteSummary>, String> {
    let normalized = normalize_tag(tag.trim_start_matches('#'));
    Ok(scan_notes(&current_vault(&state)?)?
        .into_iter()
        .filter(|note| {
            note.tags
                .iter()
                .any(|candidate| candidate.normalized_name == normalized)
        })
        .collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Starts the Tauri desktop application.
///
/// # Panics
///
/// Panics when the Tauri runtime cannot be started.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let settings = load_settings(app.handle());
            app.manage(AppState(Mutex::new(AppData {
                vault: settings
                    .vault_path
                    .map(PathBuf::from)
                    .filter(|path| path.is_dir()),
            })));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_vault,
            set_vault,
            list_notes,
            read_note,
            create_note,
            save_note,
            read_tag_memo,
            save_tag_memo,
            delete_note,
            search_tag
        ])
        .run(tauri::generate_context!())
        .expect("error while running Synaplink");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{thread, time::Duration};

    #[test]
    fn extracts_supported_tags_and_stops_at_punctuation() {
        let tags = extract_tags("#りんご、#Red-Apple と #foo_bar。");
        assert_eq!(
            tags.iter()
                .map(|tag| tag.display_name.as_str())
                .collect::<Vec<_>>(),
            vec!["りんご", "Red-Apple", "foo_bar"]
        );
    }

    #[test]
    fn ignores_escaped_and_empty_tags() {
        let tags = extract_tags(r"\#りんご # #みかん");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].display_name, "みかん");
    }

    #[test]
    fn normalizes_width_and_ascii_case() {
        assert_eq!(normalize_tag("ＡＰＰＬＥ"), "apple");
    }

    #[test]
    fn writes_and_reads_a_plain_text_document() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.txt");
        atomic_write(&path, "題名\n本文 #タグ").unwrap();
        let note = document_from_path(&path).unwrap();
        assert_eq!(note.title, "題名");
        assert_eq!(note.body, "本文 #タグ");
        assert_eq!(note.tags[0].normalized_name, "タグ");
    }

    #[test]
    fn skips_writing_when_normalized_content_is_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.txt");
        atomic_write(&path, "題名 本文\n1行目\n2行目").unwrap();
        let original = document_from_path(&path).unwrap();
        thread::sleep(Duration::from_millis(10));

        let result = save_note_at_path(
            &SaveNoteInput {
                id: "note.txt".to_string(),
                title: "題名\r本文".to_string(),
                body: "1行目\r\n2行目".to_string(),
                expected_revision: original.revision.clone(),
                overwrite: None,
            },
            &path,
        )
        .unwrap();
        let SaveResult::Saved { note } = result else {
            panic!("同一内容の保存で競合が返されました");
        };

        assert_eq!(note.revision, original.revision);
        assert_eq!(note.modified_at, original.modified_at);
    }

    #[test]
    fn checks_for_conflicts_before_skipping_an_unchanged_write() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.txt");
        atomic_write(&path, "題名\n本文").unwrap();
        let current = document_from_path(&path).unwrap();

        let result = save_note_at_path(
            &SaveNoteInput {
                id: "note.txt".to_string(),
                title: current.title.clone(),
                body: current.body.clone(),
                expected_revision: "古いrevision".to_string(),
                overwrite: None,
            },
            &path,
        )
        .unwrap();
        let SaveResult::Conflict { current: conflict } = result else {
            panic!("古いrevisionで保存済みが返されました");
        };

        assert_eq!(conflict.revision, current.revision);
    }

    #[test]
    fn writes_when_content_changes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.txt");
        atomic_write(&path, "題名\n変更前").unwrap();
        let original = document_from_path(&path).unwrap();
        thread::sleep(Duration::from_millis(10));

        let result = save_note_at_path(
            &SaveNoteInput {
                id: "note.txt".to_string(),
                title: original.title.clone(),
                body: "変更後".to_string(),
                expected_revision: original.revision.clone(),
                overwrite: None,
            },
            &path,
        )
        .unwrap();
        let SaveResult::Saved { note } = result else {
            panic!("内容変更の保存で競合が返されました");
        };

        assert_ne!(note.revision, original.revision);
        assert!(note.modified_at > original.modified_at);
        assert_eq!(document_from_path(&path).unwrap().body, "変更後");
    }

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

    #[test]
    fn scan_notes_excludes_tag_memo_files() {
        let directory = tempfile::tempdir().unwrap();
        atomic_write(&directory.path().join("ordinary.txt"), "普通\n本文").unwrap();
        let tag_path = directory.path().join(".synaplink/tag-notes/tag.txt");
        fs::create_dir_all(tag_path.parent().unwrap()).unwrap();
        atomic_write(&tag_path, "タグ本文").unwrap();
        let notes = scan_notes(directory.path()).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, "ordinary.txt");
    }
}
