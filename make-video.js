#!/usr/bin/env node
// Quran video maker: Arabic (word-by-word highlighted) + English + Bangla captions synced to recitation,
// with branded intro/outro, channel watermark, background video reels and a batch Shorts mode.
// Run without arguments for usage.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const CACHE = path.join(ROOT, 'cache');
const FONTS = path.join(ROOT, 'fonts');
const OUT = path.join(ROOT, 'output');

// qdc = Quran.com chapter recitation id (gapless audio + word timings); ea = EveryAyah.com folder (verse audio only)
const RECITERS = {
  alafasy:               { name: 'Mishary Rashid Alafasy', qdc: 7, ea: 'Alafasy_128kbps' },
  abdulbasit:            { name: 'Abdul Basit Abdus Samad', qdc: 2, ea: 'Abdul_Basit_Murattal_192kbps' },
  'abdulbasit-mujawwad': { name: 'Abdul Basit Abdus Samad (Mujawwad)', qdc: 1 },
  sudais:                { name: 'Abdur-Rahman as-Sudais', qdc: 3, ea: 'Abdurrahmaan_As-Sudais_192kbps' },
  shatri:                { name: 'Abu Bakr al-Shatri', qdc: 4 },
  rifai:                 { name: 'Hani ar-Rifai', qdc: 5 },
  husary:                { name: 'Mahmoud Khalil al-Husary', qdc: 6 },
  minshawy:              { name: 'Mohamed Siddiq al-Minshawi', qdc: 9, ea: 'Minshawy_Murattal_128kbps' },
  'minshawy-mujawwad':   { name: 'Mohamed Siddiq al-Minshawi (Mujawwad)', qdc: 8 },
  shuraym:               { name: "Sa'ud ash-Shuraym", qdc: 10, ea: 'Saood_ash-Shuraym_128kbps' },
  maher:                 { name: 'Maher al-Muaiqly', ea: 'MaherAlMuaiqly128kbps' },
  dossary:               { name: 'Yasser ad-Dossary', ea: 'Yasser_Ad-Dussary_128kbps' },
};

// Quran.com translation resource ids
const TRANSLATIONS = {
  en: { saheeh: 20, haleem: 85, usmani: 84, yusufali: 22 },
  bn: { taisirul: 161, mujibur: 163, rawai: 162, zakaria: 213 },
};

const TRANSLATION_NAMES = {
  saheeh: 'Saheeh International', haleem: 'M.A.S. Abdel Haleem', usmani: 'Mufti Taqi Usmani', yusufali: 'Abdullah Yusuf Ali',
  taisirul: 'Taisirul Quran', mujibur: 'Sheikh Mujibur Rahman', rawai: 'Rawai Al-bayan', zakaria: 'Dr. Abu Bakr Muhammad Zakaria',
};

const FONT_FILES = {
  'AmiriQuran-Regular.ttf': 'ofl/amiriquran/AmiriQuran-Regular.ttf',
  'HindSiliguri-Regular.ttf': 'ofl/hindsiliguri/HindSiliguri-Regular.ttf',
  'Poppins-Regular.ttf': 'ofl/poppins/Poppins-Regular.ttf',
  'Poppins-SemiBold.ttf': 'ofl/poppins/Poppins-SemiBold.ttf',
};

const FORMATS = {
  // fill = share of the frame height the verse block may use (Shorts keep clear of YouTube's on-screen buttons)
  long:  { w: 1920, h: 1080, orientation: 'landscape', ar: 112, en: 44, bn: 48, header: 34, margin: 160, fill: 0.8, ui: 1 },
  short: { w: 1080, h: 1920, orientation: 'portrait',  ar: 128, en: 54, bn: 60, header: 44, margin: 70,  fill: 0.72, ui: 1.15 },
};

const DEFAULT_CHANNEL = {
  name: 'My Quran Channel',
  handle: '',
  logo: '',
  intro: { long: 5, short: 1.5 },
  outro: { long: 6, short: 2.5 },
};

// Caption colours (#RRGGBB). Override per channel in channel.json "colors" or per run with --color-<name>
const DEFAULT_COLORS = {
  arabic: '#FFD780',    // Arabic verse text
  highlight: '#FFFFFF', // word currently being recited
  glow: '#FFB400',      // glow around the highlighted word
  english: '#FFFFFF',
  bangla: '#C8F0B4',
  reference: '#A0A0A0', // "Al-Fatihah 1:5" label
};

// Caption text size multipliers (1 = 100%). Override in channel.json "fontScale" or with --size-<name>
const DEFAULT_SIZES = { arabic: 1, english: 1, bangla: 1 };
const SIZE_RANGE = [0.5, 2];

const VIDEO_RE = /\.(mp4|mov|webm|mkv)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp|bmp)$/i;

const BOOL_FLAGS = new Set(['no-bismillah', 'no-highlight', 'no-intro', 'no-outro', 'no-watermark', 'batch']);

