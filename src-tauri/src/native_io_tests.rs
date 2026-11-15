//! Opt-in probes against macOS permission enforcement, without a webview or IPC mock.
use super::*;
use std::{io, os::unix::fs::PermissionsExt, process::Command};

struct RestorePermissions {
    path: PathBuf,
    permissions: fs::Permissions,
}

impl RestorePermissions {
    fn set(path: &Path, mode: u32) -> Self {
        let permissions = fs::metadata(path).unwrap().permissions();
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
        Self {
            path: path.to_path_buf(),
            permissions,
        }
    }
}

impl Drop for RestorePermissions {
    fn drop(&mut self) {
        // Restore before TempDir cleanup, including when an assertion unwinds.
        let _ = fs::set_permissions(&self.path, self.permissions.clone());
    }
}

fn require_non_root() {
    let output = Command::new("/usr/bin/id").arg("-u").output().unwrap();
    assert!(output.status.success());
    assert_ne!(String::from_utf8(output.stdout).unwrap().trim(), "0");
}

fn input_for(note: &NoteDocument) -> SaveNoteInput {
    SaveNoteInput {
        id: note.id.clone(),
        title: note.title.clone(),
        body: "保存する本文".to_string(),
        expected_revision: note.revision.clone(),
        overwrite: None,
    }
}

#[test]
#[ignore = "requires macOS file permissions under a non-root user; run explicitly"]
fn native_io_denied_read_is_reported_and_can_be_retried() {
    require_non_root();
    let directory = tempfile::tempdir().unwrap();
    let valid = directory.path().join("valid.txt");
    let denied = directory.path().join("denied.txt");
    fs::write(&valid, "正常なメモ\n読める本文").unwrap();
    fs::write(&denied, "拒否するメモ\n保持する本文").unwrap();
    {
        let _permissions = RestorePermissions::set(&denied, 0o000);
        assert_eq!(
            fs::read(&denied).unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
        let result = scan_notes(directory.path()).unwrap();
        assert_eq!(result.notes.len(), 1);
        assert_eq!(result.notes[0].id, "valid.txt");
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].path, denied.to_string_lossy());
        assert!(result.issues[0]
            .message
            .contains("Permission denied (os error 13)"));
    }
    let retried = scan_notes(directory.path()).unwrap();
    assert_eq!(retried.notes.len(), 2);
    assert_eq!(retried.issues.len(), 0);
    assert_eq!(
        fs::read_to_string(&valid).unwrap(),
        "正常なメモ\n読める本文"
    );
    assert_eq!(
        fs::read_to_string(&denied).unwrap(),
        "拒否するメモ\n保持する本文"
    );
}

#[test]
#[ignore = "requires macOS file permissions under a non-root user; run explicitly"]
fn native_io_denied_save_keeps_bytes_and_succeeds_after_permissions_restore() {
    require_non_root();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("note.txt");
    fs::write(&path, "題名\n保存前の本文").unwrap();
    let original = document_from_path(&path).unwrap();
    let input = input_for(&original);
    {
        let _permissions = RestorePermissions::set(&path, 0o000);
        assert_eq!(
            fs::read(&path).unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
        let error = save_note_at_path(&input, &path).unwrap_err();
        assert!(error.contains("Permission denied (os error 13)"));
    }
    assert_eq!(fs::read_to_string(&path).unwrap(), "題名\n保存前の本文");
    let retried = save_note_at_path(&input, &path).unwrap();
    assert!(matches!(retried, SaveResult::Saved { .. }));
    assert_eq!(fs::read_to_string(&path).unwrap(), "題名\n保存する本文");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
#[ignore = "requires macOS file permissions under a non-root user; run explicitly"]
fn native_io_denied_directory_write_keeps_original_and_leaves_no_temporary_file() {
    require_non_root();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("note.txt");
    fs::write(&path, "題名\n保存前の本文").unwrap();
    let original = document_from_path(&path).unwrap();
    let input = input_for(&original);
    {
        let _permissions = RestorePermissions::set(directory.path(), 0o500);
        let probe = directory.path().join("permission-probe");
        assert_eq!(
            fs::write(&probe, "probe").unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
        let error = save_note_at_path(&input, &path).unwrap_err();
        assert!(error.contains("一時ファイルを作成できません: Permission denied (os error 13)"));
        assert_eq!(scan_notes(directory.path()).unwrap().notes.len(), 1);
        assert_eq!(fs::read_to_string(&path).unwrap(), "題名\n保存前の本文");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
    assert!(matches!(
        save_note_at_path(&input, &path).unwrap(),
        SaveResult::Saved { .. }
    ));
    assert_eq!(fs::read_to_string(&path).unwrap(), "題名\n保存する本文");
}

#[test]
#[ignore = "requires macOS file permissions under a non-root user; run explicitly"]
fn native_io_denied_vault_returns_a_whole_error_and_recovers() {
    require_non_root();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("note.txt");
    fs::write(&path, "題名\n保持する本文").unwrap();
    {
        let _permissions = RestorePermissions::set(directory.path(), 0o000);
        assert_eq!(
            fs::read_dir(directory.path()).unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
        let error = scan_notes(directory.path()).unwrap_err();
        assert!(error.contains("保存先フォルダを読み込めません: Permission denied (os error 13)"));
    }
    let retried = scan_notes(directory.path()).unwrap();
    assert_eq!(retried.notes.len(), 1);
    assert_eq!(retried.issues.len(), 0);
    assert_eq!(fs::read_to_string(&path).unwrap(), "題名\n保持する本文");
}

#[test]
#[ignore = "requires macOS LaunchServices and Swift; run explicitly without a registered handler"]
fn native_io_unregistered_scheme_returns_an_os_error_without_a_browser() {
    require_non_root();
    let scheme = format!("synaplink-native-io-{}", Uuid::new_v4().simple());
    let cache = tempfile::tempdir().unwrap();
    let script = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../docs/investigations/2026-11-15/native-io/url-handler.swift");
    let query = Command::new("/usr/bin/swift")
        .arg("-module-cache-path")
        .arg(cache.path())
        .arg(script)
        .arg(&scheme)
        .output()
        .unwrap();
    assert!(
        query.status.success(),
        "{}",
        String::from_utf8_lossy(&query.stderr)
    );
    assert_eq!(
        String::from_utf8(query.stdout).unwrap().trim(),
        "unregistered"
    );
    let error =
        tauri_plugin_opener::open_url(format!("{scheme}://probe"), None::<&str>).unwrap_err();
    assert!(matches!(error, tauri_plugin_opener::Error::Io(_)));
}
