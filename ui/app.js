'use strict';

// ---------- Utilities ----------

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

async function api(path, { method = 'GET', json, body, headers } = {}) {
  const opts = { method, headers: { ...(headers || {}) } };
  if (json !== undefined) {
    opts.body = JSON.stringify(json);
    opts.headers['Content-Type'] = 'application/json';
  } else if (body !== undefined) {
    opts.body = body;
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

const ICONS = {
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="m7 4 13 8-13 8z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = (type === 'error' ? ICONS.alert : ICONS.check) + '<span></span>';
  el.querySelector('span').textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = b => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const fmtDate = ms => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const fmtClock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const toArabicDigits = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`${label} copied`); }
  catch { toast('Copy failed — select the text manually', 'error'); }
}

// ---------- Constants ----------

const COLOR_FIELDS = [
  ['arabic', 'Arabic text'],
  ['highlight', 'Highlighted word'],
  ['glow', 'Highlight glow'],
  ['english', 'English'],
  ['bangla', 'Bangla'],
  ['reference', 'Verse reference'],
];

const PRESETS = {
  'Classic gold': { arabic: '#FFD780', highlight: '#FFFFFF', glow: '#FFB400', english: '#FFFFFF', bangla: '#C8F0B4', reference: '#A0A0A0' },
  Emerald: { arabic: '#E9F7EF', highlight: '#7CFFC4', glow: '#00A86B', english: '#F2F2F2', bangla: '#BFEBD6', reference: '#8FB8A8' },
  Moonlight: { arabic: '#F4F1E8', highlight: '#FFFFFF', glow: '#7FA8FF', english: '#D9E2F2', bangla: '#C9D6EE', reference: '#8D99AE' },
  'Desert rose': { arabic: '#FFE3C7', highlight: '#FFFFFF', glow: '#FF7A59', english: '#FFF4EC', bangla: '#FFD1B8', reference: '#B79A8B' },
  Ivory: { arabic: '#FFFFFF', highlight: '#FFD24A', glow: '#C77700', english: '#E8E8E8', bangla: '#F5E6B8', reference: '#9A9A9A' },
};

// Mirrors FORMATS in make-video.js so the live preview matches the render layout
const FORMATS = {
  long: { w: 1920, h: 1080, ar: 112, en: 44, bn: 48, header: 34, margin: 160, budget: 380 },
  short: { w: 1080, h: 1920, ar: 128, en: 54, bn: 60, header: 44, margin: 70, budget: 440 },
};

// ---------- State ----------

let meta = null;
let backgrounds = [];
let library = [];
let verse = null;
let highlightIndex = -1;

const state = Object.assign({
  surah: 1, from: 1, to: 7,
  reciter: 'alafasy', en: 'saheeh', bn: 'taisirul',
  mode: 'single', format: 'long', groupSeconds: 0, bg: 'auto',
  highlight: true, intro: true, outro: true, watermark: true, bismillah: true,
  colors: null, preview: 'live',
}, store.get('qvs-state', {}));
state.preview = 'live';

const saveState = debounce(() => store.set('qvs-state', state), 200);
const surahOf = id => meta.surahs.find(s => s.id === +id);
const effectiveFormat = () => (state.mode === 'batch' ? 'short' : state.format);

function payload() {
  return {
    surah: state.surah, from: state.from, to: state.to,
    reciter: state.reciter, en: state.en, bn: state.bn,
    format: effectiveFormat(), batch: state.mode === 'batch', groupSeconds: state.groupSeconds,
    highlight: state.highlight, intro: state.intro, outro: state.outro,
    watermark: state.watermark, bismillah: state.bismillah,
    bg: state.bg, colors: state.colors,
  };
}

// ---------- Navigation ----------

function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'library') loadLibrary();
  if (name === 'backgrounds') loadBackgrounds();
  history.replaceState(null, '', `#${name}`);
  window.scrollTo({ top: 0 });
}

$$('.nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (meta && ['create', 'library', 'branding', 'backgrounds'].includes(view)) showView(view);
});
document.addEventListener('click', e => {
  const go = e.target.closest('[data-goto]');
  if (go) { e.preventDefault(); showView(go.dataset.goto); }
});

$('#themeToggle').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('qvs-theme', next); } catch { /* ignore */ }
});

// ---------- Segmented controls ----------

function bindSegmented(el, onChange) {
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    setSegmented(el, b.dataset.value);
    onChange(b.dataset.value);
  });
}
const setSegmented = (el, value) => $$('button', el).forEach(b => b.classList.toggle('active', b.dataset.value === value));