function parseArgs() {
  const a = { reciter: 'alafasy', en: 'saheeh', bn: 'taisirul', format: 'long', bismillah: true, highlight: true };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (BOOL_FLAGS.has(k)) { a[k] = true; continue; }
    // --bg can be repeated: several clips/images play in that order
    if (k === 'bg') { (a.bg = a.bg || []).push(argv[++i]); continue; }
    a[k] = argv[++i];
  }
  if (a['no-bismillah']) a.bismillah = false;
  if (a['no-highlight']) a.highlight = false;
  if (a.batch) a.format = 'short';
  if (!a.surah) {
    console.log(`Usage: node make-video.js --surah <1-114> [options]
  --from <n> --to <n>     verse range (default: whole surah)
  --reciter <name>        ${Object.keys(RECITERS).join(', ')}
  --en <name>             ${Object.keys(TRANSLATIONS.en).join(', ')}
  --bn <name>             ${Object.keys(TRANSLATIONS.bn).join(', ')}
  --format <long|short>   16:9 YouTube video or 9:16 Shorts (default long)
  --bg <file|folder>      background image/video, or a folder of them to cycle through
                          (default: ./backgrounds if it has media, else animated gradient).
                          Repeat --bg to pick several files; they cross-fade in that order.
                          Use --bg gradient for the animated gradient.
  --bg-source <match|all> Auto: clips matching the format's orientation, or all clips
  --bg-order <rotate|shuffle|name>  Auto: clip order (rotate = different first clip per surah)
  --bg-max <n>            Auto: most clips in the reel (1–${MAX_REEL_CLIPS})
  --clip-seconds <n>      seconds each clip shows before cross-fading (4–30)
  --bg-dim <0–0.9>        darken clips so captions stay readable (default 0.55)
  --gradient "#a,#b,#c"   gradient colours (2–4); --gradient-speed 0–10 (0 = still)
  --batch                 one Short per verse (use --group-seconds to merge very short verses)
  --group-seconds <n>     with --batch: join consecutive verses until each Short is at least n seconds
  --no-highlight          disable word-by-word Arabic highlighting
  --no-intro / --no-outro / --no-watermark
  --no-bismillah          don't prepend Bismillah audio
  --color-<name> <#hex>   ${Object.keys(DEFAULT_COLORS).join(', ')} (e.g. --color-highlight #00FFAA)
  --size-<name> <n>       text size for ${Object.keys(DEFAULT_SIZES).join(', ')}: ${SIZE_RANGE[0]}–${SIZE_RANGE[1]} (1 = 100%, e.g. --size-arabic 1.3)
  --still <file.png>      render one preview frame of the first verse instead of a video
  --out <file>            output mp4 path (single video only)

Branding (channel name, @handle, logo, intro/outro length) is read from channel.json.`);
    process.exit(1);
  }
  return a;
}

