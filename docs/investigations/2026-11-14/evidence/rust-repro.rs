#[cfg(test)]
mod audit_tests {
    use super::*;
    use std::{os::unix::fs::PermissionsExt, thread, time::Duration};
    #[test]
    fn existing_permissions_change_on_save() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("secret.txt");
        fs::write(&p, "title\nold").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).unwrap();
        atomic_write(&p, "title\nnew").unwrap();
        let actual = fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        println!("permission_after_save={actual:o}");
        assert_ne!(actual, 0o600);
    }
    #[test]
    fn invalid_utf8_note_silently_disappears() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("valid.txt"), "title\nbody").unwrap();
        fs::write(d.path().join("invalid.txt"), [0xff]).unwrap();
        let notes = scan_notes(d.path()).unwrap();
        assert_eq!(notes.len(), 1);
        println!("scan_ok=true files=2 visible_notes={}", notes.len());
    }
    #[test]
    fn external_write_during_atomic_save_is_lost() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("note.txt");
        fs::write(&p, "title\noriginal").unwrap();
        let original = document_from_path(&p).unwrap();
        let watcher_dir = d.path().to_path_buf();
        let watcher_path = p.clone();
        let handle = thread::spawn(move || {
            for _ in 0..10000 {
                if fs::read_dir(&watcher_dir)
                    .unwrap()
                    .filter_map(Result::ok)
                    .any(|x| x.file_name().to_string_lossy().ends_with(".tmp"))
                {
                    fs::write(&watcher_path, "title\nEXTERNAL EDIT").unwrap();
                    return true;
                }
                thread::sleep(Duration::from_micros(100));
            }
            false
        });
        let result = save_note_at_path(
            &SaveNoteInput {
                id: "note.txt".into(),
                title: "title".into(),
                body: "x".repeat(32 * 1024 * 1024),
                expected_revision: original.revision,
                overwrite: None,
            },
            &p,
        )
        .unwrap();
        assert!(handle.join().unwrap());
        assert!(matches!(result, SaveResult::Saved { .. }));
        assert!(!fs::read_to_string(&p).unwrap().contains("EXTERNAL EDIT"));
        println!("external_edit_written=true conflict_reported=false external_edit_retained=false");
    }
}

#[cfg(test)]
mod additional_audit_tests {
    use super::*;
    use std::time::Instant;
    #[test]
    fn scan_notes_timing() {
        for count in [1000, 5000] {
            let d = tempfile::tempdir().unwrap();
            let data = format!("title\n{}", "x".repeat(1018));
            for n in 0..count {
                fs::write(d.path().join(format!("{n}.txt")), &data).unwrap();
            }
            let start = Instant::now();
            let notes = scan_notes(d.path()).unwrap();
            let elapsed = start.elapsed();
            println!(
                "scan_files={count} bytes_per_file={} visible={} elapsed_ms={:.3}",
                data.len(),
                notes.len(),
                elapsed.as_secs_f64() * 1000.0
            );
        }
    }
    #[test]
    fn external_deletion_blocks_even_forced_save() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("note.txt");
        fs::write(&p, "title\noriginal").unwrap();
        let original = document_from_path(&p).unwrap();
        fs::remove_file(&p).unwrap();
        let result = save_note_at_path(
            &SaveNoteInput {
                id: "note.txt".into(),
                title: "title".into(),
                body: "unsaved draft".into(),
                expected_revision: original.revision,
                overwrite: Some(true),
            },
            &p,
        );
        assert!(result.is_err());
        assert!(!p.exists());
        println!("external_deletion_force_save={:?}", result.err());
    }
    #[test]
    fn symlink_note_save_replaces_link_not_target() {
        use std::os::unix::fs::symlink;
        let d = tempfile::tempdir().unwrap();
        let target = d.path().join("outside.txt");
        fs::write(&target, "title\noriginal").unwrap();
        let vault = d.path().join("vault");
        fs::create_dir(&vault).unwrap();
        let p = vault.join("note.txt");
        symlink(&target, &p).unwrap();
        let original = document_from_path(&p).unwrap();
        let visible = scan_notes(&vault).unwrap();
        assert_eq!(visible.len(), 1);
        let result = save_note_at_path(
            &SaveNoteInput {
                id: "note.txt".into(),
                title: "title".into(),
                body: "draft".into(),
                expected_revision: original.revision,
                overwrite: None,
            },
            &p,
        )
        .unwrap();
        assert!(matches!(result, SaveResult::Saved { .. }));
        assert!(!fs::symlink_metadata(&p).unwrap().is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), "title\noriginal");
        println!("symlink_visible=true save_replaces_symlink=true external_target_unchanged=true");
    }
}

#[cfg(test)]
mod malformed_link_perf {
    use super::*;
    use std::time::Instant;
    #[test]
    fn timing() {
        for count in [10000, 20000, 40000, 80000] {
            let data = "[[x\n".repeat(count);
            let start = Instant::now();
            let links = extract_links(&data);
            println!(
                "malformed_lines={count} bytes={} links={} elapsed_ms={:.3}",
                data.len(),
                links.len(),
                start.elapsed().as_secs_f64() * 1000.0
            );
        }
    }
}
