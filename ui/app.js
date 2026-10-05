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

// Filled from /api/meta with the renderer's own layout numbers, so the live preview matches the render
const FORMATS = {};
let LAYOUT = null;
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]/g;

// Same calculation as verseFit() in make-video.js: keep the chosen sizes unless the verse would overflow
function verseFit(words, en, bn, fmt, size) {
  const m = LAYOUT.fontMetrics;
  const r = LAYOUT.emRatio;
  const g = LAYOUT.gaps;
  const width = fmt.w - 2 * fmt.margin;
  const room = fmt.h * fmt.fill;
  const blocks = [
    [(words.join(' ') + ' ﴿٠﴾').replace(ARABIC_MARKS, '').length * m.arabic, fmt.ar * size.arabic * r.arabic],
    [en.length * m.english, fmt.en * size.english * r.latin],
    [bn.length * m.bangla, fmt.bn * size.bangla * r.bangla],
  ];
  const extra = g.afterArabic + g.afterEnglish + g.beforeReference + LAYOUT.referenceSize * r.latin;
  const height = k => blocks.reduce((h, [em, fs]) => {
    const lines = Math.max(1, Math.ceil((em * fs * k * m.wrapSlack) / width));
    return h + lines * m.lineHeight * fs * k;
  }, 0) + extra * m.lineHeight * k;
  for (let k = 1; k > 0.1; k -= 0.01) if (height(k) <= room) return k;
  return 0.1;
}

// CSS line-height that reproduces libass line spacing: libass puts lines (winAscent+winDescent) × 1.04 apart
const lineHeightFor = role => (LAYOUT.emRatio[role] * LAYOUT.fontMetrics.lineHeight).toFixed(3);

// ---------- State ----------

let meta = null;
let backgrounds = [];
let library = [];
let verse = null;
let highlightIndex = -1;

