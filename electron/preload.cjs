const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  chooseOutputFolder: () => ipcRenderer.invoke("dialog:chooseOutputFolder"),
  downloadVideo: (payload) => ipcRenderer.invoke("download:start", payload),
  onDownloadProgress: (callback) => {
    const listener = (_, update) => callback(update);
    ipcRenderer.on("download:progress", listener);

    return () => {
      ipcRenderer.removeListener("download:progress", listener);
    };
  },
});
