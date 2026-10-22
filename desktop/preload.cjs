const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("textai", Object.freeze({
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  clearApiKey: () => ipcRenderer.invoke("settings:clear-key"),
  generate: (text) => ipcRenderer.invoke("textai:generate", text),
  hide: () => ipcRenderer.send("window:hide"),
  quit: () => ipcRenderer.send("app:quit"),
  onSelection: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("textai:selection", listener);
    return () => ipcRenderer.removeListener("textai:selection", listener);
  },
  onStream: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("textai:stream", listener);
    return () => ipcRenderer.removeListener("textai:stream", listener);
  },
}));