const state = Object.assign({
  surah: 1, from: 1, to: 7,
  reciter: 'alafasy', en: 'saheeh', bn: 'taisirul',
  mode: 'single', format: 'long', groupSeconds: 0, bgMode: 'auto', bgSelection: [], bgOptions: null,
  translationAudio: null,
  highlight: true, intro: true, outro: true, watermark: true, bismillah: true,
  colors: null, sizes: null, preview: 'live',
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
    bg: state.bgMode === 'custom' ? state.bgSelection : state.bgMode,
    bgOptions: state.bgOptions,
    colors: state.colors, sizes: state.sizes,
    translationAudio: state.translationAudio,
    // Speech keys are only sent when the Bangla audio is on
    ttsKeys: state.translationAudio && state.translationAudio.enabled ? ttsKeys() : undefined,
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
  $('#surahMeta').textContent = [s.bangla && `সূরা ${s.bangla}`, s.meaning, `${s.verses} verses`, s.place === 'madinah' ? 'Madani' : 'Makki']
    .filter(Boolean).join(' · ');
  $('#surahArabic').textContent = s.arabic;
}

function renderSurahList(query = '') {
  const q = query.trim().toLowerCase();
  // Search English name, meaning, Bangla name or number
  const items = meta.surahs.filter(s => !q || String(s.id) === q || s.name.toLowerCase().includes(q)
    || s.meaning.toLowerCase().includes(q) || (s.bangla && s.bangla.includes(query.trim())));
  $('#surahList').innerHTML = items.map((s, i) => `
    <li role="option" data-id="${s.id}" class="${s.id === state.surah ? 'selected' : ''} ${i === 0 && q ? 'focus' : ''}">
      <span class="n">${s.id}</span>
      <span class="t">${esc(s.name)}<small>${s.bangla ? `${esc(s.bangla)} · ` : ''}${esc(s.meaning)} · ${s.verses} verses</small></span>
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
  note.textContent = (r && r.wordTimings
    ? 'Word timings available — word-by-word highlighting supported.'
    : 'No word timings for this reciter — highlighting will be off.')
    + (r && r.group === 'lesser' ? ' Lower profile, but not guaranteed claim-free: upload as Private first and check YouTube’s copyright Checks.' : '');
  $('#optHighlight').disabled = !(r && r.wordTimings);
}

$('#reciter').addEventListener('change', e => { state.reciter = e.target.value; updateReciterNote(); saveState(); updateSummary(); invalidateFrame(); });
$('#enTr').addEventListener('change', e => { state.en = e.target.value; saveState(); loadVerse(); invalidateFrame(); });
$('#bnTr').addEventListener('change', e => { state.bn = e.target.value; saveState(); loadVerse(); invalidateFrame(); });

bindSegmented($('#modeSeg'), v => { state.mode = v; applyMode(); });
bindSegmented($('#formatSeg'), v => { state.format = v; applyMode(); });
$('#groupSeconds').addEventListener('change', e => { state.groupSeconds = Math.max(0, Math.min(170, +e.target.value || 0)); saveState(); updateSummary(); });
function applyMode() {
  const batch = state.mode === 'batch';
  $('#groupField').hidden = !batch;
  $$('#formatSeg button').forEach(b => { b.disabled = batch && b.dataset.value === 'long'; });
  setSegmented($('#formatSeg'), effectiveFormat());
  $('#btnRenderLabel').textContent = batch ? 'Render Shorts' : 'Render video';
  $('#stage').className = `stage ${effectiveFormat()}`;
  renderBackgroundControls();
  saveState();
  updateSummary();
  renderStage();
  invalidateFrame();
}

// ---------- Background selection ----------

const clipSeconds = () => state.bgOptions.clipSeconds;
const reelFade = () => Math.min(1.2, clipSeconds() / 4);
const orientationFor = fmt => (fmt === 'short' ? 'portrait' : 'landscape');
const clipById = id => backgrounds.find(b => b.id === id);
const fmtDur = s => (s ? fmtClock(s) : '');

// Clips used by "Auto" — mirrors resolveBackground() in make-video.js
function autoClips() {
  return autoCandidates().slice(0, state.bgOptions.max);
}

// Every clip Auto could use, in play order (before the max-clips limit)
function autoCandidates() {
  const { source, order } = state.bgOptions;
  let list;
  if (source === 'all') list = [...backgrounds];
  else {
    const o = orientationFor(effectiveFormat());
    const inFolder = backgrounds.filter(b => b.folder === o);
    list = inFolder.length ? inFolder : backgrounds.filter(b => !b.folder);
  }
  if (!list.length) return [];
  if (order === 'rotate') {
    const r = state.surah % list.length;
    list = [...list.slice(r), ...list.slice(0, r)];
  }
  // Shuffle happens at render time; the preview shows them by name
  return list;
}

// The clips that will actually play, in order
function activeClips() {
  if (state.bgMode === 'gradient') return [];
  if (state.bgMode === 'custom') return state.bgSelection.map(clipById).filter(Boolean);
  return autoClips();
}

function reelSeconds(clips) {
  if (!clips.length) return 0;
  const cs = clipSeconds();
  const total = clips.reduce((s, c) => s + (c.type === 'video' ? Math.min(cs, c.duration || cs) : cs), 0);
  return Math.max(0, total - reelFade() * (clips.length - 1));
}

function renderBackgroundControls() {
  // Drop selections whose files were deleted
  state.bgSelection = state.bgSelection.filter(id => clipById(id));
  if (state.bgMode === 'custom' && !state.bgSelection.length && !$('#bgPicker').open) state.bgMode = 'auto';
  setSegmented($('#bgModeSeg'), state.bgMode);

  const o = orientationFor(effectiveFormat());
  const auto = autoClips();
  $('#bgHint').textContent = state.bgMode === 'auto'
    ? (auto.length ? `cycles ${auto.length} clip${auto.length > 1 ? 's' : ''}` : 'no clips yet — gradient')
    : state.bgMode === 'gradient' ? 'animated gradient' : `${state.bgSelection.length} selected`;

  const custom = state.bgMode === 'custom';
  $('#bgSelected').hidden = !custom;
  if (custom) {
    const strip = $('#bgStrip');
    strip.classList.toggle('portrait', o === 'portrait');
    strip.innerHTML = state.bgSelection.map((id, i) => {
      const c = clipById(id);
      return `<li draggable="true" tabindex="0" data-id="${esc(id)}" title="${esc(c.name)} — drag to reorder"
          aria-label="${i + 1}. ${esc(c.name)}. Use arrow keys to move, Delete to remove.">
        <img src="${esc(c.thumb)}" alt="" loading="lazy">
        <span class="n">${i + 1}</span>
        <button class="rm" data-remove="${esc(id)}" aria-label="Remove ${esc(c.name)}">${ICONS.x}</button>
      </li>`;
    }).join('') + `<li class="add" id="bgStripAdd" title="Add clips" aria-label="Add clips" tabindex="0">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></li>`;
    const clips = activeClips();
    const mismatched = clips.filter(c => c.shape !== o).length;
    $('#bgSelectedNote').innerHTML = clips.length
      ? `Reel ≈ ${fmtClock(reelSeconds(clips))}, loops` + (mismatched ? ` · <span style="color:var(--gold)">${mismatched} will be centre-cropped</span>` : '')
      : 'No clips selected';
  }

  // Auto: settings + a read-only strip of the clips it will use
  const isAuto = state.bgMode === 'auto';
  const autoHasClips = auto.length > 0;
  $('#bgAutoPanel').hidden = !isAuto || !backgrounds.length;
  if (isAuto && backgrounds.length) {
    const bo = state.bgOptions;
    $('#bgSource').value = bo.source;
    $('#bgOrder').value = bo.order;
    // Slider only goes as high as the clips actually available
    const available = autoCandidates().length;
    const top = Math.max(1, Math.min(meta.backgroundLimits.max[1], available));
    $('#bgMax').max = top;
    $('#bgMax').disabled = available <= 1;
    $('#bgMax').value = Math.min(bo.max, top);
    $('#bgMaxVal').textContent = bo.max >= available ? `all ${available}` : `${bo.max} of ${available}`;
    const strip = $('#bgAutoStrip');
    strip.classList.toggle('portrait', o === 'portrait');
    const shown = auto.slice(0, 8);
    strip.innerHTML = shown.map((c, i) => `
      <li title="${esc(c.name)}${c.shape !== o ? ' — will be centre-cropped' : ''}">
        <img src="${esc(c.thumb)}" alt="${esc(c.name)}" loading="lazy">
        ${bo.order === 'shuffle' ? '' : `<span class="n">${i + 1}</span>`}
      </li>`).join('') + (auto.length > shown.length ? `<li class="more">+${auto.length - shown.length}</li>` : '');
    const crop = auto.filter(c => c.shape !== o).length;
    $('#bgAutoNote').innerHTML = autoHasClips
      ? `${auto.length} clip${auto.length > 1 ? 's' : ''} · reel ≈ ${fmtClock(reelSeconds(auto))}`
        + (bo.order === 'shuffle' ? ' · random order' : '')
        + (crop ? ` · <span style="color:var(--gold)">${crop} cropped</span>` : '')
      : 'No clips match this format';
  }

  // Gradient: shown for Gradient, and for Auto when there are no clips to use
  const showGradient = state.bgMode === 'gradient' || (isAuto && !autoHasClips);
  $('#bgGradientPanel').hidden = !showGradient;
  $('#bgGradientNote').hidden = !(isAuto && !autoHasClips);
  if (showGradient) renderGradientControls();

  // Seconds per clip and dim apply whenever clips play
  $('#bgClipPanel').hidden = !activeClips().length;
  $('#clipSeconds').value = state.bgOptions.clipSeconds;
  $('#clipSecondsVal').textContent = `${state.bgOptions.clipSeconds}s`;
  $('#bgDim').value = state.bgOptions.dim;
  $('#bgDimVal').textContent = `${Math.round(state.bgOptions.dim * 100)}%`;

  renderStageBackground();
}

// ---------- Background options (Auto, Gradient, clip look) ----------

const GRADIENT_PRESETS = {
  'Night emerald': ['#0A1A24', '#14352B', '#1D1530'],
  'Midnight blue': ['#050A1F', '#0B2A5B', '#1B1035'],
  'Desert dusk': ['#2B1A0E', '#5A2E12', '#1A0F1F'],
  'Royal purple': ['#1A0B2E', '#3A0CA3', '#120A1F'],
  'Deep teal': ['#021B1A', '#06433F', '#0B2230'],
  Charcoal: ['#0E0E10', '#1E1F24', '#121316'],
};
const SPEED_LABELS = ['Still', 'Very slow', 'Slow', 'Slow', 'Gentle', 'Medium', 'Medium', 'Lively', 'Fast', 'Fast', 'Very fast'];

const gradientCss = cols => `linear-gradient(135deg, ${cols.join(', ')}, ${cols[0]})`;
// Higher speed → shorter CSS loop; 0 = no animation
const gradientAnimation = speed => (speed > 0 ? `gradient-drift ${Math.round(48 / speed)}s ease-in-out infinite` : 'none');

function renderGradientControls() {
  const { gradient, gradientSpeed } = state.bgOptions;
  const prev = $('#gradientPreview');
  prev.style.backgroundImage = gradientCss(gradient);
  prev.style.animation = gradientAnimation(gradientSpeed);
  $('#gradientStops').innerHTML = gradient.map((c, i) => `
    <div class="stop">
      <label class="swatch" style="background:${c}" title="Pick colour ${i + 1}">
        <input type="color" data-stop="${i}" value="${c.toLowerCase()}" aria-label="Gradient colour ${i + 1}">
      </label>
      <input class="hex" data-stop-hex="${i}" value="${c}" maxlength="7" spellcheck="false" aria-label="Gradient colour ${i + 1} hex">
      ${gradient.length > 2 ? `<button class="rm" data-stop-rm="${i}" title="Remove colour" aria-label="Remove colour ${i + 1}">${ICONS.x}</button>` : ''}
    </div>`).join('')
    + (gradient.length < 4 ? '<button class="stop-add" id="stopAdd" title="Add a colour" aria-label="Add a colour"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>' : '');
  $('#gradientPresets').innerHTML = Object.entries(GRADIENT_PRESETS).map(([name, cols]) => `
    <button class="preset" data-gradient="${esc(name)}"><span class="bar" style="background:${gradientCss(cols)}"></span>${esc(name)}</button>`).join('');
  $('#gradientSpeed').value = gradientSpeed;
  $('#gradientSpeedVal').textContent = SPEED_LABELS[gradientSpeed] || '';
}

function setBgOption(key, value, { rerender = true } = {}) {
  state.bgOptions[key] = value;
  saveState();
  if (rerender) renderBackgroundControls(); else renderStageBackground();
  updateSummary();
  invalidateFrame();
}

$('#bgSource').addEventListener('change', e => setBgOption('source', e.target.value));
$('#bgOrder').addEventListener('change', e => setBgOption('order', e.target.value));
$('#bgMax').addEventListener('input', e => setBgOption('max', +e.target.value));
$('#clipSeconds').addEventListener('input', e => setBgOption('clipSeconds', +e.target.value));
$('#bgDim').addEventListener('input', e => {
  $('#bgDimVal').textContent = `${Math.round(e.target.value * 100)}%`;
  setBgOption('dim', +e.target.value, { rerender: false });
});
$('#gradientSpeed').addEventListener('input', e => setBgOption('gradientSpeed', +e.target.value));

// Gradient colour stops: update the preview live without re-rendering (keeps the picker open)
function setStop(i, hex) {
  const g = [...state.bgOptions.gradient];
  g[i] = hex.toUpperCase();
  state.bgOptions.gradient = g;
  const stop = $(`[data-stop="${i}"]`).closest('.stop');
  $('.swatch', stop).style.background = hex;
  $('[data-stop]', stop).value = hex.toLowerCase();
  if (document.activeElement !== $('[data-stop-hex]', stop)) $('[data-stop-hex]', stop).value = hex.toUpperCase();
  $('#gradientPreview').style.backgroundImage = gradientCss(g);
  saveState();
  renderStageBackground();
  invalidateFrame();
}
$('#gradientStops').addEventListener('input', e => {
  if (e.target.dataset.stop !== undefined) setStop(+e.target.dataset.stop, e.target.value);
  if (e.target.dataset.stopHex !== undefined) {
    let v = e.target.value.trim();
    if (!v.startsWith('#')) v = `#${v}`;
    const ok = /^#[0-9a-f]{6}$/i.test(v);
    e.target.classList.toggle('invalid', !ok);
    if (ok) setStop(+e.target.dataset.stopHex, v);
  }
});
$('#gradientStops').addEventListener('click', e => {
  const rm = e.target.closest('[data-stop-rm]');
  if (rm) setBgOption('gradient', state.bgOptions.gradient.filter((_, i) => i !== +rm.dataset.stopRm));
  if (e.target.closest('#stopAdd')) {
    const g = state.bgOptions.gradient;
    setBgOption('gradient', [...g, g[g.length - 1]]);
  }
});
$('#gradientPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-gradient]');
  if (b) setBgOption('gradient', [...GRADIENT_PRESETS[b.dataset.gradient]]);
});

