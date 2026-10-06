#!/usr/bin/env node
// Local web UI for the Quran video maker. Start with `npm start` and open http://localhost:4173
// Runs make-video.js / fetch-backgrounds.js as child processes and streams their progress to the browser.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  RECITERS, TRANSLATIONS, TRANSLATION_NAMES, DEFAULT_COLORS, DEFAULT_SIZES, SIZE_RANGE, DEFAULT_CHANNEL,
  FFMPEG, FFPROBE, MAX_REEL_CLIPS, DEFAULT_BACKGROUND, BG_LIMITS, FORMATS, FONT_METRICS, VERSE_GAPS, REFERENCE_SIZE, WATERMARK_SIZE, emRatio,
  surahNameBn, timingKind, TRANSLATION_VOICES, DEFAULT_TRANSLATION_AUDIO, TA_LIMITS, translationClip,
} = require('./make-video.js');
const { execFile } = require('child_process');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '4173', 10);
const HOST = '127.0.0.1';
const UI = path.join(ROOT, 'ui');
const OUT = path.join(ROOT, 'output');
const PREVIEWS = path.join(ROOT, 'cache', 'previews');
const ASSETS = path.join(ROOT, 'assets');
const BACKGROUNDS = path.join(ROOT, 'backgrounds');
const CHANNEL_FILE = path.join(ROOT, 'channel.json');
// Only these folders are served to the browser
const MEDIA_ROOTS = {
  output: OUT, previews: PREVIEWS, assets: ASSETS, backgrounds: BACKGROUNDS,
  tts: path.join(ROOT, 'cache', 'tts'), recordings: path.join(ROOT, 'translation-audio'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.txt': 'text/plain; charset=utf-8',
};
const VIDEO_RE = /\.(mp4|mov|webm|mkv)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp|bmp)$/i;
const HEX_RE = /^#[0-9a-f]{6}$/i;

// ---------- helpers ----------

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};
const fail = (res, status, message) => send(res, status, { error: message });

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJson = async req => {
  const buf = await readBody(req);
  return buf.length ? JSON.parse(buf.toString('utf8')) : {};
};

const readChannel = () => (fs.existsSync(CHANNEL_FILE) ? JSON.parse(fs.readFileSync(CHANNEL_FILE, 'utf8')) : {});
const writeChannel = ch => fs.writeFileSync(CHANNEL_FILE, JSON.stringify(ch, null, 2) + '\n', 'utf8');

const mediaUrl = abs => {
  for (const [name, dir] of Object.entries(MEDIA_ROOTS)) {
    const rel = path.relative(dir, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return `/media/${name}/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;
  }
  return null;
};

// Resolve /media/<root>/<path> safely inside one of MEDIA_ROOTS
function mediaPath(urlPath) {
  const [, , rootName, ...rest] = urlPath.split('/');
  const dir = MEDIA_ROOTS[rootName];
  if (!dir || !rest.length) return null;
  const abs = path.resolve(dir, ...rest.map(decodeURIComponent));
  return abs.startsWith(dir + path.sep) ? abs : null;
}

// Static file with HTTP Range support so <video> can seek
function serveFile(req, res, file, cacheable = false) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, 'Not found');
  const st = fs.statSync(file);
  const size = st.size;
  // Validators so the browser picks up updated UI files instead of reusing a stale copy
  const lastModified = st.mtime.toUTCString();
  res.setHeader('Last-Modified', lastModified);
  if (!req.headers.range && req.headers['if-modified-since'] === lastModified) {
    res.writeHead(304);
    return res.end();
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? parseInt(range[1], 10) : 0;
    const end = range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1;
    if (start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, {
    'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes',
    'Cache-Control': cacheable ? 'max-age=86400' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out);
    else if (filter(e.name)) out.push(p);
  }
  return out;
}

const cleanTranslation = t => String(t || '').replace(/<sup[^>]*>.*?<\/sup>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function cachedJson(url, name) {
  const file = path.join(ROOT, 'cache', 'api', name);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Quran.com API error ${res.status}`);
  const json = await res.json();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json));
  return json;
}

// ---------- background clips ----------

const THUMBS = path.join(ROOT, 'cache', 'thumbs');
const clipMetaCache = new Map();