// ---------- Surah combobox ----------

function renderSurahButton() {
  const s = surahOf(state.surah);
  if (!s) return;
  $('#surahNum').textContent = s.id;
  $('#surahName').textContent = s.name;
  $('#surahMeta').textContent = `${s.meaning} · ${s.verses} verses · ${s.place === 'madinah' ? 'Madani' : 'Makki'}`;
  $('#surahArabic').textContent = s.arabic;
}

function renderSurahList(query = '') {
  const q = query.trim().toLowerCase();
  const items = meta.surahs.filter(s => !q || String(s.id) === q || s.name.toLowerCase().includes(q) || s.meaning.toLowerCase().includes(q));
  $('#surahList').innerHTML = items.map((s, i) => `
    <li role="option" data-id="${s.id}" class="${s.id === state.surah ? 'selected' : ''} ${i === 0 && q ? 'focus' : ''}">
      <span class="n">${s.id}</span>
      <span class="t">${esc(s.name)}<small>${esc(s.meaning)} · ${s.verses} verses</small></span>
      <span class="a" dir="rtl">${esc(s.arabic)}</span>
    </li>`).join('') || '<li class="empty-li">No match</li>';
}

function openSurahPop(open) {
  $('#surahPop').hidden = !open;
  if (open) {
    $('#surahSearch').value = '';
    renderSurahList();
    $('#surahSearch').focus();
    $('#surahList .selected')?.scrollIntoView({ block: 'center' });
  }
}

function selectSurah(id, from, to) {
  const s = surahOf(id);
  state.surah = s.id;
  state.from = from || 1;
  state.to = to || s.verses;
  syncPassage();
  onPassageChange();
}

$('#surahBtn').addEventListener('click', () => openSurahPop($('#surahPop').hidden));
$('#surahSearch').addEventListener('input', e => renderSurahList(e.target.value));
$('#surahSearch').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const li = $('#surahList li[data-id]');
    if (li) { selectSurah(+li.dataset.id); openSurahPop(false); }
  }
  if (e.key === 'Escape') { openSurahPop(false); $('#surahBtn').focus(); }
});
$('#surahList').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]');
  if (li) { selectSurah(+li.dataset.id); openSurahPop(false); }
});
document.addEventListener('click', e => { if (!e.target.closest('#surahCombo')) $('#surahPop').hidden = true; });

// ---------- Passage ----------

function syncPassage() {
  const s = surahOf(state.surah);
  state.from = Math.min(Math.max(1, state.from | 0), s.verses);
  state.to = Math.min(Math.max(state.from, state.to | 0), s.verses);
  $('#fromVerse').value = state.from;
  $('#toVerse').value = state.to;
  $('#fromVerse').max = $('#toVerse').max = s.verses;
  $('#verseHint').textContent = `of ${s.verses}`;
  renderSurahButton();
}

$('#fromVerse').addEventListener('change', e => { state.from = +e.target.value; if (state.to < state.from) state.to = state.from; syncPassage(); onPassageChange(); });
$('#toVerse').addEventListener('change', e => { state.to = +e.target.value; syncPassage(); onPassageChange(); });

$('#quickPicks').addEventListener('click', e => {
  const b = e.target.closest('[data-pick]');
  if (!b) return;
  if (b.dataset.pick === 'full') return selectSurah(state.surah);
  const [s, range] = b.dataset.pick.split(':');
  const [from, to] = range.split('-').map(Number);
  selectSurah(+s, from, to);
});

function onPassageChange() {
  saveState();
  updateSummary();
  loadVerse();
  invalidateFrame();
}

// ---------- Recitation & output ----------

