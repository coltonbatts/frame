# Frame — Local Video Intelligence Platform

## 1. Concept & Vision

**Frame** is a professional-grade, offline-first video processing tool that runs entirely on your machine. No subscriptions. No cloud uploads. No bloat. It feels like the love child of a terminal power user and a clean macOS native app — dark, fast, keyboard-first, unapologetically pro.

The philosophy: **your footage never leaves your machine** unless you explicitly export it. AI transcription, color analysis, scene detection — all computed locally. Frame is for filmmakers, editors, YouTubers, and podcasters who want Premiere-level control without the subscription tax and cloud dependency.

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
│  📁 Export │                                │                   │
│            │                                │  [Process]        │
│            │                                │                   │
├────────────┴────────────────────────────────┴───────────────────┤
│  QUEUE: file1.mov → H.265 4K    [▶ Running 34%]  [⏸] [✕]      │
└─────────────────────────────────────────────────────────────────┘
```

### Panel Specifications
| Panel     | Default Width | Min Width | Resizable | Collapsible |
|-----------|---------------|-----------|-----------|-------------|
| Project Bin | 220px      | 180px     | Yes       | Yes (icon)  |
| Video Preview | flex     | 400px     | No        | No          |
| Analysis Panel | 280px  | 220px     | Yes       | Yes (icon)  |
| Queue Bar   | full height | n/a    | No        | No (slide)  |

### Responsive Strategy
- Minimum window: 1024x600
- Below 1280px: Analysis panel collapses to icon bar (click to overlay)
- Below 1024px: Project bin collapses, accessible via hotkey

---

## 4. Features & Interactions

### 4.1 Project Bin
**Purpose:** Manage source files and exports for current session.

**Behaviors:**
- Drag files/folders from Finder into bin → copies/references into project
- Right-click file → context menu: Preview, Analyze, Add to Queue, Remove, Show in Finder
- Double-click → opens in Video Preview
- Folder groups: Raw (source files), Export (output files)
- File states: `idle`, `analyzing`, `queued`, `processing`, `done`, `error`
- Drag to reorder
- Multi-select with Shift+Click or Cmd+Click
- Badge counts on folders: `[12]` files total

**Keyboard shortcuts:**
- `Cmd+O` — Open file picker
- `Cmd+Delete` — Remove selected from bin
- `Cmd+A` — Select all in current folder

### 4.2 Video Preview
**Purpose:** Playback and scrubbing with frame-accurate precision.

**Behaviors:**
- Loads currently selected file from bin
- Transport controls: Play/Pause (Space), Step frame back (←), Step frame forward (→), Jump 5s (Shift+←/→)
- Scrubber: click to seek, drag for fast scrub, shows frame thumbnails on hover
- Time display: `HH:MM:SS:FF` format (SMPTE timecode)
- Volume control with mute toggle
- Fullscreen: `F` key or double-click preview area
- Picture-in-Picture: `P` key
- Overlay toggle: show/hide timecode, filename, resolution badge

**States:**
- `empty` — "Drop a file to preview" placeholder
- `loading` — spinner, file name shown
- `ready` — frame displayed, transport enabled
- `playing` — animated playhead
- `error` — error icon + message + retry button

### 4.3 Analysis Panel
**Purpose:** Display AI-generated insights for the current clip.

**Sections (each collapsible):**

#### 🎞 Scene Detection
- Lists detected shots with thumbnail + in/out timestamps
- Click thumbnail → seek preview to that moment
- Confidence score per scene (percentage bar)
- Adjustable sensitivity slider (fewer/more cuts detected)

#### 🎨 Color Analysis
- Dominant color palette (8 colors extracted from clip)
- Color wheel visualization
- Mood tags: "warm", "cool", "high contrast", "desaturated", etc.
- Per-scene palette breakdown (mini timeline below palette)

#### 🔊 Audio Analysis (Whisper)
- Waveform visualization over timeline
- Transcript with timestamps (click to seek)
- Speaker labels if multiple detected
- Export transcript as `.txt`, `.srt`, `.vtt`
- Language detected badge

#### 📝 Custom Tags
- Auto-generated tags (editable): `outdoor`, `dialogue`, `slow-motion`, etc.
- User can add/remove tags
- Tags persist in project database

**Processing states:**
- `idle` — "Select a file and click Analyze"
- `queued` — "Waiting in queue..."
- `processing` — Progress bar with stage description
- `done` — Full results displayed
- `error` — Error message with retry

### 4.4 Queue System
**Purpose:** Batch processing pipeline for exports.

**Behaviors:**
- Files added via "Add to Queue" or drag-drop onto queue bar
- Queue items show: filename, target preset, progress bar, ETA
- Multiple items process sequentially (one at a time initially)
- Controls per item: Pause/Resume, Cancel
- Controls global: Pause All, Clear Completed
- Notifications on completion (system notification + in-app toast)

**Queue item states:**
- `pending` — Waiting, grayed out
- `queued` — In line, ready
- `processing` — Active, progress bar animated
- `paused` — User paused
- `done` — Green checkmark, click to reveal in Finder
- `error` — Red X, click for error details

### 4.5 Settings Modal
**Accessible via gear icon or `Cmd+,`**

Sections:
- **General:** Default export folder, startup behavior, hardware acceleration toggle
- **Transcription:** Whisper model size (tiny/base/small/medium/large), language preference, punctutation toggle
- **Scene Detection:** Algorithm sensitivity, min shot length, blackframe detection threshold
- **Export Presets:** List of saved presets, add/edit/delete
- **Keyboard Shortcuts:** Full shortcut reference, rebindable
- **About:** Version, licenses, GitHub link

---

## 5. Component Inventory

### Button
| Variant | Appearance                                    | Use Case              |
|---------|-----------------------------------------------|-----------------------|
| Primary | Accent bg, white text, 6px radius             | Main actions          |
| Secondary | Surface+ bg, muted text, border            | Secondary actions     |
| Ghost   | Transparent, muted text, hover shows surface+ | Tertiary, inline      |
| Danger  | Danger bg, white text                        | Destructive           |
| Icon    | 32x32, ghost, centered icon                   | Toolbar, panel header |

States: default, hover (lighten 10%), active (darken 5%), disabled (50% opacity, no pointer), loading (spinner replaces label)

### File Card (in Project Bin)
```
┌─────────────────────────────────┐
│ 🎬 file1.mov              [▶]  │
│ 1920×1080 • 12m 05s • H.264   │
│ [████████░░] 67%               │
└─────────────────────────────────┘
```
States: idle (normal), selected (accent border), analyzing (pulsing dot), processing (progress bar), done (green dot), error (red dot)

### Progress Bar
- Height: 4px
- Background: `#27272A`
- Fill: accent gradient
- Indeterminate: shimmer animation left-to-right
- Shows percentage text on hover