$('#btnResetBg').addEventListener('click', () => {
  state.bgOptions = { ...meta.defaultBackground, ...(meta.channel.background || {}) };
  saveState();
  renderBackgroundControls();
  invalidateFrame();
  toast('Background settings reset to your channel default');
});
$('#btnSaveBg').addEventListener('click', async () => {
  try {
    const { channel } = await api('/api/channel', { method: 'PUT', json: { background: state.bgOptions } });
    meta.channel = channel;
    toast('Background settings saved as default');
  } catch (e) { toast(e.message, 'error'); }
});

function setBgMode(mode) {
  state.bgMode = mode;
  if (mode === 'custom' && !state.bgSelection.length) { openPicker(); return; }
  renderBackgroundControls();
  saveState();
  invalidateFrame();
}
bindSegmented($('#bgModeSeg'), setBgMode);
$('#btnEditBg').addEventListener('click', () => openPicker());

function commitSelection(ids) {
  state.bgSelection = ids;
  if (!ids.length && state.bgMode === 'custom') state.bgMode = 'auto';
  renderBackgroundControls();
  saveState();
  invalidateFrame();
}

// Strip: remove, add, drag-and-drop and keyboard reordering
$('#bgStrip').addEventListener('click', e => {
  const rm = e.target.closest('[data-remove]');
  if (rm) { e.stopPropagation(); commitSelection(state.bgSelection.filter(id => id !== rm.dataset.remove)); return; }
  if (e.target.closest('#bgStripAdd')) openPicker();
});
$('#bgStrip').addEventListener('keydown', e => {
  const li = e.target.closest('li');
  if (!li) return;
  if (li.id === 'bgStripAdd') { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } return; }
  const sel = [...state.bgSelection];
  const i = sel.indexOf(li.dataset.id);
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); commitSelection(sel.filter(x => x !== li.dataset.id)); return; }
  const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  if (!dir || i + dir < 0 || i + dir >= sel.length) return;
  e.preventDefault();
  [sel[i], sel[i + dir]] = [sel[i + dir], sel[i]];
  commitSelection(sel);
  $(`#bgStrip li[data-id="${CSS.escape(li.dataset.id)}"]`)?.focus();
});

