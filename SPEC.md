# Frame — Specification

## 1. Concept & Vision

**Frame** is a professional-grade, offline-first video processing tool that runs entirely on your machine. No subscriptions. No cloud uploads. No bloat. It feels like the love child of a terminal power user and a clean macOS native app — dark, fast, keyboard-first, unapologetically pro.

The philosophy: **your footage never leaves your machine** unless you explicitly export it. AI transcription, color analysis, scene detection, and visual understanding — all computed locally via small, specialized models embedded in the app itself. Frame is for filmmakers, editors, YouTubers, and podcasters who want Premiere-level control without the subscription tax and cloud dependency.

The vibe is confident and minimal. This isn't a consumer app trying to be friendly. It's a precision instrument.

---

## 2. Design Language

### Color Palette
| Role        | Hex       | Usage                          |
|-------------|-----------|--------------------------------|
| Background  | `#0D0D0F` | App shell, deep black          |
| Surface     | `#18181B` | Cards, panels, sidebars        |
| Surface+    | `#27272A` | Elevated cards, hover states  |
| Border      | `#3F3F46` | Subtle dividers                |
| Text Primary| `#FAFAFA` | Headings, important labels     |
| Text Muted  | `#A1A1AA` | Secondary labels, descriptions  |
| Accent      | `#6366F1` | Primary actions, progress bars |
| Accent Glow | `#818CF8` | Hover states, active elements  |
| Success     | `#22C55E` | Completed tasks, valid states  |
| Warning     | `#F59E0B` | Warnings, pending states       |
| Danger      | `#EF4444` | Errors, destructive actions    |

### Typography
- **Primary Font:** `Inter` (clean, professional, excellent at small sizes)
- **Mono Font:** `JetBrains Mono` (timestamps, technical data, code)
- **Scale:** 11px (small labels), 13px (body), 15px (headings), 20px (section titles), 28px (app title)
- **Weight:** 400 (body), 500 (labels), 600 (headings), 700 (emphasis)

### Spatial System
- Base unit: 4px
- Component padding: 12px / 16px / 20px
- Section gaps: 24px
- Panel gutters: 1px (border as separator)
- Border radius: 6px (cards), 4px (buttons), 2px (inputs)

### Motion Philosophy
- **Micro-interactions:** 150ms ease-out for hovers, color shifts
- **Panel transitions:** 200ms ease-in-out for show/hide
- **Progress animations:** Linear for determinate, ease-in-out pulse for indeterminate
- **No decorative animation** — motion is functional only

### Visual Assets
- Icons: **Lucide** (consistent stroke weight, minimal style)
- No images in UI chrome
- Video thumbnails: generated from actual frame extracts

---

## 3. Layout & Structure

### Three-Column Layout
```
┌─────────────────────────────────────────────────────────────────┐
│  [●] Frame                                        [─] [□] [✕]   │  <- Title bar
├────────────┬────────────────────────────────┬───────────────────┤
│            │                                │                   │
│  PROJECT   │      VIDEO PREVIEW             │  ANALYSIS         │
│  BIN       │                                │  PANEL            │
│            │   [ ▶ ]  00:01:24 / 00:12:05   │                   │
│  📁 Raw    │                                │  🎞 Scenes: 12    │
│   file1.mov│   ═════════●═══════════        │  🎨 Palette       │
│   file2.mp4│                                │  🔊 Audio Wave    │
│            │                                │  📝 Transcript    │
│  📁 Export │                                │  🤖 AI Insights   │
│            │                                │                   │
├────────────┴────────────────────────────────┴───────────────────┤
│  QUEUE: file1.mov → H.265 4K    [▶ Running 34%]  [⏸] [✕]      │
└─────────────────────────────────────────────────────────────────┘
```

### Panel Specifications
| Panel     | Default Width | Min Width | Resizable | Collapsible |
|-----------|---------------|-----------|-----------|-------------|
| Project Bin | 240px       | 180px     | Yes       | Yes         |
| Video Preview | flex       | 480px     | No        | No          |
| Analysis   | 320px         | 280px     | Yes       | Yes         |

### Responsive Strategy
- Minimum window: 1024x600
- Analysis panel collapses to icon bar below 1280px width
- Project bin collapses to icon bar below 900px width

---

## 4. Architecture

### Tech Stack
- **Frontend:** React 18 + TypeScript + Vite
- **State:** Zustand (lightweight, no boilerplate)
- **Desktop Shell:** Tauri v2 (Rust backend)
- **Icons:** Lucide React
- **Styling:** Tailwind CSS + CSS custom properties

### Rust Backend (src-tauri/)

#### Command Modules
```
src-tauri/src/
├── lib.rs              # Tauri builder, route registration
├── main.rs             # Entry point
├── models.rs           # Shared data types (FileMetadata, Transcript, Scene, etc.)
└── commands/
    ├── mod.rs
    ├── files.rs        # File I/O, ffprobe metadata extraction, frame extraction
    ├── ffmpeg.rs       # FFmpeg operations (transcode, cut, export)
    ├── scenes.rs        # Scene detection via FFmpeg
    ├── whisper.rs       # Local transcription via whisper.cpp
    ├── vision.rs        # Frame analysis via local vision model (LLaVA/Moondream)
    └── queue.rs         # Job queue management
```

