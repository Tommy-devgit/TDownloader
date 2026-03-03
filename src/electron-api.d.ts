interface DownloadProgress {
  percent: string;
  speed: string;
  eta: string;
}

interface DownloadPayload {
  url: string;
  outputDir?: string;
  format: "mp4" | "mp3";
}

interface DownloadResult {
  success: boolean;
  outputDir: string;
  message: string;
}

interface ElectronAPI {
  chooseOutputFolder: () => Promise<string | null>;
  downloadVideo: (payload: DownloadPayload) => Promise<DownloadResult>;
  onDownloadProgress: (callback: (update: DownloadProgress) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