function backgroundPath(id) {
  const file = path.resolve(BACKGROUNDS, String(id || ''));
  return file.startsWith(BACKGROUNDS + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()
    && (VIDEO_RE.test(file) || IMAGE_RE.test(file)) ? file : null;
}

const run = (bin, args) => new Promise((resolve, reject) =>
  execFile(bin, args, { windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout))));

// Width, height and duration (cached per file + mtime)
async function clipMeta(file) {
  const st = fs.statSync(file);
  const key = `${file}|${st.mtimeMs}`;
  if (clipMetaCache.has(key)) return clipMetaCache.get(key);
  let meta = { width: 0, height: 0, duration: 0 };
  if (FFPROBE) {
    try {
      const out = JSON.parse(await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]));
      const s = (out.streams || [])[0] || {};
      meta = { width: s.width || 0, height: s.height || 0, duration: VIDEO_RE.test(file) ? parseFloat(out.format?.duration) || 0 : 0 };
    } catch { /* unreadable file: leave zeros */ }
  }
  clipMetaCache.set(key, meta);
  return meta;
}

// Small JPEG thumbnail (1 s into videos), generated once and cached
async function clipThumb(file) {
  const st = fs.statSync(file);
  const name = `${require('crypto').createHash('md5').update(file + st.mtimeMs).digest('hex')}.jpg`;
  const out = path.join(THUMBS, name);
  if (fs.existsSync(out)) return out;
  if (!FFMPEG) return null;
  fs.mkdirSync(THUMBS, { recursive: true });
  const seek = VIDEO_RE.test(file) ? ['-ss', '1'] : [];
  try {
    await run(FFMPEG, ['-y', '-v', 'error', ...seek, '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out]);
  } catch {
    // Clips shorter than 1 s: take the first frame instead
    await run(FFMPEG, ['-y', '-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out]).catch(() => {});
  }
  return fs.existsSync(out) ? out : null;
}

// ---------- jobs (one at a time) ----------

let job = null;
let jobSeq = 0;

function startJob(kind, script, args, env = {}) {
  if (job && job.status === 'running') throw Object.assign(new Error('Another job is already running'), { status: 409 });
  const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, env: { ...process.env, ...env } });
  job = {
    id: ++jobSeq, kind, status: 'running', startedAt: Date.now(), endedAt: null,
    args, log: [], stats: '', step: 'Starting…', progress: 0, outputs: [], error: '',
    batch: { index: 1, count: 1 }, duration: 0, child,
  };
  const j = job;
  const onData = buf => {
    for (const raw of buf.toString('utf8').split(/[\r\n]+/)) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      const time = /time=(\d+):(\d+):([\d.]+)/.exec(line);
      if (time) {
        j.stats = line.trim();
        const t = +time[1] * 3600 + +time[2] * 60 + +time[3];
        if (j.duration) j.progress = Math.min(0.99, (j.batch.index - 1 + Math.min(1, t / j.duration)) / j.batch.count);
        continue;
      }
      let m;
      if ((m = /Rendering (\d+)\/(\d+)/.exec(line))) j.batch = { index: +m[1], count: +m[2] };
      if ((m = /duration ([\d.]+)s/.exec(line))) j.duration = parseFloat(m[1]);
      if ((m = /^\s*✓\s+(.+)$/.exec(line))) {
        const file = m[1].trim();
        j.outputs.push({ file: path.basename(file), url: mediaUrl(file) });
        j.progress = Math.min(0.99, j.batch.index / j.batch.count);
      }
      if ((m = /^✗\s*(.+)$/.exec(line.trim()))) j.error = m[1];
      if (/^•/.test(line.trim())) j.step = line.trim().replace(/^•\s*/, '');
      j.log.push(line);
      if (j.log.length > 600) j.log.splice(0, j.log.length - 600);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', code => {
    if (j.status === 'running') j.status = code === 0 ? 'done' : 'error';
    if (j.status === 'done') { j.progress = 1; j.step = 'Finished'; }
    if (j.status === 'error' && !j.error) j.error = `Process exited with code ${code}`;
    j.endedAt = Date.now();
    j.child = null;
  });
  return j;
}

function cancelJob() {
  if (!job || job.status !== 'running' || !job.child) return false;
  job.status = 'cancelled';
  job.step = 'Cancelled';
  // Kill the whole tree so ffmpeg stops too
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(job.child.pid), '/T', '/F']);
  else job.child.kill('SIGTERM');
  return true;
}