function fillSelect(el, items, value) {
  el.innerHTML = items.map(i => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
  el.value = value;
}

function updateReciterNote() {
  const r = meta.reciters.find(x => x.id === state.reciter);
  const note = $('#reciterNote');
  note.textContent = r && r.wordTimings
    ? 'Word timings available — word-by-word highlighting supported.'
    : 'No word timings for this reciter — highlighting will be off.';
  $('#optHighlight').disabled = !(r && r.wordTimings);
}

$('#reciter').addEventListener('change', e => { state.reciter = e.target.value; updateReciterNote(); saveState(); updateSummary(); invalidateFrame(); });
$('#enTr').addEventListener('change', e => { state.en = e.target.value; saveState(); loadVerse(); invalidateFrame(); });
$('#bnTr').addEventListener('change', e => { state.bn = e.target.value; saveState(); loadVerse(); invalidateFrame(); });

bindSegmented($('#modeSeg'), v => { state.mode = v; applyMode(); });
bindSegmented($('#formatSeg'), v => { state.format = v; applyMode(); });
$('#groupSeconds').addEventListener('change', e => { state.groupSeconds = Math.max(0, Math.min(170, +e.target.value || 0)); saveState(); updateSummary(); });
$('#bgSelect').addEventListener('change', e => { state.bg = e.target.value; saveState(); invalidateFrame(); });

function applyMode() {
  const batch = state.mode === 'batch';
  $('#groupField').hidden = !batch;
  $$('#formatSeg button').forEach(b => { b.disabled = batch && b.dataset.value === 'long'; });
  setSegmented($('#formatSeg'), effectiveFormat());
  $('#btnRenderLabel').textContent = batch ? 'Render Shorts' : 'Render video';
  $('#stage').className = `stage ${effectiveFormat()}`;
  fillBackgroundSelect();
  saveState();
  updateSummary();
  renderStage();
  invalidateFrame();
}

function fillBackgroundSelect() {
  const orientation = effectiveFormat() === 'short' ? 'portrait' : 'landscape';
  const clips = backgrounds.filter(b => b.orientation === orientation);
  const opts = [
    { id: 'auto', name: clips.length ? `Auto — cycle ${clips.length} ${orientation} clip${clips.length > 1 ? 's' : ''}` : 'Auto — animated gradient (no clips yet)' },
    { id: 'gradient', name: 'Animated gradient' },
    ...clips.map(c => ({ id: c.id, name: `Clip: ${c.name}` })),
  ];
  if (!opts.some(o => o.id === state.bg)) state.bg = 'auto';
  fillSelect($('#bgSelect'), opts, state.bg);
}

const TOGGLES = { optHighlight: 'highlight', optIntro: 'intro', optOutro: 'outro', optWatermark: 'watermark', optBismillah: 'bismillah' };
for (const [id, key] of Object.entries(TOGGLES)) {
  $(`#${id}`).addEventListener('change', e => {
    state[key] = e.target.checked;
    saveState();
    updateSummary();
    renderStage();
    invalidateFrame();
  });
}

function updateSummary() {
  if (!meta) return;
  const s = surahOf(state.surah);
  const r = meta.reciters.find(x => x.id === state.reciter);
  const full = state.from === 1 && state.to === s.verses;
  const range = full ? 'Full surah' : state.from === state.to ? `Verse ${state.from}` : `Verses ${state.from}–${state.to}`;
  $('#renderTitle').textContent = `Surah ${s.name} · ${range}`;
  const count = state.to - state.from + 1;
  const what = state.mode === 'batch'
    ? (state.groupSeconds ? `Up to ${count} Shorts (≥ ${state.groupSeconds}s each)` : `${count} Short${count > 1 ? 's' : ''}, one per verse`)
    : effectiveFormat() === 'short' ? 'Short · 9:16' : 'Video · 16:9';
  $('#renderSub').textContent = `${what} · ${r ? r.name : ''}`;
}

// ---------- Colours ----------

function renderColorControls() {
  $('#colorPresets').innerHTML = Object.entries(PRESETS).map(([name, p]) => `
    <button class="preset" data-preset="${esc(name)}">
      <span class="dots">${['arabic', 'highlight', 'glow', 'bangla'].map(k => `<i style="background:${p[k]}"></i>`).join('')}</span>${esc(name)}
    </button>`).join('');
  $('#colorList').innerHTML = COLOR_FIELDS.map(([key, label]) => `
    <div class="color-row">
      <label class="swatch" style="background:${state.colors[key]}" title="Pick ${esc(label)} colour">
        <input type="color" data-color="${key}" value="${state.colors[key]}" aria-label="${esc(label)} colour">
      </label>
      <div class="meta"><b>${esc(label)}</b>
        <input class="hex" data-hex="${key}" value="${state.colors[key]}" maxlength="7" spellcheck="false" aria-label="${esc(label)} hex">
      </div>
    </div>`).join('');
}

function setColor(key, value) {
  state.colors[key] = value.toUpperCase();
  const row = $(`[data-color="${key}"]`).closest('.color-row');
  $('.swatch', row).style.background = value;
  $('[data-color]', row).value = value.toLowerCase();
  const hex = $('[data-hex]', row);
  if (document.activeElement !== hex) hex.value = value.toUpperCase();
  hex.classList.remove('invalid');
  saveState();
  renderStage();
  invalidateFrame();
}

$('#colorList').addEventListener('input', e => {
  if (e.target.dataset.color) setColor(e.target.dataset.color, e.target.value);
  if (e.target.dataset.hex) {
    let v = e.target.value.trim();
    if (!v.startsWith('#')) v = `#${v}`;
    const ok = /^#[0-9a-f]{6}$/i.test(v);
    e.target.classList.toggle('invalid', !ok);
    if (ok) setColor(e.target.dataset.hex, v);
  }
});
$('#colorList').addEventListener('focusout', e => {
  if (e.target.dataset.hex) { e.target.value = state.colors[e.target.dataset.hex]; e.target.classList.remove('invalid'); }
});
$('#colorPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  const p = PRESETS[b.dataset.preset];
  Object.entries(p).forEach(([k, v]) => setColor(k, v));
});
$('#btnResetColors').addEventListener('click', () => {
  const base = { ...meta.defaultColors, ...(meta.channel.colors || {}) };
  Object.entries(base).forEach(([k, v]) => setColor(k, v));
  toast('Colours reset to your channel default');
});
$('#btnSaveColors').addEventListener('click', async () => {
  try {
    const { channel } = await api('/api/channel', { method: 'PUT', json: { colors: state.colors } });
    meta.channel = channel;
    renderDefaultSwatches();
    toast('Saved as channel default colours');
  } catch (e) { toast(e.message, 'error'); }
});

