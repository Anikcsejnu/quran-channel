// Upload queue for the Studio: uploads rendered videos to YouTube one at a time.
//   output/upload-queue.json — pending/finished queue items (survives a restart; an interrupted upload resumes)
//   output/uploads.json      — log of everything uploaded, keyed by the video's path under output/ (prevents duplicates)

const fs = require('fs');
const path = require('path');
const yt = require('./youtube.js');

const PRIVACY = ['private', 'unlisted', 'public'];
const CATEGORIES = { 27: 'Education', 22: 'People & Blogs', 29: 'Nonprofits & Activism', 24: 'Entertainment' };
const DEFAULT_SETTINGS = {
  privacy: 'private',
  categoryId: '27',
  playlist: 'surah',          // none | surah | custom
  customPlaylist: '',
  playlistPrivacy: 'public',
  notifySubscribers: true,
  madeForKids: false,
  scheduleTime: '18:00',      // default time of day for scheduled publishing
  scheduleEveryHours: 24,
  tags: ['Quran', 'Quran recitation', 'Holy Quran', 'Quran with translation', 'কুরআন', 'কুরআন তিলাওয়াত', 'বাংলা অনুবাদ', 'القرآن الكريم'],
};

function createQueue({ outDir, surahNameBn, log = () => {} }) {
  const QUEUE_FILE = path.join(outDir, 'upload-queue.json');
  const LOG_FILE = path.join(outDir, 'uploads.json');
  const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n', 'utf8'); };

  let items = readJson(QUEUE_FILE, []);
  // An upload that was running when the Studio stopped continues from its saved session
  for (const it of items) if (it.status === 'uploading' || it.status === 'finishing') it.status = 'queued';
  let paused = null; // { reason, message } while uploads are on hold (quota, sign-in)
  let running = null; // { qid, controller }
  const save = () => writeJson(QUEUE_FILE, items);
  const uploads = () => readJson(LOG_FILE, {});

  const fileFor = id => {
    const file = path.resolve(outDir, id);
    if (!file.startsWith(outDir + path.sep) || !/\.mp4$/i.test(file)) throw Object.assign(new Error('Invalid video'), { status: 400 });
    if (!fs.existsSync(file)) throw Object.assign(new Error(`Video not found: ${id}`), { status: 404 });
    return file;
  };

  // ----- suggested metadata for a rendered video -----

  // "Shorts/112 - Al-Ikhlas/…" → { surah: 112, name: 'Al-Ikhlas' }
  const surahOfId = id => {
    const m = /^(?:Videos|Shorts)\/(\d{3}) - ([^/]+)\//.exec(id);
    return m ? { surah: +m[1], name: m[2] } : null;
  };

  function suggest(id, settings) {
    const file = fileFor(id);
    const read = ext => { const f = file.replace(/\.mp4$/i, ext); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
    const title = read('.title.txt').trim() || path.basename(file, '.mp4');
    const description = read('.description.txt');
    const format = /^Shorts\//.test(id) ? 'short' : 'long';
    const s = surahOfId(id);
    const bn = s && surahNameBn ? surahNameBn(s.surah) : '';
    const reciter = (/🎙️\s*Reciter:\s*(.+)/.exec(description) || [])[1] || '';
    const tags = [
      ...(s ? [`Surah ${s.name}`, s.name, ...(bn ? [`সূরা ${bn}`, bn] : [])] : []),
      ...(reciter ? [reciter.trim(), ...(s ? [`${s.name} ${reciter.trim()}`] : [])] : []),
      ...(format === 'short' ? ['Quran Shorts', 'Islamic Shorts'] : []),
      ...(settings.tags || []),
    ];
    const surahPlaylist = s ? `Surah ${s.name}${bn ? ` | সূরা ${bn}` : ''}` : '';
    return {
      id, format, title, description, tags: yt.cleanTags(tags), surahPlaylist,
      // The description names synthetic narration ("AI-generated voice"); YouTube asks for that to be disclosed
      syntheticMedia: /AI-generated voice/i.test(description),
      uploaded: uploads()[id] || null,
      queued: items.some(it => it.id === id && ['queued', 'uploading', 'finishing', 'waiting'].includes(it.status)),
    };
  }

  // ----- queue operations -----

  function add(list) {
    const added = [];
    for (const raw of list) {
      const file = fileFor(String(raw.id || ''));
      const id = path.relative(outDir, file).split(path.sep).join('/');
      if (items.some(it => it.id === id && ['queued', 'uploading', 'finishing', 'waiting'].includes(it.status))) continue;
      const title = String(raw.title || '').trim();
      if (!title) throw Object.assign(new Error('Every video needs a title'), { status: 400 });
      if (title.length > 100) throw Object.assign(new Error(`Title is longer than 100 characters: ${title.slice(0, 40)}…`), { status: 400 });
      const description = String(raw.description || '');
      if (Buffer.byteLength(description, 'utf8') > 5000) throw Object.assign(new Error(`Description is over YouTube's 5,000-byte limit: ${title.slice(0, 40)}…`), { status: 400 });
      let publishAt = null;
      if (raw.publishAt) {
        const t = new Date(raw.publishAt);
        if (isNaN(t)) throw Object.assign(new Error('Invalid schedule time'), { status: 400 });
        if (t.getTime() < Date.now() + 15 * 60 * 1000) throw Object.assign(new Error('Scheduled times must be at least 15 minutes from now'), { status: 400 });
        publishAt = t.toISOString();
      }
      const item = {
        qid: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        id, title, description,
        tags: yt.cleanTags(Array.isArray(raw.tags) ? raw.tags : []),
        privacy: PRIVACY.includes(raw.privacy) ? raw.privacy : 'private',
        publishAt,
        playlist: String(raw.playlist || '').trim().slice(0, 150),
        playlistPrivacy: PRIVACY.includes(raw.playlistPrivacy) ? raw.playlistPrivacy : 'public',
        categoryId: CATEGORIES[raw.categoryId] ? String(raw.categoryId) : '27',
        madeForKids: !!raw.madeForKids,
        syntheticMedia: !!raw.syntheticMedia,
        notifySubscribers: raw.notifySubscribers !== false,
        status: 'queued', sent: 0, total: fs.statSync(file).size,
        addedAt: Date.now(),
      };
      items.push(item);
      added.push(item);
    }
    save();
    kick();
    return added;
  }

  function cancel(qid) {
    const it = items.find(x => x.qid === qid);
    if (!it) return false;
    if (running && running.qid === qid) running.controller.abort();
    if (['queued', 'waiting', 'uploading'].includes(it.status)) { it.status = 'cancelled'; it.session = null; }
    save();
    return true;
  }

  function retry(qid) {
    const it = items.find(x => x.qid === qid);
    if (!it || !['failed', 'cancelled', 'waiting'].includes(it.status)) return false;
    it.status = 'queued';
    it.error = null;
    paused = null;
    save();
    kick();
    return true;
  }

  function resume() {
    paused = null;
    for (const it of items) if (it.status === 'waiting') { it.status = 'queued'; it.error = null; }
    save();
    kick();
  }

  function remove(qid) {
    const i = items.findIndex(x => x.qid === qid);
    if (i < 0 || (running && running.qid === qid)) return false;
    items.splice(i, 1);
    save();
    return true;
  }

  function clearFinished() {
    items = items.filter(it => !['done', 'cancelled'].includes(it.status));
    save();
  }

  // ----- worker -----

  async function kick() {
    if (running || paused) return;
    const it = items.find(x => x.status === 'queued');
    if (!it) return;
    const controller = new AbortController();
    running = { qid: it.qid, controller };
    it.status = 'uploading';
    it.error = null;
    it.startedAt = Date.now();
    save();
    let lastSave = 0;
    try {
      const file = fileFor(it.id);
      const video = await yt.uploadVideo(file, it, {
        resume: it.session ? { session: it.session } : null,
        signal: controller.signal,
        onSession: url => { it.session = url; save(); },
        onProgress: (sent, total) => {
          it.sent = sent; it.total = total;
          if (Date.now() - lastSave > 3000) { lastSave = Date.now(); save(); }
        },
      });
      it.status = 'finishing';
      it.videoId = video.id;
      it.url = `https://www.youtube.com/${it.id.startsWith('Shorts/') ? 'shorts/' : 'watch?v='}${video.id}`;
      it.studioUrl = `https://studio.youtube.com/video/${video.id}/edit`;
      it.session = null;
      it.resultPrivacy = video.status && video.status.privacyStatus;
      // Projects that haven't passed YouTube's API audit get every upload locked to Private
      if (!it.publishAt && it.privacy !== 'private' && it.resultPrivacy === 'private') {
        it.warning = 'YouTube set this video to Private: your Google Cloud project has not passed the YouTube API audit yet. Publish it from YouTube Studio.';
      }
      save();
      if (it.playlist) {
        try {
          const pid = await yt.ensurePlaylist(it.playlist, '', it.playlistPrivacy);
          await yt.addToPlaylist(pid, video.id);
          it.playlistId = pid;
        } catch (e) {
          it.warning = [it.warning, `Uploaded, but adding to the playlist failed: ${e.message}`].filter(Boolean).join(' ');
        }
      }
      it.status = 'done';
      it.finishedAt = Date.now();
      const logged = uploads();
      logged[it.id] = {
        videoId: video.id, url: it.url, title: it.title, privacy: it.publishAt ? 'scheduled' : it.privacy,
        resultPrivacy: it.resultPrivacy, publishAt: it.publishAt, playlist: it.playlist || null, uploadedAt: it.finishedAt,
      };
      writeJson(LOG_FILE, logged);
      log(`Uploaded ${it.id} → ${it.url}`);
    } catch (e) {
      if (e.reason === 'cancelled' || it.status === 'cancelled') {
        it.status = 'cancelled';
        it.session = null;
      } else if (['quotaExceeded', 'uploadLimitExceeded', 'notConnected'].includes(e.reason)) {
        // Hold the whole queue: nothing else can go through until this is resolved
        it.status = 'waiting';
        it.error = e.message;
        paused = { reason: e.reason, message: e.message };
      } else {
        it.status = 'failed';
        it.error = e.message;
        if (e.reason === 'sessionExpired') it.session = null;
      }
      log(`Upload of ${it.id} ${it.status}: ${e.message}`);
    } finally {
      running = null;
      save();
      setImmediate(kick);
    }
  }

  function state() {
    return {
      items: items.map(({ session, description, ...it }) => ({ ...it, resumable: !!session })),
      paused,
      quota: yt.quotaUsed(),
    };
  }

  kick();
  return { suggest, add, cancel, retry, resume, remove, clearFinished, state, uploads };
}

module.exports = { createQueue, DEFAULT_SETTINGS, CATEGORIES, PRIVACY };
