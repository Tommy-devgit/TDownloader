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
  const candidates = [
    path.join(__dirname, "..", "assets", "icon.png"),
    path.join(__dirname, "..", "assets", "icon.ico"),
    path.join(__dirname, "..", "public", "vite.svg"),
  ];
  return findFirstExisting(candidates);
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

  tray.on("double-click", () => {
    if (!mainWindow) {
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });
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
    icon: iconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (isDev) {
    // Hot-reload Electron process files during development.
    try {
      require("electron-reload")(path.join(__dirname, ".."), {
        hardResetMethod: "exit",
      });
    } catch {
      // Best-effort in development only.
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

function sendProgress(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }
  webContents.send("download:progress", payload);
}

async function downloadMp4({
  stream,
  targetPath,
  sender,
  id,
  title,
  outputDir,
}) {
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(targetPath);

    stream.on("progress", (_, downloaded, total) => {
      const percent = total > 0 ? (downloaded / total) * 100 : 0;
      sendProgress(sender, {
        id,
        title,
        status: "downloading",
        percent: Number(percent.toFixed(2)),
        speed: "-",
        eta: "-",
      });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(percent / 100);
      }
    });

    stream.on("error", reject);
    file.on("error", reject);
    file.on("finish", resolve);

    stream.pipe(file);
  });

  sendProgress(sender, {
    id,
    title,
    status: "completed",
    percent: 100,
    speed: "done",
    eta: "0s",
    filePath: targetPath,
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setProgressBar(-1);
  }

  return {
    success: true,
    filePath: targetPath,
    outputDir,
    message: "Download completed.",
  };
}

async function downloadMp3({
  stream,
  targetPath,
  sender,
  id,
  title,
  outputDir,
}) {
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
      {
        windowsHide: true,
        stdio: ["pipe", "ignore", "pipe"],
      }
    );

    stream.on("progress", (_, downloaded, total) => {
      const percent = total > 0 ? (downloaded / total) * 100 : 0;
      sendProgress(sender, {
        id,
        title,
        status: "downloading",
        percent: Number(percent.toFixed(2)),
        speed: "converting",
        eta: "-",
      });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(percent / 100);
      }
    });

    let errorText = "";
    ffmpeg.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });

    ffmpeg.on("error", (err) => {
      reject(
        new Error(
          `Failed to start ffmpeg (${ffmpegPath}). ${err.message}`
        )
      );
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(errorText.trim() || `ffmpeg exited with code ${code}`));
        return;
      }
      resolve();
    });

    stream.on("error", reject);
    stream.pipe(ffmpeg.stdin);
  });

  sendProgress(sender, {
    id,
    title,
    status: "completed",
    percent: 100,
    speed: "done",
    eta: "0s",
    filePath: targetPath,
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setProgressBar(-1);
  }

  return {
    success: true,
    filePath: targetPath,
    outputDir,
    message: "Download completed.",
  };
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

  return {
    id: details.videoId,
    title: details.title,
    author: details.author?.name || "Unknown",
    duration: formatDuration(details.lengthSeconds),
    thumbnail: thumb,
    url: details.video_url || url,
  };
});

ipcMain.handle("download:start", async (event, payload) => {
  const { id, url, outputDir, format, title } = payload || {};
  if (!id || typeof id !== "string") {
    throw new Error("Download ID is required.");
  }
  if (!url || typeof url !== "string" || !ytdl.validateURL(url)) {
    throw new Error("A valid YouTube URL is required.");
  }

  const output = outputDir || app.getPath("downloads");
  await fs.promises.mkdir(output, { recursive: true });

  const info = await ytdl.getInfo(url);
  const details = info.videoDetails;
  const safeBaseName = sanitizeFileName(title || details.title || id);
  const extension = format === "mp3" ? "mp3" : "mp4";
  const targetPath = path.join(output, `${safeBaseName}-${Date.now()}.${extension}`);

  sendProgress(event.sender, {
    id,
    title: details.title,
    status: "starting",
    percent: 0,
    speed: "-",
    eta: "-",
  });

  const streamOptions =
    format === "mp3"
      ? { quality: "highestaudio", filter: "audioonly" }
      : { quality: "highest", filter: "audioandvideo" };

  const stream = ytdl.downloadFromInfo(info, streamOptions);

  try {
    if (format === "mp3") {
      return await downloadMp3({
        stream,
        targetPath,
        sender: event.sender,
        id,
        title: details.title,
        outputDir: output,
      });
    }

    return await downloadMp4({
      stream,
      targetPath,
      sender: event.sender,
      id,
      title: details.title,
      outputDir: output,
    });
  } catch (error) {
    sendProgress(event.sender, {
      id,
      title: details.title,
      status: "failed",
      percent: 0,
      speed: "-",
      eta: "-",
      error: error instanceof Error ? error.message : "Download failed.",
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
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

