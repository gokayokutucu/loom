import { app, BrowserWindow, ipcMain, nativeImage, shell, systemPreferences } from "electron";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppLogger } from "./app-logger.mjs";
import { LoomServiceSidecarManager } from "./sidecar-manager.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.cjs");
const devServerUrl = process.env.LOOM_ELECTRON_DEV_SERVER_URL;

let mainWindow;
let sidecar;
let quitInProgress = false;
const appSessionId = crypto.randomUUID();
let appLogger;

function sanitizeLogValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (depth >= 3) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeLogValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([key, entry]) => [key, sanitizeLogValue(entry, depth + 1)])
    );
  }
  return String(value);
}

function sanitizeRendererLogPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  return sanitizeLogValue(payload);
}

function getAppIconPath() {
  const extension = process.platform === "darwin" ? "icns" : "ico";
  return app.isPackaged
    ? path.join(process.resourcesPath, `loom_logo.${extension}`)
    : path.join(repoRoot, "public", `loom_logo.${extension}`);
}

function getAppIcon() {
  const icon = nativeImage.createFromPath(getAppIconPath());
  return icon.isEmpty() ? null : icon;
}

function loadingHtml(message = "The local loom-service sidecar is starting. The app will open when the runtime is ready.") {
  const escapedMessage = String(message)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Loom</title>
      <style>
        :root { color-scheme: dark; }
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: #101112;
          color: #f4f1eb;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        main {
          width: min(440px, calc(100vw - 48px));
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
        }
        h1 { margin: 0 0 8px; font-size: 20px; letter-spacing: 0; }
        p { margin: 0; color: rgba(244, 241, 235, 0.72); line-height: 1.5; }
      </style>
    </head>
    <body>
      <main>
        <h1>Starting Loom runtime</h1>
        <p>${escapedMessage}</p>
      </main>
    </body>
  </html>`;
}

function errorHtml(message) {
  const escaped = String(message)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Loom runtime error</title>
      <style>
        :root { color-scheme: dark; }
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: #101112;
          color: #f4f1eb;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        main {
          width: min(560px, calc(100vw - 48px));
          border: 1px solid rgba(255, 112, 72, 0.45);
          background: rgba(255, 112, 72, 0.08);
          border-radius: 12px;
          padding: 24px;
        }
        h1 { margin: 0 0 8px; font-size: 20px; letter-spacing: 0; }
        p { margin: 0; color: rgba(244, 241, 235, 0.78); line-height: 1.5; }
        code { color: #ff8b61; }
      </style>
    </head>
    <body>
      <main>
        <h1>Local runtime could not start</h1>
        <p><code>${escaped}</code></p>
      </main>
    </body>
  </html>`;
}

