import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[4]
work = Path(tempfile.mkdtemp(prefix='synaplink-parser-compare-'))
evidence = repo / 'docs/investigations/2026-11-14/evidence'
base = '7ac94be'
rows = []
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
output = parser.parse_args().output
assert subprocess.check_output(['node', '--version'], text=True).strip() == 'v26.7.0', 'Use Node.js 26.7.0 for this comparison'

def function(source, name):
    start = source.index(f'fn {name}(')
    return source[start:source.index('\n}', start)+2]

for variant in ['before', 'after']:
    rust = subprocess.check_output(['git', 'show', f'{base}:src-tauri/src/lib.rs'], cwd=repo, text=True) if variant == 'before' else (repo/'src-tauri/src/lib.rs').read_text()
    js = subprocess.check_output(['git', 'show', f'{base}:src/link-parser.ts'], cwd=repo, text=True) if variant == 'before' else (repo/'src/link-parser.ts').read_text()
    module = work / f'{variant}.ts'
    module.write_text(js)
    crate = work / variant
    (crate/'src').mkdir(parents=True)
    for name in ['Cargo.toml','Cargo.lock']:
        shutil.copyfile(evidence/name, crate/name)
    program = '''use unicode_normalization::UnicodeNormalization;
#[derive(Debug)]
struct LinkReference { normalized_name: String, display_name: String }
''' + function(rust, 'normalize_link') + '\n' + function(rust, 'extract_links') + '''
fn main() {
    let variant = std::env::args().nth(1).unwrap();
    for lines in [10000, 20000, 40000, 80000] {
        let input = "[[x\\n".repeat(lines);
        for sample in 1..=3 {
            let start = std::time::Instant::now();
            let links = std::hint::black_box(extract_links(std::hint::black_box(&input))).len();
            let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
            println!("{{\\"language\\":\\"rust\\",\\"variant\\":\\"{}\\",\\"lines\\":{},\\"bytes\\":{},\\"sample\\":{},\\"links\\":{},\\"elapsedMs\\":{:.6}}}", variant, lines, input.len(), sample, links, elapsed_ms);
        }
    }
}
'''
    (crate/'src/main.rs').write_text(program)
    env = dict(os.environ, CARGO_TARGET_DIR=str(work/'target'))
    subprocess.run(['cargo','build','--locked','--offline','--release','--manifest-path',str(crate/'Cargo.toml')],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    raw = subprocess.check_output([str(work/'target/release/synaplink-rust-audit'),variant],text=True)
    rows.extend(json.loads(line) for line in raw.splitlines())
    node_program = '''const {parseLinks}=await import(process.argv[1]); const variant=process.argv[2]; for(const lines of [10000,20000,40000,80000]) { const input="[[x\\n".repeat(lines); for(let sample=1;sample<=3;sample+=1){const start=performance.now(); const links=parseLinks(input).length; console.log(JSON.stringify({language:"javascript",variant,lines,bytes:input.length,sample,links,elapsedMs:performance.now()-start}));}}'''
    raw = subprocess.check_output(['node','--input-type=module','-e',node_program,module.as_uri(),variant],text=True)
    rows.extend(json.loads(line) for line in raw.splitlines())

output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(''.join(json.dumps(row,separators=(',',':'))+'\n' for row in rows))
print(f'workspace={work}')
from statistics import median
for language in ['rust','javascript']:
    for lines in [10000,20000,40000,80000]:
        print(language,lines,[(variant,round(median(row['elapsedMs'] for row in rows if row['language']==language and row['variant']==variant and row['lines']==lines),6)) for variant in ['before','after']])