### Toast Notification
```
┌──────────────────────────────────┐
│ ✓ Export complete                │
│ file1.mov → 4K_H265.mp4     [✕] │
└──────────────────────────────────┘
```
- Appears bottom-right, stacks upward
- Auto-dismiss: 5s (success), 10s (error), manual dismiss available
- Types: success (green left border), error (red), info (accent), warning (yellow)

### Modal / Dialog
- Backdrop: `rgba(0,0,0,0.7)` with blur
- Card: Surface bg, 8px radius, 24px padding
- Max width: 480px (settings), 720px (preview/export dialogs)
- Header: title + close button
- Footer: action buttons right-aligned

### Context Menu
- Surface+ bg, 4px radius, 8px padding
- Items: 32px height, full-width hover highlight
- Dividers: 1px border line
- Keyboard shortcut hints right-aligned, muted

---

## 6. Technical Architecture

### Stack
- **Frontend:** React 18 + TypeScript + Vite
- **Backend/Shell:** Tauri v2 (Rust)
- **Styling:** Tailwind CSS (or CSS Modules if Tailwind feels too runtime)
- **State Management:** Zustand (lightweight, TypeScript-native)
- **Video Playback:** HTML5 video + custom controls, or MPV player embedded
- **Database:** SQLite via `tauri-plugin-sql` (project metadata, presets, tags)
- **FFmpeg:** Bundled binary, invoked via Rust `Command` API
- **AI Transcription:** Whisper.cpp (local, CPU/GPU)
- **AI Features:** Local model inference where possible; Gemini API as optional cloud enhancement