function createWindow(runtimeStatus) {
  const serviceUrl = runtimeStatus.serviceUrl ?? "http://127.0.0.1:17633";
  const appIcon = getAppIcon();
  appLogger?.info("window.create", {
    serviceUrl,
    runtimeState: runtimeStatus?.state,
  });
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "Loom",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: "#101112",
    icon: appIcon ? getAppIconPath() : undefined,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
      additionalArguments: [`--loom-service-url=${serviceUrl}`],
    },
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission !== "media") {
      callback(false);
      return;
    }
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    callback(mediaTypes.length === 0 || mediaTypes.includes("audio"));
  });

  mainWindow.once("ready-to-show", () => {
    appLogger?.info("window.ready_to_show");
    mainWindow?.show();
  });

  const startupMessage =
    runtimeStatus?.state === "draining"
      ? "Finishing previous response..."
      : undefined;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml(startupMessage))}`);
  return mainWindow;
}

async function loadRenderer() {
  if (!mainWindow) return;
  if (devServerUrl) {
    appLogger?.info("renderer.load.dev", { url: devServerUrl });
    await mainWindow.loadURL(devServerUrl);
    return;
  }
  appLogger?.info("renderer.load.file", { file: path.join(repoRoot, "dist", "index.html") });
  await mainWindow.loadFile(path.join(repoRoot, "dist", "index.html"));
}

ipcMain.handle("loom:runtime-status", async () => {
  if (!sidecar) return { state: "unavailable", startedByElectron: false };
  return sidecar.refreshStatus();
});

ipcMain.handle("loom:runtime-restart", async () => {
  if (!sidecar) return { state: "unavailable", startedByElectron: false };
  const status = await sidecar.restart({
    onRestarting: (restartStatus) => {
      mainWindow?.webContents.send("loom:runtime-status-changed", restartStatus);
    },
  });
  mainWindow?.webContents.send("loom:runtime-status-changed", status);
  return status;
});

ipcMain.handle("loom:app-log", (_event, payload) => {
  const entry = sanitizeRendererLogPayload(payload);
  const level = entry.level === "warn" || entry.level === "error" ? entry.level : "info";
  const event = typeof entry.event === "string" ? entry.event : "renderer.event";
  const data = entry.data && typeof entry.data === "object" ? entry.data : {};
  appLogger?.[level](event, {
    source: "renderer",
    ...data,
  });
});

ipcMain.handle("loom:window-minimize", () => {
  BrowserWindow.getFocusedWindow()?.minimize();
});

ipcMain.handle("loom:window-toggle-maximize", () => {
  const window = BrowserWindow.getFocusedWindow();
  if (!window) return;
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.handle("loom:window-close", () => {
  BrowserWindow.getFocusedWindow()?.close();
});

ipcMain.handle("loom:microphone-permission-status", () => {
  if (process.platform !== "darwin") {
    return { platform: process.platform, status: "unsupported" };
  }
  return {
    platform: process.platform,
    status: systemPreferences.getMediaAccessStatus("microphone"),
  };
});

ipcMain.handle("loom:open-microphone-settings", async () => {
  if (process.platform !== "darwin") {
    return { platform: process.platform, opened: false, status: "unsupported" };
  }
  await shell.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
  );
  return {
    platform: process.platform,
    opened: true,
    status: systemPreferences.getMediaAccessStatus("microphone"),
  };
});

app.whenReady().then(async () => {
  appLogger = createAppLogger({ app, sessionId: appSessionId });
  appLogger.info("app.session_started", {
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    pid: process.pid,
    repoRoot,
    devServerUrl,
  });
  const appIcon = getAppIcon();
  if (process.platform === "darwin" && appIcon && app.dock) {
    app.dock.setIcon(appIcon);
  }

  sidecar = new LoomServiceSidecarManager({ app, repoRoot, logger: appLogger });
  try {
    const runtimeStatus = await sidecar.start({
      onStarting: (startingStatus) => {
        createWindow(startingStatus);
      },
    });
    if (mainWindow?.webContents) {
      mainWindow.webContents.send("loom:runtime-ready", runtimeStatus);
    }
    appLogger.info("app.runtime_ready", {
      serviceUrl: runtimeStatus.serviceUrl,
      pid: runtimeStatus.pid,
      startedByElectron: runtimeStatus.startedByElectron,
    });
    await loadRenderer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLogger.error("app.start_failed", { error });
    if (!mainWindow) createWindow({ serviceUrl: undefined });
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml(message))}`);
    mainWindow.show();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && sidecar) {
      createWindow(sidecar.getStatus());
      loadRenderer().catch((error) => {
        console.error("failed to load Loom renderer", error);
      });
    }
  });
});

app.on("before-quit", async (event) => {
  if (quitInProgress) return;
  if (!sidecar || sidecar.getStatus().state === "stopped") return;
  event.preventDefault();
  quitInProgress = true;
  appLogger?.info("app.before_quit", { runtimeState: sidecar.getStatus().state });
  try {
    await sidecar.stop();
  } finally {
    appLogger?.info("app.session_ended");
    sidecar = null;
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
