// YouTube Data API v3: Google sign-in (OAuth 2.0 for desktop apps, loopback + PKCE), resumable video upload and playlists.
// No dependencies: Node's built-in fetch only.
//
// The OAuth client and the refresh token are stored outside the project (never committed, never sent to the browser):
//   %USERPROFILE%\.quran-channel\youtube.json

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = path.join(os.homedir(), '.quran-channel');
const CONFIG_FILE = path.join(CONFIG_DIR, 'youtube.json');
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube'];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3/videos';
const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KiB

// Approximate quota costs (units); the default daily quota is 10,000
const QUOTA = { upload: 1600, playlistList: 1, playlistInsert: 50, playlistItem: 50, channel: 1 };
const DAILY_QUOTA = 10000;

class YouTubeError extends Error {
  constructor(message, { status, reason, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.retryable = retryable;
  }
}

// ---------- stored configuration ----------

const readConfig = () => {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
};
const writeConfig = cfg => {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
};

// What the browser may see: never the secret or the tokens
function status() {
  const c = readConfig();
  return {
    configured: !!(c.clientId && c.clientSecret),
    connected: !!c.refreshToken,
    clientId: c.clientId || '',
    channel: c.channel || null,
    connectedAt: c.connectedAt || null,
    lastError: c.lastError || null,
  };
}

function saveClient({ clientId, clientSecret }) {
  clientId = String(clientId || '').trim();
  clientSecret = String(clientSecret || '').trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new YouTubeError('That doesn’t look like an OAuth client ID (…apps.googleusercontent.com)', { status: 400 });
  const c = readConfig();
  if (!clientSecret && !(c.clientSecret && c.clientId === clientId)) throw new YouTubeError('Client secret is required', { status: 400 });
  // A different client invalidates the old sign-in
  const changed = c.clientId && c.clientId !== clientId;
  writeConfig({
    ...(changed ? {} : c),
    clientId,
    clientSecret: clientSecret || c.clientSecret,
  });
}

function removeClient() {
  try { fs.unlinkSync(CONFIG_FILE); } catch { /* already gone */ }
  cachedToken = null;
}

// ---------- sign-in ----------

const pending = new Map(); // state → { verifier, redirectUri, returnTo, expires }
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function authUrl(redirectUri, returnTo = '') {
  const c = readConfig();
  if (!c.clientId) throw new YouTubeError('Add your OAuth client first', { status: 400 });
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  pending.set(state, { verifier, redirectUri, returnTo, expires: Date.now() + 10 * 60 * 1000 });
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // always returns a refresh token
    include_granted_scopes: 'true',
    state,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(params) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error_description || j.error || `HTTP ${r.status}`;
    throw new YouTubeError(`Google sign-in failed: ${msg}`, { status: r.status, reason: j.error });
  }
  return j;
}

// Where to send the browser back to after sign-in (known only while the sign-in is pending)
const returnToFor = state => (pending.get(state) || {}).returnTo || '';

// Called by the server when Google redirects back with ?code=…&state=…
async function finishAuth({ code, state, error }) {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || p.expires < Date.now()) throw new YouTubeError('This sign-in link has expired. Start again from Settings.', { status: 400 });
  if (error) throw new YouTubeError(error === 'access_denied' ? 'Access was not granted.' : `Google returned: ${error}`, { status: 400 });
  const c = readConfig();
  const t = await tokenRequest({
    grant_type: 'authorization_code', code, redirect_uri: p.redirectUri,
    client_id: c.clientId, client_secret: c.clientSecret, code_verifier: p.verifier,
  });
  if (!t.refresh_token) throw new YouTubeError('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.', { status: 400 });
  cachedToken = { value: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 };
  writeConfig({ ...c, refreshToken: t.refresh_token, connectedAt: Date.now(), lastError: null });
  // Which channel did they pick?
  const ch = await api('GET', '/channels', { query: { part: 'snippet', mine: 'true' } });
  const item = ch.items && ch.items[0];
  const channel = item
    ? { id: item.id, title: item.snippet.title, handle: item.snippet.customUrl || '', thumbnail: item.snippet.thumbnails?.default?.url || '' }
    : null;
  writeConfig({ ...readConfig(), channel });
  noteQuota(QUOTA.channel);
  return channel;
}

async function disconnect() {
  const c = readConfig();
  if (c.refreshToken) {
    // Best effort: revoke at Google too, so the app disappears from the account's permissions
    await fetch(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: c.refreshToken }) }).catch(() => {});
  }
  const { refreshToken, channel, connectedAt, lastError, ...rest } = c;
  writeConfig(rest);
  cachedToken = null;
}