function findBin(name) {
  try { execFileSync(name, ['-version'], { stdio: 'ignore' }); return name; } catch {}
  const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(base)) {
    for (const pkg of fs.readdirSync(base).filter(d => d.startsWith('Gyan.FFmpeg'))) {
      for (const sub of fs.readdirSync(path.join(base, pkg))) {
        const p = path.join(base, pkg, sub, 'bin', name + '.exe');
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error(`${name} not found. Install FFmpeg: winget install Gyan.FFmpeg`);
}
const tryFindBin = name => { try { return findBin(name); } catch { return null; } };
const FFMPEG = tryFindBin('ffmpeg');
const FFPROBE = tryFindBin('ffprobe');
const requireBin = (bin, name) => {
  if (!bin) throw new Error(`${name} not found. Install FFmpeg: winget install Gyan.FFmpeg`);
  return bin;
};

const ffmpeg = (args, cwd) => execFileSync(requireBin(FFMPEG, 'ffmpeg'),
  ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd, stdio: 'inherit' });
const probeDuration = file => parseFloat(execFileSync(requireBin(FFPROBE, 'ffprobe'),
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function getJson(url, cacheName) {
  const file = path.join(CACHE, 'api', cacheName);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${url}`);
  const json = await res.json();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json));
  return json;
}

function loadChannel() {
  const file = path.join(ROOT, 'channel.json');
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const ch = { ...DEFAULT_CHANNEL, ...cfg,
    intro: { ...DEFAULT_CHANNEL.intro, ...cfg.intro }, outro: { ...DEFAULT_CHANNEL.outro, ...cfg.outro } };
  if (ch.logo) {
    ch.logo = path.resolve(ROOT, ch.logo);
    if (!fs.existsSync(ch.logo)) { console.warn(`  ! logo not found: ${ch.logo} (using text watermark)`); ch.logo = ''; }
  }
  return ch;
}

// ---------- Quran data ----------

const cleanTranslation = t => t
  .replace(/<sup[^>]*>.*?<\/sup>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim();

async function loadVerses(surah, enId, bnId) {
  const raw = [];
  for (let page = 1; page; ) {
    const j = await getJson(
      `https://api.quran.com/api/v4/verses/by_chapter/${surah}?translations=${enId},${bnId}&words=true&word_fields=text_uthmani&per_page=50&page=${page}`,
      `verses-${surah}-${enId}-${bnId}-p${page}.json`);
    raw.push(...j.verses);
    page = j.pagination.next_page;
  }
  const tr = (v, id) => cleanTranslation((v.translations.find(t => t.resource_id === id) || {}).text || '');
  const map = new Map();
  for (const v of raw) {
    map.set(v.verse_number, {
      num: v.verse_number,
      juz: v.juz_number,
      words: v.words.filter(w => w.char_type_name === 'word').map(w => w.text_uthmani),
      en: tr(v, enId),
      bn: tr(v, bnId),
    });
  }
  return map;
}

// Bangla surah names (editable list of 114, in order)
let surahNamesBn = null;
function surahNameBn(surah) {
  if (!surahNamesBn) {
    try { surahNamesBn = JSON.parse(fs.readFileSync(path.join(ROOT, 'surah-names-bn.json'), 'utf8')); } catch { surahNamesBn = []; }
  }
  return surahNamesBn[surah - 1] || '';
}

// Where a video goes: output/Videos/<NNN - Name>/ or output/Shorts/<NNN - Name>/
function surahFolder(data, isShort) {
  const name = data.chapter.name_simple.replace(/[<>:"/\\|?*]/g, '');
  return path.join(OUT, isShort ? 'Shorts' : 'Videos', `${pad3(data.surah)} - ${name}`);
}

async function loadSurah(surah, args) {
  const enId = TRANSLATIONS.en[args.en] || parseInt(args.en, 10);
  const bnId = TRANSLATIONS.bn[args.bn] || parseInt(args.bn, 10);
  const { chapter } = await getJson(`https://api.quran.com/api/v4/chapters/${surah}`, `chapter-${surah}.json`);
  const { chapter: chapterBn } = await getJson(`https://api.quran.com/api/v4/chapters/${surah}?language=bn`, `chapter-${surah}-bn.json`);
  // Quran.com only has the meaning in Bangla ("আন্তরিকতা"); the searchable name ("আল-ইখলাস") comes from surah-names-bn.json
  chapter.meaning_bn = chapterBn.translated_name.name;
  chapter.name_bn = surahNameBn(surah) || chapter.meaning_bn;
  const { chapter_info: info } = await getJson(`https://api.quran.com/api/v4/chapters/${surah}/info`, `chapter-info-${surah}.json`);
  chapter.info = info;
  const verses = await loadVerses(surah, enId, bnId);
  const fatiha = surah === 1 ? verses : await loadVerses(1, enId, bnId);
  return { surah, chapter, verses, bismillahVerse: fatiha.get(1) };
}

// ---------- Audio + timeline ----------

// Returns per-verse timings (and word segments when available) for the whole surah.
async function loadRecitation(surah, reciter) {
  if (reciter.qdc) {
    const { audio_file: af } = await getJson(
      `https://api.quran.com/api/v4/chapter_recitations/${reciter.qdc}/${surah}?segments=true`,
      `recitation-${reciter.qdc}-${surah}.json`);
    const mp3 = await download(af.audio_url, path.join(CACHE, 'audio', `qdc-${reciter.qdc}`, `${surah}.mp3`));
    const timings = new Map();
    for (const t of af.timestamps) {
      const num = parseInt(t.verse_key.split(':')[1], 10);
      timings.set(num, {
        from: t.timestamp_from / 1000,
        to: t.timestamp_to / 1000,
        segs: (t.segments || []).filter(s => s.length === 3).map(([pos, s]) => ({ i: pos - 1, t: s / 1000 })),
      });
    }
    return { mode: 'qdc', mp3, timings };
  }
  return { mode: 'ea', dir: reciter.ea };
}

async function verseDuration(rec, surah, num) {
  if (rec.mode === 'qdc') { const t = rec.timings.get(num); return t.to - t.from; }
  return probeDuration(await eaFile(rec, surah, num));
}

const pad3 = n => String(n).padStart(3, '0');
const eaFile = (rec, surah, num) => download(`https://everyayah.com/data/${rec.dir}/${pad3(surah)}${pad3(num)}.mp3`,
  path.join(CACHE, 'audio', rec.dir, `${pad3(surah)}${pad3(num)}.mp3`));

// Builds the audio parts list + caption cues for one video. Times start at `offset` (after the intro).
async function buildTimeline(job, data, rec, bismillahRec, work, offset) {
  const parts = [];
  const cues = [];
  let t = offset;
  const wav = (src, from, to, name) => {
    const out = path.join(work, name);
    ffmpeg(['-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', src, '-ar', '44100', '-ac', '2', out]);
    parts.push(out);
    return to - from;
  };

  if (job.bismillah) {
    const v = data.bismillahVerse;
    if (bismillahRec.mode === 'qdc') {
      const bt = bismillahRec.timings.get(1);
      const d = wav(bismillahRec.mp3, bt.from, bt.to, 'bismillah.wav');
      cues.push({ ...v, num: 0, label: '', start: t, end: t + d, segs: bt.segs.map(s => ({ i: s.i, t: t + s.t - bt.from })) });
      t += d;
    } else {
      const f = await eaFile(bismillahRec, 1, 1);
      const d = probeDuration(f);
      parts.push(f);
      cues.push({ ...v, num: 0, label: '', start: t, end: t + d, segs: [] });
      t += d;
    }
  }

  if (rec.mode === 'qdc') {
    const T0 = rec.timings.get(job.from).from;
    const T1 = rec.timings.get(job.to).to;
    wav(rec.mp3, T0, T1, 'verses.wav');
    const base = t;
    for (let n = job.from; n <= job.to; n++) {
      const vt = rec.timings.get(n);
      const start = base + vt.from - T0, end = base + vt.to - T0;
      cues.push({ ...data.verses.get(n), start, end, label: `${data.chapter.name_simple} ${data.surah}:${n}`,
        segs: vt.segs.map(s => ({ i: s.i, t: Math.max(start, base + s.t - T0) })) });
    }
    t = base + T1 - T0;
  } else {
    for (let n = job.from; n <= job.to; n++) {
      const f = await eaFile(rec, data.surah, n);
      const d = probeDuration(f);
      parts.push(f);
      cues.push({ ...data.verses.get(n), start: t, end: t + d, label: `${data.chapter.name_simple} ${data.surah}:${n}`, segs: [] });
      t += d;
    }
  }
  return { parts, cues, audioEnd: t };
}

// ---------- Captions (ASS) ----------

// ASS treats {} as override blocks and \ as escapes
const esc = t => String(t).replace(/[{}]/g, m => (m === '{' ? '(' : ')')).replace(/\\/g, '/');
const rtl = t => `\u202B${t}\u202C`;

function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

// #RRGGBB → ASS &H00BBGGRR&
function assColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`Invalid colour "${hex}" (use #RRGGBB)`);
  const h = m[1].toUpperCase();
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`;
}

// Defaults < channel.json "colors" < --color-<name> flags
function resolveColors(channel, args) {
  const out = {};
  for (const k of Object.keys(DEFAULT_COLORS)) {
    out[k] = assColor(args[`color-${k}`] || (channel.colors || {})[k] || DEFAULT_COLORS[k]);
  }
  return out;
}

// Defaults < channel.json "fontScale" < --size-<name> flags (1 = 100%)
function resolveSizes(channel, args) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SIZES)) {
    const v = parseFloat(args[`size-${k}`] ?? (channel.fontScale || {})[k] ?? DEFAULT_SIZES[k]);
    if (!(v >= SIZE_RANGE[0] && v <= SIZE_RANGE[1])) throw new Error(`--size-${k} must be between ${SIZE_RANGE[0]} and ${SIZE_RANGE[1]}`);
    out[k] = v;
  }
  return out;
}

// Caption text sizes are given the way browsers (and the Studio's live preview) size text: by the font's
// em. libass instead sizes a font so its OS/2 winAscent+winDescent equals \fs, which draws Amiri Quran
// ~2.8x smaller at the same number. EM_RATIO converts an em size into the \fs value libass needs.
const FONT_FILES_BY_ROLE = { arabic: 'AmiriQuran-Regular.ttf', latin: 'Poppins-Regular.ttf', bangla: 'HindSiliguri-Regular.ttf' };
const DEFAULT_EM_RATIO = { arabic: 2.774, latin: 1.762, bangla: 1.617 };

function readEmRatio(file) {
  const b = fs.readFileSync(file);
  const tables = {};
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const o = 12 + i * 16;
    tables[b.toString('ascii', o, o + 4)] = b.readUInt32BE(o + 8);
  }
  const upm = b.readUInt16BE(tables.head + 18);
  const os2 = tables['OS/2'];
  return (b.readUInt16BE(os2 + 74) + b.readUInt16BE(os2 + 76)) / upm;
}

let emRatioCache = null;
function emRatio() {
  if (emRatioCache) return emRatioCache;
  const out = {};
  for (const [role, file] of Object.entries(FONT_FILES_BY_ROLE)) {
    const p = path.join(FONTS, file);
    try { out[role] = fs.existsSync(p) ? readEmRatio(p) : DEFAULT_EM_RATIO[role]; } catch { out[role] = DEFAULT_EM_RATIO[role]; }
  }
  return (emRatioCache = out);
}

// Average character width (in units of libass \fs) and line height, measured from libass renders of
// the caption fonts. Arabic is per base letter: harakat and other marks take no horizontal space.
const FONT_METRICS = { arabic: 0.123, english: 0.28, bangla: 0.245, lineHeight: 1.04, wrapSlack: 1.08 };
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]/g;
// Vertical gaps between the languages (pixels at full size, scaled with the verse) and the reference label size
const VERSE_GAPS = { afterArabic: 24, afterEnglish: 14, beforeReference: 20 };
const REFERENCE_SIZE = 28;
const WATERMARK_SIZE = 22;

// Font size multiplier for a verse. Estimates how many lines each language wraps to and shrinks only
// when the whole block would not fit on screen, so the chosen text sizes are kept whenever there is room.
function verseFit(c, fmt, size, ratio = emRatio()) {
  const width = fmt.w - 2 * fmt.margin;
  const room = fmt.h * fmt.fill;
  const m = FONT_METRICS;
  // [width per unit of \fs, \fs at full size]
  const blocks = [
    [(c.words.join(' ') + ' ﴿٠﴾').replace(ARABIC_MARKS, '').length * m.arabic, fmt.ar * size.arabic * ratio.arabic],
    [c.en.length * m.english, fmt.en * size.english * ratio.latin],
    [c.bn.length * m.bangla, fmt.bn * size.bangla * ratio.bangla],
  ];
  const g = VERSE_GAPS;
  const extra = g.afterArabic + g.afterEnglish + g.beforeReference + REFERENCE_SIZE * ratio.latin;
  const height = k => blocks.reduce((h, [em, fs]) => {
    const lines = Math.max(1, Math.ceil((em * fs * k * m.wrapSlack) / width));
    return h + lines * m.lineHeight * fs * k;
  }, 0) + extra * m.lineHeight * k;
  for (let k = 1; k > 0.1; k -= 0.01) if (height(k) <= room) return k;
  return 0.1;
}

function verseEvents(c, fmt, highlight, col, size) {
  const AR_BASE = `\\c${col.arabic}\\3c&H00000000&\\bord2\\blur0`;
  const AR_HIGHLIGHT = `\\c${col.highlight}\\3c${col.glow}\\bord3\\blur4`;
  const ratio = emRatio();
  const k = verseFit(c, fmt, size, ratio);
  // Em size (as in the live preview) \u2192 libass \fs for that font
  const fs = (em, role) => Math.round(em * k * ratio[role]);
  // A blank line of the given height, used as vertical spacing between the languages
  const gap = n => `\\N{\\fs${Math.round(n * k)}}\\h\\N`;
  const g = VERSE_GAPS;
  const marker = c.num ? ` \uFD3F${c.num.toLocaleString('ar-EG')}\uFD3E` : '';
  const body = active =>
    `{\\fnAmiri Quran\\fs${fs(fmt.ar * size.arabic, 'arabic')}${AR_BASE}}` +
    rtl(c.words.map((w, i) => (i === active ? `{${AR_HIGHLIGHT}}${esc(w)}{${AR_BASE}}` : esc(w))).join(' ') + marker) +
    `${gap(g.afterArabic)}{\\fnPoppins\\fs${fs(fmt.en * size.english, 'latin')}\\c${col.english}\\bord2}${esc(c.en)}` +
    `${gap(g.afterEnglish)}{\\fnHind Siliguri\\fs${fs(fmt.bn * size.bangla, 'bangla')}\\c${col.bangla}\\bord2}${esc(c.bn)}` +
    (c.label ? `${gap(g.beforeReference)}{\\fnPoppins\\fs${fs(REFERENCE_SIZE, 'latin')}\\c${col.reference}\\bord1}${esc(c.label)}` : '');

  if (!highlight || !c.segs.length) return [{ start: c.start, end: c.end, text: `{\\fad(250,250)}${body(-1)}` }];

  // One event per word: the whole verse is redrawn with the word being recited highlighted
  const marks = [{ t: c.start, i: -1 }, ...c.segs.filter(s => s.i < c.words.length && s.t < c.end)];
  const events = [];
  marks.forEach((m, j) => {
    const end = j + 1 < marks.length ? marks[j + 1].t : c.end;
    if (end - m.t >= 0.01) events.push({ start: m.t, end, active: m.i });
  });
  return events.map((e, j) => ({
    start: e.start, end: e.end,
    text: `{\\fad(${j === 0 ? 250 : 0},${j === events.length - 1 ? 250 : 0})}${body(e.active)}`,
  }));
}

function buildAss({ cues, fmt, data, reciter, channel, job, intro, outro, total, watermark, highlight, colors: col, sizes }) {
  const { w, h } = fmt;
  const u = n => Math.round(n * fmt.ui);
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Verse,Poppins,${fmt.en},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,2,5,${fmt.margin},${fmt.margin},40,-1
Style: Header,Poppins SemiBold,${Math.round(fmt.header * emRatio().latin)},&H00C8E6FF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,1,0,1,1.5,1,8,40,40,${Math.round(h * 0.05)},1
Style: Card,Poppins,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,2,5,${fmt.margin},${fmt.margin},0,1
Style: Watermark,Poppins SemiBold,${Math.round(u(WATERMARK_SIZE) * emRatio().latin)},&H60FFFFFF,&H00FFFFFF,&H90000000,&H00000000,0,0,0,0,100,100,1,0,1,1,0,3,36,36,32,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = [];
  const add = (layer, start, end, style, text) =>
    ev.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`);
  // Positioned card line that drifts up slightly while fading in
  const card = (start, end, yFrac, tags, text, delay = 0) => {
    const x = w / 2, y = Math.round(h * yFrac);
    add(2, start + delay, end, 'Card', `{\\an5\\move(${x},${y + 24},${x},${y},0,600)\\fad(500,400)${tags}}${text}`);
  };
  const versesEnd = total - outro;
  const { chapter } = data;

  if (intro > 0) {
    const short = fmt === FORMATS.short;
    const range = job.from === 1 && job.to === chapter.verses_count ? '' : `  ·  Verses ${job.from}–${job.to}`;
    const top = channel.logo ? 0.30 : 0.26;
    card(0, intro, top, `\\fnPoppins SemiBold\\fs${u(36)}\\fsp4\\c&H00A8D8F0&`, esc(channel.name.toUpperCase()));
    card(0, intro, 0.45, `\\fnAmiri Quran\\fs${u(short ? 130 : 150)}\\c${col.arabic}\\bord2`, rtl(`سورة ${chapter.name_arabic}`), 0.3);
    card(0, intro, 0.60, `\\fnPoppins\\fs${u(46)}`, esc(`Surah ${chapter.name_simple} · ${chapter.translated_name.name}`), 0.6);
    card(0, intro, 0.67, `\\fnHind Siliguri\\fs${u(46)}\\c${col.bangla}`, esc(`সূরা ${chapter.name_bn}`), 0.8);
    if (!short) card(0, intro, 0.77, `\\fnPoppins\\fs${u(30)}\\c&H00B0B0B0&`, esc(`Recitation: ${reciter.name}${range}`), 1.1);
  }

  add(0, intro, versesEnd, 'Header', `{\\fad(400,400)}${esc(`Surah ${chapter.name_simple} · ${chapter.translated_name.name}`)}`);
  if (watermark && !channel.logo) add(0, intro, versesEnd, 'Watermark', esc(channel.handle || channel.name));

  for (const c of cues) {
    for (const e of verseEvents(c, fmt, highlight, col, sizes)) add(1, e.start, Math.min(e.end, versesEnd), 'Verse', e.text);
  }

  if (outro > 0) {
    const s = versesEnd;
    card(s, total, 0.34, `\\fnAmiri Quran\\fs${u(110)}\\c${col.arabic}`, rtl('جَزَاكُمُ ٱللَّهُ خَيْرًا'));
    card(s, total, 0.50, `\\fnPoppins SemiBold\\fs${u(54)}`, esc(`Subscribe to ${channel.name}`), 0.3);
    if (channel.handle) card(s, total, 0.57, `\\fnPoppins\\fs${u(40)}\\c&H00A8D8F0&`, esc(channel.handle), 0.4);
    card(s, total, 0.68, `\\fnPoppins\\fs${u(32)}\\c&H00D0D0D0&`, 'Share this video — it may become Sadaqah Jariyah for you', 0.7);
    card(s, total, 0.74, `\\fnHind Siliguri\\fs${u(34)}\\c${col.bangla}`, 'ভিডিওটি শেয়ার করুন — এটি আপনার জন্য সদকায়ে জারিয়া হতে পারে', 0.8);
  }
  return head + ev.join('\n') + '\n';
}

