import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, shell, systemPreferences } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAppMenuTemplate,
  LOOM_APP_NAME,
  sendOpenSettingsToWindow,
} from "./app-menu.mjs";
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

app.setName(LOOM_APP_NAME);

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

function installApplicationMenu() {
  const template = buildAppMenuTemplate({
    appName: LOOM_APP_NAME,
    onOpenSettings: () => {
      sendOpenSettingsToWindow(mainWindow);
    },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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

function windowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(windowStatePath(), "utf8");
    const state = JSON.parse(raw);
    if (
      typeof state.width === "number" && state.width >= 980 &&
      typeof state.height === "number" && state.height >= 680
    ) {
      return state;
    }
  } catch {
    // no saved state yet
  }
  return null;
}

function saveWindowState(window) {
  try {
    const isMaximized = window.isMaximized();
    const bounds = window.getNormalBounds();
    fs.writeFileSync(windowStatePath(), JSON.stringify({ ...bounds, isMaximized }), "utf8");
  } catch {
    // ignore
  }
}

function createWindow(runtimeStatus) {
  const serviceUrl = runtimeStatus.serviceUrl ?? "http://127.0.0.1:17633";
  const appIcon = getAppIcon();
  const savedState = loadWindowState();
  appLogger?.info("window.create", {
    serviceUrl,
    runtimeState: runtimeStatus?.state,
  });
  mainWindow = new BrowserWindow({
    width: savedState?.width ?? 1280,
    height: savedState?.height ?? 860,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: 980,
    minHeight: 680,
    title: "Loom",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: "#101112",
    icon: appIcon ? getAppIconPath() : undefined,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
      additionalArguments: [`--loom-service-url=${serviceUrl}`],
    },
  });

  if (savedState?.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission !== "media") {
      callback(false);
      return;
    }
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    callback(mediaTypes.length === 0 || mediaTypes.includes("audio"));
  });

  mainWindow.on("close", () => {
    if (mainWindow) saveWindowState(mainWindow);
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

// Full database wipe: stops the service (killing external dev/manual processes if needed),
// physically deletes the DB file, then restarts a fresh service.
// Used by the "Reset DB" action to guarantee data cannot survive a restart.
ipcMain.handle("loom:db-wipe", async () => {
  if (!sidecar) return { ok: false, error: "no sidecar available" };

  const currentStatus = sidecar.getStatus();
  const { dbPath, pid, startedByElectron, serviceUrl } = currentStatus;

  appLogger?.info("db_wipe.requested", { dbPath, pid, startedByElectron });

  // Step 1: Best-effort hard-reset via HTTP to flush WAL pages cleanly.
  // Ignore failures — the DB might be empty/broken (no tables) which is fine.
  if (serviceUrl) {
    await fetch(`${serviceUrl}/hard-reset`, { method: "POST" }).catch(() => undefined);
  }

  // Step 2: Stop the sidecar. For Electron-owned processes this sends a
  // graceful drain-shutdown and waits. For external dev/manual services it
  // just marks the local state as stopped (we kill the process below).
  await sidecar.stop().catch(() => undefined);

  // Step 3: Kill external dev/manual process so the port is freed.
  // (sidecar.stop() deliberately leaves externally-started processes alive.)
  if (!startedByElectron && pid) {
    try {
      process.kill(Number(pid), "SIGTERM");
      appLogger?.info("db_wipe.sigterm_sent", { pid });
    } catch {
      // Already dead — that's fine.
    }
    // Wait up to 3 s for the process to exit gracefully.
    const deadline = Date.now() + 3000;
    let dead = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        process.kill(Number(pid), 0); // Signal 0 = existence check
      } catch {
        dead = true;
        break;
      }
    }
    if (!dead) {
      // Force-kill if it's still alive after the grace period.
      try {
        process.kill(Number(pid), "SIGKILL");
        appLogger?.warn("db_wipe.sigkill_sent", { pid });
      } catch {}
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  // Step 4: Physically delete the DB and its WAL/SHM sidecar files.
  // dbPath here is the path Electron resolves via resolveElectronDataPaths
  // (.data/dev/loom.db in dev mode) — the file a freshly-spawned service
  // would use — so deleting it is correct even when attached to an external
  // process that happened to be using a different (stale) DB.
  if (dbPath) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(dbPath + suffix, { force: true });
      } catch {}
    }
    appLogger?.info("db_wipe.files_deleted", { dbPath });
  }

  // Step 5: Start a fresh service. Electron will spawn its own child this
  // time (port is free, no lock file) and pass LOOM_SERVICE_DB_PATH so the
  // service uses the correct path and runs migrations on the empty file.
  try {
    const newStatus = await sidecar.start({
      onStarting: (s) => mainWindow?.webContents.send("loom:runtime-status-changed", s),
    });
    mainWindow?.webContents.send("loom:runtime-status-changed", newStatus);
    appLogger?.info("db_wipe.completed", { serviceUrl: newStatus.serviceUrl });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLogger?.error("db_wipe.restart_failed", { error });
    return { ok: false, error: message };
  }
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

// Address bar context menu — shows a native OS menu with text-editing actions
// plus Loom-specific address actions (Paste and Go, Copy Clean Link).
ipcMain.handle("loom:address-bar-context-menu", (event, params) => {
  const clipboardText = clipboard.readText();
  const trimmedClipboard = clipboardText.trim();
  const isLoomClipboard = trimmedClipboard.startsWith("loom://");
  const hasClipboard = clipboardText.length > 0;
  const { hasText = false, hasSelection = false, allSelected = false, hasLoomAddress = false } = params ?? {};

  return new Promise((resolve) => {
    const send = (action) => () => resolve({ action, clipboardText });

    /** @type {import("electron").MenuItemConstructorOptions[]} */
    const template = [
      // Standard edit actions
      // NOTE: exact undo/redo state is not detectable from the renderer —
      // included unconditionally; the browser engine no-ops if no history.
      { label: "Undo", accelerator: "CmdOrCtrl+Z", click: send("undo") },
      { label: "Redo", accelerator: process.platform === "darwin" ? "CmdOrCtrl+Shift+Z" : "CmdOrCtrl+Y", click: send("redo") },
      { type: "separator" },
      { label: "Cut", accelerator: "CmdOrCtrl+X", enabled: hasSelection, click: send("cut") },
      { label: "Copy", accelerator: "CmdOrCtrl+C", enabled: hasSelection, click: send("copy") },
      // Paste: always show; enable when clipboard has text (Clipboard API may
      // not be accessible in main process for permission reasons on some OSes,
      // so we fall back to enabled=true when clipboardText is unavailable).
      { label: "Paste", accelerator: "CmdOrCtrl+V", enabled: hasClipboard || true, click: send("paste") },
      { label: "Delete", enabled: hasSelection, click: send("delete") },
      { type: "separator" },
      // Select All: disable if input is empty or already fully selected
      { label: "Select All", accelerator: "CmdOrCtrl+A", enabled: hasText && !allSelected, click: send("selectAll") },
    ];

    // Loom-specific: Paste and Go / Paste and Go to Loom
    if (hasClipboard) {
      template.push({ type: "separator" });
      if (isLoomClipboard) {
        const preview = trimmedClipboard.length > 50
          ? trimmedClipboard.slice(0, 50) + "…"
          : trimmedClipboard;
        template.push({
          label: `Paste and Go to Loom: ${preview}`,
          click: send("pasteAndGoToLoom"),
        });
      } else {
        template.push({ label: "Paste and Go", click: send("pasteAndGo") });
      }
    }

    // Copy Clean Link: only when the current address is a loom:// URL
    if (hasLoomAddress) {
      template.push({ type: "separator" });
      template.push({ label: "Copy Clean Link", click: send("copyCleanLink") });
    }

    const menu = Menu.buildFromTemplate(template);
    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender),
      callback: () => resolve({ action: "none", clipboardText }),
    });
  });
});

