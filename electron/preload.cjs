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
  windowControls: {
    minimize: () => ipcRenderer.invoke("loom:window-minimize"),
    toggleMaximize: () => ipcRenderer.invoke("loom:window-toggle-maximize"),
    close: () => ipcRenderer.invoke("loom:window-close"),
  },
});
