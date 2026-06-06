const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zefoxBridge", {
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  getStatus: () => ipcRenderer.invoke("bridge:getStatus"),
  setPresenceEnabled: (enabled) => ipcRenderer.invoke("bridge:setPresenceEnabled", enabled),
  setAccountDisplayEnabled: (enabled) => ipcRenderer.invoke("bridge:setAccountDisplayEnabled", enabled),
  start: () => ipcRenderer.invoke("bridge:start"),
  stop: () => ipcRenderer.invoke("bridge:stop"),
  onStatus: (callback) => {
    ipcRenderer.on("bridge:status", (_event, status) => callback(status));
  },
  onError: (callback) => {
    ipcRenderer.on("bridge:error", (_event, message) => callback(message));
  },
  onLog: (callback) => {
    ipcRenderer.on("bridge:log", (_event, message) => callback(message));
  },
});