// ---------- Background ----------

// A folder of clips/images becomes one cross-faded "reel" video that is looped behind the captions.
const MAX_REEL_CLIPS = 40;

// Background look. Override in channel.json "background" or with the flags noted beside each value
const DEFAULT_BACKGROUND = {
  source: 'match',      // --bg-source: Auto uses clips matching the format's orientation ("match") or every clip ("all")
  order: 'rotate',      // --bg-order:  "rotate" (different first clip per surah), "shuffle" or "name"
  max: 12,              // --bg-max:    most clips Auto puts in the reel
  clipSeconds: 12,      // --clip-seconds: how long each clip shows before cross-fading to the next
  dim: 0.55,            // --bg-dim:    0 = original brightness, 0.9 = almost black (keeps captions readable)
  gradient: ['#0A1A24', '#14352B', '#1D1530'], // --gradient "#hex,#hex,#hex" (2–4 colours)
  gradientSpeed: 2,     // --gradient-speed: 0 (still) to 10 (fast)
};
const BG_LIMITS = { max: [1, MAX_REEL_CLIPS], clipSeconds: [4, 30], dim: [0, 0.9], gradientSpeed: [0, 10] };

// Defaults < channel.json "background" < command-line flags
function resolveBackgroundOptions(channel, args) {
  const o = { ...DEFAULT_BACKGROUND, ...(channel.background || {}) };
  const flag = { source: 'bg-source', order: 'bg-order', max: 'bg-max', clipSeconds: 'clip-seconds', dim: 'bg-dim', gradientSpeed: 'gradient-speed' };
  for (const [k, f] of Object.entries(flag)) if (args[f] !== undefined) o[k] = args[f];
  if (args.gradient) o.gradient = String(args.gradient).split(',').map(s => s.trim());

  if (!['match', 'all'].includes(o.source)) throw new Error('--bg-source must be "match" or "all"');
  if (!['rotate', 'shuffle', 'name'].includes(o.order)) throw new Error('--bg-order must be "rotate", "shuffle" or "name"');
  for (const [k, [min, max]] of Object.entries(BG_LIMITS)) {
    o[k] = parseFloat(o[k]);
    if (!(o[k] >= min && o[k] <= max)) throw new Error(`Background ${k} must be between ${min} and ${max}`);
  }
  o.max = Math.round(o.max);
  if (!Array.isArray(o.gradient) || o.gradient.length < 2 || o.gradient.length > 4) throw new Error('--gradient needs 2 to 4 colours');
  o.gradient.forEach(assColor); // validates #RRGGBB
  return o;
}

