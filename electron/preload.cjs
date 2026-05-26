const { contextBridge, ipcRenderer } = require("electron");

function getServiceUrl() {
  const prefix = "--loom-service-url=";
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "http://127.0.0.1:17633";
}

const runtimeInfo = Object.freeze({
  isElectron: true,
  platform: process.platform,
  serviceUrl: getServiceUrl(),
});

window.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("loom-electron-shell");
});

contextBridge.exposeInMainWorld("loomDesktop", {
  getRuntimeInfo: () => runtimeInfo,
  runtime: {
    status: () => ipcRenderer.invoke("loom:runtime-status"),
    restart: () => ipcRenderer.invoke("loom:runtime-restart"),
  },
  runtimeStatus: () => ipcRenderer.invoke("loom:runtime-status"),
  logs: {
    info: (event, data) => ipcRenderer.invoke("loom:app-log", { level: "info", event, data }),
    warn: (event, data) => ipcRenderer.invoke("loom:app-log", { level: "warn", event, data }),
    error: (event, data) => ipcRenderer.invoke("loom:app-log", { level: "error", event, data }),
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke("loom:window-minimize"),
    toggleMaximize: () => ipcRenderer.invoke("loom:window-toggle-maximize"),
    close: () => ipcRenderer.invoke("loom:window-close"),
  },
  permissions: {
    microphoneStatus: () => ipcRenderer.invoke("loom:microphone-permission-status"),
    openMicrophoneSettings: () => ipcRenderer.invoke("loom:open-microphone-settings"),
  },
  addressBar: {
    showContextMenu: (params) =>
      ipcRenderer.invoke("loom:address-bar-context-menu", params),
  },
  attachments: {
    openPath: (tempPath) => ipcRenderer.invoke("loom:open-attachment-path", tempPath),
  },
});