function renderDefaultSwatches() {
  const c = { ...meta.defaultColors, ...(meta.channel.colors || {}) };
  $('#defaultSwatches').innerHTML = COLOR_FIELDS.map(([k, label]) =>
    `<span class="swatch-chip"><i style="background:${c[k]}"></i>${esc(label)}</span>`).join('');
}

// ---------- Live preview ----------

const loadVerse = debounce(async () => {
  try {
    verse = await api(`/api/verse?surah=${state.surah}&verse=${state.from}&en=${state.en}&bn=${state.bn}`);
    highlightIndex = -1;
    renderStage();
  } catch (e) {
    verse = null;
    renderStage();
  }
}, 250);

function renderStage() {
  if (!meta) return;
  const fmt = FORMATS[effectiveFormat()];
  const stage = $('#stage');
  const scale = stage.clientWidth / fmt.w;
  if (!scale) return;
  const c = state.colors;
  const s = surahOf(state.surah);
  const px = n => `${(n * scale).toFixed(2)}px`;

  $('#stHeader').textContent = `Surah ${s.name} · ${s.meaning}`;
  $('#stHeader').style.fontSize = px(fmt.header);

  const words = verse ? verse.words : ['…'];
  const en = verse ? verse.en : 'Loading verse…';
  const bn = verse ? verse.bn : '';
  // Same shrink rule as make-video.js
  const len = words.join(' ').length * 1.3 + en.length * 0.5 + bn.length * 0.5;
  const k = Math.max(0.42, Math.min(1, Math.sqrt(fmt.budget / len)));

  const body = $('#stBody');
  body.style.padding = `0 ${px(fmt.margin)}`;

  const ar = $('#stArabic');
  ar.style.fontSize = px(fmt.ar * k);
  ar.style.color = c.arabic;
  ar.innerHTML = words.map((w, i) => `<span class="w" data-i="${i}">${esc(w)}</span>`).join(' ')
    + (verse ? ` <span class="num">﴿${toArabicDigits(verse.number)}﴾</span>` : '');
  paintHighlight();

  const enEl = $('#stEnglish');
  enEl.textContent = en;
  enEl.style.cssText = `font-size:${px(fmt.en * k)};color:${c.english};margin-top:${px(24 * k)}`;
  const bnEl = $('#stBangla');
  bnEl.textContent = bn;
  bnEl.style.cssText = `font-size:${px(fmt.bn * k)};color:${c.bangla};margin-top:${px(14 * k)}`;
  const ref = $('#stRef');
  ref.textContent = verse ? `${s.name} ${verse.key}` : '';
  ref.style.cssText = `font-size:${px(28 * k)};color:${c.reference};margin-top:${px(20 * k)}`;

  const wm = $('#stWatermark');
  wm.hidden = !state.watermark;
  const ch = meta.channel;
  if (ch.logo && ch.logoUrl) {
    wm.innerHTML = `<img src="${esc(ch.logoUrl)}" alt="" style="height:${px(fmt.h * (effectiveFormat() === 'short' ? 0.045 : 0.07))}">`;
  } else {
    wm.textContent = ch.handle || ch.name || '';
    wm.style.fontSize = px(28);
  }
}

