#!/usr/bin/env node
// Downloads royalty-free background videos from Pexels into ./backgrounds/<landscape|portrait>/
// and records attribution in ./backgrounds/credits.json (used in the YouTube descriptions).
//
// Get a free API key at https://www.pexels.com/api/ then:
//   set PEXELS_API_KEY=your_key            (PowerShell: $env:PEXELS_API_KEY="your_key")
//   node fetch-backgrounds.js                                   # default Islamic/nature themes
//   node fetch-backgrounds.js --query "mosque" --count 6 --orientation portrait

const fs = require('fs');
const path = require('path');

const DEFAULT_QUERIES = [
  'mosque', 'mosque interior', 'islamic architecture', 'minaret', 'mecca',
  'desert dunes', 'clouds timelapse', 'night sky stars', 'calm ocean', 'mountains mist',
];

function parseArgs() {
  const a = { count: 3, orientation: 'both' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) a[argv[i].replace(/^--/, '')] = argv[++i];
  a.key = a.key || process.env.PEXELS_API_KEY;
  if (!a.key) {
    console.error('Missing Pexels API key. Get one free at https://www.pexels.com/api/ and set PEXELS_API_KEY.');
    process.exit(1);
  }
  return a;
}

// Prefer an HD file closest to the target size (avoids huge 4K downloads)
function pickFile(video, orientation) {
  const target = orientation === 'portrait' ? 1080 : 1920;
  const files = video.video_files.filter(f => f.file_type === 'video/mp4' && f.width && f.height);
  const ok = files.filter(f => (orientation === 'portrait' ? f.height > f.width : f.width > f.height));
  const pool = ok.length ? ok : files;
  return pool.sort((x, y) => Math.abs(x.width - target) - Math.abs(y.width - target))[0];
}

async function main() {
  const args = parseArgs();
  const queries = args.query ? [args.query] : DEFAULT_QUERIES;
  const orientations = args.orientation === 'both' ? ['landscape', 'portrait'] : [args.orientation];
  const root = path.join(__dirname, 'backgrounds');
  const creditsFile = path.join(root, 'credits.json');
  const credits = fs.existsSync(creditsFile) ? JSON.parse(fs.readFileSync(creditsFile, 'utf8')) : {};

  for (const orientation of orientations) {
    const dir = path.join(root, orientation);
    fs.mkdirSync(dir, { recursive: true });
    for (const q of queries) {
      const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${args.count}&orientation=${orientation}&size=medium`;
      const res = await fetch(url, { headers: { Authorization: args.key } });
      if (!res.ok) throw new Error(`Pexels API error ${res.status}`);
      const { videos } = await res.json();
      for (const v of videos) {
        const name = `pexels-${v.id}.mp4`;
        const dest = path.join(dir, name);
        if (fs.existsSync(dest)) continue;
        const file = pickFile(v, orientation);
        if (!file) continue;
        process.stdout.write(`  ${orientation}/${name}  "${q}"  ${file.width}x${file.height} ... `);
        const r = await fetch(file.link);
        if (!r.ok) { console.log('failed'); continue; }
        fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
        credits[name] = `Video by ${v.user.name} on Pexels: ${v.url}`;
        fs.writeFileSync(creditsFile, JSON.stringify(credits, null, 2));
        console.log('ok');
      }
    }
  }
  console.log(`\nDone. Review the clips in ${root} and delete any you don't want before rendering.`);
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