const publicJob = j => j && {
  id: j.id, kind: j.kind, status: j.status, startedAt: j.startedAt, endedAt: j.endedAt, step: j.step,
  progress: j.progress, stats: j.stats, outputs: j.outputs, error: j.error, batch: j.batch, log: j.log.slice(-200),
};

// ---------- render options → CLI args ----------

function intIn(v, min, max, name) {
  const n = parseInt(v, 10);
  if (!(n >= min && n <= max)) throw Object.assign(new Error(`${name} must be between ${min} and ${max}`), { status: 400 });
  return String(n);
}

function validSize(v, name) {
  const n = parseFloat(v);
  if (!(n >= SIZE_RANGE[0] && n <= SIZE_RANGE[1])) {
    throw Object.assign(new Error(`${name} size must be between ${SIZE_RANGE[0] * 100}% and ${SIZE_RANGE[1] * 100}%`), { status: 400 });
  }
  return String(Math.round(n * 100) / 100);
}

// Validates background options from the UI; returns a clean object (missing keys are left out)
function cleanBackgroundOptions(b) {
  const bad = msg => Object.assign(new Error(msg), { status: 400 });
  const out = {};
  if (!b) return out;
  if (b.source !== undefined) { if (!['match', 'all'].includes(b.source)) throw bad('Invalid background source'); out.source = b.source; }
  if (b.order !== undefined) { if (!['rotate', 'shuffle', 'name'].includes(b.order)) throw bad('Invalid background order'); out.order = b.order; }
  for (const [k, [min, max]] of Object.entries(BG_LIMITS)) {
    if (b[k] === undefined) continue;
    const n = parseFloat(b[k]);
    if (!(n >= min && n <= max)) throw bad(`Background ${k} must be between ${min} and ${max}`);
    out[k] = k === 'max' ? Math.round(n) : Math.round(n * 100) / 100;
  }
  if (b.gradient !== undefined) {
    if (!Array.isArray(b.gradient) || b.gradient.length < 2 || b.gradient.length > 4 || !b.gradient.every(c => HEX_RE.test(c))) {
      throw bad('Gradient needs 2 to 4 #RRGGBB colours');
    }
    out.gradient = b.gradient.map(c => c.toUpperCase());
  }
  return out;
}

// Validates translation-audio settings from the UI
function cleanTranslationAudio(b) {
  const bad = msg => Object.assign(new Error(msg), { status: 400 });
  const out = { enabled: !!(b && b.enabled) };
  if (!b) return out;
  if (b.voice !== undefined) {
    if (!TRANSLATION_VOICES[b.voice]) throw bad('Unknown translation voice');
    out.voice = b.voice;
  }
  for (const [k, [min, max]] of Object.entries(TA_LIMITS)) {
    if (b[k] === undefined) continue;
    const n = parseFloat(b[k]);
    if (!(n >= min && n <= max)) throw bad(`Translation audio ${k} must be between ${min} and ${max}`);
    out[k] = Math.round(n * 100) / 100;
  }
  return out;
}

// Speech-service keys come from the browser with each request and are only passed to the child process
// environment — never written to disk or logged
function ttsEnv(keys) {
  const k = keys || {};
  const clean = v => String(v || '').trim().slice(0, 200);
  const env = {};
  if (k.azureKey) env.AZURE_SPEECH_KEY = clean(k.azureKey);
  if (k.azureRegion) env.AZURE_SPEECH_REGION = clean(k.azureRegion).toLowerCase();
  if (k.googleKey) env.GOOGLE_TTS_API_KEY = clean(k.googleKey);
  return env;
}

