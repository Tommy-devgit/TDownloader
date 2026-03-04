import { useEffect, useMemo, useState } from "react";
import "./App.css";

type DownloadFormat = "mp4" | "mp3";
type DownloadResolution = "best" | "2160" | "1440" | "1080" | "720" | "480" | "360";
type DownloadStatus = "queued" | "starting" | "downloading" | "completed" | "failed";

type QueueItem = {
  id: string;
  videoId: string;
  url: string;
  title: string;
  author: string;
  duration: string;
  thumbnail: string;
  format: DownloadFormat;
  resolution: DownloadResolution;
  status: DownloadStatus;
  percent: number;
  speed: string;
  eta: string;
  filePath?: string;
  error?: string;
};

const RESOLUTION_OPTIONS: DownloadResolution[] = [
  "best",
  "2160",
  "1440",
  "1080",
  "720",
  "480",
  "360",
];

function statusLabel(status: DownloadStatus): string {
  if (status === "queued") return "Queued";
  if (status === "starting") return "Starting";
  if (status === "downloading") return "Downloading";
  if (status === "completed") return "Completed";
  return "Failed";
}

function formatResolution(value: DownloadResolution): string {
  return value === "best" ? "Best Available" : `${value}p`;
}

function isPlaylistUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.searchParams.get("list"));
  } catch {
    return false;
  }
}

