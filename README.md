# Quran Video Studio

Make YouTube videos and Shorts of Quran recitation with synced captions — from a local web studio or the command line.

- **Arabic** (Uthmani script) with **word-by-word highlighting** that follows the reciter
- **English** and **Bangla** translations
- Branded **intro / outro** and a **watermark** (your logo or @handle)
- **Backgrounds**: your own clips/images or free stock footage, cross-faded, or an animated gradient
- **Batch Shorts**: one Short per verse of a surah
- **Caption style**: colours for every text element and adjustable text sizes, with a live preview that matches the render
- **YouTube-ready title and description** for every video
- **Upload to YouTube** from the Studio: one video or a whole batch of Shorts, with playlists and scheduled publishing

---

## Contents

1. [Quick start](#quick-start)
2. [Using the Studio](#using-the-studio)
   - [Uploading to YouTube](#uploading-to-youtube)
3. [How it works](#how-it-works)
   - [Architecture](#architecture)
   - [Render pipeline](#render-pipeline)
   - [Word-by-word highlighting](#word-by-word-highlighting)
   - [Text size and fitting](#text-size-and-fitting)
   - [Backgrounds](#backgrounds)
   - [Batch Shorts](#batch-shorts)
   - [Preview frame](#preview-frame)
   - [Jobs and progress](#jobs-and-progress)
   - [Titles and descriptions](#titles-and-descriptions)
   - [YouTube uploads](#youtube-uploads)
4. [Configuration](#configuration)
5. [Command line](#command-line)
6. [Project layout](#project-layout)
7. [Studio server API](#studio-server-api)
8. [Troubleshooting](#troubleshooting)
9. [Sources and credits](#sources-and-credits)

---

## Quick start

**Requirements**
- Node.js 18 or newer (no npm packages needed)
- FFmpeg — on Windows: `winget install Gyan.FFmpeg`

**Run the Studio**

```bash
npm start
```

Open **http://localhost:4173**. The Studio only listens on your own computer (127.0.0.1).

**Or render from the command line**

```bash
node make-video.js --surah 112
```

The video is written to `output/Videos/112 - Al-Ikhlas/112_1-4_alafasy.mp4`, with a `.title.txt` and `.description.txt` next to it (see [Where videos are saved](#where-videos-are-saved)).

Fonts (Amiri Quran, Hind Siliguri, Poppins) are downloaded automatically on the first render.

---

## Using the Studio

The Studio has four pages in the sidebar.

### Create

Work top to bottom on the left, check the result on the right, then render.

| Step | What you set |
|---|---|
| **1. Passage** | Surah (search by name, meaning or number), verse range, or a quick pick (Full surah, Ayat al-Kursi, End of Al-Baqarah, Al-Kahf 1–10, Al-Mulk). |
| **2. Recitation & translation** | Reciter (it tells you whether word timings are exact or aligned), English and Bangla translation. |
| **3. Output** | **Single video** or **Short per verse**; format **Video 16:9** or **Short 9:16**; **Background** — see below. |
| **4. Features** | Word-by-word highlight, intro card, outro card, watermark, Bismillah, and **Bangla translation audio** (see below). |

**Bangla translation audio** reads each ayah's Bangla translation aloud right after the recitation:
*ayah → pause → Bangla translation → pause → next ayah*. While it plays, the Bangla line glows in the highlight colour.
Choose a voice — **Azure** (Nabanita / Pradeep, Bangladeshi accent, recommended), **Google** (Indian Bengali), or
**My recordings** (your own narration, one file per ayah) — set the speed and both pauses, and press **Test voice**
to hear it. Azure and Google need a free API key, entered in the panel and stored only in your browser.

**Background** has three modes:

- **Auto** — uses your clips automatically. Settings: *Use clips* (matching this format / all clips), *Order* (different start per surah / shuffle / by name), *Maximum clips*. A **Will use** strip shows exactly which clips will play.
- **Gradient** — an animated gradient. Pick 2–4 colours (picker or hex), a preset, and the animation speed.
- **Choose clips** — opens a picker: click clips to select them in play order (numbered), hover to preview them large with size, length and credit, filter by orientation/type, upload new clips. The chosen clips appear as a strip you can **drag** (or use **arrow keys**) to reorder.

For Auto and Choose clips you can also set **Seconds per clip** and **Dim background**. **Save background as default** stores these settings.

**Preview** (right side):

- **Live** — instant, in the browser, with the highlight walking through the words and the real background behind the text. It uses the same layout numbers as the renderer, so sizes and line breaks match the video.
- **Rendered frame** — an exact frame from the real renderer (about 2 seconds).

**Caption style**:

- **Text size** — sliders and −/+ buttons for Arabic, English and Bangla (50–200%). If a verse is too long for your sizes, a note says how much it was reduced to fit.
- **Colours** — presets or pickers for Arabic text, highlighted word, highlight glow, English, Bangla and verse reference.
- **Save as default** stores colours and sizes for future videos; **Reset** goes back to them.

Click **Render video** (or **Render Shorts**). A panel shows progress, the current step, a log, finished files and a **Cancel** button.

### Library

Every rendered video, newest first: play it, **copy the YouTube title or description**, download it, delete it, or **upload it to YouTube**. Each card shows its surah folder and, once uploaded, an *On YouTube* link. Filter by Videos, Shorts or *Not on YouTube*, or search. Tick the box on several cards to upload them together.

### Where videos are saved

Videos are sorted by type and surah, so they're easy to find when uploading:

```
output/
├── Videos/
│   ├── 001 - Al-Fatihah/
│   │   ├── 001_1-7_alafasy.mp4
│   │   ├── 001_1-7_alafasy.title.txt
│   │   └── 001_1-7_alafasy.description.txt
│   └── 108 - Al-Kawthar/ …
└── Shorts/
    └── 112 - Al-Ikhlas/
        ├── 112_1_alafasy.mp4          one per verse with "Short per verse"
        ├── 112_2_alafasy.mp4
        └── …
```

File names are `<surah>_<verses>_<reciter>.mp4`. Folder numbers are zero-padded so folders sort in Quran order.

Videos rendered before this layout existed can be moved into it with:

```bash
node organize-output.js           # shows what would move
node organize-output.js --apply   # moves them (with their title/description files)
```

### Branding

Channel name, YouTube handle, subscribe line for descriptions, logo upload (drag and drop), and intro/outro lengths for videos and Shorts.

### Uploading to YouTube

**One-time setup** (Settings page — about 10 minutes):

1. In [Google Cloud Console](https://console.cloud.google.com/projectcreate) create a project and enable **YouTube Data API v3**.
2. Set up the **OAuth consent screen**: type *External*, add your Gmail as a test user, then **Publish app**. (Left in *Testing*, the sign-in expires every 7 days.)
3. Create an **OAuth client** of type **Desktop app**, and paste its client ID and secret into *Settings → OAuth client*.
4. Click **Connect YouTube** and sign in with the account that owns the channel. Google warns that the app isn't verified — it's your own app, so choose *Advanced → Go to …*.

**Uploading**

1. In the **Library**, tick one or more videos/Shorts (or use the upload icon on one card) and click **Upload to YouTube**.
2. In the dialog, check each title (max 100 characters), description and tags, and choose:
   - **Visibility** — Private, Unlisted, Public, or **Scheduled**: a first publish time and the hours between videos (e.g. one Short a day at 18:00);
   - **Playlist** — none, one per surah (*Surah Al-Ikhlas | সূরা আল-ইখলাস*, created if missing) or a custom name.
3. The **Uploads** page shows the queue: progress, *Watch* and *Studio* links, Cancel/Retry, and how much of today's API quota is left.

Defaults for visibility, category, playlist, schedule, tags and notifications are set in *Settings → Upload defaults*.

> **Uploads stay Private until Google audits your project.** YouTube locks every video uploaded through an unaudited API
> project to Private. Apply with the [YouTube API audit form](https://support.google.com/youtube/contact/yt_api_form);
> until then, publish each video yourself in YouTube Studio (the queue shows a note when this happens). It's also a good
> moment to look at the copyright *Checks* result before publishing.

### Backgrounds

- **Download stock footage** from **Pixabay** (free API key) or **Pexels** (only if you already have a key — Pexels has paused new keys). Your key is stored only in your browser.
- **Upload your own** videos or images for videos (landscape) or Shorts (portrait).
- Browse, preview (hover to play) and remove clips.

---

## How it works

### Architecture

```mermaid
flowchart LR
  UI["Studio UI<br/>ui/ (browser)"] -- "HTTP / JSON" --> S["server.js<br/>127.0.0.1:4173"]
  S -- "spawns" --> MV["make-video.js"]
  S -- "spawns" --> FB["fetch-backgrounds.js"]
  MV --> FF["FFmpeg + libass"]
  MV -- "text, translations,<br/>audio, word timings" --> QC[("Quran.com API")]
  MV -- "fallback audio" --> EA[("EveryAyah.com")]
  FB --> PX[("Pixabay / Pexels")]
  MV --> OUT["output/<br/>.mp4 + title + description"]
  S -- "reads/writes" --> CFG["channel.json<br/>intros.json"]
  MV -- "reads" --> CFG
```

- **`make-video.js`** does all the real work and can be used on its own from the command line.
- **`server.js`** is a small Node HTTP server with no dependencies. It serves the UI, validates every option, turns it into command-line flags for `make-video.js`, runs one job at a time and reports progress.
- **`ui/`** is plain HTML/CSS/JS — no build step.
- Everything downloaded is cached in `cache/`, so re-rendering is fast.

### Render pipeline

What `make-video.js` does for each video:

```mermaid
flowchart TD
  A["1 · Fonts<br/>download once, read font metrics"] --> B["2 · Quran data<br/>words, translations, surah info"]
  B --> C["3 · Recitation<br/>chapter audio + word timings"]
  C --> D["4 · Timeline<br/>cut audio, place Bismillah + verses<br/>after the intro"]
  D --> E["5 · Background<br/>gradient, single file, or cross-faded reel"]
  E --> F["6 · Captions (.ass)<br/>intro, header, verses, highlight events,<br/>watermark, outro"]
  F --> G["7 · FFmpeg<br/>background + dim + logo + captions + audio<br/>→ H.264/AAC MP4"]
  G --> H["8 · Title + description<br/>.title.txt / .description.txt"]
```

1. **Fonts** — Amiri Quran (Arabic), Poppins (English, header), Hind Siliguri (Bangla) are downloaded from Google Fonts on first run. Their metrics are read from the font files (see [Text size](#text-size-and-fitting)).
2. **Quran data** — from the Quran.com API: each verse's Uthmani words, the chosen English and Bangla translations (footnote markers removed), juz, and surah info (Arabic name, meaning, place of revelation, summary).
3. **Recitation** — for reciters with word timings, Quran.com's gapless **chapter audio** plus **timestamps for every verse and word**. Most reciters come from the Quran.com v4 API; Yasser ad-Dossary and Khalifah Al Tunaiji only exist in Quran.com's newer audio API (`api.qurancdn.com`), which returns the same data under different field names. Maher al-Muaiqly and the lesser-known reciters have no published word timings, so their audio comes as one MP3 per verse from EveryAyah.com and the word timings are worked out by [audio alignment](#word-timings-by-audio-alignment).
4. **Timeline** — the needed part of the chapter audio is cut to WAV. If the passage starts at verse 1 (and the surah isn't Al-Fatiha or At-Tawbah), the Bismillah is taken from Al-Fatiha 1:1 and placed first. Everything starts after the intro, and the outro is added at the end.
5. **Background** — see [Backgrounds](#backgrounds).
6. **Captions** — an Advanced SubStation (`.ass`) subtitle file with the intro card, surah header, every verse (Arabic + English + Bangla + reference), the highlight events, the text watermark and the outro card.
7. **FFmpeg** — combines background (scaled, cropped, dimmed, vignette), logo overlays, the captions (rendered by libass, which shapes Arabic and Bangla correctly) and the audio into an MP4 (H.264 + AAC, `faststart` for YouTube).
8. **Title and description** — written next to the video.

### Bangla translation audio

No source offers human Bangla narration split per ayah (EveryAyah, QuranicAudio and Quran.com have none), so the
spoken translation comes from one of three places:

| Voice | Source | Key |
|---|---|---|
| `azure:bn-BD-NabanitaNeural`, `azure:bn-BD-PradeepNeural` | Microsoft Azure neural speech (Bangladesh) | `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` — free tier 500k characters/month |
| `google:bn-IN-Wavenet-A`, `google:bn-IN-Wavenet-B` | Google Cloud Text-to-Speech (India) | `GOOGLE_TTS_API_KEY` |
| `files` | Your recordings: `translation-audio/bn/<NNN>/<NNNAAA>.mp3` (e.g. `112/112001.mp3`; Bismillah = `001/001001.mp3`) | none |

How it fits into the [render pipeline](#render-pipeline):

1. When the option is on, the recitation is cut **per ayah** (instead of one continuous cut).
2. After each ayah (and the Bismillah), the timeline adds: a pause → the spoken Bangla translation (exactly the text shown on screen) → a pause.
3. Synthesised speech is **cached** in `cache/tts/` by voice, speed and text, so re-rendering never calls the service — or bills you — twice.
4. The captions get an extra phase per ayah: from the end of the recitation until the next ayah, the Bangla line is drawn in the highlight colour with a glow.
5. The description adds a line naming the narration; synthetic voices are labelled **AI-generated voice**.

Preview frames never generate speech. Keys sent from the Studio are only passed to the render process's environment — never saved or logged.

### Word-by-word highlighting

Quran.com gives, for each verse, the time each word starts. Instead of one subtitle per verse, the renderer writes **one subtitle event per word**: the whole verse is drawn again with only that word in the highlight colour and glow. Because the text and layout are identical in every event, only the colour changes on screen.

Arabic needs two details to render correctly:
- the verse is wrapped in right-to-left embedding marks and the caption style uses libass's *whole-text layout*, so colour changes inside the line don't break word order;
- the verse number is drawn in ornate brackets: ﴿٧﴾.

#### Word timings by audio alignment

For reciters without published timings (Maher al-Muaiqly and the lesser-known reciters), the renderer finds the word
starts itself by comparing the recitation with reciters whose timings are known:

1. **Reference audio** — the same verse recited by Abdur-Rahman as-Sudais and Saud ash-Shuraym, with Quran.com's exact word timings. Their chapter audio is downloaded once to `cache/audio/`.
2. **Features** — both recordings are decoded to 16 kHz mono and turned into MFCC frames (20 ms steps), normalised per recording so voice and microphone differences matter less.
3. **Alignment** — dynamic time warping (restricted to a band around the diagonal, to stay fast) maps every moment of the reference onto the target recording, so each known word start lands on a time in the new recitation.
4. **Vote** — the two predictions are combined (median) and kept in order. If alignment fails, a fallback estimates the timings from silences and word lengths.
5. **Cache** — results are saved in `cache/timings/`, so only the first render of a surah is slower.

Tested against Mishary Alafasy (whose exact timings are known, but who is not a reference): mean error **0.2 s**, 74 % of
words within 0.3 s; short ayat are usually within 0.1 s, very long ones like Ayat al-Kursi drift by up to about half a second.

### Text size and fitting

Sizes are set the way the browser sets them (by the font's **em**), so the live preview is the reference. libass sizes a font differently — so that the font's full line height (OS/2 `winAscent + winDescent`) equals the size — which would draw Amiri Quran about **2.8×**, Poppins **1.8×** and Hind Siliguri **1.6×** smaller. The renderer reads those values from the font files and converts each size, so the video matches the preview.

Each verse then goes through a **fit check**:

1. Start at your chosen sizes (default size × your Text size %).
2. Estimate how many lines the Arabic, English and Bangla will wrap to, using character widths and line heights measured from libass renders of these fonts, plus the gaps and reference label.
3. If the block is taller than the space allowed (80% of the frame for videos, 72% for Shorts, leaving room for YouTube's on-screen buttons), shrink all three together until it fits.

So your sizes are used exactly whenever the verse fits; only very long verses (e.g. Ayat al-Kursi, 2:282) are reduced. The Studio runs the same calculation with the same numbers (sent by the server) and tells you when a verse was reduced.

### Backgrounds

```mermaid
flowchart TD
  M{"Background mode"} -->|Gradient| G["FFmpeg 'gradients' source<br/>your 2–4 colours + speed"]
  M -->|Choose clips| L["Your clips, in your order"]
  M -->|Auto| A["Pick clips from backgrounds/<br/>source · order · max"]
  A -->|none found| G
  L --> R["Build reel: each clip trimmed to<br/>'seconds per clip', images slowly zoomed,<br/>cross-fades of up to 1.2 s"]
  A --> R
  R --> C[("cache/reels<br/>reused next time")]
  R --> V["Looped behind the video,<br/>scaled/cropped, dimmed, vignette"]
  G --> V
```

- **Auto** reads `backgrounds/landscape/` for videos or `backgrounds/portrait/` for Shorts (or every clip, if *Use clips* is "all"). With *Order: different start per surah* the reel starts at a different clip for each surah, so videos don't all look the same.
- Clips of the other shape are **centre-cropped**; the picker shows a dashed crop guide for this.
- The reel is cached under `cache/reels/` keyed by the clips and settings, and written atomically, so a cancelled render can't leave a broken reel.
- **Dim** darkens clips (0–90%) so captions stay readable.
- Stock footage credits are saved in `backgrounds/credits.json` and added to the description of any video that uses those clips.

### Batch Shorts

**Short per verse** (`--batch`) renders one 9:16 Short for every verse in the range into `output/Shorts/<NNN - Name>/`, each with its own title (`… #Shorts`) and description. With **Merge short verses** (`--group-seconds N`), consecutive verses are joined until each Short lasts at least N seconds. Shorts use the shorter intro/outro lengths from Branding.

### Preview frame

**Rendered frame** runs the real renderer for the first verse of your selection with `--still`, without intro/outro. To be fast, the video timestamps are shifted so the very first frame is already partway through the verse (a word is highlighted), so only one frame is drawn.

### Jobs and progress

The server runs one render (or background download) at a time:

1. `POST /api/render` validates the options and starts `make-video.js` with matching flags.
2. The server reads its output: steps (`• Rendering 2/4 …`), the video duration and FFmpeg's `time=` progress are turned into a percentage; finished files (`✓ …`) become links.
3. The page polls `GET /api/job` every 0.8 s. **Cancel** stops the whole process tree, including FFmpeg.

### Titles and descriptions

For every video:

- **`.title.txt`** — the surah name in **English and Bangla**, so the video is found by searches in either language:
  - video: `Surah Al-Ikhlas | সূরা আল-ইখলাস | Mishary Rashid Alafasy | Arabic, English & Bangla Translation`
  - Short: `Surah Al-Baqarah 2:255 | সূরা আল-বাকারা | The Cow ✨ #Shorts`

  YouTube allows 100 characters, so when a reciter name or verse range makes the title too long, the ending is shortened step by step (e.g. to `… | বাংলা অনুবাদ`). The Bangla name also appears in the description, as a hashtag (`#সূরা_আল_ইখলাস`) and on the intro card.
- **`.description.txt`** — an introduction, then 📖 surah · 📍 juz and verses · 🕋 place of revelation · 🎙️ reciter · 🌐 translators, your subscribe line and handle, background credits and hashtags.

The introduction comes from **`intros.json`** — keyed by surah (`"112"`) or by an exact verse/range (`"2:255"`, `"2:285-286"`). Surahs without an entry use the short summary from Quran.com (Tafhim al-Qur'an).

### YouTube uploads

`youtube.js` talks to the YouTube Data API v3 with Node's built-in `fetch` (no packages); `upload-queue.js` runs the queue.

- **Sign-in** — OAuth 2.0 for desktop apps: the Studio opens Google's consent page with a PKCE challenge, and Google sends the browser back to `http://127.0.0.1:4173/` with a one-time code. The server exchanges it for a **refresh token**, stored with the client ID/secret in `%USERPROFILE%\.quran-channel\youtube.json` — outside the project, never committed and never sent to the browser. *Disconnect* revokes it at Google.
- **Metadata** — title and description come from the `.title.txt` / `.description.txt` files (YouTube doesn't allow `<` or `>`, so they're swapped for ‹ ›). Tags combine your defaults with the surah's English and Bangla names and the reciter. Audio language is Arabic; *made for kids* is off unless you change it. Videos whose description names an **AI-generated voice** are flagged as altered/synthetic content, as YouTube requires.
- **Resumable upload** — the file goes up in 8 MB chunks. After a network error or server error the uploader asks YouTube how much arrived and continues from there (with back-off); an expired access token is refreshed automatically. The session URL is saved, so if the Studio is closed mid-upload the next start resumes it.
- **Queue** — one upload at a time, saved in `output/upload-queue.json`. Finished uploads are recorded in `output/uploads.json` (video ID, URL, visibility, playlist), which the Library uses for its *On YouTube* links and to warn before uploading the same file twice.
- **Quota** — the API allows 10,000 units a day; an upload costs about 1,600 and a playlist step 50, so **about 6 uploads a day**. The Uploads page tracks today's use (reset at midnight Pacific Time). If YouTube reports the quota or the channel's daily upload limit is used up, the queue pauses with that message; press **Resume** the next day. More quota can be requested from Google after the audit.
- **Safety** — the YouTube endpoints only accept same-origin JSON requests from the Studio page on `localhost`/`127.0.0.1`, so another website can't trigger an upload through it.

---

## Configuration

### `channel.json`

Everything the Studio's **Save as default** buttons and the Branding page write. All keys are optional.

```json
{
  "name": "Al-Bayaan Quran",
  "handle": "@Al-BayaanQuran",
  "logo": "assets/logo.jpg",
  "subscribeLine": "Subscribe for daily peaceful Quranic verses with verified English and Bengali translations.",
  "intro": { "long": 5, "short": 1.5 },
  "outro": { "long": 6, "short": 2.5 },
  "colors": {
    "arabic": "#FFD780", "highlight": "#FFFFFF", "glow": "#FFB400",
    "english": "#FFFFFF", "bangla": "#C8F0B4", "reference": "#A0A0A0"
  },
  "fontScale": { "arabic": 1, "english": 1, "bangla": 1 },
  "background": {
    "source": "match", "order": "rotate", "max": 12,
    "clipSeconds": 12, "dim": 0.55,
    "gradient": ["#0A1A24", "#14352B", "#1D1530"], "gradientSpeed": 2
  }
}
```

| Key | Meaning |
|---|---|
| `name`, `handle` | Shown in the intro/outro, watermark and description. |
| `logo` | Image path (relative to the project). Used as watermark and in the intro. Without it, the handle is a text watermark. |
| `subscribeLine` | Line in every description. |
| `intro`, `outro` | Seconds for videos (`long`) and Shorts (`short`); `0` turns them off. |
| `colors` | Caption colours (`#RRGGBB`). |
| `fontScale` | Text size multipliers, 0.5–2 (1 = 100%). |
| `background` | Default background settings (see [Backgrounds](#backgrounds)). |
| `translationAudio` | `{ "enabled", "voice", "rate", "pauseAfterAyah", "pauseAfterTranslation" }` — defaults for [Bangla translation audio](#bangla-translation-audio). Keys are never stored here. |

Precedence for every setting: **built-in default < `channel.json` < command-line flag** (the Studio sends flags for what you set on the page).

### `intros.json`

Opening paragraphs for descriptions:

```json
{
  "112": "Surah Al-Ikhlas (Chapter 112 of the Holy Quran) explains …",
  "2:255": "Ayat al-Kursi (Surah Al-Baqarah, verse 255) …"
}
```

---

## Command line

```bash
node make-video.js --surah 36                                     # Surah Ya-Sin, full, 16:9
node make-video.js --surah 2 --from 255 --to 255 --format short   # Ayat al-Kursi as a Short
node make-video.js --surah 67 --batch                             # one Short per verse of Al-Mulk
node make-video.js --surah 2 --from 1 --to 20 --batch --group-seconds 20
node make-video.js --surah 18 --reciter sudais --bg my-folder
node make-video.js --surah 1 --from 5 --still preview.png         # one frame, to check the look
```

| Option | Values | Default |
|---|---|---|
| `--surah` | 1–114 | required |
| `--from`, `--to` | verse range | whole surah |
| `--reciter` | alafasy, abdulbasit, abdulbasit-mujawwad, sudais, shatri, rifai, husary, minshawy, minshawy-mujawwad, shuraym, dossary, tunaiji, maher\* | alafasy |
| `--en` | saheeh, haleem, usmani, yusufali | saheeh |
| `--bn` | taisirul, mujibur, rawai, zakaria | taisirul |
| `--format` | `long` (1920×1080) or `short` (1080×1920) | long |
| `--batch` | one Short per verse → `output/Shorts/<NNN - Name>/` | |
| `--group-seconds` | with `--batch`: merge verses until each Short is ≥ n s | 0 |
| `--bg` | image, video or folder; repeat to cross-fade several files in order; or `gradient` | `backgrounds/` or gradient |
| `--bg-source` / `--bg-order` / `--bg-max` | Auto: `match`/`all` · `rotate`/`shuffle`/`name` · 1–40 | match · rotate · 12 |
| `--clip-seconds` / `--bg-dim` | seconds per clip (4–30) · darkening 0–0.9 | 12 · 0.55 |
| `--gradient` / `--gradient-speed` | 2–4 colours `"#0A1A24,#14352B,#1D1530"` · 0 (still)–10 | Night emerald · 2 |
| `--color-<name>` | `arabic`, `highlight`, `glow`, `english`, `bangla`, `reference` = `#RRGGBB` | see `channel.json` |
| `--size-<name>` | `arabic`, `english`, `bangla` = 0.5–2 | 1 |
| `--bn-audio` / `--no-bn-audio` | read the Bangla translation after each ayah | off |
| `--bn-voice` | `azure:bn-BD-NabanitaNeural`, `azure:bn-BD-PradeepNeural`, `google:bn-IN-Wavenet-A`, `google:bn-IN-Wavenet-B`, `files` | Nabanita |
| `--bn-rate` / `--bn-pause-ayah` / `--bn-pause-translation` | speed −40…40 % · seconds before · seconds after the translation (0–3) | 0 · 0.6 · 0.9 |
| `--still <file.png>` | render one preview frame of the first verse instead of a video | |
| `--out <file>` | output path (single video only) | `output/…` |
| `--no-highlight` `--no-intro` `--no-outro` `--no-watermark` `--no-bismillah` | turn features off | |

\* Maher al-Muaiqly: word timings by [audio alignment](#word-timings-by-audio-alignment).

**Lesser-known reciters** (word highlighting by [audio alignment](#word-timings-by-audio-alignment); audio from EveryAyah, Hafs, 128–192 kbps):
`neana` (Ahmed Neana), `alalaqimy` (Akram Al-Alaqimy), `suesy` (Ali Hajjaj Al-Suesy), `alili` (Aziz Alili),
`salamah` (Yaser Salamah), `sahl-yassin` (Sahl Yassin), `abdulkareem` (Muhammad Abdul Kareem), `matroud` (Abdullah Matroud),
`qahtani` (Khalid Abdullah Al-Qahtani), `tablawi` (Mohammad Al-Tablawi).

Muhammad Abdul Kareem's verse-1 recordings already begin with the Bismillah, so the renderer splits it off (at the quietest
moment where his own Bismillah ends) and uses it as the Bismillah — it is never recited twice.

They are lower profile than the famous imams and worth trying if your videos get copyright claims — but **no recording is
guaranteed claim-free**. Upload a short test (e.g. Al-Ikhlas) as *Private* and look at YouTube Studio's **Checks** step before
publishing, and get the reciter's or publisher's permission before monetising.

**Background downloads**

```powershell
$env:PIXABAY_API_KEY = "your_key"        # free: https://pixabay.com/api/docs/
node fetch-backgrounds.js                # mosques, Islamic architecture, desert, sky, ocean…
node fetch-backgrounds.js --query "masjid nabawi" --count 5 --orientation portrait
node fetch-backgrounds.js --provider pexels   # with $env:PEXELS_API_KEY
```

Review downloaded clips and delete any you don't want (e.g. ones showing people).

---

## Project layout

```
quran-channel/
├── make-video.js          Renderer (CLI + used by the server)
├── server.js              Studio web server
├── fetch-backgrounds.js   Stock footage downloader (Pixabay / Pexels)
├── youtube.js             YouTube sign-in, resumable upload, playlists
├── upload-queue.js        Upload queue and upload log
├── ui/                    Studio front end (index.html, styles.css, app.js)
├── channel.json           Branding and default style
├── intros.json            Description introductions
├── surah-names-bn.json    Bangla surah names (114, in order) for titles, descriptions and the intro card
├── organize-output.js     Moves older renders into output/Videos and output/Shorts
├── translation-audio/     Your own Bangla narration recordings (optional)                       [git-ignored]
├── assets/                Uploaded logo
├── backgrounds/           Your clips: landscape/ (videos), portrait/ (Shorts), credits.json   [git-ignored]
├── output/                Videos/<NNN - Name>/ and Shorts/<NNN - Name>/ with .title/.description,
│                          uploads.json + upload-queue.json                                       [git-ignored]
├── fonts/                 Downloaded fonts                                                      [git-ignored]
└── cache/                 API responses, audio, reels, thumbnails, previews, work files        [git-ignored]
```

---

## Studio server API

All endpoints are local only (`127.0.0.1`).

| Method & path | Purpose |
|---|---|
| `GET /api/meta` | Reciters, translations, surah list, defaults, saved channel settings, layout numbers for the preview |
| `GET /api/verse?surah=&verse=&en=&bn=` | One verse's words and translations (for the live preview) |
| `POST /api/render` | Start a render job (options as JSON) |
| `POST /api/preview` | Render one exact frame; returns its URL |
| `GET /api/job` · `POST /api/job/cancel` | Current job status/log · cancel it |
| `GET /api/library` · `DELETE /api/library?id=` | Rendered videos with titles/descriptions · delete one |
| `PUT /api/channel` | Save branding, colours, text sizes or background defaults |
| `POST /api/logo` · `DELETE /api/logo` | Upload / remove the logo |
| `GET /api/backgrounds` · `DELETE /api/backgrounds?id=` | Clips with size, length, credit · remove one |
| `GET /api/backgrounds/thumb?id=` | Cached JPEG thumbnail |
| `POST /api/backgrounds/upload?orientation=&name=` | Upload a clip |
| `POST /api/backgrounds/fetch` | Download stock footage (job) |
| `GET /api/youtube` · `PUT /api/youtube/settings` | Connection status, upload defaults, quota · save defaults |
| `POST /api/youtube/client` · `DELETE /api/youtube/client` | Save / remove the OAuth client |
| `POST /api/youtube/connect` · `POST /api/youtube/disconnect` | Start Google sign-in (returns the URL) · sign out and revoke |
| `POST /api/uploads/prepare` | Suggested title, description, tags and playlist for library videos |
| `GET /api/uploads` · `POST /api/uploads` | Queue and quota · add videos to the queue |
| `POST /api/uploads/<id>/cancel\|retry\|remove` · `/resume` · `/clear` | Manage queue items |
| `GET /media/<output\|previews\|assets\|backgrounds>/…` | Files, with range requests for video seeking |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **"Port 4173 is already in use"** | The Studio is already running — open http://localhost:4173, or stop the other one. Another port: `$env:PORT=4174; npm start`. |
| **Changes don't show after updating** | Restart the Studio (Ctrl+C, then `npm start`) and reload the page. |
| **"FFmpeg missing"** in the sidebar | `winget install Gyan.FFmpeg`, then restart the Studio. |
| **Pexels: "New API key issuance is paused"** | Use Pixabay instead, or download clips by hand and use **Upload your own**. |
| **Text on a long verse doesn't get bigger** | It already fills the screen; the note under Text size shows how much it was reduced to fit. |
| **No word highlighting** | The feature is switched off (`--no-highlight`). |
| **Highlight a little early/late** | Reciters without published timings use [audio alignment](#word-timings-by-audio-alignment); long ayat can be off by up to ~0.5 s. Delete `cache/timings/` to recompute. |
| **"Azure speech error 401"** | Wrong key or region. The region is the one shown on your Speech resource (e.g. `southeastasia`). |
| **Uploaded video is Private although I chose Public** | Your Google Cloud project hasn't passed the YouTube API audit; publish it in YouTube Studio, and apply for the audit (Settings has the link). |
| **"Your YouTube sign-in expired"** every week | The OAuth consent screen is still in *Testing*. Click **Publish app** there, then connect again. |
| **"redirect_uri_mismatch"** when connecting | The OAuth client must be of type **Desktop app** (not *Web application*). |
| **"The daily YouTube API quota is used up"** | About 6 uploads fit in a day. The queue pauses; press **Resume** after midnight Pacific Time. |
| **"Missing recording: translation-audio/bn/…"** | With *My recordings*, every ayah in the range (and `001/001001.mp3` for the Bismillah) needs a file. |

---

## Sources and credits

- Quran text, translations, recitation audio and word timings: [Quran.com API](https://api.quran.com)
- Fallback verse audio: [EveryAyah.com](https://everyayah.com)
- Fonts: [Amiri Quran](https://fonts.google.com/specimen/Amiri+Quran), [Hind Siliguri](https://fonts.google.com/specimen/Hind+Siliguri), [Poppins](https://fonts.google.com/specimen/Poppins) (SIL Open Font License)
- Background footage: [Pixabay](https://pixabay.com) / [Pexels](https://www.pexels.com) — free to use; credits are added to descriptions automatically

Check each reciter's and publisher's terms before monetising videos.