let dragId = null;
$('#bgStrip').addEventListener('dragstart', e => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  dragId = li.dataset.id;
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
});
$('#bgStrip').addEventListener('dragover', e => {
  if (!dragId) return;
  e.preventDefault();
  $$('#bgStrip li').forEach(li => li.classList.remove('drop-before'));
  const over = e.target.closest('li');
  if (over && over.dataset.id !== dragId) over.classList.add('drop-before');
});
$('#bgStrip').addEventListener('drop', e => {
  e.preventDefault();
  const over = e.target.closest('li');
  if (!dragId || !over) return;
  const sel = state.bgSelection.filter(id => id !== dragId);
  const at = over.id === 'bgStripAdd' ? sel.length : sel.indexOf(over.dataset.id);
  sel.splice(at < 0 ? sel.length : at, 0, dragId);
  commitSelection(sel);
});
$('#bgStrip').addEventListener('dragend', () => {
  dragId = null;
  $$('#bgStrip li').forEach(li => li.classList.remove('dragging', 'drop-before'));
});

// Live preview: show the first clip that will play behind the captions
function renderStageBackground() {
  const holder = $('#stageBg');
  const live = $('#stageLive');
  const first = activeClips()[0];
  // No clip → show the chosen gradient (the CSS default is only a fallback)
  if (!first) {
    holder.innerHTML = '';
    holder.dataset.id = '';
    live.style.background = gradientCss(state.bgOptions.gradient);
    live.style.backgroundSize = '300% 300%';
    live.style.animation = gradientAnimation(state.bgOptions.gradientSpeed);
    return;
  }
  live.style.background = live.style.backgroundSize = live.style.animation = '';
  if (holder.dataset.id !== first.id) {
    holder.dataset.id = first.id;
    holder.innerHTML = first.type === 'video'
      ? `<video src="${esc(first.url)}" poster="${esc(first.thumb)}" muted loop autoplay playsinline preload="metadata"></video>`
      : `<img src="${esc(first.url)}" alt="">`;
  }
  const media = holder.firstElementChild;
  if (media) media.style.filter = `brightness(${(1 - state.bgOptions.dim).toFixed(2)})`;
}

// ---------- Background picker ----------

let draft = [];
let pickerFilter = 'match';
let pickerType = 'any';
let previewId = null;

function openPicker() {
  draft = [...state.bgSelection];
  previewId = draft[0] || null;
  const o = orientationFor(effectiveFormat());
  $('#pickerFilterMatch').textContent = o === 'portrait' ? 'Portrait (Shorts)' : 'Landscape (Videos)';
  // Show everything when the matching folder is empty
  pickerFilter = backgrounds.some(b => b.orientation === o) ? 'match' : 'all';
  setSegmented($('#pickerFilter'), pickerFilter);
  renderPicker();
  renderPickerPreview();
  $('#bgPicker').showModal();
}

function pickerItems() {
  const o = orientationFor(effectiveFormat());
  return backgrounds.filter(b => (pickerFilter === 'all' || b.orientation === o) && (pickerType === 'any' || b.type === pickerType));
}