function paintHighlight() {
  const c = state.colors;
  const fmt = FORMATS[effectiveFormat()];
  const scale = $('#stage').clientWidth / fmt.w;
  $$('#stArabic .w').forEach(w => {
    const on = state.highlight && +w.dataset.i === highlightIndex;
    w.style.color = on ? c.highlight : '';
    w.style.textShadow = on
      ? `0 0 ${4 * scale + 2}px ${c.glow}, 0 0 ${10 * scale + 4}px ${c.glow}, 0 0 2px ${c.glow}`
      : '';
  });
}

// Walk the highlight through the words like the recitation does
setInterval(() => {
  if (!verse || state.preview !== 'live' || !$('#view-create').classList.contains('active')) return;
  highlightIndex = highlightIndex + 1 >= verse.words.length ? -1 : highlightIndex + 1;
  paintHighlight();
}, 650);

new ResizeObserver(() => renderStage()).observe($('#stage'));

// ---------- Rendered frame ----------

let frameUrl = null;

function invalidateFrame() {
  frameUrl = null;
  if (state.preview === 'frame') applyPreviewMode();
}

function applyPreviewMode() {
  const frame = state.preview === 'frame';
  $('#stageLive').hidden = frame;
  $('#stageFrame').hidden = !frame || !frameUrl;
  $('#stageEmpty').hidden = !frame || !!frameUrl;
  if (frameUrl) $('#stageFrame').src = frameUrl;
  $('#previewNote').textContent = frame
    ? `Exact render of verse ${state.from}, captured mid-recitation.`
    : 'Live preview is an approximation. Use “Rendered frame” to see the exact result.';
}

bindSegmented($('#previewSeg'), v => { state.preview = v; applyPreviewMode(); });

async function renderFrame() {
  state.preview = 'frame';
  setSegmented($('#previewSeg'), 'frame');
  $('#stageLoading').hidden = false;
  $('#stageEmpty').hidden = true;
  $('#stageLive').hidden = true;
  $$('#btnPreviewFrame, #btnFrameInline').forEach(b => { b.disabled = true; });
  try {
    const { url } = await api('/api/preview', { method: 'POST', json: payload() });
    frameUrl = `${url}?t=${Date.now()}`;
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    $('#stageLoading').hidden = true;
    $$('#btnPreviewFrame, #btnFrameInline').forEach(b => { b.disabled = false; });
    applyPreviewMode();
  }
}
$('#btnPreviewFrame').addEventListener('click', renderFrame);
$('#btnFrameInline').addEventListener('click', renderFrame);

// ---------- Jobs ----------

let pollTimer = null;
let lastJobId = null;
let lastJobStatus = null;

$('#btnRender').addEventListener('click', async () => {
  try {
    const { job } = await api('/api/render', { method: 'POST', json: payload() });
    showJob(job);
    pollJob();
  } catch (e) { toast(e.message, 'error'); }
});

async function pollJob(initial = false) {
  clearTimeout(pollTimer);
  try {
    const { job } = await api('/api/job');
    if (!job) return;
    // On page load, only reopen the panel for a job that is still running
    if (initial && job.status !== 'running') { lastJobId = job.id; lastJobStatus = job.status; return; }
    showJob(job);
    if (job.status === 'running') pollTimer = setTimeout(pollJob, 800);
  } catch {
    pollTimer = setTimeout(pollJob, 2000);
  }
}

