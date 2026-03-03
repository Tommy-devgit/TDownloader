# TDownloader

Electron desktop app for downloading YouTube videos/audio using `yt-dlp`.

## Requirements

- Node.js 20+
- `yt-dlp` available on your PATH
- `ffmpeg` available on your PATH (required for MP3 extraction and merging)

## Run

```bash
npm install
npm run dev
```

## Build web assets

```bash
npm run build
```

## Notes

- If output folder is empty, downloads go to your system Downloads directory.
- This project does not package an installer yet; it runs locally with Electron.
