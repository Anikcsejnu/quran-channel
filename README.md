# Quran Video Maker

Generates YouTube videos and Shorts of Quran recitation with synced captions:
- **Arabic** (Uthmani) with **word-by-word highlighting** that follows the reciter
- **English** and **Bangla** translations
- Branded **intro/outro** and a **channel watermark** (text or your logo)
- **Background videos** (Islamic architecture, nature…) cycled with cross-fades
- **Batch mode**: one Short per verse of a surah, each with its own YouTube description
- **Custom caption colours**: Arabic text, highlighted word, glow, English, Bangla, verse reference
- **Adjustable text size** for the Arabic verse and each translation
- **Studio**: a local web UI for all of the above

## Requirements
- Node.js 18+ (no npm packages needed)
- FFmpeg: `winget install Gyan.FFmpeg`

Fonts (Amiri Quran, Hind Siliguri, Poppins) download automatically on first run.

## Studio (web UI)

```bash
npm start
```

Then open **http://localhost:4173**. The studio runs only on your computer.

| Page | What you can do |
|---|---|
| **Create** | Pick surah and verses (searchable, with quick picks), reciter, translations, video or Shorts batch, background and features. **Choose clips** opens a background picker: select any number of videos/images (numbered in play order, with a live preview, duration, credit and crop guide for Shorts), then drag or arrow-key to reorder them. **Auto** has settings too (which clips, order, how many) and shows the clips it will use; **Gradient** lets you pick 2–4 colours, presets and animation speed; seconds per clip and background dim apply to any clips. **Save background as default** stores these in `channel.json` under `"background"`. Style the caption colours with presets or colour pickers, watch the **live preview** with the word highlight moving, or render an **exact preview frame** in about 2 seconds. Then render, with live progress, a log and cancel. |
| **Library** | Watch rendered videos, copy the YouTube title and description in one click, download or delete. |
| **Branding** | Channel name, handle, subscribe line, logo upload, intro/outro lengths, default caption colours. |
| **Backgrounds** | Download clips from Pixabay or Pexels (your API key stays in your browser), upload your own, preview and remove clips. |

Everything the studio does is also available from the command line (below).

## Caption colours

Defaults live in `channel.json` under `"colors"` (the studio's **Save as default** writes them there).
Override per run with `--color-<name> "#RRGGBB"`:

| Name | Colours |
|---|---|
| `arabic` | Arabic verse text |
| `highlight` | the word being recited |
| `glow` | glow around the highlighted word |
| `english` / `bangla` | translations |
| `reference` | the "Al-Fatihah 1:5" label |

```bash
node make-video.js --surah 67 --color-highlight "#7CFFC4" --color-glow "#00A86B"
node make-video.js --surah 1 --from 5 --still preview.png   # one frame, to check colours quickly
```

## Text size

Make the Arabic, English or Bangla text bigger or smaller, from 50% to 200% (the Studio has sliders under
**Caption style → Text size**). Saved defaults live in `channel.json` under `"fontScale"`; override per run with
`--size-<name>` (1 = 100%):

```bash
node make-video.js --surah 112 --size-arabic 1.3 --size-english 0.9 --size-bangla 1.2
```

Your sizes are used as-is whenever the verse fits on screen. Text is only shrunk when a verse would otherwise
overflow (the renderer estimates the wrapped height of all three languages), so very long verses such as
Ayat al-Kursi or 2:282 may not get bigger than the screen allows.

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

Get a free **Pixabay** API key (sign up, then find it at https://pixabay.com/api/docs/), then:

```powershell
$env:PIXABAY_API_KEY = "your_key"
node fetch-backgrounds.js                                   # mosques, Islamic architecture, desert, sky, ocean…
node fetch-backgrounds.js --query "masjid nabawi" --count 5 --orientation portrait
```

Pixabay has few vertical clips, so Shorts may use landscape clips (centre-cropped automatically).
Already have a Pexels key? Use `--provider pexels` with `$env:PEXELS_API_KEY` (Pexels has paused new keys).

No API key at all? Download clips by hand from pixabay.com or pexels.com and drop them into the Studio's
**Backgrounds → Upload your own** (or into the `backgrounds/landscape` / `backgrounds/portrait` folders).

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
| `--bg` | image, video or folder; repeat to cross-fade several files in that order (`--bg a.mp4 --bg b.jpg`), or `gradient` | `backgrounds/` or gradient |
| `--bg-source` / `--bg-order` / `--bg-max` | Auto: `match`/`all` clips · `rotate`/`shuffle`/`name` · 1–40 | match · rotate · 12 |
| `--clip-seconds` / `--bg-dim` | seconds each clip shows (4–30) · darkening 0–0.9 | 12 · 0.55 |
| `--gradient` / `--gradient-speed` | 2–4 colours `"#0A1A24,#14352B,#1D1530"` · 0 (still)–10 | Night emerald · 2 |
| `--batch` | one Short per verse → `output/<surah>_shorts/` | |
| `--group-seconds` | with `--batch`: merge verses until each Short is ≥ n s | 0 |
| `--no-highlight` `--no-intro` `--no-outro` `--no-watermark` `--no-bismillah` | turn features off | |

\* maher and dossary have no word timings, so highlighting is off for them.

## 4. YouTube title & description

Each video gets two files next to it, ready to paste into YouTube Studio:
- `.title.txt`: e.g. `Surah Al-Ikhlas | Mishary Rashid Alafasy | Arabic, English & Bangla Translation`
- `.description.txt`: an introduction to the surah, then 📖 Surah · 📍 Juz & verses · 🕋 place of revelation ·
  🎙️ reciter · 🌐 translators, your subscribe line (`subscribeLine` in `channel.json`), background credits and hashtags.

The introduction comes from **`intros.json`**, keyed by surah (`"112"`) or by a specific verse/range (`"2:255"`, `"2:285-286"`).
It includes intros for popular surahs; add or edit your own there. Surahs without an entry fall back to the
short summary from Quran.com (Tafhim al-Qur'an).

## Sources
- Text, translations, recitation audio and word timings: [Quran.com API](https://api.quran.com)
- Fallback verse audio: [EveryAyah.com](https://everyayah.com)
- Background footage: [Pixabay](https://pixabay.com) or [Pexels](https://www.pexels.com) (free to use, attribution included)

Downloads are cached in `cache/`, so re-rendering is fast.