function showJob(job) {
  const panel = $('#job');
  const isNew = job.id !== lastJobId;
  if (isNew) { panel.hidden = false; $('#jobLog').hidden = true; }
  lastJobId = job.id;
  panel.className = `job ${job.status}`;

  const titles = {
    running: { video: 'Rendering video', batch: 'Rendering Shorts', backgrounds: 'Downloading backgrounds' },
    done: { video: 'Video ready', batch: 'Shorts ready', backgrounds: 'Backgrounds downloaded' },
  };
  $('#jobTitle').textContent = job.status === 'running' ? titles.running[job.kind]
    : job.status === 'done' ? titles.done[job.kind]
    : job.status === 'cancelled' ? 'Cancelled' : 'Something went wrong';
  $('#jobIcon').innerHTML = job.status === 'running' ? '<span class="spinner"></span>'
    : job.status === 'done' ? ICONS.check : ICONS.alert;

  $('#jobStep').textContent = job.step || '';
  const pct = Math.round((job.progress || 0) * 100);
  $('#jobBar').style.width = `${job.status === 'running' && pct === 0 ? 3 : pct}%`;
  $('#jobPct').textContent = job.kind === 'backgrounds' && job.status === 'running' ? '' : `${pct}%`;
  const end = job.endedAt || Date.now();
  $('#jobElapsed').textContent = fmtClock((end - job.startedAt) / 1000);

  const log = $('#jobLog');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  log.textContent = job.log.join('\n') + (job.stats ? `\n${job.stats}` : '');
  if (atBottom) log.scrollTop = log.scrollHeight;

  $('#jobError').hidden = !job.error || job.status !== 'error';
  $('#jobError').textContent = job.error || '';

  $('#jobOutputs').innerHTML = job.outputs.filter(o => o.url).slice(-20).map(o =>
    `<a href="${esc(o.url)}" target="_blank" rel="noopener">${ICONS.play}${esc(o.file)}</a>`).join('');

  $('#jobCancel').hidden = job.status !== 'running';
  $('#jobOpenLibrary').hidden = !(job.status === 'done' && job.kind !== 'backgrounds');

  if (lastJobStatus === 'running' && job.status !== 'running') {
    if (job.status === 'done') toast(titles.done[job.kind]);
    if (job.status === 'error') toast(job.error || 'Job failed', 'error');
    if (job.kind === 'backgrounds') loadBackgrounds();
    else loadLibrary();
  }
  lastJobStatus = job.status;
}

$('#jobCancel').addEventListener('click', async () => {
  await api('/api/job/cancel', { method: 'POST' }).catch(e => toast(e.message, 'error'));
  pollJob();
});
$('#jobClose').addEventListener('click', () => { $('#job').hidden = true; });
$('#jobLogToggle').addEventListener('click', () => {
  const log = $('#jobLog');
  log.hidden = !log.hidden;
  log.scrollTop = log.scrollHeight;
});
$('#jobOpenLibrary').addEventListener('click', () => showView('library'));

// ---------- Library ----------

let libraryFilter = 'all';

async function loadLibrary() {
  try {
    library = (await api('/api/library')).items;
    $('#libraryCount').textContent = library.length || '';
    renderLibrary();
  } catch (e) { toast(e.message, 'error'); }
}

function renderLibrary() {
  const q = $('#librarySearch').value.trim().toLowerCase();
  const items = library.filter(v => (libraryFilter === 'all' || v.format === libraryFilter)
    && (!q || `${v.title} ${v.name} ${v.folder}`.toLowerCase().includes(q)));
  $('#libraryEmpty').hidden = library.length > 0;
  $('#libraryGrid').innerHTML = items.map(v => `
    <article class="card vcard ${v.format}" data-id="${esc(v.id)}">
      <div class="player"><video src="${esc(v.url)}#t=2.5" preload="metadata" controls playsinline></video></div>
      <div class="body">
        <div class="title">${esc(v.title || v.name)}</div>
        <div class="meta">
          <span class="tag ${v.format}">${v.format === 'short' ? 'Short' : 'Video'}</span>
          <span>${fmtSize(v.size)}</span><span>·</span><span>${fmtDate(v.modified)}</span>
        </div>
        <pre hidden>${esc(v.description)}</pre>
        <div class="actions">
          <button class="btn sm" data-act="title">${ICONS.copy}Title</button>
          <button class="btn sm" data-act="desc">${ICONS.copy}Description</button>
          <span class="spacer"></span>
          <button class="icon-btn sm" data-act="toggle" title="Show description" aria-label="Show description">${ICONS.text}</button>
          <a class="icon-btn sm" href="${esc(v.url)}" download title="Download" aria-label="Download">${ICONS.download}</a>
          <button class="icon-btn sm danger-text" data-act="delete" title="Delete" aria-label="Delete">${ICONS.trash}</button>
        </div>
      </div>
    </article>`).join('');
  if (library.length && !items.length) {
    $('#libraryGrid').innerHTML = '<p class="field-note">No videos match your search.</p>';
  }
}

$('#libraryGrid').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const card = b.closest('.vcard');
  const v = library.find(x => x.id === card.dataset.id);
  if (b.dataset.act === 'title') copy(v.title || v.name, 'Title');
  if (b.dataset.act === 'desc') copy(v.description, 'Description');
  if (b.dataset.act === 'toggle') { const pre = $('pre', card); pre.hidden = !pre.hidden; }
  if (b.dataset.act === 'delete') {
    if (!confirm(`Delete "${v.title || v.name}"? This removes the video and its title/description files.`)) return;
    try { await api(`/api/library?id=${encodeURIComponent(v.id)}`, { method: 'DELETE' }); toast('Video deleted'); loadLibrary(); }
    catch (err) { toast(err.message, 'error'); }
  }
});
$('#librarySearch').addEventListener('input', debounce(renderLibrary, 120));
bindSegmented($('#libraryFilter'), v => { libraryFilter = v; renderLibrary(); });
$('#btnRefreshLibrary').addEventListener('click', loadLibrary);

