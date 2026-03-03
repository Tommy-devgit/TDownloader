interface DownloadProgress {
  id: string;
  title: string;
  status: "starting" | "downloading" | "completed" | "failed";
  percent: number;
  speed: string;
  eta: string;
  filePath?: string;
  error?: string;
}

interface VideoInfo {
  id: string;
  title: string;
  author: string;
  duration: string;
  thumbnail: string;
  url: string;
}

interface DownloadPayload {
  id: string;
  url: string;
  outputDir?: string;
  format: "mp4" | "mp3";
  title?: string;
}

interface DownloadResult {
  success: boolean;
  filePath: string;
  outputDir: string;
  message: string;
}

interface ElectronAPI {
  chooseOutputFolder: () => Promise<string | null>;
  getVideoInfo: (url: string) => Promise<VideoInfo>;
  downloadVideo: (payload: DownloadPayload) => Promise<DownloadResult>;
  onDownloadProgress: (callback: (update: DownloadProgress) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
