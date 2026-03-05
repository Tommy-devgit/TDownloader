const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ytdl = require("ytdl-core");

const isDev = !app.isPackaged;
let mainWindow = null;
let tray = null;
const activeYtDlpDownloads = new Map();
const userStoppedDownloads = new Set();

function findFirstExisting(paths) {
  for (const filePath of paths) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function getIconPath() {
  return findFirstExisting([
    path.join(__dirname, "..", "assets", "icon.png"),
    path.join(__dirname, "..", "assets", "icon.ico"),
  ]);
}

function resolveExecutable(name) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter);
  const home = os.homedir();
  const isWindows = process.platform === "win32";
  const ffmpegRoot = isWindows
    ? path.join(
        home,
        "AppData",
        "Local",
        "Microsoft",
        "WinGet",
        "Packages",
        "yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
      )
    : null;
  const ytdlpRoot = isWindows
    ? path.join(
        home,
        "AppData",
        "Local",
        "Microsoft",
        "WinGet",
        "Packages",
        "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe"
      )
    : null;

  let ffmpegBin = null;
  if (ffmpegRoot && fs.existsSync(ffmpegRoot)) {
    const entries = fs.readdirSync(ffmpegRoot, { withFileTypes: true });
    const versionDir = entries.find((entry) => entry.isDirectory());
    if (versionDir) {
      ffmpegBin = path.join(ffmpegRoot, versionDir.name, "bin");
    }
  }

  const fallbackDirs = [
    isWindows ? path.join(home, "AppData", "Local", "Programs", "TDownloaderTools") : null,
    ffmpegBin,
    ytdlpRoot,
    "/usr/local/bin",
    "/usr/bin",
    "/opt/homebrew/bin",
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

function setProgress(percent) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (typeof percent === "number") {
    mainWindow.setProgressBar(percent / 100);
  } else {
    mainWindow.setProgressBar(-1);
  }
}

function sendProgress(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }
  webContents.send("download:progress", payload);
}

function sendMaximizeState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("window:maximized", mainWindow.isMaximized());
}

function createTray() {
  const iconPath = getIconPath();
  if (!iconPath) {
    return;
  }

  let trayIcon = nativeImage.createFromPath(iconPath);
  if (trayIcon.isEmpty()) {
    return;
  }
  trayIcon = trayIcon.resize({ width: 18, height: 18 });
  tray = new Tray(trayIcon);
  tray.setToolTip("TDownloader");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show App",
        click: () => {
          if (!mainWindow) {
            return;
          }
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { type: "separator" },
      { role: "quit", label: "Quit" },
    ])
  );
}

function createWindow() {
  const iconPath = getIconPath();
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#0d1014",
    title: "TDownloader",
    frame: false,
    icon: iconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("maximize", sendMaximizeState);
  mainWindow.on("unmaximize", sendMaximizeState);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    sendMaximizeState();
  });

  if (isDev) {
    try {
      require("electron-reload")(path.join(__dirname, ".."), {
        hardResetMethod: "exit",
      });
    } catch {
      // no-op in dev when not available
    }
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 140).trim();
}

function formatDuration(secondsText) {
  const totalSeconds = Number(secondsText || 0);
  if (!Number.isFinite(totalSeconds)) {
    return "--:--";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

function extractPlaylistId(url) {
  try {
    const parsed = new URL(url);
    const list = parsed.searchParams.get("list");
    return list && list.trim() ? list.trim() : null;
  } catch {
    return null;
  }
}

function isPlaylistUrl(url) {
  return Boolean(extractPlaylistId(url));
}

function parseYtDlpProgress(line) {
  const clean = line.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").trim();
  if (!clean) {
    return null;
  }

  const templateMatch = clean.match(/^download:\s*([^|]+)\|([^|]+)\|(.+)$/i);
  if (templateMatch) {
    const rawPercent = templateMatch[1].trim().replace("%", "").trim();
    const percent = Number(rawPercent);
    return {
      percent: Number.isFinite(percent) ? Number(percent.toFixed(2)) : 0,
      speed: templateMatch[2].trim(),
      eta: templateMatch[3].trim(),
    };
  }

  const defaultMatch = clean.match(
    /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+.+?\s+at\s+(.+?)\s+ETA\s+(.+)$/i
  );
  if (defaultMatch) {
    return {
      percent: Number(Number(defaultMatch[1]).toFixed(2)),
      speed: defaultMatch[2].trim(),
      eta: defaultMatch[3].trim(),
    };
  }

  const percentOnly = clean.match(/(\d+(?:\.\d+)?)%/);
  if (percentOnly) {
    const speedMatch = clean.match(/\bat\s+(.+?)\s+ETA\b/i);
    const etaMatch = clean.match(/\bETA\s+(.+)$/i);
    return {
      percent: Number(Number(percentOnly[1]).toFixed(2)),
      speed: speedMatch ? speedMatch[1].trim() : "-",
      eta: etaMatch ? etaMatch[1].trim() : "-",
    };
  }

  return null;
}

async function runYtDlpJson(args) {
  const ytdlpPath = resolveExecutable(process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  return await new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }

      const parsed = JSON.parse(stdout);
      resolve(parsed);
    });
  });
}