// ---------- Branding ----------

function fillBranding() {
  const ch = meta.channel;
  $('#brandName').textContent = ch.name || 'Quran Studio';
  document.title = `${ch.name || 'Quran'} · Video Studio`;
  $('#chName').value = ch.name || '';
  $('#chHandle').value = ch.handle || '';
  $('#chSubscribe').value = ch.subscribeLine || '';
  $('#introLong').value = ch.intro?.long ?? 5;
  $('#introShort').value = ch.intro?.short ?? 1.5;
  $('#outroLong').value = ch.outro?.long ?? 6;
  $('#outroShort').value = ch.outro?.short ?? 2.5;
  ch.logoUrl = ch.logo ? `/media/assets/${encodeURIComponent(ch.logo.split('/').pop())}?t=${Date.now()}` : '';
  $('#logoPreview').hidden = !ch.logo;
  $('#logoEmpty').hidden = !!ch.logo;
  if (ch.logo) $('#logoPreview').src = ch.logoUrl;
  $('#btnRemoveLogo').disabled = !ch.logo;
  renderDefaultSwatches();
}

$('#btnSaveBranding').addEventListener('click', async () => {
  try {
    const { channel } = await api('/api/channel', {
      method: 'PUT',
      json: {
        name: $('#chName').value.trim(), handle: $('#chHandle').value.trim(), subscribeLine: $('#chSubscribe').value.trim(),
        intro: { long: $('#introLong').value, short: $('#introShort').value },
        outro: { long: $('#outroLong').value, short: $('#outroShort').value },
      },
    });
    meta.channel = channel;
    fillBranding();
    renderStage();
    toast('Branding saved');
  } catch (e) { toast(e.message, 'error'); }
});

async function uploadLogo(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Logo must be PNG, JPG or WebP', 'error');
  try {
    const { logo } = await api('/api/logo', { method: 'POST', body: file, headers: { 'Content-Type': file.type } });
    meta.channel.logo = logo;
    fillBranding();
    renderStage();
    toast('Logo uploaded');
  } catch (e) { toast(e.message, 'error'); }
}

function bindDrop(zone, input, onFiles) {
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); onFiles([...e.dataTransfer.files]); });
  input.addEventListener('change', () => { onFiles([...input.files]); input.value = ''; });
}

bindDrop($('#logoDrop'), $('#logoInput'), files => uploadLogo(files[0]));
$('#btnChooseLogo').addEventListener('click', () => $('#logoInput').click());
$('#btnRemoveLogo').addEventListener('click', async () => {
  try {
    await api('/api/logo', { method: 'DELETE' });
    meta.channel.logo = '';
    fillBranding();
    renderStage();
    toast('Logo removed');
  } catch (e) { toast(e.message, 'error'); }
});

// ---------- Backgrounds ----------

let bgFilter = 'landscape';

async function loadBackgrounds() {
  try {
    backgrounds = (await api('/api/backgrounds')).items;
    renderClips();
    fillBackgroundSelect();
  } catch (e) { toast(e.message, 'error'); }
}

function renderClips() {
  const items = backgrounds.filter(b => b.orientation === bgFilter);
  $('#clipEmpty').hidden = items.length > 0;
  $('#clipGrid').innerHTML = items.map(b => `
    <div class="clip ${b.orientation}" data-id="${esc(b.id)}">
      ${b.type === 'video'
        ? `<video src="${esc(b.url)}#t=1" muted loop playsinline preload="metadata"></video>`
        : `<img src="${esc(b.url)}" alt="" loading="lazy">`}
      <div class="cap"><b>${esc(b.name)}</b><span>${esc(b.credit || fmtSize(b.size))}</span></div>
      <button class="icon-btn sm del" data-del title="Remove clip" aria-label="Remove clip">${ICONS.trash}</button>
    </div>`).join('');
}

