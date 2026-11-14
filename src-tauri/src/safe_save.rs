use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

use super::{document_from_path, revision, NoteDocument, SaveResult};

fn check_file_type(metadata: &fs::Metadata) -> Result<(), String> {
    if metadata.file_type().is_symlink() {
        return Err(
            "シンボリックリンクのメモは保存できません。通常ファイルへコピーして保存してください"
                .to_string(),
        );
    }
    if !metadata.is_file() {
        return Err("通常ファイル以外のメモは保存できません".to_string());
    }
    Ok(())
}

pub fn ensure_regular(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("メモの状態を取得できません: {error}"))?;
    check_file_type(&metadata)
}

fn recovery_error(message: &str, recovery: &Path) -> String {
    format!(
        "{message}。復旧用ファイルを削除せず残しました: {}",
        recovery.display()
    )
}

pub fn prepare(path: &Path, content: &str) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "保存先が不正です".to_string())?;
    let permissions = match fs::symlink_metadata(path) {
        Ok(metadata) => {
            check_file_type(&metadata)?;
            Some(metadata.permissions())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("メモのアクセス権限を取得できません: {error}")),
    };
    let temporary = parent.join(format!(
        ".{}.{}.recovery",
        path.file_name().unwrap_or_default().to_string_lossy(),
        Uuid::new_v4()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("一時ファイルを作成できません: {error}"))?;
    let result = (|| {
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)
                .map_err(|error| format!("メモのアクセス権限を設定できません: {error}"))?;
        }
        file.write_all(content.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|error| format!("メモを書き込めません: {error}"))
    })();
    if let Err(error) = result {
        return match fs::remove_file(&temporary) {
            Ok(()) => Err(error),
            Err(cleanup_error) if cleanup_error.kind() == io::ErrorKind::NotFound => Err(error),
            Err(cleanup_error) => Err(recovery_error(
                &format!("{error}。一時ファイルを削除できません: {cleanup_error}"),
                &temporary,
            )),
        };
    }
    Ok(temporary)
}

#[cfg(target_os = "macos")]
fn exchange(left: &Path, right: &Path) -> io::Result<()> {
    rustix::fs::renameat_with(
        rustix::fs::CWD,
        left,
        rustix::fs::CWD,
        right,
        rustix::fs::RenameFlags::EXCHANGE,
    )
    .map_err(io::Error::from)
}

#[cfg(not(target_os = "macos"))]
fn exchange(_left: &Path, _right: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "この環境ではメモの原子的な交換に対応していません",
    ))
}

fn read_current(path: &Path) -> Result<NoteDocument, String> {
    ensure_regular(path)?;
    document_from_path(path)
}

fn read_displaced(path: &Path) -> Result<String, String> {
    ensure_regular(path)?;
    fs::read_to_string(path).map_err(|error| format!("退避したメモを読み込めません: {error}"))
}

fn sync_parent(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "保存先が不正です".to_string())?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("保存先フォルダの変更を同期できません: {error}"))
}

fn remove_verified_copy(
    path: &Path,
    remove: &mut impl FnMut(&Path) -> io::Result<()>,
) -> Result<(), String> {
    remove(path)
        .map_err(|error| recovery_error(&format!("一時ファイルを削除できません: {error}"), path))
}

fn restore(
    path: &Path,
    temporary: &Path,
    saved_revision: &str,
    swap: &mut impl FnMut(&Path, &Path) -> io::Result<()>,
    remove: &mut impl FnMut(&Path) -> io::Result<()>,
    read_error: Option<&str>,
) -> Result<SaveResult, String> {
    let current = read_current(path).map_err(|error| recovery_error(&error, temporary))?;
    if current.revision != saved_revision {
        return Err(recovery_error(
            "保存中に追加の外部変更を検出したため、復元を中断しました",
            temporary,
        ));
    }
    swap(temporary, path).map_err(|error| {
        recovery_error(
            &format!("外部の変更を元の場所へ戻せません: {error}"),
            temporary,
        )
    })?;
    sync_parent(path).map_err(|error| recovery_error(&error, temporary))?;
    if let Some(error) = read_error {
        return Err(recovery_error(error, temporary));
    }
    let current = read_current(path).map_err(|error| recovery_error(&error, temporary))?;
    let replaced = read_displaced(temporary).map_err(|error| recovery_error(&error, temporary))?;
    if revision(&replaced) != saved_revision {
        return Err(recovery_error(
            "復元中に追加の外部変更を検出したため、退避内容を保持しました",
            temporary,
        ));
    }
    remove_verified_copy(temporary, remove)?;
    Ok(SaveResult::Conflict { current })
}