let cachedToken = null;
async function accessToken(force = false) {
  if (!force && cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;
  const c = readConfig();
  if (!c.refreshToken) throw new YouTubeError('YouTube is not connected. Connect your channel in Settings.', { status: 401, reason: 'notConnected' });
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret });
    cachedToken = { value: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 };
    return cachedToken.value;
  } catch (e) {
    if (e.reason === 'invalid_grant') {
      // Revoked, or expired (apps left in "Testing" mode get 7-day tokens)
      const { refreshToken, ...rest } = readConfig();
      writeConfig({ ...rest, lastError: 'Your YouTube sign-in expired or was revoked. Connect again.' });
      cachedToken = null;
      throw new YouTubeError('Your YouTube sign-in expired or was revoked. Connect again in Settings.', { status: 401, reason: 'notConnected' });
    }
    throw e;
  }
}

// ---------- API calls ----------

async function errorFrom(r) {
  const j = await r.json().catch(() => ({}));
  const e = j.error || {};
  const reason = (e.errors && e.errors[0] && e.errors[0].reason) || e.status || '';
  const messages = {
    quotaExceeded: 'The daily YouTube API quota is used up. Uploads continue after midnight Pacific Time.',
    uploadLimitExceeded: 'YouTube’s daily upload limit for this channel is reached. Try again tomorrow.',
    youtubeSignupRequired: 'This Google account has no YouTube channel yet. Create one on youtube.com first.',
    forbidden: 'YouTube refused the request. Check that the channel can upload videos.',
    invalidTitle: 'YouTube rejected the title (max 100 characters, no < or >).',
    invalidDescription: 'YouTube rejected the description (max 5,000 bytes, no < or >).',
    invalidTags: 'YouTube rejected the tags (max 500 characters in total).',
    invalidPublishAt: 'The scheduled time must be in the future.',
    accessNotConfigured: 'The YouTube Data API v3 is not enabled in your Google Cloud project.',
  };
  return new YouTubeError(messages[reason] || e.message || `YouTube API error ${r.status}`, {
    status: r.status, reason, retryable: r.status >= 500 || r.status === 429,
  });
}

async function api(method, route, { query, json, retried = false } = {}) {
  const url = `${API}${route}${query ? `?${new URLSearchParams(query)}` : ''}`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  if (r.status === 401 && !retried) { await accessToken(true); return api(method, route, { query, json, retried: true }); }
  if (!r.ok) throw await errorFrom(r);
  return r.status === 204 ? {} : r.json();
}

// ---------- quota bookkeeping (approximate; resets at midnight Pacific Time) ----------

const pacificDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
function noteQuota(units) {
  const c = readConfig();
  const q = c.quota && c.quota.day === pacificDay() ? c.quota : { day: pacificDay(), used: 0 };
  q.used += units;
  writeConfig({ ...c, quota: q });
}
function quotaUsed() {
  const q = readConfig().quota;
  return { used: q && q.day === pacificDay() ? q.used : 0, limit: DAILY_QUOTA, perUpload: QUOTA.upload };
}

// ---------- playlists ----------

const playlistCache = new Map();
async function ensurePlaylist(title, description = '', privacyStatus = 'public') {
  title = title.slice(0, 150);
  if (playlistCache.has(title)) return playlistCache.get(title);
  let pageToken;
  do {
    const page = await api('GET', '/playlists', { query: { part: 'snippet', mine: 'true', maxResults: '50', ...(pageToken ? { pageToken } : {}) } });
    noteQuota(QUOTA.playlistList);
    for (const p of page.items || []) playlistCache.set(p.snippet.title, p.id);
    pageToken = page.nextPageToken;
  } while (pageToken && !playlistCache.has(title));
  if (playlistCache.has(title)) return playlistCache.get(title);
  const created = await api('POST', '/playlists', {
    query: { part: 'snippet,status' },
    json: { snippet: { title, description: description.slice(0, 5000) }, status: { privacyStatus } },
  });
  noteQuota(QUOTA.playlistInsert);
  playlistCache.set(title, created.id);
  return created.id;
}

async function addToPlaylist(playlistId, videoId) {
  await api('POST', '/playlistItems', {
    query: { part: 'snippet' },
    json: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } },
  });
  noteQuota(QUOTA.playlistItem);
}

// ---------- resumable upload ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));