### File Structure
```
frame/
├── src/                      # React frontend
│   ├── components/
│   │   ├── layout/           # AppShell, TitleBar, StatusBar
│   │   ├── project-bin/      # FileCard, FolderGroup, ContextMenu
│   │   ├── video-preview/    # Player, TransportControls, Scrubber
│   │   ├── analysis/         # SceneList, ColorPalette, Transcript, Tags
│   │   ├── queue/           # QueueBar, QueueItem, ProgressBar
│   │   └── ui/              # Button, Modal, Toast, Tooltip, etc.
│   ├── hooks/                # usePlayer, useAnalysis, useQueue, useSettings
│   ├── stores/               # Zustand stores
│   ├── lib/
│   │   ├── ffmpeg.ts         # FFmpeg command builders
│   │   ├── whisper.ts        # Whisper interface
│   │   └── utils.ts          # formatters, helpers
│   ├── styles/
│   │   └── globals.css       # CSS variables, base styles
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── main.rs           # Entry point, window setup
│   │   ├── commands/         # Tauri command handlers
│   │   │   ├── files.rs      # File operations
│   │   │   ├── ffmpeg.rs     # FFmpeg wrapper
│   │   │   ├── whisper.rs    # Whisper runner
│   │   │   └── scenes.rs     # Scene detection
│   │   ├── db.rs             # SQLite operations
│   │   └── models.rs         # Rust structs matching frontend types
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js        # (or remove if using CSS Modules)
├── SPEC.md                   # This file
└── README.md
```

### Tauri Commands (Rust → Frontend)
```rust
// File operations
#[tauri::command] fn open_file_dialog() -> Result<Vec<String>, String>
#[tauri::command] fn get_file_metadata(path: String) -> Result<FileMetadata, String>
#[tauri::command] fn extract_frame(path: String, time: f64) -> Result<Frame, String>

// FFmpeg
#[tauri::command] fn run_ffmpeg(args: Vec<String>, on_progress: FfiCallback) -> Result<(), String>
#[tauri::command] fn probe_file(path: String) -> Result<MediaInfo, String>

// Scene detection
#[tauri::command] fn detect_scenes(path: String, sensitivity: f64) -> Result<Vec<Scene>, String>

// Whisper
#[tauri::command] fn transcribe(path: String, model: String) -> Result<Transcript, String>

// Queue management
#[tauri::command] fn add_to_queue(item: QueueItem) -> Result<String, String>
#[tauri::command] fn process_queue() -> Result<(), String>
#[tauri::command] fn cancel_item(id: String) -> Result<(), String>
```

### Data Models
```typescript
interface ProjectFile {
  id: string;
  path: string;
  name: string;
  size: number;
  duration: number;       // seconds
  width: number;
  height: number;
  codec: string;
  fps: number;
  state: 'idle' | 'analyzing' | 'queued' | 'processing' | 'done' | 'error';
  thumbnail?: string;     // base64 or blob URL
  analysis?: AnalysisResult;
  tags: string[];
}

interface AnalysisResult {
  scenes: Scene[];
  palette: Color[];
  mood: string[];
  transcript?: Transcript;
  processedAt: Date;
}

interface Scene {
  index: number;
  startTime: number;
  endTime: number;
  thumbnail?: string;
  confidence: number;
}

interface QueueItem {
  id: string;
  fileId: string;
  preset: ExportPreset;
  progress: number;       // 0-100
  state: 'pending' | 'queued' | 'processing' | 'paused' | 'done' | 'error';
  error?: string;
  outputPath?: string;
}

interface ExportPreset {
  id: string;
  name: string;
  container: 'mp4' | 'mov' | 'webm' | 'mkv';
  videoCodec: 'h264' | 'h265' | 'vp9' | 'prores';
  audioCodec: 'aac' | 'opus' | 'pcm';
  bitrate?: string;       // e.g. "8M"
  resolution?: string;    // e.g. "1920x1080"
  fps?: number;
  extraArgs?: string[];   // additional ffmpeg flags
}
```

