const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  chooseOutputFolder: () => ipcRenderer.invoke("dialog:chooseOutputFolder"),
  getVideoInfo: (url) => ipcRenderer.invoke("video:getInfo", url),
  downloadVideo: (payload) => ipcRenderer.invoke("download:start", payload),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  onWindowMaximized: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on("window:maximized", listener);
    return () => {
      ipcRenderer.removeListener("window:maximized", listener);
    };
  },
  onDownloadProgress: (callback) => {
    const listener = (_, update) => callback(update);
    ipcRenderer.on("download:progress", listener);

    return () => {
      ipcRenderer.removeListener("download:progress", listener);
    };
  },
});