function buildArgs(o) {
  const bad = msg => Object.assign(new Error(msg), { status: 400 });
  const a = ['--surah', intIn(o.surah, 1, 114, 'Surah')];
  if (o.from) a.push('--from', intIn(o.from, 1, 286, 'From verse'));
  if (o.to) a.push('--to', intIn(o.to, 1, 286, 'To verse'));
  if (!RECITERS[o.reciter]) throw bad('Unknown reciter');
  if (!TRANSLATIONS.en[o.en]) throw bad('Unknown English translation');
  if (!TRANSLATIONS.bn[o.bn]) throw bad('Unknown Bangla translation');
  if (!['long', 'short'].includes(o.format)) throw bad('Unknown format');
  a.push('--reciter', o.reciter, '--en', o.en, '--bn', o.bn, '--format', o.format);
  if (o.batch) {
    a.push('--batch');
    if (o.groupSeconds) a.push('--group-seconds', intIn(o.groupSeconds, 0, 170, 'Group seconds'));
  }
  if (o.highlight === false) a.push('--no-highlight');
  if (o.intro === false) a.push('--no-intro');
  if (o.outro === false) a.push('--no-outro');
  if (o.watermark === false) a.push('--no-watermark');
  if (o.bismillah === false) a.push('--no-bismillah');
  // bg: 'auto' | 'gradient' | [clip ids in play order] (a single id string is still accepted)
  if (o.bg === 'gradient') a.push('--bg', 'gradient');
  else if (o.bg && o.bg !== 'auto') {
    const ids = Array.isArray(o.bg) ? o.bg : [o.bg];
    if (!ids.length) throw bad('Select at least one background clip');
    if (ids.length > MAX_REEL_CLIPS) throw bad(`Select at most ${MAX_REEL_CLIPS} background clips`);
    for (const id of ids) {
      const file = backgroundPath(id);
      if (!file) throw bad(`Background not found: ${id}`);
      a.push('--bg', file);
    }
  }
  for (const k of Object.keys(DEFAULT_COLORS)) {
    const c = o.colors && o.colors[k];
    if (c) {
      if (!HEX_RE.test(c)) throw bad(`Invalid colour for ${k}`);
      a.push(`--color-${k}`, c);
    }
  }
  for (const k of Object.keys(DEFAULT_SIZES)) {
    const s = o.sizes && o.sizes[k];
    if (s !== undefined && s !== null) a.push(`--size-${k}`, validSize(s, k));
  }
  const bo = cleanBackgroundOptions(o.bgOptions);
  const flags = { source: '--bg-source', order: '--bg-order', max: '--bg-max', clipSeconds: '--clip-seconds', dim: '--bg-dim', gradientSpeed: '--gradient-speed' };
  for (const [k, f] of Object.entries(flags)) if (bo[k] !== undefined) a.push(f, String(bo[k]));
  if (bo.gradient) a.push('--gradient', bo.gradient.join(','));
  if (o.translationAudio !== undefined) {
    const ta = cleanTranslationAudio(o.translationAudio);
    if (!ta.enabled) a.push('--no-bn-audio');
    else {
      a.push('--bn-audio');
      if (ta.voice) a.push('--bn-voice', ta.voice);
      if (ta.rate !== undefined) a.push('--bn-rate', String(ta.rate));
      if (ta.pauseAfterAyah !== undefined) a.push('--bn-pause-ayah', String(ta.pauseAfterAyah));
      if (ta.pauseAfterTranslation !== undefined) a.push('--bn-pause-translation', String(ta.pauseAfterTranslation));
    }
  }
  return a;
}

