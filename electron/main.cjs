const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
const os = require("os");

const isDev = !app.isPackaged;

function resolveExecutable(name) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter);
  const home = os.homedir();
  const ffmpegRoot = path.join(
    home,
    "AppData",
    "Local",
    "Microsoft",
    "WinGet",
    "Packages",
    "yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
  );
  let ffmpegBin = null;
  if (fs.existsSync(ffmpegRoot)) {
    const entries = fs.readdirSync(ffmpegRoot, { withFileTypes: true });
    const versionDir = entries.find((entry) => entry.isDirectory());
    if (versionDir) {
      ffmpegBin = path.join(ffmpegRoot, versionDir.name, "bin");
    }
  }

  const fallbackDirs = [
    path.join(home, "AppData", "Local", "Programs", "TDownloaderTools"),
    path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Packages", "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe"),
    ffmpegBin,
  ];

  const candidates = [...pathEntries, ...fallbackDirs].filter(Boolean);
  for (const dir of candidates) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) {
      return full;
    }
  }

  return name;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function parseProgressLine(line) {
  const match = line.match(/^download:([^|]+)\|([^|]+)\|(.+)$/);
  if (!match) {
    return null;
  }

  return {
    percent: match[1].trim(),
    speed: match[2].trim(),
    eta: match[3].trim(),
  };
}

function ensureYtDlp() {
  const ytDlpPath = resolveExecutable("yt-dlp.exe");
  const check = spawnSync(ytDlpPath, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (check.status !== 0) {
    throw new Error(
      "yt-dlp was not found on PATH. Install yt-dlp and ffmpeg first."
    );
  }
}

ipcMain.handle("dialog:chooseOutputFolder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("download:start", async (event, payload) => {
  const { url, outputDir, format } = payload || {};

  if (!url || typeof url !== "string") {
    throw new Error("A valid YouTube URL is required.");
  }

  ensureYtDlp();

  const finalOutputDir = outputDir || app.getPath("downloads");
  await fs.promises.mkdir(finalOutputDir, { recursive: true });
  const ytDlpPath = resolveExecutable("yt-dlp.exe");
  const ffmpegPath = resolveExecutable("ffmpeg.exe");

  const outputTemplate = path.join(finalOutputDir, "%(title)s.%(ext)s");

  const formatArgs =
    format === "mp3"
      ? ["-x", "--audio-format", "mp3", "--audio-quality", "0"]
      : ["-f", "bv*+ba/b", "--merge-output-format", "mp4"];

  const args = [
    ...formatArgs,
    "--no-playlist",
    "--newline",
    "--ffmpeg-location",
    path.dirname(ffmpegPath),
    "--progress-template",
    "download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
    "-o",
    outputTemplate,
    url,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlpPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const line of lines) {
        const progress = parseProgressLine(line.trim());
        if (progress) {
          event.sender.send("download:progress", progress);
        }
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        event.sender.send("download:progress", {
          percent: "100%",
          speed: "done",
          eta: "0s",
        });

        resolve({
          success: true,
          outputDir: finalOutputDir,
          message: "Download completed.",
        });
        return;
      }

      const reason = stderr.trim() || `yt-dlp exited with code ${code}`;
      reject(new Error(reason));
    });
  });
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