async function getPlaylistInfo(url) {
  const data = await runYtDlpJson([
    "--skip-download",
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
    url,
  ]);

  const entries = Array.isArray(data.entries) ? data.entries : [];
  const items = entries
    .filter((entry) => entry && typeof entry.id === "string")
    .map((entry) => {
      const videoId = entry.id;
      const duration = formatDuration(entry.duration);
      const title = entry.title || `Video ${videoId}`;
      const uploader = entry.uploader || entry.channel || "Unknown";
      const thumbnail =
        entry.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      return {
        id: videoId,
        title,
        author: uploader,
        duration,
        thumbnail,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        resolutions: [],
      };
    });

  const playlistId = extractPlaylistId(url) || data.id || "playlist";
  const playlistTitle = data.title || `Playlist ${playlistId}`;

  return {
    id: playlistId,
    title: playlistTitle,
    itemCount: items.length,
    items,
  };
}

function buildYtdlpArgs({ url, format, resolution, outputPath, ffmpegPath }) {
  if (format === "mp3") {
    return [
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--continue",
      "--ffmpeg-location",
      path.dirname(ffmpegPath),
      "--newline",
      "--progress-template",
      "download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
      "-o",
      outputPath,
      "--no-playlist",
      url,
    ];
  }

  const resFilter = resolution && resolution !== "best" ? `[height<=${resolution}]` : "";
  const formatSelector =
    resolution && resolution !== "best"
      ? `bestvideo${resFilter}+bestaudio/best${resFilter}/best`
      : "bestvideo+bestaudio/best";

  return [
    "-f",
    formatSelector,
    "--merge-output-format",
    "mp4",
    "--continue",
    "--ffmpeg-location",
    path.dirname(ffmpegPath),
    "--newline",
    "--progress-template",
    "download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
    "-o",
    outputPath,
    "--no-playlist",
    url,
  ];
}

async function downloadWithYtDlp({
  sender,
  id,
  title,
  url,
  format,
  resolution,
  outputPath,
  outputDir,
}) {
  const ytdlpPath = resolveExecutable(process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  const ffmpegPath = resolveExecutable(process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const args = buildYtdlpArgs({
    url,
    format,
    resolution,
    outputPath,
    ffmpegPath,
  });

  await new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeYtDlpDownloads.set(id, proc);

    let stderr = "";
    const handleProgressOutput = (chunk) => {
      const lines = chunk.toString().split(/[\r\n]+/);
      for (const line of lines) {
        const parsed = parseYtDlpProgress(line.trim());
        if (!parsed) {
          continue;
        }
        sendProgress(sender, {
          id,
          title,
          status: "downloading",
          percent: parsed.percent,
          speed: parsed.speed,
          eta: parsed.eta,
        });
        setProgress(parsed.percent);
      }
    };

    proc.stdout.on("data", handleProgressOutput);

    proc.stderr.on("data", (chunk) => {
      handleProgressOutput(chunk);
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      activeYtDlpDownloads.delete(id);
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });
    proc.on("close", (code) => {
      activeYtDlpDownloads.delete(id);
      if (code === 0) {
        resolve();
        return;
      }
      if (userStoppedDownloads.has(id)) {
        userStoppedDownloads.delete(id);
        reject(new Error("Download stopped by user."));
        return;
      }
      reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
    });
  });

  setProgress();
  sendProgress(sender, {
    id,
    title,
    status: "completed",
    percent: 100,
    speed: "done",
    eta: "0s",
    filePath: outputPath,
  });

  return {
    success: true,
    filePath: outputPath,
    outputDir,
    message: "Download completed.",
  };
}