function renderPicker() {
  const o = orientationFor(effectiveFormat());
  const items = pickerItems();
  const grid = $('#pickerGrid');
  grid.classList.toggle('portrait', o === 'portrait' && pickerFilter === 'match');
  $('#pickerEmpty').hidden = items.length > 0;
  grid.innerHTML = items.map(b => {
    const n = draft.indexOf(b.id) + 1;
    return `
    <button class="tile ${n ? 'selected' : ''}" role="option" aria-selected="${!!n}" data-id="${esc(b.id)}"
        title="${esc(b.name)}">
      <span class="media">
        <img src="${esc(b.thumb)}" alt="" loading="lazy">
        <span class="shade"></span>
        <span class="check">${n || ''}</span>
        <span class="chips">
          ${b.shape !== o ? '<span class="pill crop">Cropped</span>' : ''}
          <span class="pill">${b.type === 'video' ? fmtDur(b.duration) || 'Video' : 'Image'}</span>
        </span>
        <span class="name">${esc(b.name)}</span>
      </span>
    </button>`;
  }).join('');
  renderPickerSummary();
}

function renderPickerSummary() {
  const clips = draft.map(clipById).filter(Boolean);
  const o = orientationFor(effectiveFormat());
  const crop = clips.filter(c => c.shape !== o).length;
  $('#pickerSummary').innerHTML = clips.length
    ? `<b>${clips.length}</b> selected · reel ≈ <b>${fmtClock(reelSeconds(clips))}</b>, loops for the whole video`
      + (crop ? ` · <span class="warn">${crop} will be centre-cropped</span>` : '')
      + (clips.length > maxClips ? ` · <span class="warn">only the first ${maxClips} are used</span>` : '')
    : 'Nothing selected — click clips to add them in play order';
  $('#pickerApply').textContent = clips.length ? `Use ${clips.length} clip${clips.length > 1 ? 's' : ''}` : 'Use Auto';
}

function renderPickerPreview() {
  const c = clipById(previewId);
  const stage = $('#ppStage');
  const o = orientationFor(effectiveFormat());
  stage.classList.toggle('portrait', !!c && c.shape === 'portrait');
  if (!c) {
    stage.innerHTML = '<span class="pp-placeholder">Hover or focus a clip to preview it</span>';
    $('#ppMeta').innerHTML = '';
    return;
  }
  if (stage.dataset.id !== c.id) {
    stage.dataset.id = c.id;
    stage.innerHTML = c.type === 'video'
      ? `<video src="${esc(c.url)}" poster="${esc(c.thumb)}" muted loop autoplay playsinline></video>`
      : `<img src="${esc(c.url)}" alt="">`;
    // Show which part survives when a landscape clip is cropped for a Short
    if (o === 'portrait' && c.shape === 'landscape') {
      const w = (9 / 16) / (16 / 9) * 100;
      stage.insertAdjacentHTML('beforeend', `<span class="crop-guide" style="left:${(100 - w) / 2}%;width:${w}%"></span>`);
    }
  }
  const n = draft.indexOf(c.id) + 1;
  $('#ppMeta').innerHTML = `
    <h4>${esc(c.name)}</h4>
    <dl>
      <dt>Type</dt><dd>${c.type === 'video' ? 'Video' : 'Image (slow zoom)'}</dd>
      ${c.width ? `<dt>Size</dt><dd>${c.width} × ${c.height}</dd>` : ''}
      ${c.duration ? `<dt>Length</dt><dd>${fmtDur(c.duration)}${c.duration > clipSeconds() ? ` (first ${clipSeconds()}s used)` : ''}</dd>` : ''}
      <dt>Folder</dt><dd>${esc(c.folder || 'backgrounds')}</dd>
      <dt>File</dt><dd>${fmtSize(c.size)}</dd>
      ${c.credit ? `<dt>Credit</dt><dd>${esc(c.credit)}</dd>` : ''}
      <dt>Status</dt><dd>${n ? `Selected · plays ${ordinal(n)}` : 'Not selected'}</dd>
    </dl>
    ${o === 'portrait' && c.shape === 'landscape' ? '<div class="note">Landscape clip — only the area inside the dashed frame shows in a Short.</div>' : ''}
    ${o === 'landscape' && c.shape === 'portrait' ? '<div class="note">Portrait clip — it will be zoomed to fill the 16:9 frame.</div>' : ''}`;
}
const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

let maxClips = 40;

function toggleDraft(id) {
  const i = draft.indexOf(id);
  if (i >= 0) draft.splice(i, 1); else draft.push(id);
  previewId = id;
  renderPicker();
  renderPickerPreview();
  $(`#pickerGrid .tile[data-id="${CSS.escape(id)}"]`)?.focus();
}