function App() {
  const [url, setUrl] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [format, setFormat] = useState<DownloadFormat>("mp4");
  const [resolution, setResolution] = useState<DownloadResolution>("best");
  const [status, setStatus] = useState("Ready");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [supportedResolutions, setSupportedResolutions] = useState<DownloadResolution[]>(RESOLUTION_OPTIONS);

  useEffect(() => {
    window.electronAPI.isWindowMaximized().then(setIsMaximized).catch(() => undefined);
    const unsubscribeMax = window.electronAPI.onWindowMaximized((value) => {
      setIsMaximized(value);
    });

    const unsubscribeProgress = window.electronAPI.onDownloadProgress((update) => {
      setQueue((prev) =>
        prev.map((item) =>
          item.id === update.id
            ? {
                ...item,
                status: update.status,
                percent: update.percent,
                speed: update.speed,
                eta: update.eta,
                filePath: update.filePath || item.filePath,
                error: update.error,
              }
            : item
        )
      );
    });

    return () => {
      unsubscribeMax();
      unsubscribeProgress();
    };
  }, []);

  const queuedCount = useMemo(
    () => queue.filter((item) => item.status === "queued").length,
    [queue]
  );
  const downloadCount = useMemo(
    () => queue.filter((item) => item.status === "downloading" || item.status === "starting").length,
    [queue]
  );

  const chooseFolder = async () => {
    const folder = await window.electronAPI.chooseOutputFolder();
    if (folder) {
      setOutputDir(folder);
    }
  };

  const addToQueue = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setStatus("Enter a YouTube URL first.");
      return;
    }

    try {
      const queuedResolution: DownloadResolution = format === "mp3" ? "best" : resolution;

      if (isPlaylistUrl(trimmed)) {
        setStatus("Fetching playlist info...");
        const playlist = await window.electronAPI.getPlaylistInfo(trimmed);
        const timestamp = Date.now();
        const newItems: QueueItem[] = playlist.items.map((item, index) => ({
          id: `${item.id}-${timestamp}-${index}`,
          videoId: item.id,
          url: item.url,
          title: item.title,
          author: item.author,
          duration: item.duration,
          thumbnail: item.thumbnail,
          format,
          resolution: queuedResolution,
          status: "queued",
          percent: 0,
          speed: "-",
          eta: "-",
        }));

        setQueue((prev) => [...newItems, ...prev]);
        setSupportedResolutions(RESOLUTION_OPTIONS);
        setUrl("");
        setStatus(
          `Added ${newItems.length} item(s) from "${playlist.title}" to queue.`
        );
        return;
      }

      setStatus("Fetching video info...");
      const info = await window.electronAPI.getVideoInfo(trimmed);
      const available = info.resolutions
        .filter((v) => RESOLUTION_OPTIONS.includes(v as DownloadResolution))
        .map((v) => v as DownloadResolution);
      if (available.length > 0) {
        setSupportedResolutions(["best", ...available.filter((v) => v !== "best")]);
      } else {
        setSupportedResolutions(RESOLUTION_OPTIONS);
      }

      const itemId = `${info.id}-${Date.now()}`;
      const newItem: QueueItem = {
        id: itemId,
        videoId: info.id,
        url: info.url,
        title: info.title,
        author: info.author,
        duration: info.duration,
        thumbnail: info.thumbnail,
        format,
        resolution: queuedResolution,
        status: "queued",
        percent: 0,
        speed: "-",
        eta: "-",
      };

      setQueue((prev) => [newItem, ...prev]);
      setUrl("");
      setStatus(`Added "${info.title}" to queue.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not fetch video info.";
      setStatus(message);
    }
  };

  const startQueue = async () => {
    if (processing) {
      return;
    }
    const pending = queue.filter((item) => item.status === "queued" || item.status === "failed");
    if (pending.length === 0) {
      setStatus("Queue is empty.");
      return;
    }

    setProcessing(true);
    setStatus(`Starting ${pending.length} download(s)...`);

    try {
      for (const item of pending) {
        setQueue((prev) =>
          prev.map((entry) =>
            entry.id === item.id ? { ...entry, status: "starting", error: undefined } : entry
          )
        );

        try {
          const result = await window.electronAPI.downloadVideo({
            id: item.id,
            url: item.url,
            outputDir: outputDir || undefined,
            format: item.format,
            resolution: item.resolution,
            title: item.title,
          });

          setQueue((prev) =>
            prev.map((entry) =>
              entry.id === item.id
                ? { ...entry, status: "completed", percent: 100, filePath: result.filePath }
                : entry
            )
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Download failed.";
          setQueue((prev) =>
            prev.map((entry) =>
              entry.id === item.id ? { ...entry, status: "failed", error: message } : entry
            )
          );
        }
      }

      setStatus("Queue processing finished.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="panel">
        <header className="window-bar app-drag">
          <span className="window-title">TDownloader</span>
          <div className="window-controls no-drag">
            <button type="button" onClick={() => window.electronAPI.minimizeWindow()}>
              -
            </button>
            <button type="button" onClick={() => window.electronAPI.toggleMaximizeWindow()}>
              {isMaximized ? "[] " : "[ ]"}
            </button>
            <button type="button" className="danger" onClick={() => window.electronAPI.closeWindow()}>
              X
            </button>
          </div>
        </header>

        <header className="panel-head">
          <div>
            <h1>TDownloader</h1>
            <p>Queue-based YouTube desktop downloader with progress tracking</p>
          </div>
          <div className="header-actions">
            <button type="button" onClick={startQueue} disabled={processing || queuedCount === 0}>
              {processing ? "Working..." : "Start Queue"}
            </button>
          </div>
        </header>

        <section className="composer">
          <label htmlFor="url">YouTube URL</label>
          <div className="row">
            <input
              id="url"
              type="text"
              placeholder="https://www.youtube.com/watch?v=... or playlist URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={processing}
            />
            <button type="button" className="primary" onClick={addToQueue} disabled={processing}>
              Add to Queue
            </button>
          </div>

          <div className="grid">
            <div>
              <label htmlFor="format">Format</label>
              <select
                id="format"
                value={format}
                onChange={(event) => setFormat(event.target.value as DownloadFormat)}
                disabled={processing}
              >
                <option value="mp4">MP4 (video)</option>
                <option value="mp3">MP3 (audio)</option>
              </select>
            </div>
            <div>
              <label htmlFor="resolution">Resolution</label>
              <select
                id="resolution"
                value={resolution}
                onChange={(event) => setResolution(event.target.value as DownloadResolution)}
                disabled={processing || format === "mp3"}
              >
                {supportedResolutions.map((res) => (
                  <option key={res} value={res}>
                    {formatResolution(res)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="out">Output Folder</label>
              <div className="row">
                <input
                  id="out"
                  type="text"
                  placeholder="Defaults to Downloads"
                  value={outputDir}
                  onChange={(event) => setOutputDir(event.target.value)}
                  disabled={processing}
                />
                <button type="button" onClick={chooseFolder} disabled={processing}>
                  Browse
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="summary">
          <div>
            <span>Queued</span>
            <strong>{queuedCount}</strong>
          </div>
          <div>
            <span>Active</span>
            <strong>{downloadCount}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{queue.length}</strong>
          </div>
        </section>

        <section className="queue-list">
          {queue.length === 0 && <p className="empty">No items yet. Add a YouTube URL to begin.</p>}
          {queue.map((item) => (
            <article key={item.id} className="queue-item">
              <img src={item.thumbnail} alt="" loading="lazy" />
              <div className="queue-body">
                <div className="queue-top">
                  <h3>{item.title}</h3>
                  <span className={`pill ${item.status}`}>{statusLabel(item.status)}</span>
                </div>
                <p>
                  {item.author} - {item.duration} - {item.format.toUpperCase()} -{" "}
                  {item.format === "mp3" ? "Audio" : formatResolution(item.resolution)}
                </p>
                <div className="meter">
                  <div className="bar" style={{ width: `${Math.max(0, Math.min(100, item.percent))}%` }} />
                </div>
                <div className="meta">
                  <span>{item.percent.toFixed(2)}%</span>
                  <span>Speed: {item.speed}</span>
                  <span>ETA: {item.eta}</span>
                </div>
                {item.filePath && <small className="path">{item.filePath}</small>}
                {item.error && <small className="error">{item.error}</small>}
              </div>
            </article>
          ))}
        </section>

        <p className="status">{status}</p>
      </section>
    </main>
  );
}

export default App;