ipcMain.handle("download:cancel", async (_, id) => {
  if (!id || typeof id !== "string") {
    return false;
  }
  const proc = activeYtDlpDownloads.get(id);
  if (!proc) {
    return false;
  }
  userStoppedDownloads.add(id);
  proc.kill("SIGTERM");
  return true;
});

ipcMain.handle("file:showInFolder", async (_, filePath) => {
  if (!filePath || typeof filePath !== "string") {
    return;
  }
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return;
  }
  const folderPath = path.dirname(filePath);
  if (fs.existsSync(folderPath)) {
    await shell.openPath(folderPath);
  }
});

ipcMain.handle("window:minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.handle("window:toggleMaximize", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return mainWindow.isMaximized();
});

ipcMain.handle("window:close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle("window:isMaximized", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  return mainWindow.isMaximized();
});

ipcMain.handle("dialog:chooseOutputFolder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("video:getInfo", async (_, url) => {
  if (!url || typeof url !== "string" || !ytdl.validateURL(url)) {
    throw new Error("Enter a valid YouTube URL.");
  }

  const info = await ytdl.getBasicInfo(url.trim());
  const details = info.videoDetails;
  const thumb =
    details.thumbnails && details.thumbnails.length > 0
      ? details.thumbnails[details.thumbnails.length - 1].url
      : "";
  const resolutions = Array.from(
    new Set(
      info.formats
        .filter((f) => f.hasVideo && f.hasAudio && f.height)
        .map((f) => String(f.height))
    )
  )
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a)
    .map((v) => String(v));

  return {
    id: details.videoId,
    title: details.title,
    author: details.author?.name || "Unknown",
    duration: formatDuration(details.lengthSeconds),
    thumbnail: thumb,
    url: details.video_url || url,
    resolutions,
  };
});

ipcMain.handle("playlist:getInfo", async (_, url) => {
  if (!url || typeof url !== "string" || !isPlaylistUrl(url)) {
    throw new Error("Enter a valid YouTube playlist URL.");
  }

  try {
    const playlist = await getPlaylistInfo(url.trim());
    if (playlist.items.length === 0) {
      throw new Error("No downloadable videos found in this playlist.");
    }
    return playlist;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not fetch playlist info.";
    if (message.includes("yt-dlp")) {
      throw new Error(
        "Playlist fetching requires yt-dlp. Install yt-dlp and try again."
      );
    }
    throw error;
  }
});

ipcMain.handle("download:start", async (event, payload) => {
  const { id, url, outputDir, format, title, resolution } = payload || {};
  if (!id || typeof id !== "string") {
    throw new Error("Download ID is required.");
  }
  if (!url || typeof url !== "string") {
    throw new Error("A valid YouTube URL is required.");
  }
  if (!ytdl.validateURL(url) && !isPlaylistUrl(url)) {
    throw new Error("A valid YouTube URL is required.");
  }

  const output = outputDir || app.getPath("downloads");
  await fs.promises.mkdir(output, { recursive: true });

  const safeBaseName = sanitizeFileName(title || id);
  const extension = format === "mp3" ? "mp3" : "mp4";
  const targetPath = path.join(output, `${safeBaseName}-${id}.${extension}`);

  sendProgress(event.sender, {
    id,
    title: title || "Download",
    status: "starting",
    percent: 0,
    speed: "-",
    eta: "-",
  });

  try {
    return await downloadWithYtDlp({
      sender: event.sender,
      id,
      title: title || "Download",
      url,
      format,
      resolution,
      outputPath: targetPath,
      outputDir: output,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed.";
    const failedStatus = message === "Download stopped by user." ? "stopped" : "failed";
    sendProgress(event.sender, {
      id,
      title: title || "Download",
      status: failedStatus,
      percent: 0,
      speed: "-",
      eta: "-",
      error: message,
    });
    setProgress();
    throw error;
  }
});

app.whenReady().then(() => {
  app.setAppUserModelId("com.tdownloader.app");
  createWindow();
  createTray();

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