function resolveBackground(bgArg, fmt, rotate, opts) {
  if (Array.isArray(bgArg)) {
    if (bgArg.length > 1) {
      // Explicit selection: keep the user's order, no rotation
      const files = bgArg.map(f => path.resolve(f));
      const missing = files.find(f => !fs.existsSync(f) || !fs.statSync(f).isFile());
      if (missing) throw new Error(`Background not found: ${missing}`);
      const bad = files.find(f => !VIDEO_RE.test(f) && !IMAGE_RE.test(f));
      if (bad) throw new Error(`Not an image or video: ${bad}`);
      const used = files.slice(0, MAX_REEL_CLIPS);
      return { type: 'video', file: buildReel(used, fmt, opts), used };
    }
    bgArg = bgArg[0];
  }
  if (bgArg === 'gradient') return { type: 'gradient' };
  let bg = bgArg ? path.resolve(bgArg) : path.join(ROOT, 'backgrounds');
  if (!fs.existsSync(bg)) {
    if (bgArg) throw new Error(`Background not found: ${bg}`);
    return { type: 'gradient' };
  }
  if (fs.statSync(bg).isFile()) return { type: IMAGE_RE.test(bg) ? 'image' : 'video', file: bg, used: [bg] };

  const media = f => VIDEO_RE.test(f) || IMAGE_RE.test(f);
  let files;
  if (opts.source === 'all') {
    // Every clip in the folder tree; ones of the other shape are centre-cropped
    const walk = d => fs.readdirSync(d, { withFileTypes: true })
      .flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : media(e.name) ? [path.join(d, e.name)] : []));
    files = walk(bg).sort();
  } else {
    const sub = path.join(bg, fmt.orientation);
    const dir = fs.existsSync(sub) && fs.readdirSync(sub).some(media) ? sub : bg;
    files = fs.readdirSync(dir).filter(media).sort().map(f => path.join(dir, f));
  }
  if (!files.length) {
    if (bgArg) throw new Error(`No images/videos in ${bg}`);
    return { type: 'gradient' };
  }
  if (opts.order === 'shuffle') {
    for (let i = files.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [files[i], files[j]] = [files[j], files[i]];
    }
  } else if (opts.order === 'rotate') {
    // Start at a different clip for each surah so videos don't all look the same
    const r = rotate % files.length;
    files = [...files.slice(r), ...files.slice(0, r)];
  }
  files = files.slice(0, opts.max);
  if (files.length === 1) return resolveBackground(files[0], fmt, 0, opts);
  return { type: 'video', file: buildReel(files, fmt, opts), used: files };
}

