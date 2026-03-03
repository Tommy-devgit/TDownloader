# TDownloader

Electron desktop app for downloading YouTube videos/audio with queue support and progress bars.

## Requirements

- Node.js 20+
- `ffmpeg` available on your PATH (required for MP3 conversion)

## Architecture

- Main Process: `electron/main.cjs` (window lifecycle, tray, IPC, downloader logic)
- Preload Bridge: `electron/preload.cjs`
- Renderer UI: `src/App.tsx` + `src/App.css`
- Backend Downloader: `ytdl-core` in main process with automatic `yt-dlp` fallback

## Run Dev

```bash
npm install
npm run dev
```

## Package Installer (Windows)

```bash
npm run dist:win
```

Builder config is in `electron-builder.json`.

## App Icon Setup

- Place your PNG icon at `assets/icon.png`
- For best Windows installer/taskbar compatibility, also add `assets/icon.ico`

## Notes

- If output folder is empty, files are downloaded into your system Downloads directory.
- MP4 uses progressive streams; MP3 uses ffmpeg conversion.