// YouTube rejects < and > in titles and descriptions
const cleanText = s => String(s || '').replace(/</g, '‹').replace(/>/g, '›');
function cleanTags(tags) {
  const out = [];
  let len = 0;
  for (const t of tags || []) {
    const tag = String(t).replace(/[<>,"]/g, '').trim().slice(0, 100);
    if (!tag || out.includes(tag)) continue;
    const cost = tag.length + (tag.includes(' ') ? 2 : 0) + (out.length ? 1 : 0);
    if (len + cost > 480) break;
    out.push(tag);
    len += cost;
  }
  return out;
}

// Starts an upload session; returns the session URL to PUT the bytes to
async function startSession(file, meta) {
  const size = fs.statSync(file).size;
  const body = {
    snippet: {
      title: cleanText(meta.title).slice(0, 100),
      description: cleanText(meta.description),
      tags: cleanTags(meta.tags),
      categoryId: String(meta.categoryId || '27'),
      defaultAudioLanguage: 'ar',
    },
    status: {
      privacyStatus: meta.publishAt ? 'private' : meta.privacy || 'private',
      ...(meta.publishAt ? { publishAt: new Date(meta.publishAt).toISOString() } : {}),
      selfDeclaredMadeForKids: !!meta.madeForKids,
      containsSyntheticMedia: !!meta.syntheticMedia,
      embeddable: true,
    },
  };
  const q = new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status', notifySubscribers: meta.notifySubscribers === false ? 'false' : 'true' });
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${UPLOAD_API}?${q}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await accessToken(attempt > 0)}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      noteQuota(QUOTA.upload);
      return r.headers.get('location');
    }
    if (r.status === 401 && attempt === 0) continue;
    const err = await errorFrom(r);
    if (!err.retryable || attempt >= 4) throw err;
    await sleep(2 ** attempt * 1000);
  }
}

// Asks the session how many bytes it already has: { offset } or { done: video }
async function sessionStatus(session, size) {
  const r = await fetch(session, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Length': '0', 'Content-Range': `bytes */${size}` },
  });
  if (r.status === 200 || r.status === 201) return { done: await r.json() };
  if (r.status === 308) {
    const range = r.headers.get('range');
    return { offset: range ? parseInt(range.split('-')[1], 10) + 1 : 0 };
  }
  if (r.status === 404 || r.status === 410) return { expired: true };
  throw await errorFrom(r);
}

// Uploads `file`, resuming `resume.session` when given. Calls onSession(url) once a session exists (so it can be saved)
// and onProgress(sent, total). Resolves with the YouTube video resource.
async function uploadVideo(file, meta, { resume, onSession, onProgress, signal } = {}) {
  const size = fs.statSync(file).size;
  let session = resume && resume.session;
  let offset = 0;
  if (session) {
    const s = await sessionStatus(session, size).catch(() => ({ expired: true }));
    if (s.done) return s.done;
    if (s.expired) session = null;
    else offset = s.offset;
  }
  if (!session) {
    session = await startSession(file, meta);
    if (onSession) onSession(session);
  }

  const fd = fs.openSync(file, 'r');
  try {
    let failures = 0;
    while (offset < size) {
      if (signal && signal.aborted) throw new YouTubeError('Cancelled', { reason: 'cancelled' });
      const len = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      let r;
      try {
        r = await fetch(session, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${await accessToken()}`,
            'Content-Length': String(len),
            'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}`,
          },
          body: buf,
          signal,
        });
      } catch (e) {
        if (signal && signal.aborted) throw new YouTubeError('Cancelled', { reason: 'cancelled' });
        r = null; // network error: ask the session where it got to
      }
      if (r && (r.status === 200 || r.status === 201)) { if (onProgress) onProgress(size, size); return await r.json(); }
      if (r && r.status === 308) {
        const range = r.headers.get('range');
        offset = range ? parseInt(range.split('-')[1], 10) + 1 : 0;
        failures = 0;
        if (onProgress) onProgress(offset, size);
        continue;
      }
      if (r && r.status === 401) { await accessToken(true); continue; }
      if (r && r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 404 && r.status !== 410) throw await errorFrom(r);
      if (r && (r.status === 404 || r.status === 410)) throw new YouTubeError('The upload session expired. Retry to start again.', { reason: 'sessionExpired' });
      // 5xx, 429 or network failure: back off, then resume from what the server has
      if (++failures > 8) throw new YouTubeError('Upload keeps failing (network or YouTube server errors). Retry later — it resumes where it stopped.', { retryable: true });
      await sleep(Math.min(60000, 2 ** failures * 1000));
      const s = await sessionStatus(session, size).catch(() => null);
      if (s && s.done) { if (onProgress) onProgress(size, size); return s.done; }
      if (s && s.expired) throw new YouTubeError('The upload session expired. Retry to start again.', { reason: 'sessionExpired' });
      if (s) { offset = s.offset; if (onProgress) onProgress(offset, size); }
    }
    // Every byte was accepted but no final response arrived: ask once more
    const s = await sessionStatus(session, size);
    if (s.done) return s.done;
    throw new YouTubeError('Upload finished but YouTube did not confirm it. Retry to check.', { retryable: true });
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  CONFIG_FILE, QUOTA, DAILY_QUOTA, YouTubeError,
  status, saveClient, removeClient, authUrl, returnToFor, finishAuth, disconnect,
  uploadVideo, ensurePlaylist, addToPlaylist, quotaUsed, cleanTags,
};