fn replace_with(
    path: &Path,
    content: &str,
    expected_revision: &str,
    swap: &mut impl FnMut(&Path, &Path) -> io::Result<()>,
    remove: &mut impl FnMut(&Path) -> io::Result<()>,
) -> Result<SaveResult, String> {
    let temporary = prepare(path, content)?;
    swap(&temporary, path).map_err(|error| {
        recovery_error(
            &format!("メモを原子的に交換できません: {error}"),
            &temporary,
        )
    })?;
    sync_parent(path).map_err(|error| recovery_error(&error, &temporary))?;
    let saved_revision = revision(content);
    match read_displaced(&temporary) {
        Ok(displaced) if revision(&displaced) == expected_revision => {
            let note = read_current(path).map_err(|error| recovery_error(&error, &temporary))?;
            remove_verified_copy(&temporary, remove)?;
            if note.revision == saved_revision {
                Ok(SaveResult::Saved { note })
            } else {
                Ok(SaveResult::Conflict { current: note })
            }
        }
        Ok(_) => restore(path, &temporary, &saved_revision, swap, remove, None),
        Err(error) => restore(
            path,
            &temporary,
            &saved_revision,
            swap,
            remove,
            Some(&error),
        ),
    }
}

pub fn replace(path: &Path, content: &str, expected_revision: &str) -> Result<SaveResult, String> {
    replace_with(
        path,
        content,
        expected_revision,
        &mut exchange,
        &mut |temporary| fs::remove_file(temporary),
    )
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::{save_note_at_path, SaveNoteInput};

    const ORIGINAL: &str = "題名\n変更前";
    const LOCAL: &str = "題名\nローカルの編集";
    const EXTERNAL: &str = "題名\n外部の編集";
    const THIRD: &str = "題名\nさらに外部の編集";

    fn original() -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.txt");
        fs::write(&path, ORIGINAL).unwrap();
        (directory, path)
    }

    fn recovery_paths(directory: &Path) -> Vec<PathBuf> {
        fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension == "recovery")
            })
            .collect()
    }

    fn with_swap(
        path: &Path,
        swap: &mut impl FnMut(&Path, &Path) -> io::Result<()>,
    ) -> Result<SaveResult, String> {
        replace_with(path, LOCAL, &revision(ORIGINAL), swap, &mut |temporary| {
            fs::remove_file(temporary)
        })
    }

    #[test]
    fn restores_an_external_write_completed_before_exchange_as_a_conflict() {
        let (directory, path) = original();
        let mut swaps = 0;
        let result = with_swap(&path, &mut |temporary, destination| {
            swaps += 1;
            if swaps == 1 {
                fs::write(destination, EXTERNAL)?;
            }
            exchange(temporary, destination)
        })
        .unwrap();

        let SaveResult::Conflict { current } = result else {
            panic!("外部の編集が保存成功として上書きされました");
        };
        assert_eq!(swaps, 2);
        assert_eq!(current.id, "note.txt");
        assert_eq!(current.body, "外部の編集");
        assert_eq!(current.revision, revision(EXTERNAL));
        assert_eq!(fs::read_to_string(&path).unwrap(), EXTERNAL);
        assert_eq!(recovery_paths(directory.path()), Vec::<PathBuf>::new());
    }

    #[test]
    fn successful_saves_do_not_accumulate_recovery_files() {
        let (directory, path) = original();
        let mut expected = revision(ORIGINAL);
        for content in [LOCAL, EXTERNAL, THIRD] {
            let result = replace(&path, content, &expected).unwrap();
            let SaveResult::Saved { note } = result else {
                panic!("競合のない保存が失敗しました");
            };
            assert_eq!(note.id, "note.txt");
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
            assert_eq!(recovery_paths(directory.path()), Vec::<PathBuf>::new());
            expected = note.revision;
        }
    }

    #[test]
    fn reports_a_later_active_write_as_a_conflict_without_restoring_an_older_version() {
        let (directory, path) = original();
        let result = with_swap(&path, &mut |temporary, destination| {
            exchange(temporary, destination)?;
            fs::write(destination, THIRD)
        })
        .unwrap();

        let SaveResult::Conflict { current } = result else {
            panic!("保存後に入った外部の変更を検出できませんでした");
        };
        assert_eq!(current.id, "note.txt");
        assert_eq!(current.revision, revision(THIRD));
        assert_eq!(fs::read_to_string(&path).unwrap(), THIRD);
        assert_eq!(recovery_paths(directory.path()), Vec::<PathBuf>::new());
    }

    #[test]
    fn explicit_overwrite_keeps_its_existing_revision_semantics() {
        let (directory, path) = original();
        let input = SaveNoteInput {
            id: "note.txt".to_string(),
            title: "題名".to_string(),
            body: "ローカルの編集".to_string(),
            expected_revision: "以前の競合".to_string(),
            overwrite: Some(true),
        };
        let result = save_note_at_path(&input, &path).unwrap();

        let SaveResult::Saved { note } = result else {
            panic!("明示的な上書きが拒否されました");
        };
        assert_eq!(note.id, "note.txt");
        assert_eq!(fs::read_to_string(&path).unwrap(), LOCAL);
        assert_eq!(recovery_paths(directory.path()), Vec::<PathBuf>::new());
    }

    #[test]
    fn retains_additional_external_writes_before_or_during_rollback() {
        for during_rollback in [false, true] {
            let (directory, path) = original();
            let mut swaps = 0;
            let result = with_swap(&path, &mut |temporary, destination| {
                swaps += 1;
                if swaps == 1 {
                    fs::write(destination, EXTERNAL)?;
                } else if during_rollback {
                    fs::write(destination, THIRD)?;
                }
                exchange(temporary, destination)?;
                if swaps == 1 && !during_rollback {
                    fs::write(destination, THIRD)?;
                }
                Ok(())
            });

            let error = result.unwrap_err();
            let recoveries = recovery_paths(directory.path());
            assert_eq!(recoveries.len(), 1);
            assert!(error.contains(&recoveries[0].display().to_string()));
            let (active, retained) = if during_rollback {
                (EXTERNAL, THIRD)
            } else {
                (THIRD, EXTERNAL)
            };
            assert_eq!(fs::read_to_string(&path).unwrap(), active);
            assert_eq!(fs::read_to_string(&recoveries[0]).unwrap(), retained);
        }
    }

    #[test]
    fn retains_the_external_version_if_rollback_fails() {
        let (directory, path) = original();
        let mut swaps = 0;
        let result = with_swap(&path, &mut |temporary, destination| {
            swaps += 1;
            if swaps == 1 {
                fs::write(destination, EXTERNAL)?;
                exchange(temporary, destination)
            } else {
                Err(io::Error::other("rollback failed"))
            }
        });

        let error = result.unwrap_err();
        let recoveries = recovery_paths(directory.path());
        assert_eq!(recoveries.len(), 1);
        assert!(error.contains(&recoveries[0].display().to_string()));
        assert_eq!(fs::read_to_string(&path).unwrap(), LOCAL);
        assert_eq!(fs::read_to_string(&recoveries[0]).unwrap(), EXTERNAL);
    }

    #[test]
    fn unsupported_exchange_never_falls_back_to_rename() {
        let (directory, path) = original();
        let result = with_swap(&path, &mut |_, _| {
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "unsupported filesystem",
            ))
        });

        let error = result.unwrap_err();
        let recoveries = recovery_paths(directory.path());
        assert_eq!(recoveries.len(), 1);
        assert!(error.contains(&recoveries[0].display().to_string()));
        assert_eq!(fs::read_to_string(&path).unwrap(), ORIGINAL);
        assert_eq!(fs::read_to_string(&recoveries[0]).unwrap(), LOCAL);
    }

    #[test]
    fn invalid_utf8_displaced_during_save_is_restored_without_deleting_the_draft() {
        let (directory, path) = original();
        let mut swaps = 0;
        let result = with_swap(&path, &mut |temporary, destination| {
            swaps += 1;
            if swaps == 1 {
                fs::write(destination, [0xff])?;
            }
            exchange(temporary, destination)
        });

        let error = result.unwrap_err();
        let recoveries = recovery_paths(directory.path());
        assert_eq!(recoveries.len(), 1);
        assert!(error.contains(&recoveries[0].display().to_string()));
        assert_eq!(fs::read(&path).unwrap(), [0xff]);
        assert_eq!(fs::read_to_string(&recoveries[0]).unwrap(), LOCAL);
    }

    #[test]
    fn retains_displaced_content_if_the_active_file_cannot_be_read() {
        let (directory, path) = original();
        let result = with_swap(&path, &mut |temporary, destination| {
            exchange(temporary, destination)?;
            fs::write(destination, [0xff])
        });

        let error = result.unwrap_err();
        let recoveries = recovery_paths(directory.path());
        assert_eq!(recoveries.len(), 1);
        assert!(error.contains(&recoveries[0].display().to_string()));
        assert_eq!(fs::read(&path).unwrap(), [0xff]);
        assert_eq!(fs::read_to_string(&recoveries[0]).unwrap(), ORIGINAL);
    }

    #[test]
    fn cleanup_failure_keeps_and_reports_the_displaced_file() {
        let (directory, path) = original();
        let result = replace_with(
            &path,
            LOCAL,
            &revision(ORIGINAL),
            &mut exchange,
            &mut |_| Err(io::Error::other("cleanup failed")),
        );

        let error = result.unwrap_err();
        let recoveries = recovery_paths(directory.path());
        assert_eq!(recoveries.len(), 1);
        assert!(error.contains(&recoveries[0].display().to_string()));
        assert_eq!(fs::read_to_string(&path).unwrap(), LOCAL);
        assert_eq!(fs::read_to_string(&recoveries[0]).unwrap(), ORIGINAL);
        let notes = crate::scan_notes(directory.path()).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, "note.txt");
    }

    #[test]
    fn rejects_a_symlink_without_changing_the_link_or_its_target() {
        use std::os::unix::fs::symlink;

        let (directory, target) = original();
        let path = directory.path().join("link.txt");
        symlink(&target, &path).unwrap();
        let input = SaveNoteInput {
            id: "link.txt".to_string(),
            title: "題名".to_string(),
            body: "編集".to_string(),
            expected_revision: revision(ORIGINAL),
            overwrite: None,
        };

        assert!(save_note_at_path(&input, &path).is_err());
        assert!(fs::symlink_metadata(&path).unwrap().is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), ORIGINAL);
        assert_eq!(recovery_paths(directory.path()), Vec::<PathBuf>::new());
    }

    #[test]
    fn restores_a_symlink_inserted_after_the_initial_read_without_touching_its_target() {
        use std::os::unix::fs::symlink;

        let (directory, path) = original();
        let target = directory.path().join("outside.txt");
        fs::write(&target, EXTERNAL).unwrap();
        let mut swaps = 0;
        let result = with_swap(&path, &mut |temporary, destination| {
            swaps += 1;
            if swaps == 1 {
                fs::remove_file(destination)?;
                symlink(&target, destination)?;
            }
            exchange(temporary, destination)
        });

        let error = result.unwrap_err();
        let recoveries = recovery_paths(directory.path());
        assert_eq!(recoveries.len(), 1);
        assert!(error.contains(&recoveries[0].display().to_string()));
        assert!(fs::symlink_metadata(&path).unwrap().is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), EXTERNAL);
        assert_eq!(fs::read_to_string(&recoveries[0]).unwrap(), LOCAL);
    }
}
