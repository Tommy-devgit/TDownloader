import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

type DownloadFormat = "mp4" | "mp3";
type DownloadResolution = "best" | "2160" | "1440" | "1080" | "720" | "480" | "360";
type DownloadStatus =
  | "queued"
  | "starting"
  | "downloading"
  | "paused"
  | "stopped"
  | "completed"
  | "failed";

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

type PlaylistDraftItem = {
  key: string;
  id: string;
  title: string;
  author: string;
  duration: string;
  thumbnail: string;
  url: string;
};

type PlaylistDraft = {
  title: string;
  items: PlaylistDraftItem[];
  selectedKeys: string[];
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
  if (status === "paused") return "Paused";
  if (status === "stopped") return "Stopped";
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
  const [queuePaused, setQueuePaused] = useState(false);
  const [activeDownloadId, setActiveDownloadId] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [supportedResolutions, setSupportedResolutions] =
    useState<DownloadResolution[]>(RESOLUTION_OPTIONS);
  const [playlistDraft, setPlaylistDraft] = useState<PlaylistDraft | null>(null);

  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const pausedIdsRef = useRef<Set<string>>(new Set());
  const queuePausedRef = useRef(false);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    processingRef.current = processing;
  }, [processing]);

  useEffect(() => {
    queuePausedRef.current = queuePaused;
  }, [queuePaused]);

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
                status: update.status as DownloadStatus,
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
  const completedCount = useMemo(
    () => queue.filter((item) => item.status === "completed").length,
    [queue]
  );

  const chooseFolder = async () => {
    const folder = await window.electronAPI.chooseOutputFolder();
    if (folder) {
      setOutputDir(folder);
    }
  };

  const addSelectedPlaylistItemsToQueue = () => {
    if (!playlistDraft) {
      return;
    }
    const selected = playlistDraft.items.filter((item) =>
      playlistDraft.selectedKeys.includes(item.key)
    );
    if (selected.length === 0) {
      setStatus("Select at least one playlist item.");
      return;
    }

    const queuedResolution: DownloadResolution = format === "mp3" ? "best" : resolution;
    const stamp = Date.now();
    const newItems: QueueItem[] = selected.map((item, index) => ({
      id: `${item.id}-${stamp}-${index}`,
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
    setPlaylistDraft(null);
    setUrl("");
    setStatus(`Added ${newItems.length} selected playlist item(s) to queue.`);
  };

  const togglePlaylistItem = (key: string) => {
    setPlaylistDraft((prev) => {
      if (!prev) return prev;
      const exists = prev.selectedKeys.includes(key);
      return {
        ...prev,
        selectedKeys: exists
          ? prev.selectedKeys.filter((value) => value !== key)
          : [...prev.selectedKeys, key],
      };
    });
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
        if (typeof window.electronAPI.getPlaylistInfo !== "function") {
          setStatus("Playlist bridge is unavailable. Restart the app.");
          return;
        }
        setStatus("Fetching playlist info...");
        const playlist = await window.electronAPI.getPlaylistInfo(trimmed);
        const draftItems: PlaylistDraftItem[] = playlist.items.map((item, index) => ({
          key: `${item.id}-${index}`,
          id: item.id,
          title: item.title,
          author: item.author,
          duration: item.duration,
          thumbnail: item.thumbnail,
          url: item.url,
        }));
        setPlaylistDraft({
          title: playlist.title,
          items: draftItems,
          selectedKeys: draftItems.map((item) => item.key),
        });
        setSupportedResolutions(RESOLUTION_OPTIONS);
        setStatus(`Choose playlist items from "${playlist.title}" and add them to queue.`);
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

  const pauseQueue = async () => {
    if (!processingRef.current) {
      return;
    }
    setQueuePaused(true);
    queuePausedRef.current = true;
    if (activeDownloadId) {
      pausedIdsRef.current.add(activeDownloadId);
      await window.electronAPI.cancelDownload(activeDownloadId).catch(() => undefined);
    }
  };

  const stopItem = async (item: QueueItem) => {
    if (item.status === "queued") {
      setQueue((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: "stopped", error: "Stopped by user." }
            : entry
        )
      );
      return;
    }
    if (item.status === "starting" || item.status === "downloading") {
      await window.electronAPI.cancelDownload(item.id).catch(() => undefined);
      setQueue((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: "stopped", error: "Stopped by user." }
            : entry
        )
      );
    }
  };

  const resumeItem = (itemId: string) => {
    setQueue((prev) =>
      prev.map((entry) =>
        entry.id === itemId
          ? { ...entry, status: "queued", error: undefined }
          : entry
      )
    );
    setStatus("Item moved back to queue.");
  };

  const startQueue = async () => {
    if (processingRef.current) {
      return;
    }
    const pendingIds = queueRef.current
      .filter((item) =>
        item.status === "queued" ||
        item.status === "failed" ||
        item.status === "paused"
      )
      .map((item) => item.id);

    if (pendingIds.length === 0) {
      setStatus("Queue is empty.");
      return;
    }

    setProcessing(true);
    processingRef.current = true;
    setQueuePaused(false);
    queuePausedRef.current = false;
    setStatus(`Starting ${pendingIds.length} download(s)...`);

    try {
      for (const id of pendingIds) {
        if (queuePausedRef.current) {
          break;
        }
        const current = queueRef.current.find((entry) => entry.id === id);
        if (!current || current.status === "stopped" || current.status === "completed") {
          continue;
        }

        setActiveDownloadId(id);
        setQueue((prev) =>
          prev.map((entry) =>
            entry.id === id ? { ...entry, status: "starting", error: undefined } : entry
          )
        );

        try {
          const result = await window.electronAPI.downloadVideo({
            id,
            url: current.url,
            outputDir: outputDir || undefined,
            format: current.format,
            resolution: current.resolution,
            title: current.title,
          });

          setQueue((prev) =>
            prev.map((entry) =>
              entry.id === id
                ? { ...entry, status: "completed", percent: 100, filePath: result.filePath }
                : entry
            )
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Download failed.";
          const pausedByUser = pausedIdsRef.current.has(id);
          if (pausedByUser) {
            pausedIdsRef.current.delete(id);
          }
          setQueue((prev) =>
            prev.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    status: pausedByUser ? "paused" : "failed",
                    error: pausedByUser ? "Paused by user." : message,
                  }
                : entry
            )
          );
        } finally {
          setActiveDownloadId((currentId) => (currentId === id ? null : currentId));
        }
      }

      if (queuePausedRef.current) {
        setStatus("Queue paused.");
      } else {
        setStatus("Queue processing finished.");
      }
    } finally {
      setProcessing(false);
      processingRef.current = false;
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
            {!processing && (
              <button type="button" onClick={startQueue} disabled={queuedCount === 0}>
                {queuePaused ? "Resume Queue" : "Start Queue"}
              </button>
            )}
            {processing && (
              <button type="button" onClick={pauseQueue}>
                Pause Queue
              </button>
            )}
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

        {playlistDraft && (
          <section className="playlist-picker">
            <div className="playlist-head">
              <h2>{playlistDraft.title}</h2>
              <span>{playlistDraft.selectedKeys.length} selected</span>
            </div>
            <div className="playlist-actions">
              <button
                type="button"
                onClick={() =>
                  setPlaylistDraft((prev) =>
                    prev
                      ? { ...prev, selectedKeys: prev.items.map((item) => item.key) }
                      : prev
                  )
                }
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() =>
                  setPlaylistDraft((prev) => (prev ? { ...prev, selectedKeys: [] } : prev))
                }
              >
                Select None
              </button>
              <button type="button" className="primary" onClick={addSelectedPlaylistItemsToQueue}>
                Add Selected
              </button>
              <button type="button" onClick={() => setPlaylistDraft(null)}>
                Cancel
              </button>
            </div>
            <div className="playlist-list">
              {playlistDraft.items.map((item) => (
                <label key={item.key} className="playlist-item">
                  <input
                    type="checkbox"
                    checked={playlistDraft.selectedKeys.includes(item.key)}
                    onChange={() => togglePlaylistItem(item.key)}
                  />
                  <img src={item.thumbnail} alt="" loading="lazy" />
                  <span>
                    {item.title} - {item.duration}
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}

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
            <span>Completed</span>
            <strong>{completedCount}</strong>
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
                <div className="item-actions">
                  {(item.status === "paused" || item.status === "stopped" || item.status === "failed") && (
                    <button type="button" onClick={() => resumeItem(item.id)} disabled={processing}>
                      Resume
                    </button>
                  )}
                  {(item.status === "queued" || item.status === "starting" || item.status === "downloading") && (
                    <button
                      type="button"
                      onClick={() => {
                        void stopItem(item);
                      }}
                      disabled={item.status === "starting" || activeDownloadId === item.id ? false : processing}
                    >
                      Stop
                    </button>
                  )}
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
