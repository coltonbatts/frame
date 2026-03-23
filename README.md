# Frame

**Frame** is an offline-first video intelligence workstation built with React, TypeScript, Vite, and Tauri v2.

The philosophy: your footage never leaves your machine. AI transcription, scene detection, color analysis — all computed locally.

## Run

```bash
# Install dependencies
npm install

# Start dev server (frontend only, no Tauri)
npm run dev

# Start full desktop app (Tauri + frontend)
npm run tauri dev
```

## Prerequisites

### FFmpeg (required for real video processing)
```bash
brew install ffmpeg
```

### Whisper.cpp (for local transcription — optional)
```bash
brew install whisper-cpp
```
Models download automatically on first use. The `base` model (~140MB) is recommended for most Macs.

## Verification

```bash
npm run lint    # Type check + lint
npm run build   # Production build
cd src-tauri && cargo check  # Rust type check
```

## Architecture

```
src/                          # React frontend
├── components/               # UI components
├── lib/media.ts              # File import, blob URL creation
├── stores/appStore.ts        # Zustand state
└── types/models.ts           # Shared TypeScript types

src-tauri/                    # Rust backend
├── src/commands/
│   ├── files.rs             # ffprobe metadata, frame extraction
│   ├── whisper.rs           # whisper.cpp transcription
│   ├── ffmpeg.rs            # FFmpeg operations
│   ├── scenes.rs            # Scene detection
│   └── queue.rs             # Export queue
└── src/models.rs            # Shared Rust types
```

## Features

- [x] Native file dialog + drag-drop import
- [x] Real ffprobe metadata extraction (codec, fps, resolution, duration)
- [x] Video playback with transport controls
- [x] Project bin with raw/export organization
- [x] Mock analysis panels (scenes, palette, waveform, transcript)
- [ ] Real FFmpeg export/transcode
- [ ] Real scene detection + thumbnails
- [ ] Real whisper.cpp transcription
- [ ] Local vision model (Moondream) for AI scene analysis
- [ ] Persistent project storage (SQLite)

## AI Pipeline

Frame uses a tiered local AI approach:

| Tier | Tool | Purpose |
|------|------|---------|
| 1 | FFmpeg/ffprobe | Metadata, scene detection, transcoding |
| 1 | whisper.cpp | Local transcription |
| 2 | Moondream 1.6B | Frame description, AI tagging |