#### Data Flow
```
User drops video file
       ↓
[React] file drop handler
       ↓
[Tauri] open_file_dialog / get_file_metadata (ffprobe)
       ↓
[React] file appears in Project Bin with real metadata
       ↓
User clicks "Analyze"
       ↓
[FFmpeg] extract frames → [whisper.cpp] transcription
                                 → [Vision Model] scene descriptions
       ↓
[React] Analysis panel populates with real data
```

### AI Pipeline (Local)

#### Tier 1 — Built-in, always available
| Model | Purpose | Size | Tool |
|-------|---------|------|------|
| **whisper.cpp** (tiny/base) | Transcription | ~75-140MB | `whisper-cli` |
| **FFmpeg** | Scene detection, metadata, transcoding | N/A | `ffprobe`, `ffmpeg` |

#### Tier 2 — Embedded vision (when model fits)
| Model | Purpose | Size | Status |
|-------|---------|------|--------|
| **Moondream 1.6B** | Frame description, tagging | ~1GB | Planned |
| **LLaVA 7B** | Complex scene understanding | ~4GB | Planned |

#### Tier 3 — Optional cloud fallback
- OpenRouter API for complex queries
- User-configurable, not required

---

## 5. Features

### Phase 1 (MVP)
- [x] Custom title bar (native window controls)
- [x] Three-column layout (Project Bin, Preview, Analysis)
- [x] Video file import via native file dialog
- [x] Real metadata extraction (ffprobe) — width, height, codec, fps, duration
- [x] Video playback with transport controls (play/pause, scrub, step frame, volume)
- [x] Project Bin — add/remove files, folder organization (raw/export)
- [x] Mock analysis panels (scenes, palette, waveform, transcript) for UI development
- [x] Export queue with progress simulation
- [x] Settings modal (scene sensitivity, transcript format)

### Phase 2 (Real Pipeline)
- [ ] Real FFmpeg integration — actual transcoding, cutting, export
- [ ] Real scene detection — FFmpeg scene detection + thumbnail generation
- [ ] Real transcription — whisper.cpp integration
- [ ] Real frame extraction for thumbnails
- [ ] Persistent project storage (SQLite)

### Phase 3 (Local AI)
- [ ] whisper.cpp model download + configuration UI
- [ ] Moondream/LLaVA integration for frame description
- [ ] AI-powered tagging and search
- [ ] Export transcript in SRT/VTT/TXT formats

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Space` | Play/Pause |
| `←` / `→` | Step frame |
| `J` / `K` / `L` | Shuttle control |
| `I` | Open file dialog |
| `Cmd+,` | Settings |
| `Cmd+Shift+E` | Export selected |
| `Cmd+Delete` | Remove selected file |

---

## 6. Persistence

### Project Format
Projects stored as JSON + sidecar data:
```
MyProject/
├── project.frame         # JSON manifest (files, settings, tags)
├── thumbnails/           # Cached frame thumbnails
├── analysis/             # Cached analysis results (per file)
└── exports/              # Output files
```

### Database (SQLite via rusqlite)
Tables:
- `projects` — name, path, created_at, updated_at
- `files` — project_id, path, metadata, state, tags
- `analysis_cache` — file_id, analysis_type, result_json, computed_at

---

## 7. Local AI Configuration

### Model Storage
```
~/.frame/
├── models/
│   ├── whisper/         # whisper.cpp models (tiny.bin, base.bin, etc.)
│   └── vision/          # Moondream/LLaVA GGUF files
├── config.json          # AI provider settings
└── projects/            # Project data
```

### Whisper Model Options
| Model  | Params | Size   | Speed  | Quality  |
|--------|--------|--------|--------|----------|
| tiny   | 39M    | ~75MB  | fastest| baseline |
| base   | 74M    | ~140MB | fast  | good     |
| small  | 244M   | ~500MB | medium | very good |
| medium | 769M   | ~1.5GB | slow  | excellent|

### Vision Model Options
| Model   | Params | Size  | Use Case |
|---------|--------|-------|----------|
| Moondream | 1.6B  | ~1GB  | Fast frame description, tagging |
| LLaVA   | 7B     | ~4GB  | Complex visual reasoning |

---

## 8. Comparison to Existing Tools

| Feature              | Premiere | Resolve  | HandBrake | Frame           |
|----------------------|----------|----------|-----------|-----------------|
| Cost                 | $23/mo   | Free/$30 | Free      | Free (local)    |
| Offline              | Partial  | Yes      | Yes       | Yes             |
| Video file docker    | No       | No       | No        | **Yes**         |
| Local transcription   | No       | No       | No        | **Yes**         |
| Local vision AI      | No       | No       | No        | **Yes**         |
| Keyboard-first       | Partial  | Partial  | No        | **Yes**         |
| Minimal bloat        | No       | No       | Yes       | **Yes**         |

---

## 9. Next Logical Steps

1. Replace Rust command stubs with real FFmpeg, ffprobe, and whisper.cpp integrations
2. Persist projects, tags, and presets in SQLite
3. Replace queue simulation with command-driven processing and progress events
4. Add actual frame thumbnails, transcript export files, and Finder reveal actions
5. Integrate whisper.cpp for real local transcription
6. Add vision model (Moondream) for frame analysis
7. Build model download + configuration UI
