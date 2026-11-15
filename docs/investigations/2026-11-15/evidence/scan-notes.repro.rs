use super::*;
#[test]
fn invalid_utf8_is_still_omitted_from_successful_scan() {
    let vault = tempfile::tempdir().unwrap();
    fs::write(vault.path().join("valid.txt"), "title\nbody").unwrap();
    fs::write(vault.path().join("invalid.txt"), [0xff]).unwrap();
    let notes = scan_notes(vault.path()).unwrap();
    println!("input_files=2 scan_result=Ok returned_notes={} returned_id={}", notes.len(), notes[0].id);
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].id, "valid.txt");
}
