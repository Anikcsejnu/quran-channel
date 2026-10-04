#!/usr/bin/env node
// Downloads royalty-free background videos into ./backgrounds/<landscape|portrait>/
// and records attribution in ./backgrounds/credits.json (used in the YouTube descriptions).
//
// Providers (free API keys):
//   Pixabay  https://pixabay.com/api/docs/   → PIXABAY_API_KEY   (default)
//   Pexels   https://www.pexels.com/api/     → PEXELS_API_KEY
//
//   $env:PIXABAY_API_KEY = "your_key"
//   node fetch-backgrounds.js                                   # default Islamic/nature themes
//   node fetch-backgrounds.js --query "mosque" --count 6 --orientation portrait
//   node fetch-backgrounds.js --provider pexels

const fs = require('fs');
const path = require('path');

const DEFAULT_QUERIES = [
  'mosque', 'mosque interior', 'islamic architecture', 'minaret', 'mecca',
  'desert dunes', 'clouds timelapse', 'night sky stars', 'calm ocean', 'mountains mist',
];

const PROVIDERS = {
  pixabay: { env: 'PIXABAY_API_KEY', signup: 'https://pixabay.com/api/docs/', search: searchPixabay },
  pexels: { env: 'PEXELS_API_KEY', signup: 'https://www.pexels.com/api/', search: searchPexels },
};

function parseArgs() {
  const a = { count: 3, orientation: 'both', provider: 'pixabay' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) a[argv[i].replace(/^--/, '')] = argv[++i];
  const p = PROVIDERS[a.provider];
  if (!p) {
    console.error(`Unknown provider "${a.provider}". Use: ${Object.keys(PROVIDERS).join(', ')}`);
    process.exit(1);
  }
  a.key = a.key || process.env[p.env];
  if (!a.key) {
    console.error(`Missing ${a.provider} API key. Get one free at ${p.signup} and set ${p.env}.`);
    process.exit(1);
  }
  a.count = Math.max(1, Math.min(15, parseInt(a.count, 10) || 3));
  return a;
}

const isPortrait = (w, h) => h > w;

// Each search returns [{ id, url, width, height, credit }] best-first, already sized for the orientation
async function searchPixabay(query, orientation, count, key) {
  // Pixabay has no orientation filter: fetch more, prefer clips that already match, then fill with the rest
  // (make-video.js centre-crops any clip to the target frame)
  const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}` +
    `&safesearch=true&per_page=${Math.min(200, count * 8)}&min_width=1280`;
  const res = await fetch(url);
  if (res.status === 429) throw new Error('Pixabay rate limit reached (100 requests/minute) — try again shortly');
  if (!res.ok) throw new Error(`Pixabay API error ${res.status}${res.status === 400 ? ' (check your API key)' : ''}`);
  const { hits } = await res.json();
  const items = hits.map(h => {
    // Prefer ~1080p: large is usually 1920 wide, medium 1280
    const v = h.videos.large && h.videos.large.url ? h.videos.large : h.videos.medium;
    return {
      id: `pixabay-${h.id}`, url: v.url, width: v.width, height: v.height,
      credit: `Video by ${h.user} on Pixabay: ${h.pageURL}`,
    };
  }).filter(i => i.url);
  const wantPortrait = orientation === 'portrait';
  const matching = items.filter(i => isPortrait(i.width, i.height) === wantPortrait);
  const others = items.filter(i => isPortrait(i.width, i.height) !== wantPortrait);
  return [...matching, ...others].slice(0, count);
}

async function searchPexels(query, orientation, count, key) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=${orientation}&size=medium`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels API error ${res.status}`);
  const { videos } = await res.json();
  const target = orientation === 'portrait' ? 1080 : 1920;
  return videos.map(v => {
    // Prefer an HD file closest to the target size (avoids huge 4K downloads)
    const files = v.video_files.filter(f => f.file_type === 'video/mp4' && f.width && f.height);
    const ok = files.filter(f => isPortrait(f.width, f.height) === (orientation === 'portrait'));
    const f = (ok.length ? ok : files).sort((x, y) => Math.abs(x.width - target) - Math.abs(y.width - target))[0];
    return f && { id: `pexels-${v.id}`, url: f.link, width: f.width, height: f.height, credit: `Video by ${v.user.name} on Pexels: ${v.url}` };
  }).filter(Boolean);
}

async function main() {
  const args = parseArgs();
  const provider = PROVIDERS[args.provider];
  const queries = args.query ? [args.query] : DEFAULT_QUERIES;
  const orientations = args.orientation === 'both' ? ['landscape', 'portrait'] : [args.orientation];
  const root = path.join(__dirname, 'backgrounds');
  const creditsFile = path.join(root, 'credits.json');
  const credits = fs.existsSync(creditsFile) ? JSON.parse(fs.readFileSync(creditsFile, 'utf8')) : {};
  let downloaded = 0;

  console.log(`• Provider: ${args.provider}`);
  for (const orientation of orientations) {
    const dir = path.join(root, orientation);
    fs.mkdirSync(dir, { recursive: true });
    for (const q of queries) {
      console.log(`• Searching "${q}" (${orientation})`);
      const items = await provider.search(q, orientation, args.count, args.key);
      if (!items.length) console.log('  no results');
      for (const item of items) {
        const name = `${item.id}.mp4`;
        const dest = path.join(dir, name);
        if (fs.existsSync(dest)) continue;
        process.stdout.write(`  ${orientation}/${name}  ${item.width}x${item.height} ... `);
        const r = await fetch(item.url);
        if (!r.ok) { console.log('failed'); continue; }
        fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
        credits[name] = item.credit;
        fs.writeFileSync(creditsFile, JSON.stringify(credits, null, 2));
        downloaded++;
        console.log('ok');
      }
    }
  }
  console.log(`\n✓ ${downloaded} new clip${downloaded === 1 ? '' : 's'}. Review them in ${root} and delete any you don't want.`);
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
