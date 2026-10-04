# Quran Video Maker

Generates YouTube videos and Shorts of Quran recitation with synced captions:
- **Arabic** (Uthmani) with **word-by-word highlighting** that follows the reciter
- **English** and **Bangla** translations
- Branded **intro/outro** and a **channel watermark** (text or your logo)
- **Background videos** (Islamic architecture, nature…) cycled with cross-fades
- **Batch mode**: one Short per verse of a surah, each with its own YouTube description

## Requirements
- Node.js 18+ (no npm packages needed)
- FFmpeg: `winget install Gyan.FFmpeg`

Fonts (Amiri Quran, Hind Siliguri, Poppins) download automatically on first run.

## 1. Set up your channel branding — `channel.json`

```json
{
  "name": "My Quran Channel",
  "handle": "@MyQuranChannel",
  "logo": "logo.png",
  "intro": { "long": 5, "short": 1.5 },
  "outro": { "long": 6, "short": 2.5 }
}
```
- `logo` is optional (transparent PNG, square works best). Without it, the `handle` is used as a text watermark.
- Intro/outro lengths are in seconds; set to `0` to disable for that format.

## 2. Add background videos (optional)

Get a free Pexels API key at https://www.pexels.com/api/, then:

```powershell
$env:PEXELS_API_KEY = "your_key"
node fetch-backgrounds.js                                   # mosques, Islamic architecture, desert, sky, ocean…
node fetch-backgrounds.js --query "masjid nabawi" --count 5 --orientation portrait
```

Clips go into `backgrounds/landscape/` and `backgrounds/portrait/` (for Shorts), with attribution saved to
`backgrounds/credits.json` and added to each video description automatically.
**Review the clips and delete any you don't want** (e.g. ones showing people or music-related scenes).

You can also drop your own `.mp4` / `.jpg` / `.png` files into those folders. Images get a slow zoom effect.
If `backgrounds/` is empty, an animated gradient is used.

## 3. Make videos

```powershell
node make-video.js --surah 36                                  # Surah Yasin, full, 16:9
node make-video.js --surah 2 --from 255 --to 255 --format short # Ayat al-Kursi as a Short
node make-video.js --surah 67 --batch                           # one Short per verse of Al-Mulk
node make-video.js --surah 2 --from 1 --to 20 --batch --group-seconds 20  # merge short verses into ≥20 s Shorts
node make-video.js --surah 18 --reciter sudais --bg my-folder   # different reciter & background folder
```

| Option | Values | Default |
|---|---|---|
| `--surah` | 1–114 | required |
| `--from`, `--to` | verse range | whole surah |
| `--reciter` | alafasy, abdulbasit, abdulbasit-mujawwad, sudais, shatri, rifai, husary, minshawy, minshawy-mujawwad, shuraym, maher\*, dossary\* | alafasy |
| `--en` | saheeh, haleem, usmani, yusufali | saheeh |
| `--bn` | taisirul, mujibur, rawai, zakaria | taisirul |
| `--format` | `long` (1920×1080) or `short` (1080×1920) | long |
| `--bg` | image, video or folder | `backgrounds/` or gradient |
| `--batch` | one Short per verse → `output/<surah>_shorts/` | |
| `--group-seconds` | with `--batch`: merge verses until each Short is ≥ n s | 0 |
| `--no-highlight` `--no-intro` `--no-outro` `--no-watermark` `--no-bismillah` | turn features off | |

\* maher and dossary have no word timings, so highlighting is off for them.

Each video gets a `.description.txt` (title, reciter, translators, background credits, hashtags) to paste into YouTube.

## Sources
- Text, translations, recitation audio and word timings: [Quran.com API](https://api.quran.com)
- Fallback verse audio: [EveryAyah.com](https://everyayah.com)
- Background footage: [Pexels](https://www.pexels.com) (free to use, attribution included)

Downloads are cached in `cache/`, so re-rendering is fast.