function buildReel(files, fmt, opts) {
  const { w, h } = fmt;
  const CLIP = opts.clipSeconds;
  const FADE = Math.min(1.2, CLIP / 4);
  const key = require('crypto').createHash('md5')
    .update(files.map(f => f + fs.statSync(f).size).join('|') + w + h + CLIP).digest('hex').slice(0, 10);
  const out = path.join(CACHE, 'reels', `reel-${fmt.orientation}-${key}.mp4`);
  if (fs.existsSync(out)) return out;
  console.log(`• Building background reel from ${files.length} clips`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Write to a temp name and rename when done, so a cancelled render never leaves a broken cached reel
  const tmp = out.replace(/\.mp4$/, '.partial.mp4');

  const inputs = [], chains = [], lens = [];
  files.forEach((f, i) => {
    const fit = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
    if (IMAGE_RE.test(f)) {
      // Slow Ken Burns zoom so still images feel alive
      inputs.push('-i', f);
      const W = Math.round(w * 1.15), H = Math.round(h * 1.15);
      chains.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
        `zoompan=z='min(zoom+0.0005,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${CLIP * 30}:s=${w}x${h}:fps=30,` +
        `setsar=1,format=yuv420p,settb=AVTB[v${i}]`);
      lens.push(CLIP);
    } else {
      const len = Math.min(CLIP, probeDuration(f));
      inputs.push('-t', len.toFixed(2), '-i', f);
      chains.push(`[${i}:v]${fit},fps=30,setsar=1,format=yuv420p,settb=AVTB[v${i}]`);
      lens.push(len);
    }
  });
  let prev = 'v0', acc = lens[0];
  for (let i = 1; i < files.length; i++) {
    const offset = acc - FADE;
    const label = i === files.length - 1 ? 'out' : `x${i}`;
    chains.push(`[${prev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(2)}[${label}]`);
    prev = label;
    acc = offset + lens[i];
  }
  ffmpeg([...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', tmp]);
  fs.renameSync(tmp, out);
  return out;
}

// ---------- Render ----------

async function renderVideo(job, ctx) {
  const { data, args, fmt, reciter, rec, bismillahRec, channel } = ctx;
  const intro = args['no-intro'] ? 0 : channel.intro[args.format];
  const outro = args['no-outro'] ? 0 : channel.outro[args.format];
  const watermark = !args['no-watermark'];
  const tag = `${pad3(data.surah)}_${job.from}-${job.to}_${args.reciter}_${args.format}`;
  const work = path.join(CACHE, 'work', tag);
  fs.mkdirSync(work, { recursive: true });

  const { parts, cues, audioEnd } = await buildTimeline(job, data, rec, bismillahRec, work, intro);
  const total = audioEnd + outro;
  const highlight = args.highlight && rec.mode === 'qdc';

  fs.writeFileSync(path.join(work, 'list.txt'),
    parts.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  fs.writeFileSync(path.join(work, 'subs.ass'), '\uFEFF' +
    buildAss({ cues, fmt, data, reciter, channel, job, intro, outro, total, watermark, highlight, colors: ctx.colors, sizes: ctx.sizes }), 'utf8');
  // libass can't open fonts via a ../ path on Windows, so keep a copy beside subs.ass
  fs.cpSync(FONTS, path.join(work, 'fonts'), { recursive: true });

  const { w, h } = fmt;
  const bg = ctx.background;
  const bo = ctx.bgOptions;
  const inputs = [];
  const graph = [];
  if (bg.type === 'gradient') {
    const cols = bo.gradient.map((c, i) => `c${i}=0x${c.replace('#', '')}`).join(':');
    // Speed 0–10 → ffmpeg's rotation speed (0 = still)
    const speed = (bo.gradientSpeed * 0.002).toFixed(4);
    inputs.push('-f', 'lavfi', '-i', `gradients=s=${w}x${h}:${cols}:n=${bo.gradient.length}:speed=${speed}:r=30`);
    graph.push(`[0:v]vignette=PI/4,setsar=1[bg]`);
  } else {
    const level = (1 - bo.dim).toFixed(3);
    inputs.push(...(bg.type === 'image' ? ['-loop', '1', '-framerate', '30'] : ['-stream_loop', '-1']), '-i', bg.file);
    graph.push(`[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,` +
      `colorlevels=romax=${level}:gomax=${level}:bomax=${level},vignette=PI/5,setsar=1[bg]`);
  }
  inputs.push('-f', 'concat', '-safe', '0', '-i', 'list.txt');

  let vLabel = 'bg';
  if (channel.logo) {
    inputs.push('-loop', '1', '-framerate', '30', '-i', channel.logo);
    const versesEnd = total - outro;
    const wmH = Math.round(h * (fmt === FORMATS.short ? 0.045 : 0.07));
    const introH = Math.round(h * (fmt === FORMATS.short ? 0.09 : 0.16));
    graph.push(`[2:v]format=rgba,split[lg1][lg2]`);
    graph.push(`[lg1]scale=-1:${wmH},colorchannelmixer=aa=0.6[wm]`);
    graph.push(`[${vLabel}][wm]overlay=W-w-36:H-h-32:shortest=1:enable='between(t,${intro},${versesEnd})'[b1]`);
    vLabel = 'b1';
    if (intro > 0) {
      graph.push(`[lg2]scale=-1:${introH},fade=t=in:st=0:d=0.5:alpha=1,fade=t=out:st=${Math.max(0, intro - 0.5)}:d=0.5:alpha=1[il]`);
      graph.push(`[${vLabel}][il]overlay=(W-w)/2:H*0.10:shortest=1:enable='lt(t,${intro})'[b2]`);
      vLabel = 'b2';
    } else {
      graph.push(`[lg2]nullsink`);
    }
  }
  // Preview still: shift timestamps so the very first frame is already partway through the verse
  // (a word is highlighted) instead of rendering every frame up to that point
  const c0 = cues[cues.length - 1];
  const stillAt = c0.start + (c0.end - c0.start) * 0.45;
  const shift = args.still ? `setpts=PTS+${stillAt.toFixed(2)}/TB,` : '';
  graph.push(`[${vLabel}]${shift}subtitles=subs.ass:fontsdir=fonts,format=yuv420p[v]`);

  const outFile = path.resolve(job.out || path.join(surahFolder(data, args.format === 'short'),
    `${pad3(data.surah)}_${job.from}-${job.to}_${args.reciter}.mp4`));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  if (args.still) {
    ffmpeg([...inputs, '-filter_complex', graph.join(';'), '-map', '[v]', '-frames:v', '1', outFile], work);
    return outFile;
  }

  const ms = Math.round(intro * 1000);
  graph.push(`[1:a]adelay=delays=${ms}:all=1,apad[a]`);
  console.log(`  duration ${total.toFixed(2)}s`);
  ffmpeg([...inputs, '-filter_complex', graph.join(';'), '-map', '[v]', '-map', '[a]',
    '-t', total.toFixed(3),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-stats', outFile], work);

  writeDescription(outFile, job, ctx);
  if (args.format === 'short' && total > 180) console.warn(`  ! ${Math.round(total)}s is longer than the 3-minute Shorts limit`);
  return outFile;
}

// Opening paragraph: intros.json (most specific key first, e.g. "2:255" → "2"), else Quran.com's chapter summary
function surahIntro(data, job) {
  const file = path.join(ROOT, 'intros.json');
  const intros = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const exact = job.from === job.to ? `${data.surah}:${job.from}` : `${data.surah}:${job.from}-${job.to}`;
  if (intros[exact]) return intros[exact];
  if (intros[data.surah]) return intros[data.surah];
  const info = data.chapter.info;
  if (!info || !info.short_text) return '';
  const source = (info.source || '').split(' - ')[0];
  return `${info.short_text.trim()}${source ? ` (${source})` : ''}`;
}

function writeDescription(outFile, job, ctx) {
  const { data, args, reciter, channel, background } = ctx;
  const { chapter } = data;
  const whole = job.from === 1 && job.to === chapter.verses_count;
  const ref = job.from === job.to ? `${data.surah}:${job.from}` : `${data.surah}:${job.from}-${job.to}`;
  const juzList = [...new Set([job.from, job.to].map(n => data.verses.get(n).juz))];
  const place = chapter.revelation_place === 'madinah' ? 'Madinah (Madani)' : 'Makkah (Makki)';
  const surahName = `${chapter.name_simple} (${chapter.translated_name.name})`;
  const bnName = `সূরা ${chapter.name_bn}`;

  const credits = [];
  const creditsFile = path.join(ROOT, 'backgrounds', 'credits.json');
  if (background.used && fs.existsSync(creditsFile)) {
    const map = JSON.parse(fs.readFileSync(creditsFile, 'utf8'));
    for (const f of background.used) if (map[path.basename(f)]) credits.push(map[path.basename(f)]);
  }

  const intro = surahIntro(data, job);
  const desc = [
    ...(intro ? [intro, ''] : []),
    `📖 Surah: ${surahName} · ${chapter.name_arabic} · ${bnName}`,
    '',
    `📍 Juz: ${juzList.join('–')} | Total Verses: ${chapter.verses_count}` + (whole ? '' : ` | This video: ${ref}`),
    '',
    `🕋 Revealed in: ${place}`,
    '',
    `🎙️ Reciter: ${reciter.name}`,
    '',
    `🌐 Translations: English — ${TRANSLATION_NAMES[args.en] || args.en} · Bangla — ${TRANSLATION_NAMES[args.bn] || args.bn}`,
    '',
    channel.subscribeLine || 'Subscribe for daily peaceful Quranic verses with verified English and Bengali translations.',
    ...(channel.handle ? [`👉 ${channel.handle}`] : []),
    '',
    'Text, translations & recitation timing: Quran.com',
    ...(credits.length ? ['', '🎬 Background footage:', ...credits] : []),
    '',
    [
      '#Quran', `#Surah${chapter.name_simple.replace(/[^A-Za-z]/g, '')}`, `#${bnName.replace(/[\s-]+/g, '_')}`, '#QuranRecitation',
      '#QuranWithBanglaTranslation', '#কুরআন', '#বাংলা_অনুবাদ', '#Islam', `#${reciter.name.split(' ').pop()}`,
      ...(args.format === 'short' ? ['#Shorts'] : []),
    ].join(' '),
  ].join('\n');
  fs.writeFileSync(outFile.replace(/\.mp4$/, '.description.txt'), desc, 'utf8');

  fs.writeFileSync(outFile.replace(/\.mp4$/, '.title.txt'), buildTitle({ chapter, ref, whole, reciter, short: args.format === 'short' }), 'utf8');
}

// English + Bangla surah name so the video is found by searches in either language.
// YouTube allows 100 characters: the first candidate that fits is used, dropping the least important parts.
function buildTitle({ chapter, ref, whole, reciter, short }) {
  const en = `Surah ${chapter.name_simple}`;
  const bn = `সূরা ${chapter.name_bn}`;
  const verses = whole ? '' : ` ${ref}`;
  const candidates = short
    ? [
      `${en}${verses} | ${bn} | ${chapter.translated_name.name} ✨ #Shorts`,
      `${en}${verses} | ${bn} ✨ #Shorts`,
      `${en}${verses} | ${bn} #Shorts`,
    ]
    : [
      `${en}${verses} | ${bn} | ${reciter.name} | Arabic, English & Bangla Translation`,
      `${en}${verses} | ${bn} | ${reciter.name} | Bangla & English Translation`,
      `${en}${verses} | ${bn} | ${reciter.name} | বাংলা অনুবাদ`,
      `${en}${verses} | ${bn} | বাংলা অনুবাদ`,
    ];
  return candidates.find(t => [...t].length <= 100) || candidates[candidates.length - 1].slice(0, 100);
}

// ---------- Main ----------

async function main() {
  const args = parseArgs();
  const fmt = FORMATS[args.format];
  if (!fmt) throw new Error(`Unknown format "${args.format}" (use long or short)`);
  const surah = parseInt(args.surah, 10);
  if (!(surah >= 1 && surah <= 114)) throw new Error('Surah must be 1-114');
  const reciter = RECITERS[args.reciter];
  if (!reciter) throw new Error(`Unknown reciter "${args.reciter}". Options: ${Object.keys(RECITERS).join(', ')}`);
  const channel = loadChannel();

  console.log('• Fonts');
  for (const [file, rel] of Object.entries(FONT_FILES)) {
    await download(`https://github.com/google/fonts/raw/main/${rel}`, path.join(FONTS, file));
  }
  emRatioCache = null; // re-read metrics now that the fonts are on disk

  console.log('• Quran text & translations');
  const data = await loadSurah(surah, args);
  const from = parseInt(args.from || 1, 10);
  const to = Math.min(parseInt(args.to || data.chapter.verses_count, 10), data.chapter.verses_count);

  console.log(`• Recitation: ${reciter.name}${reciter.qdc ? ' (with word timings)' : ' (no word timings — highlighting off)'}`);
  const rec = await loadRecitation(surah, reciter);
  const bismillahRec = surah === 1 ? rec : await loadRecitation(1, reciter);

  const bgOptions = resolveBackgroundOptions(channel, args);
  const background = resolveBackground(args.bg, fmt, surah, bgOptions);
  console.log(`• Background: ${background.type === 'gradient' ? 'animated gradient'
    : background.used && background.used.length > 1 ? `${background.used.length} clips` : path.basename(background.file)}`);
  const ctx = { data, args, fmt, reciter, rec, bismillahRec, channel, background, bgOptions, colors: resolveColors(channel, args), sizes: resolveSizes(channel, args) };

  const needsBismillah = args.bismillah && data.chapter.bismillah_pre;
  let jobs;
  if (args.still) {
    args['no-intro'] = args['no-outro'] = true;
    jobs = [{ from, to: from, bismillah: false, out: args.still }];
  } else if (args.batch) {
    // One Short per verse, optionally merging consecutive short verses up to --group-seconds
    const minSec = parseFloat(args['group-seconds'] || 0);
    jobs = [];
    let cur = null, dur = 0;
    for (let n = from; n <= to; n++) {
      const d = await verseDuration(rec, surah, n);
      if (!cur) { cur = { from: n, to: n, bismillah: false }; dur = 0; }
      cur.to = n; dur += d;
      if (dur >= minSec || n === to) { jobs.push(cur); cur = null; }
    }
    const dir = surahFolder(data, true);
    jobs.forEach(j => { j.out = path.join(dir, `${pad3(surah)}_${j.from === j.to ? j.from : `${j.from}-${j.to}`}_${args.reciter}.mp4`); });
    console.log(`• Batch: ${jobs.length} Shorts → ${dir}`);
  } else {
    jobs = [{ from, to, bismillah: needsBismillah && from === 1, out: args.out }];
  }

  for (const [i, job] of jobs.entries()) {
    console.log(`• Rendering ${jobs.length > 1 ? `${i + 1}/${jobs.length} ` : ''}(verses ${job.from}–${job.to})`);
    const file = await renderVideo(job, ctx);
    console.log(`  ✓ ${file}`);
  }
}

if (require.main === module) {
  main().catch(e => { console.error('\n✗', e.message); process.exit(1); });
}

module.exports = {
  RECITERS, TRANSLATIONS, TRANSLATION_NAMES, DEFAULT_COLORS, DEFAULT_SIZES, SIZE_RANGE, FORMATS, DEFAULT_CHANNEL,
  FFMPEG, FFPROBE, MAX_REEL_CLIPS, DEFAULT_BACKGROUND, BG_LIMITS, verseFit,
  FONT_METRICS, VERSE_GAPS, REFERENCE_SIZE, WATERMARK_SIZE, emRatio, surahNameBn, buildTitle,
};