$('#pickerGrid').addEventListener('click', e => {
  const t = e.target.closest('.tile');
  if (t) toggleDraft(t.dataset.id);
});
$('#pickerGrid').addEventListener('mouseover', e => {
  const t = e.target.closest('.tile');
  if (t && t.dataset.id !== previewId) { previewId = t.dataset.id; renderPickerPreview(); }
});
$('#pickerGrid').addEventListener('focusin', e => {
  const t = e.target.closest('.tile');
  if (t && t.dataset.id !== previewId) { previewId = t.dataset.id; renderPickerPreview(); }
});
bindSegmented($('#pickerFilter'), v => { pickerFilter = v; renderPicker(); });
bindSegmented($('#pickerType'), v => { pickerType = v; renderPicker(); });
$('#pickerSelectAll').addEventListener('click', () => {
  for (const b of pickerItems()) if (!draft.includes(b.id)) draft.push(b.id);
  renderPicker();
  renderPickerPreview();
});
$('#pickerClear').addEventListener('click', () => { draft = []; renderPicker(); renderPickerPreview(); });
$('#pickerCancel').addEventListener('click', () => $('#bgPicker').close());
$('#pickerClose').addEventListener('click', () => $('#bgPicker').close());
$('#bgPicker').addEventListener('close', () => {
  // Stop preview playback and fall back if "Choose clips" was picked but nothing chosen
  $('#ppStage').innerHTML = '';
  $('#ppStage').dataset.id = '';
  if (state.bgMode === 'custom' && !state.bgSelection.length) state.bgMode = 'auto';
  renderBackgroundControls();
});
$('#bgPicker').addEventListener('click', e => { if (e.target === $('#bgPicker')) $('#bgPicker').close(); });
$('#pickerApply').addEventListener('click', () => {
  state.bgMode = draft.length ? 'custom' : 'auto';
  commitSelection(draft.slice(0, maxClips));
  $('#bgPicker').close();
  toast(draft.length ? `Background: ${Math.min(draft.length, maxClips)} clip${draft.length > 1 ? 's' : ''} selected` : 'Background set to Auto');
});

