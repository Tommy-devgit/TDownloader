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
  resolutions: string[];
}

interface DownloadPayload {
  id: string;
  url: string;
  outputDir?: string;
  format: "mp4" | "mp3";
  resolution?: "best" | "2160" | "1440" | "1080" | "720" | "480" | "360";
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
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  onWindowMaximized: (callback: (isMaximized: boolean) => void) => () => void;
  onDownloadProgress: (callback: (update: DownloadProgress) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
