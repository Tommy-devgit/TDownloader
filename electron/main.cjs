const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
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
  const ffmpegRoot = path.join(
    home,
    "AppData",
    "Local",
    "Microsoft",
    "WinGet",
    "Packages",
    "yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
  );
  const ytdlpRoot = path.join(
    home,
    "AppData",
    "Local",
    "Microsoft",
    "WinGet",
    "Packages",
    "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe"
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
    ffmpegBin,
    ytdlpRoot,
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
  const match = line.match(/^download:([^|]+)\|([^|]+)\|(.+)$/);
  if (!match) {
    return null;
  }
  const rawPercent = match[1].trim().replace("%", "").trim();
  const percent = Number(rawPercent);
  return {
    percent: Number.isFinite(percent) ? Number(percent.toFixed(2)) : 0,
    speed: match[2].trim(),
    eta: match[3].trim(),
  };
}

async function runYtDlpJson(args) {
  const ytdlpPath = resolveExecutable("yt-dlp.exe");
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
  const ytdlpPath = resolveExecutable("yt-dlp.exe");
  const ffmpegPath = resolveExecutable("ffmpeg.exe");
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

    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
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
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
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

function selectProgressiveFormat(formats, resolution) {
  const progressive = formats
    .filter((f) => f.hasVideo && f.hasAudio && f.container === "mp4")
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  if (progressive.length === 0) {
    return null;
  }

  if (!resolution || resolution === "best") {
    return progressive[0];
  }

  const cap = Number(resolution);
  if (!Number.isFinite(cap)) {
    return progressive[0];
  }

  return progressive.find((f) => (f.height || 0) <= cap) || progressive[0];
}

async function downloadWithYtdlCore({
  sender,
  id,
  info,
  format,
  resolution,
  targetPath,
  outputDir,
}) {
  const details = info.videoDetails;
  const streamOptions =
    format === "mp3"
      ? { quality: "highestaudio", filter: "audioonly" }
      : (() => {
          const fmt = selectProgressiveFormat(info.formats, resolution);
          if (!fmt) {
            throw new Error("No progressive MP4 format available for this video.");
          }
          return { quality: fmt.itag };
        })();

  const stream = ytdl.downloadFromInfo(info, streamOptions);

  if (format === "mp4") {
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(targetPath);
      stream.on("progress", (_, downloaded, total) => {
        const percent = total > 0 ? Number(((downloaded / total) * 100).toFixed(2)) : 0;
        sendProgress(sender, {
          id,
          title: details.title,
          status: "downloading",
          percent,
          speed: "-",
          eta: "-",
        });
        setProgress(percent);
      });
      stream.on("error", reject);
      file.on("error", reject);
      file.on("finish", resolve);
      stream.pipe(file);
    });
  } else {
    const ffmpegPath = resolveExecutable("ffmpeg.exe");
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn(
        ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          "pipe:0",
          "-vn",
          "-codec:a",
          "libmp3lame",
          "-q:a",
          "2",
          "-y",
          targetPath,
        ],
        { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] }
      );
      let errorText = "";
      ffmpeg.stderr.on("data", (chunk) => {
        errorText += chunk.toString();
      });
      stream.on("progress", (_, downloaded, total) => {
        const percent = total > 0 ? Number(((downloaded / total) * 100).toFixed(2)) : 0;
        sendProgress(sender, {
          id,
          title: details.title,
          status: "downloading",
          percent,
          speed: "converting",
          eta: "-",
        });
        setProgress(percent);
      });
      stream.on("error", reject);
      ffmpeg.on("error", reject);
      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(errorText.trim() || `ffmpeg exited with code ${code}`));
          return;
        }
        resolve();
      });
      stream.pipe(ffmpeg.stdin);
    });
  }

  setProgress();
  sendProgress(sender, {
    id,
    title: details.title,
    status: "completed",
    percent: 100,
    speed: "done",
    eta: "0s",
    filePath: targetPath,
  });

  return {
    success: true,
    filePath: targetPath,
    outputDir,
    message: "Download completed.",
  };
}

function shouldFallbackToYtDlp(error) {
  if (!error || !(error instanceof Error)) {
    return false;
  }
  const msg = error.message || "";
  return (
    msg.includes("Could not extract functions") ||
    msg.includes("Could not extract decipher") ||
    msg.includes("No n transform function")
  );
}

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
  const targetPath = path.join(output, `${safeBaseName}-${Date.now()}.${extension}`);

  sendProgress(event.sender, {
    id,
    title: title || "Download",
    status: "starting",
    percent: 0,
    speed: "-",
    eta: "-",
  });

  try {
    const info = await ytdl.getInfo(url);
    return await downloadWithYtdlCore({
      sender: event.sender,
      id,
      info,
      format,
      resolution,
      targetPath,
      outputDir: output,
    });
  } catch (error) {
    if (shouldFallbackToYtDlp(error)) {
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
    }

    sendProgress(event.sender, {
      id,
      title: title || "Download",
      status: "failed",
      percent: 0,
      speed: "-",
      eta: "-",
      error: error instanceof Error ? error.message : "Download failed.",
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
