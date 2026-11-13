"""Generate an isolated reproduction crate from the measured source snapshot."""
import argparse
import hashlib
from pathlib import Path
import shutil

evidence = Path(__file__).resolve().parent
repository = evidence.parents[3]
source = (repository / 'src-tauri/src/lib.rs').read_text()
expected_sha256 = '450cc62c4b94fbc14ab6dfe8cb7093aa5657918741df929259ebe621a14e4349'
if hashlib.sha256(source.encode()).hexdigest() != expected_sha256:
    raise SystemExit('Source differs from the measured snapshot; do not reuse the recorded results.')

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
output = parser.parse_args().output
output.mkdir(parents=True, exist_ok=False)
(output / 'src').mkdir()

def declaration(marker, derived=False):
    start = source.index(marker)
    if derived:
        start = source.rindex('#[derive', 0, start)
    end = source.index('\n}', start) + 2
    return source[start:end]

chunks = [
    'use serde::{Deserialize, Serialize};',
    'use sha2::{Digest, Sha256};',
    'use std::{collections::BTreeSet, fs::{self, File, OpenOptions}, io::Write, path::{Path, PathBuf}, time::UNIX_EPOCH};',
    'use unicode_normalization::UnicodeNormalization;',
    'use uuid::Uuid;',
]
for kind, name in [
    ('struct', 'LinkReference'), ('struct', 'NoteSummary'),
    ('struct', 'NoteDocument'), ('struct', 'SaveNoteInput'), ('enum', 'SaveResult'),
]:
    chunks.append(declaration(f'pub {kind} {name}', derived=True))
for name in [
    'normalize_link', 'extract_links', 'unique_links', 'revision',
    'modified_at', 'split_document', 'document_from_path',
    'summary_from_document', 'scan_notes', 'atomic_write', 'save_note_at_path',
]:
    chunks.append(declaration(f'fn {name}('))
chunks.append((evidence / 'rust-repro.rs').read_text())
(output / 'src/lib.rs').write_text('\n\n'.join(chunks) + '\n')
for name in ['Cargo.toml', 'Cargo.lock']:
    shutil.copyfile(evidence / name, output / name)
print(f'crate={output}')
print(f'source_sha256={expected_sha256}')