$('#pickerUpload').addEventListener('click', () => $('#pickerUploadInput').click());
$('#pickerUploadInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  const orientation = orientationFor(effectiveFormat());
  const added = [];
  for (const f of files) {
    try {
      await api(`/api/backgrounds/upload?orientation=${orientation}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      added.push(`${orientation}/${f.name.replace(/[^\w.\- ]/g, '_')}`);
    } catch (err) { toast(`${f.name}: ${err.message}`, 'error'); }
  }
  await loadBackgrounds();
  // Newly uploaded clips are selected straight away
  for (const id of added) if (clipById(id) && !draft.includes(id)) draft.push(id);
  if (added.length) toast(`Uploaded ${added.length} file${added.length > 1 ? 's' : ''}`);
  renderPicker();
  renderPickerPreview();
});

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

// ---------- Bangla translation audio ----------

const TTS_KEYS = 'qvs-tts-keys';
const ttsKeys = () => store.get(TTS_KEYS, {});
const taProvider = () => (meta.translationVoices.find(v => v.id === state.translationAudio.voice) || {}).provider;

function initTranslationAudio() {
  // Voices grouped by provider
  const groups = { azure: 'Microsoft Azure — Bangladesh', google: 'Google Cloud — India', files: 'Your own recordings' };
  $('#taVoice').innerHTML = Object.entries(groups).map(([p, name]) => {
    const opts = meta.translationVoices.filter(v => v.provider === p)
      .map(v => `<option value="${esc(v.id)}">${esc(v.label.replace(/ \((Azure|Google)\)$/, ''))}</option>`).join('');
    return opts ? `<optgroup label="${esc(name)}">${opts}</optgroup>` : '';
  }).join('');
  const k = ttsKeys();
  $('#taAzureKey').value = k.azureKey || '';
  $('#taAzureRegion').value = k.azureRegion || '';
  $('#taGoogleKey').value = k.googleKey || '';
  renderTranslationAudio();
}

function renderTranslationAudio() {
  const ta = state.translationAudio;
  $('#optBnAudio').checked = ta.enabled;
  $('#taPanel').hidden = !ta.enabled;
  $('#taVoice').value = ta.voice;
  const p = taProvider();
  $('#taAzure').hidden = p !== 'azure';
  $('#taGoogle').hidden = p !== 'google';
  $('#taFiles').hidden = p !== 'files';
  $('#taDisclosure').hidden = p === 'files';
  $('#taRate').value = ta.rate;
  $('#taRateVal').textContent = ta.rate === 0 ? 'normal' : `${ta.rate > 0 ? '+' : ''}${ta.rate}%`;
  $('#taPauseAyah').value = ta.pauseAfterAyah;
  $('#taPauseTr').value = ta.pauseAfterTranslation;
  $('#taPauseAyahVal').textContent = $('#taFlowGap1').textContent = `${ta.pauseAfterAyah.toFixed(1)}s`;
  $('#taPauseTrVal').textContent = $('#taFlowGap2').textContent = `${ta.pauseAfterTranslation.toFixed(1)}s`;
}

function setTa(key, value) {
  state.translationAudio[key] = value;
  saveState();
  renderTranslationAudio();
  updateSummary();
}

$('#optBnAudio').addEventListener('change', e => setTa('enabled', e.target.checked));
$('#taVoice').addEventListener('change', e => { setTa('voice', e.target.value); $('#taAudio').hidden = true; });
$('#taRate').addEventListener('input', e => setTa('rate', +e.target.value));
$('#taPauseAyah').addEventListener('input', e => setTa('pauseAfterAyah', +e.target.value));
$('#taPauseTr').addEventListener('input', e => setTa('pauseAfterTranslation', +e.target.value));
for (const [id, key] of [['taAzureKey', 'azureKey'], ['taAzureRegion', 'azureRegion'], ['taGoogleKey', 'googleKey']]) {
  $(`#${id}`).addEventListener('change', e => store.set(TTS_KEYS, { ...ttsKeys(), [key]: e.target.value.trim() }));
}

$('#btnTestVoice').addEventListener('click', async () => {
  const btn = $('#btnTestVoice');
  btn.disabled = true;
  try {
    // Speak the Bangla translation of the verse shown in the preview, if loaded
    const { url } = await api('/api/tts-test', {
      method: 'POST',
      json: { ...state.translationAudio, text: verse && verse.bn, ttsKeys: ttsKeys() },
    });
    const audio = $('#taAudio');
    audio.hidden = false;
    audio.src = `${url}?t=${Date.now()}`;
    audio.play().catch(() => {});
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

$('#btnSaveTa').addEventListener('click', async () => {
  try {
    const { channel } = await api('/api/channel', { method: 'PUT', json: { translationAudio: state.translationAudio } });
    meta.channel = channel;
    toast('Bangla audio settings saved as default');
  } catch (e) { toast(e.message, 'error'); }
});

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
  const bnAudio = state.translationAudio && state.translationAudio.enabled ? ' · + Bangla audio' : '';
  $('#renderSub').textContent = `${what} · ${r ? r.name : ''}${bnAudio}`;
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
  state.sizes = { ...meta.defaultSizes, ...(meta.channel.fontScale || {}) };
  renderSizeControls();
  onSizeChange();
  toast('Style reset to your channel default');
});
$('#btnSaveColors').addEventListener('click', async () => {
  try {
    const { channel } = await api('/api/channel', { method: 'PUT', json: { colors: state.colors, fontScale: state.sizes } });
    meta.channel = channel;
    renderDefaultSwatches();
    renderSizeControls();
    toast('Saved colours and text sizes as channel default');
  } catch (e) { toast(e.message, 'error'); }
});

// ---------- Text size ----------

const SIZE_FIELDS = [
  ['arabic', 'Arabic', 'Verse text'],
  ['english', 'English', 'Translation'],
  ['bangla', 'Bangla', 'Translation'],
];
const SIZE_STEP = 0.05;

function renderSizeControls() {
  const [min, max] = meta.sizeRange;
  const saved = { ...meta.defaultSizes, ...(meta.channel.fontScale || {}) };
  $('#sizeList').innerHTML = SIZE_FIELDS.map(([key, label, sub]) => {
    const v = state.sizes[key];
    return `
    <div class="size-row" data-size="${key}">
      <span class="name">${esc(label)}<small>${esc(sub)}</small></span>
      <button class="icon-btn sm" data-step="-1" aria-label="Smaller ${esc(label)} text" title="Smaller">−</button>
      <input type="range" min="${min}" max="${max}" step="${SIZE_STEP}" value="${v}" aria-label="${esc(label)} text size">
      <button class="icon-btn sm" data-step="1" aria-label="Larger ${esc(label)} text" title="Larger">+</button>
      <span class="val ${v !== saved[key] ? 'changed' : ''}" title="${v !== saved[key] ? 'Different from your saved default' : ''}">${Math.round(v * 100)}%</span>
    </div>`;
  }).join('');
}

// Update one row in place (keeps keyboard focus on the slider or button)
function setSize(key, value) {
  const [min, max] = meta.sizeRange;
  const v = Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
  state.sizes[key] = v;
  const row = $(`.size-row[data-size="${key}"]`);
  const saved = { ...meta.defaultSizes, ...(meta.channel.fontScale || {}) }[key];
  $('input[type="range"]', row).value = v;
  const val = $('.val', row);
  val.textContent = `${Math.round(v * 100)}%`;
  val.classList.toggle('changed', v !== saved);
  val.title = v !== saved ? 'Different from your saved default' : '';
  onSizeChange();
}

const onSizeChange = () => { saveState(); renderStage(); invalidateFrame(); };

$('#sizeList').addEventListener('input', e => {
  if (e.target.type === 'range') setSize(e.target.closest('[data-size]').dataset.size, parseFloat(e.target.value));
});
$('#sizeList').addEventListener('click', e => {
  const b = e.target.closest('[data-step]');
  if (!b) return;
  const key = b.closest('[data-size]').dataset.size;
  setSize(key, state.sizes[key] + SIZE_STEP * +b.dataset.step);
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

  // Positions and sizes below mirror buildAss()/verseEvents() in make-video.js
  const head = $('#stHeader');
  head.textContent = `Surah ${s.name} · ${s.meaning}`;
  head.style.cssText = `font-size:${px(fmt.header)};line-height:${lineHeightFor('latin')};top:${px(fmt.h * 0.05)};letter-spacing:${px(1)}`;

  const words = verse ? verse.words : ['…'];
  const en = verse ? verse.en : 'Loading verse…';
  const bn = verse ? verse.bn : '';
  // Same shrink rule as make-video.js
  const sz = state.sizes;
  const k = verseFit(words, en, bn, fmt, sz);
  const fitNote = $('#sizeFitNote');
  fitNote.textContent = verse && k < 0.99
    ? `This verse is long — shown at ${Math.round(k * 100)}% of your sizes to fit`
    : "Shrinks only if a verse wouldn't fit";
  fitNote.style.color = verse && k < 0.99 ? 'var(--gold)' : '';

  const body = $('#stBody');
  body.style.padding = `0 ${px(fmt.margin)}`;

  const g = LAYOUT.gaps;
  // A libass gap line of height n is n × 1.04 tall
  const gapPx = n => px(n * k * LAYOUT.fontMetrics.lineHeight);
  const ar = $('#stArabic');
  ar.style.fontSize = px(fmt.ar * sz.arabic * k);
  ar.style.lineHeight = lineHeightFor('arabic');
  ar.style.color = c.arabic;
  ar.innerHTML = words.map((w, i) => `<span class="w" data-i="${i}">${esc(w)}</span>`).join(' ')
    + (verse ? ` <span class="num">﴿${toArabicDigits(verse.number)}﴾</span>` : '');
  paintHighlight();

  const enEl = $('#stEnglish');
  enEl.textContent = en;
  enEl.style.cssText = `font-size:${px(fmt.en * sz.english * k)};line-height:${lineHeightFor('latin')};color:${c.english};margin-top:${gapPx(g.afterArabic)}`;
  const bnEl = $('#stBangla');
  bnEl.textContent = bn;
  bnEl.style.cssText = `font-size:${px(fmt.bn * sz.bangla * k)};line-height:${lineHeightFor('bangla')};color:${c.bangla};margin-top:${gapPx(g.afterEnglish)}`;
  const ref = $('#stRef');
  ref.textContent = verse ? `${s.name} ${verse.key}` : '';
  ref.style.cssText = `font-size:${px(LAYOUT.referenceSize * k)};line-height:${lineHeightFor('latin')};color:${c.reference};margin-top:${gapPx(g.beforeReference)}`;

  // Watermark: libass anchors it 36 px from the right and 32 px from the bottom
  const wm = $('#stWatermark');
  wm.hidden = !state.watermark;
  wm.style.right = px(36);
  wm.style.bottom = px(32);
  const ch = meta.channel;
  if (ch.logo && ch.logoUrl) {
    wm.innerHTML = `<img src="${esc(ch.logoUrl)}" alt="" style="height:${px(fmt.h * (effectiveFormat() === 'short' ? 0.045 : 0.07))}">`;
  } else {
    wm.textContent = ch.handle || ch.name || '';
    wm.style.fontSize = px(LAYOUT.watermarkSize * fmt.ui);
    wm.style.lineHeight = lineHeightFor('latin');
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
          ${v.folder ? `<span title="output/${esc(v.folder)}">${esc(v.folder.split(/[\\/]/).pop())}</span><span>·</span>` : ''}
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
    const data = await api('/api/backgrounds');
    backgrounds = data.items;
    maxClips = data.maxClips || maxClips;
    renderClips();
    renderBackgroundControls();
  } catch (e) { toast(e.message, 'error'); }
}

function renderClips() {
  const items = backgrounds.filter(b => b.orientation === bgFilter);
  $('#clipEmpty').hidden = items.length > 0;
  $('#clipGrid').innerHTML = items.map(b => `
    <div class="clip ${b.orientation}" data-id="${esc(b.id)}">
      ${b.type === 'video'
        ? `<video src="${esc(b.url)}" poster="${esc(b.thumb)}" muted loop playsinline preload="none"></video>`
        : `<img src="${esc(b.thumb)}" alt="" loading="lazy">`}
      <div class="cap"><b>${esc(b.name)}</b><span>${esc([b.type === 'video' ? fmtDur(b.duration) : 'Image', b.width ? `${b.width}×${b.height}` : '', b.credit || fmtSize(b.size)].filter(Boolean).join(' · '))}</span></div>
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
  LAYOUT = meta.layout;
  Object.assign(FORMATS, meta.layout.formats);

  const pill = $('#ffmpegStatus');
  pill.classList.add(meta.ffmpeg ? 'ok' : 'bad');
  $('span:last-child', pill).textContent = meta.ffmpeg ? 'FFmpeg ready' : 'FFmpeg missing';
  pill.title = meta.ffmpeg ? '' : 'Install with: winget install Gyan.FFmpeg';

  state.colors = { ...meta.defaultColors, ...(meta.channel.colors || {}), ...(state.colors || {}) };
  state.sizes = { ...meta.defaultSizes, ...(meta.channel.fontScale || {}), ...(state.sizes || {}) };
  state.bgOptions = { ...meta.defaultBackground, ...(meta.channel.background || {}), ...(state.bgOptions || {}) };
  state.translationAudio = { ...meta.defaultTranslationAudio, ...(meta.channel.translationAudio || {}), ...(state.translationAudio || {}) };
  initTranslationAudio();
  if (!surahOf(state.surah)) state.surah = 1;

  // Grouped: well-known reciters, then lesser-known ones worth testing for copyright claims
  const reciterGroups = { main: 'Well-known reciters', lesser: 'Lesser-known reciters — test with YouTube Checks' };
  $('#reciter').innerHTML = Object.entries(reciterGroups).map(([g, label]) => {
    const opts = meta.reciters.filter(r => r.group === g)
      .map(r => `<option value="${esc(r.id)}">${esc(r.wordTimings ? r.name : `${r.name} (no highlighting)`)}</option>`).join('');
    return opts ? `<optgroup label="${esc(label)}">${opts}</optgroup>` : '';
  }).join('');
  if (!meta.reciters.some(r => r.id === state.reciter)) state.reciter = 'alafasy';
  $('#reciter').value = state.reciter;
  fillSelect($('#enTr'), meta.translations.en, state.en);
  fillSelect($('#bnTr'), meta.translations.bn, state.bn);
  updateReciterNote();

  for (const [id, key] of Object.entries(TOGGLES)) $(`#${id}`).checked = state[key];
  $('#groupSeconds').value = state.groupSeconds;
  setSegmented($('#modeSeg'), state.mode);

  fillBranding();
  renderColorControls();
  renderSizeControls();
  syncPassage();

  const bgData = await api('/api/backgrounds').catch(() => ({ items: [] }));
  backgrounds = bgData.items;
  maxClips = bgData.maxClips || maxClips;
  // Older saved state stored a single clip id in "bg"
  if (typeof state.bg === 'string') {
    if (state.bg === 'gradient') state.bgMode = 'gradient';
    else if (state.bg !== 'auto') { state.bgMode = 'custom'; state.bgSelection = [state.bg]; }
    delete state.bg;
  }
  if (!Array.isArray(state.bgSelection)) state.bgSelection = [];
  applyMode();
  loadVerse();
  loadLibrary();
  pollJob(true);

  const view = location.hash.slice(1);
  if (['create', 'library', 'branding', 'backgrounds'].includes(view)) showView(view);
}

init();