// Prompt-editor (contentEditable composer) right-click context menu.
// Provides standard text-editing actions: cut, copy, paste, delete, select all.
ipcMain.handle("loom:composer-context-menu", (event, params) => {
  const clipboardText = clipboard.readText();
  const hasClipboard = clipboardText.length > 0;
  const { hasSelection = false, hasContent = false } = params ?? {};

  return new Promise((resolve) => {
    const send = (action) => () => resolve({ action, clipboardText });

    /** @type {import("electron").MenuItemConstructorOptions[]} */
    const template = [
      { label: "Cut",       accelerator: "CmdOrCtrl+X", enabled: hasSelection, click: send("cut") },
      { label: "Copy",      accelerator: "CmdOrCtrl+C", enabled: hasSelection, click: send("copy") },
      { label: "Paste",     accelerator: "CmdOrCtrl+V", enabled: hasClipboard,  click: send("paste") },
      { label: "Delete",    enabled: hasSelection, click: send("delete") },
      { type: "separator" },
      { label: "Select All", accelerator: "CmdOrCtrl+A", enabled: hasContent, click: send("selectAll") },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender),
      callback: () => resolve({ action: "none", clipboardText }),
    });
  });
});

// Opens a materialized attachment temp-file path using the OS default app.
// Only accepts absolute paths under the OS temp directory to prevent
// the renderer from opening arbitrary filesystem paths.
ipcMain.handle("loom:open-attachment-path", async (_event, tempPath) => {
  if (typeof tempPath !== "string") {
    return { opened: false, error: "invalid path" };
  }
  const normalizedPath = path.normalize(tempPath);
  const tempDir = path.normalize(os.tmpdir());
  if (!normalizedPath.startsWith(tempDir + path.sep) && normalizedPath !== tempDir) {
    return { opened: false, error: "path outside temp directory" };
  }
  if (!fs.existsSync(normalizedPath)) {
    return { opened: false, error: "file not found" };
  }
  const error = await shell.openPath(normalizedPath);
  if (error) {
    return { opened: false, error };
  }
  return { opened: true };
});

app.whenReady().then(async () => {
  installApplicationMenu();
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
