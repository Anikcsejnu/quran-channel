#!/usr/bin/env node
// Moves videos rendered before the Videos/Shorts folder layout into it:
//   output/113_1-5_alafasy_long.mp4          → output/Videos/113 - Al-Falaq/113_1-5_alafasy.mp4
//   output/112_Al-Ikhlas_shorts/112_1.mp4     → output/Shorts/112 - Al-Ikhlas/112_1.mp4
// The .title.txt and .description.txt files move with each video. Nothing is overwritten.
//
//   node organize-output.js            # show what would move
//   node organize-output.js --apply    # move the files

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'output');
const apply = process.argv.includes('--apply');

// Surah names from the cached Quran.com chapter list (written by the Studio) or per-chapter cache files
function surahName(n) {
  const list = path.join(ROOT, 'cache', 'api', 'chapters.json');
  if (fs.existsSync(list)) {
    const c = JSON.parse(fs.readFileSync(list, 'utf8')).chapters.find(x => x.id === n);
    if (c) return c.name_simple;
  }
  const one = path.join(ROOT, 'cache', 'api', `chapter-${n}.json`);
  if (fs.existsSync(one)) return JSON.parse(fs.readFileSync(one, 'utf8')).chapter.name_simple;
  return `Surah ${n}`;
}

const folder = (n, short) => path.join(OUT, short ? 'Shorts' : 'Videos',
  `${String(n).padStart(3, '0')} - ${surahName(n).replace(/[<>:"/\\|?*]/g, '')}`);

const moves = [];

// Single videos in the root of output/
for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
  const m = /^(\d{3})_(\d+-\d+)_([\w-]+)_(long|short)\.mp4$/.exec(f);
  if (m) moves.push([path.join(OUT, f), path.join(folder(+m[1], m[4] === 'short'), `${m[1]}_${m[2]}_${m[3]}.mp4`)]);
}

// Old batch folders: output/<NNN>_<Name>_shorts/
for (const d of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
  const m = /^(\d{3})_.+_shorts$/.exec(d);
  if (!m || !fs.statSync(path.join(OUT, d)).isDirectory()) continue;
  for (const f of fs.readdirSync(path.join(OUT, d)).filter(x => x.endsWith('.mp4'))) {
    moves.push([path.join(OUT, d, f), path.join(folder(+m[1], true), f)]);
  }
}

if (!moves.length) {
  console.log('Nothing to organise — output/ already uses the Videos/Shorts layout.');
  process.exit(0);
}

const rel = p => path.relative(ROOT, p);
let moved = 0;
for (const [from, to] of moves) {
  if (fs.existsSync(to)) { console.log(`  skip (already exists): ${rel(to)}`); continue; }
  console.log(`  ${rel(from)}  →  ${rel(to)}`);
  if (!apply) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  for (const ext of ['.mp4', '.title.txt', '.description.txt']) {
    const a = from.replace(/\.mp4$/, ext), b = to.replace(/\.mp4$/, ext);
    if (fs.existsSync(a)) fs.renameSync(a, b);
  }
  moved++;
}

if (apply) {
  // Remove old batch folders left empty
  for (const d of fs.readdirSync(OUT)) {
    const p = path.join(OUT, d);
    if (/_shorts$/.test(d) && fs.statSync(p).isDirectory() && !fs.readdirSync(p).length) fs.rmdirSync(p);
  }
  console.log(`\n✓ Moved ${moved} video${moved === 1 ? '' : 's'}.`);
} else {
  console.log('\nDry run. Run with --apply to move these files.');
}