### FFmpeg Integration
- Bundle `ffmpeg` and `ffprobe` binaries in `src-tauri/ffmpeg/`
- All ffmpeg invocations go through Rust commands (no direct frontend spawning)
- Progress reported back via `tauri-plugin-shell` events or custom FFI callback
- Common operations:
  - Probe: `ffprobe -v quiet -print_format json -show_format -show_streams <file>`
  - Scene detection: `ffmpeg -i <file> -vf scenenum,metadata=mode=print -f null -`
  - Extract frame: `ffmpeg -ss <time> -i <file> -frames:v 1 -f image2pipe -`
  - Transcode: `ffmpeg -i <input> -c:v <codec> -c:a <audio> <options> <output>`

### Whisper Integration
- Use `whisper.cpp` compiled for macOS (Apple Silicon optimized)
- Model files downloaded on first use or bundled in app
- Models: `tiny`, `base`, `small`, `medium`, `large` (size: 75MB, 140MB, 480MB, 1.5GB, 2.9GB)
- Run via Rust subprocess, stream results back as JSON lines

---

## 7. Implementation Phases

### Phase 1: Scaffold & Core UI
- [ ] Initialize Tauri v2 project with React + TypeScript + Vite
- [ ] Set up Tailwind CSS with design tokens
- [ ] Build three-column layout shell
- [ ] Implement Window controls (minimize, maximize, close) — custom titlebar
- [ ] Basic navigation and panel resizing

### Phase 2: File Management
- [ ] File picker dialog (native)
- [ ] Project bin with folder groups (Raw, Export)
- [ ] File cards with metadata display
- [ ] Context menu (right-click)
- [ ] Multi-select behavior

### Phase 3: Video Playback
- [ ] HTML5 video player in preview pane
- [ ] Custom transport controls
- [ ] Scrubber with seek
- [ ] Frame step forward/backward
- [ ] Volume control

### Phase 4: FFmpeg Integration
- [ ] Bundle ffmpeg binary
- [ ] Probe file metadata (resolution, codec, duration, fps)
- [ ] Thumbnail extraction
- [ ] Basic transcode operation
- [ ] Progress reporting

### Phase 5: Analysis Features
- [ ] Scene detection pipeline
- [ ] Color palette extraction
- [ ] Whisper transcription setup
- [ ] Analysis panel display

### Phase 6: Queue & Export
- [ ] Queue data structure and UI
- [ ] Batch processing loop
- [ ] Export presets management
- [ ] System notifications

### Phase 7: Polish
- [ ] Keyboard shortcuts
- [ ] Settings modal
- [ ] Persistence (SQLite for project state)
- [ ] App icon and bundling

---

## 8. Build & Run Instructions

```bash
# Install dependencies
npm install
cd src-tauri && cargo install --path . && cd ..

# Development
npm run tauri dev

# Production build
npm run tauri build

# Output: .app bundle in src-tauri/target/release/bundle/
```

---

## 9. Resources & References

- **Tauri v2 Docs:** https://v2.tauri.app/
- **FFmpeg Documentation:** https://ffmpeg.org/documentation.html
- **Whisper.cpp:** https://github.com/ggerganov/whisper.cpp
- **Tailwind CSS:** https://tailwindcss.com/docs
- **Lucide Icons:** https://lucide.dev/

---

*Frame — Process locally. Create globally.*
