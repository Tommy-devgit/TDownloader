import { useEffect, useMemo, useState } from "react";
import "./App.css";

type DownloadFormat = "mp4" | "mp3";
type DownloadStatus = "queued" | "starting" | "downloading" | "completed" | "failed";

type QueueItem = {
  id: string;
  videoId: string;
  url: string;
  title: string;
  author: string;
  duration: string;
  thumbnail: string;
  status: DownloadStatus;
  percent: number;
  speed: string;
  eta: string;
  filePath?: string;
  error?: string;
};

function statusLabel(status: DownloadStatus): string {
  if (status === "queued") return "Queued";
  if (status === "starting") return "Starting";
  if (status === "downloading") return "Downloading";
  if (status === "completed") return "Completed";
  return "Failed";
}

function App() {
  const [url, setUrl] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [format, setFormat] = useState<DownloadFormat>("mp4");
  const [status, setStatus] = useState("Ready");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onDownloadProgress((update) => {
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
      unsubscribe();
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
      setStatus("Fetching video info...");
      const info = await window.electronAPI.getVideoInfo(trimmed);
      const itemId = `${info.id}-${Date.now()}`;
      const newItem: QueueItem = {
        id: itemId,
        videoId: info.id,
        url: info.url,
        title: info.title,
        author: info.author,
        duration: info.duration,
        thumbnail: info.thumbnail,
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
            format,
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

  const clearFinished = () => {
    setQueue((prev) => prev.filter((item) => item.status !== "completed"));
    setStatus("Cleared completed downloads.");
  };

  return (
    <main className="app-shell">
      <section className="panel">
        <header className="panel-head">
          <div>
            <h1>TDownloader</h1>
            <p>Electron desktop YouTube downloader with queue + progress tracking</p>
          </div>
          <div className="header-actions">
            <button type="button" onClick={startQueue} disabled={processing || queuedCount === 0}>
              {processing ? "Working..." : "Start Queue"}
            </button>
            <button type="button" className="ghost" onClick={clearFinished}>
              Clear Completed
            </button>
          </div>
        </header>

        <section className="composer">
          <label htmlFor="url">YouTube URL</label>
          <div className="row">
            <input
              id="url"
              type="text"
              placeholder="https://www.youtube.com/watch?v=..."
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
                  {item.author} • {item.duration}
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