// ---------- API ----------

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/meta') {
    const chapters = await cachedJson('https://api.quran.com/api/v4/chapters', 'chapters.json');
    const count = sub => walk(path.join(BACKGROUNDS, sub), n => VIDEO_RE.test(n) || IMAGE_RE.test(n)).length;
    return send(res, 200, {
      ffmpeg: !!FFMPEG,
      reciters: Object.entries(RECITERS).map(([id, r]) => ({ id, name: r.name, timing: timingKind(r), group: r.group || 'main' })),
      translations: {
        en: Object.keys(TRANSLATIONS.en).map(id => ({ id, name: TRANSLATION_NAMES[id] })),
        bn: Object.keys(TRANSLATIONS.bn).map(id => ({ id, name: TRANSLATION_NAMES[id] })),
      },
      defaultColors: DEFAULT_COLORS,
      defaultSizes: DEFAULT_SIZES,
      defaultBackground: DEFAULT_BACKGROUND,
      translationVoices: Object.entries(TRANSLATION_VOICES).map(([id, v]) => ({ id, label: v.label, provider: v.provider })),
      defaultTranslationAudio: DEFAULT_TRANSLATION_AUDIO,
      translationAudioLimits: TA_LIMITS,
      // Same layout numbers the renderer uses, so the live preview sizes text identically
      layout: {
        formats: FORMATS, fontMetrics: FONT_METRICS, emRatio: emRatio(),
        gaps: VERSE_GAPS, referenceSize: REFERENCE_SIZE, watermarkSize: WATERMARK_SIZE,
      },
      backgroundLimits: BG_LIMITS,
      sizeRange: SIZE_RANGE,
      channel: { ...DEFAULT_CHANNEL, ...readChannel() },
      surahs: chapters.chapters.map(c => ({
        id: c.id, name: c.name_simple, arabic: c.name_arabic, meaning: c.translated_name.name, bangla: surahNameBn(c.id),
        verses: c.verses_count, place: c.revelation_place,
      })),
      backgrounds: { landscape: count('landscape'), portrait: count('portrait') },
    });
  }

  if (route === 'GET /api/verse') {
    const surah = intIn(url.searchParams.get('surah'), 1, 114, 'Surah');
    const verse = intIn(url.searchParams.get('verse') || 1, 1, 286, 'Verse');
    const en = TRANSLATIONS.en[url.searchParams.get('en')] || 20;
    const bn = TRANSLATIONS.bn[url.searchParams.get('bn')] || 161;
    const r = await fetch(`https://api.quran.com/api/v4/verses/by_key/${surah}:${verse}?translations=${en},${bn}&words=true&word_fields=text_uthmani`);
    if (!r.ok) return fail(res, 502, 'Could not load verse');
    const { verse: v } = await r.json();
    const tr = id => cleanTranslation((v.translations.find(t => t.resource_id === id) || {}).text);
    return send(res, 200, {
      key: v.verse_key, number: v.verse_number,
      words: v.words.filter(w => w.char_type_name === 'word').map(w => w.text_uthmani),
      en: tr(en), bn: tr(bn),
    });
  }

  if (route === 'PUT /api/channel') {
    const body = await readJson(req);
    const ch = readChannel();
    const str = (v, max) => String(v ?? '').slice(0, max);
    if ('name' in body) ch.name = str(body.name, 80);
    if ('handle' in body) ch.handle = str(body.handle, 60);
    if ('subscribeLine' in body) ch.subscribeLine = str(body.subscribeLine, 300);
    const secs = v => Math.max(0, Math.min(20, parseFloat(v) || 0));
    if (body.intro) ch.intro = { long: secs(body.intro.long), short: secs(body.intro.short) };
    if (body.outro) ch.outro = { long: secs(body.outro.long), short: secs(body.outro.short) };
    if (body.colors) {
      ch.colors = {};
      for (const k of Object.keys(DEFAULT_COLORS)) if (HEX_RE.test(body.colors[k] || '')) ch.colors[k] = body.colors[k].toUpperCase();
    }
    if (body.background) ch.background = { ...DEFAULT_BACKGROUND, ...cleanBackgroundOptions(body.background) };
    if (body.translationAudio) ch.translationAudio = { ...DEFAULT_TRANSLATION_AUDIO, ...cleanTranslationAudio(body.translationAudio) };
    if (body.fontScale) {
      ch.fontScale = {};
      for (const k of Object.keys(DEFAULT_SIZES)) ch.fontScale[k] = parseFloat(validSize(body.fontScale[k] ?? DEFAULT_SIZES[k], k));
    }
    writeChannel(ch);
    return send(res, 200, { channel: { ...DEFAULT_CHANNEL, ...ch } });
  }

  if (route === 'POST /api/logo') {
    const type = req.headers['content-type'] || '';
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[type];
    if (!ext) return fail(res, 400, 'Logo must be PNG, JPG or WebP');
    const buf = await readBody(req, 8e6);
    fs.mkdirSync(ASSETS, { recursive: true });
    for (const f of fs.readdirSync(ASSETS)) if (/^logo\./.test(f)) fs.unlinkSync(path.join(ASSETS, f));
    const file = path.join(ASSETS, `logo${ext}`);
    fs.writeFileSync(file, buf);
    const ch = readChannel();
    ch.logo = `assets/logo${ext}`;
    writeChannel(ch);
    return send(res, 200, { logo: ch.logo, url: mediaUrl(file) });
  }

  if (route === 'DELETE /api/logo') {
    const ch = readChannel();
    ch.logo = '';
    writeChannel(ch);
    return send(res, 200, { ok: true });
  }

  if (route === 'POST /api/render') {
    const body = await readJson(req);
    const j = startJob(body.batch ? 'batch' : 'video', 'make-video.js', buildArgs(body), ttsEnv(body.ttsKeys));
    return send(res, 200, { job: publicJob(j) });
  }

  // A single rendered frame so colours can be checked exactly as they will appear
  if (route === 'POST /api/preview') {
    const body = await readJson(req);
    const args = buildArgs({ ...body, batch: false, to: body.from });
    fs.mkdirSync(PREVIEWS, { recursive: true });
    for (const f of fs.readdirSync(PREVIEWS)) fs.unlinkSync(path.join(PREVIEWS, f));
    const file = path.join(PREVIEWS, `preview-${Date.now()}.png`);
    const out = await new Promise(resolve => {
      const p = spawn(process.execPath, ['make-video.js', ...args, '--still', file], { cwd: ROOT });
      let log = '';
      p.stdout.on('data', d => { log += d; });
      p.stderr.on('data', d => { log += d; });
      p.on('close', code => resolve({ code, log }));
    });
    if (out.code !== 0 || !fs.existsSync(file)) {
      const msg = (/✗\s*(.+)/.exec(out.log) || [])[1] || 'Preview failed';
      return fail(res, 500, msg);
    }
    return send(res, 200, { url: mediaUrl(file) });
  }

  // Speaks a short sample so the voice, speed and keys can be checked before rendering
  if (route === 'POST /api/tts-test') {
    const body = await readJson(req);
    const ta = { ...DEFAULT_TRANSLATION_AUDIO, ...cleanTranslationAudio({ ...body, enabled: true }) };
    const text = String(body.text || 'পরম করুণাময় অসীম দয়ালু আল্লাহর নামে').slice(0, 600);
    const file = await translationClip(text, 1, 1, ta, ttsEnv(body.ttsKeys))
      .catch(e => { throw Object.assign(new Error(e.message), { status: 400 }); });
    return send(res, 200, { url: mediaUrl(file) });
  }

  if (route === 'GET /api/job') return send(res, 200, { job: publicJob(job) });
  if (route === 'POST /api/job/cancel') return send(res, 200, { cancelled: cancelJob() });

  if (route === 'GET /api/library') {
    const items = walk(OUT, n => /\.mp4$/i.test(n)).map(file => {
      const st = fs.statSync(file);
      const read = ext => { const f = file.replace(/\.mp4$/i, ext); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
      const rel = path.relative(OUT, file);
      return {
        id: rel.split(path.sep).join('/'), name: path.basename(file), folder: path.dirname(rel) === '.' ? '' : path.dirname(rel),
        url: mediaUrl(file), size: st.size, modified: st.mtimeMs,
        // output/Shorts/… (current layout) or the older *_short.mp4 / *_shorts/ names
        format: /^Shorts[\\/]|_short\.mp4$|_shorts[\\/]/i.test(rel) ? 'short' : 'long',
        title: read('.title.txt').trim(), description: read('.description.txt'),
      };
    }).sort((a, b) => b.modified - a.modified);
    return send(res, 200, { items });
  }

  if (route === 'DELETE /api/library') {
    const id = url.searchParams.get('id') || '';
    const file = path.resolve(OUT, id);
    if (!file.startsWith(OUT + path.sep) || !/\.mp4$/i.test(file) || !fs.existsSync(file)) return fail(res, 404, 'Not found');
    for (const ext of ['.mp4', '.title.txt', '.description.txt']) {
      const f = file.replace(/\.mp4$/i, ext);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    return send(res, 200, { ok: true });
  }

  if (route === 'GET /api/backgrounds') {
    const credits = fs.existsSync(path.join(BACKGROUNDS, 'credits.json'))
      ? JSON.parse(fs.readFileSync(path.join(BACKGROUNDS, 'credits.json'), 'utf8')) : {};
    const files = walk(BACKGROUNDS, n => VIDEO_RE.test(n) || IMAGE_RE.test(n));
    const items = await Promise.all(files.map(async file => {
      const id = path.relative(BACKGROUNDS, file).split(path.sep).join('/');
      const st = fs.statSync(file);
      const meta = await clipMeta(file);
      const folder = id.split('/')[0];
      // Folder decides how the renderer uses it; fall back to the clip's own shape for loose files
      const orientation = ['landscape', 'portrait'].includes(folder) ? folder
        : meta.height > meta.width ? 'portrait' : 'landscape';
      return {
        id, name: path.basename(file), orientation, folder: id.includes('/') ? folder : '',
        // Actual shape of the clip (a landscape clip can live in the portrait folder)
        shape: meta.width && meta.height ? (meta.height > meta.width ? 'portrait' : 'landscape') : orientation,
        type: VIDEO_RE.test(file) ? 'video' : 'image',
        url: mediaUrl(file), thumb: `/api/backgrounds/thumb?id=${encodeURIComponent(id)}&v=${Math.round(st.mtimeMs)}`,
        size: st.size, modified: st.mtimeMs, ...meta, credit: credits[path.basename(file)] || '',
      };
    }));
    items.sort((a, b) => a.id.localeCompare(b.id));
    return send(res, 200, { items, maxClips: MAX_REEL_CLIPS });
  }

  if (route === 'GET /api/backgrounds/thumb') {
    const file = backgroundPath(url.searchParams.get('id'));
    if (!file) return fail(res, 404, 'Not found');
    const thumb = await clipThumb(file);
    if (!thumb) return IMAGE_RE.test(file) ? serveFile(req, res, file) : fail(res, 500, 'Could not create thumbnail');
    return serveFile(req, res, thumb, true);
  }

  if (route === 'DELETE /api/backgrounds') {
    const file = path.resolve(BACKGROUNDS, url.searchParams.get('id') || '');
    if (!file.startsWith(BACKGROUNDS + path.sep) || !fs.existsSync(file)) return fail(res, 404, 'Not found');
    fs.unlinkSync(file);
    return send(res, 200, { ok: true });
  }

  if (route === 'POST /api/backgrounds/upload') {
    const name = path.basename(url.searchParams.get('name') || '');
    const orientation = url.searchParams.get('orientation') === 'portrait' ? 'portrait' : 'landscape';
    if (!VIDEO_RE.test(name) && !IMAGE_RE.test(name)) return fail(res, 400, 'Upload a video (.mp4/.mov/.webm) or image (.jpg/.png/.webp)');
    const buf = await readBody(req, 500e6);
    const dir = path.join(BACKGROUNDS, orientation);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name.replace(/[^\w.\- ]/g, '_')), buf);
    return send(res, 200, { ok: true });
  }

  if (route === 'POST /api/backgrounds/fetch') {
    const body = await readJson(req);
    const providers = { pixabay: 'PIXABAY_API_KEY', pexels: 'PEXELS_API_KEY' };
    const provider = providers[body.provider] ? body.provider : 'pixabay';
    if (!body.key) return fail(res, 400, 'API key is required');
    const args = ['--provider', provider, '--count', intIn(body.count || 3, 1, 15, 'Count')];
    if (body.query) args.push('--query', String(body.query).slice(0, 80));
    if (['landscape', 'portrait', 'both'].includes(body.orientation)) args.push('--orientation', body.orientation);
    const j = startJob('backgrounds', 'fetch-backgrounds.js', args, { [providers[provider]]: String(body.key) });
    return send(res, 200, { job: publicJob(j) });
  }

  return fail(res, 404, 'Unknown endpoint');
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/media/')) return serveFile(req, res, mediaPath(url.pathname));
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(UI, rel);
    if (!file.startsWith(UI + path.sep)) return fail(res, 403, 'Forbidden');
    return serveFile(req, res, file);
  } catch (e) {
    if (!res.headersSent) fail(res, e.status || 500, e.message);
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — the studio may already be running at http://localhost:${PORT}`);
    console.error(`  Stop the other instance, or start on another port:  $env:PORT=4174; npm start\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Quran Video Studio running at http://localhost:${PORT}\n`);
  if (!FFMPEG) console.warn('  ! FFmpeg not found — install it with: winget install Gyan.FFmpeg\n');
});
