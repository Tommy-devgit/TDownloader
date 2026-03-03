import { useEffect, useMemo, useState } from "react";
import "./App.css";

type DownloadFormat = "mp4" | "mp3";

function App() {
  const [url, setUrl] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [format, setFormat] = useState<DownloadFormat>("mp4");
  const [status, setStatus] = useState("Ready");
  const [progress, setProgress] = useState({ percent: "-", speed: "-", eta: "-" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onDownloadProgress((update) => {
      setProgress(update);
      setStatus("Downloading...");
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const canStart = useMemo(() => !busy && url.trim().length > 0, [busy, url]);

  const chooseFolder = async () => {
    const folder = await window.electronAPI.chooseOutputFolder();
    if (folder) {
      setOutputDir(folder);
    }
  };

  const startDownload = async () => {
    if (!canStart) {
      return;
    }

    setBusy(true);
    setProgress({ percent: "-", speed: "-", eta: "-" });
    setStatus("Starting...");

    try {
      const result = await window.electronAPI.downloadVideo({
        url: url.trim(),
        outputDir: outputDir || undefined,
        format,
      });

      setStatus(result.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed.";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="card">
        <h1>TDownloader</h1>
        <p className="subtitle">Desktop YouTube downloader (Electron + yt-dlp)</p>

        <label htmlFor="url">YouTube URL</label>
        <input
          id="url"
          type="text"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />

        <label htmlFor="format">Format</label>
        <select
          id="format"
          value={format}
          onChange={(e) => setFormat(e.target.value as DownloadFormat)}
          disabled={busy}
        >
          <option value="mp4">MP4 (video)</option>
          <option value="mp3">MP3 (audio)</option>
        </select>

        <label htmlFor="output">Output Folder (optional)</label>
        <div className="row">
          <input
            id="output"
            type="text"
            placeholder="Defaults to your Downloads folder"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            disabled={busy}
          />
          <button type="button" onClick={chooseFolder} disabled={busy}>
            Browse
          </button>
        </div>

        <button className="primary" type="button" onClick={startDownload} disabled={!canStart}>
          {busy ? "Downloading..." : "Download"}
        </button>

        <div className="status-grid">
          <div>
            <span>Percent</span>
            <strong>{progress.percent}</strong>
          </div>
          <div>
            <span>Speed</span>
            <strong>{progress.speed}</strong>
          </div>
          <div>
            <span>ETA</span>
            <strong>{progress.eta}</strong>
          </div>
        </div>

        <p className="status">{status}</p>
      </section>
    </main>
  );
}

export default App;