$('#clipGrid').addEventListener('mouseover', e => { const v = e.target.closest('.clip')?.querySelector('video'); if (v) v.play().catch(() => {}); });
$('#clipGrid').addEventListener('mouseout', e => { const v = e.target.closest('.clip')?.querySelector('video'); if (v && !e.relatedTarget?.closest?.('.clip')) v.pause(); });
$('#clipGrid').addEventListener('click', async e => {
  if (!e.target.closest('[data-del]')) return;
  const id = e.target.closest('.clip').dataset.id;
  if (!confirm(`Remove ${id}?`)) return;
  try { await api(`/api/backgrounds?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); loadBackgrounds(); }
  catch (err) { toast(err.message, 'error'); }
});
bindSegmented($('#bgFilter'), v => { bgFilter = v; renderClips(); });

const PROVIDER_INFO = {
  pixabay: {
    label: 'Pixabay', link: 'https://pixabay.com/api/docs/',
    note: 'Stored only in this browser. Pixabay has few vertical clips, so Shorts may use centre-cropped landscape clips.',
  },
  pexels: {
    label: 'Pexels', link: 'https://www.pexels.com/api/',
    note: 'Stored only in this browser. Pexels has paused new API keys — use this only if you already have one.',
  },
};
let provider = store.get('qvs-bg-provider', 'pixabay');
const keyStore = () => `qvs-${provider}-key`;

function applyProvider() {
  const info = PROVIDER_INFO[provider];
  setSegmented($('#providerSeg'), provider);
  $('#providerKeyLabel').textContent = `${info.label} API key`;
  $('#providerKeyLink').href = info.link;
  $('#providerNote').textContent = info.note;
  $('#pexelsKey').value = store.get(keyStore(), '');
}
bindSegmented($('#providerSeg'), v => { provider = v; store.set('qvs-bg-provider', v); applyProvider(); });
applyProvider();
$('#pexelsKey').addEventListener('change', e => store.set(keyStore(), e.target.value.trim()));

$('#btnFetchBg').addEventListener('click', async () => {
  const key = $('#pexelsKey').value.trim();
  if (!key) { toast(`Add your ${PROVIDER_INFO[provider].label} API key first`, 'error'); $('#pexelsKey').focus(); return; }
  store.set(keyStore(), key);
  try {
    const { job } = await api('/api/backgrounds/fetch', {
      method: 'POST',
      json: { provider, key, query: $('#pexelsQuery').value.trim(), count: $('#pexelsCount').value, orientation: $('#pexelsOrientation').value },
    });
    showJob(job);
    pollJob();
  } catch (e) { toast(e.message, 'error'); }
});

bindDrop($('#bgDrop'), $('#bgInput'), async files => {
  const orientation = $('#bgUploadOrientation').value;
  for (const f of files) {
    try {
      await api(`/api/backgrounds/upload?orientation=${orientation}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      toast(`Uploaded ${f.name}`);
    } catch (e) { toast(`${f.name}: ${e.message}`, 'error'); }
  }
  bgFilter = orientation;
  setSegmented($('#bgFilter'), orientation);
  loadBackgrounds();
});

// ---------- Init ----------

async function init() {
  try {
    meta = await api('/api/meta');
  } catch (e) {
    toast(`Could not load data: ${e.message}`, 'error');
    return;
  }

  const pill = $('#ffmpegStatus');
  pill.classList.add(meta.ffmpeg ? 'ok' : 'bad');
  $('span:last-child', pill).textContent = meta.ffmpeg ? 'FFmpeg ready' : 'FFmpeg missing';
  pill.title = meta.ffmpeg ? '' : 'Install with: winget install Gyan.FFmpeg';

  state.colors = { ...meta.defaultColors, ...(meta.channel.colors || {}), ...(state.colors || {}) };
  if (!surahOf(state.surah)) state.surah = 1;

  fillSelect($('#reciter'), meta.reciters.map(r => ({ id: r.id, name: r.wordTimings ? r.name : `${r.name} (no highlighting)` })), state.reciter);
  fillSelect($('#enTr'), meta.translations.en, state.en);
  fillSelect($('#bnTr'), meta.translations.bn, state.bn);
  updateReciterNote();

  for (const [id, key] of Object.entries(TOGGLES)) $(`#${id}`).checked = state[key];
  $('#groupSeconds').value = state.groupSeconds;
  setSegmented($('#modeSeg'), state.mode);

  fillBranding();
  renderColorControls();
  syncPassage();

  backgrounds = (await api('/api/backgrounds').catch(() => ({ items: [] }))).items;
  applyMode();
  loadVerse();
  loadLibrary();
  pollJob(true);

  const view = location.hash.slice(1);
  if (['create', 'library', 'branding', 'backgrounds'].includes(view)) showView(view);
}

init();
