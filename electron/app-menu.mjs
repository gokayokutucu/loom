export const LOOM_APP_NAME = "Loom";
export const LOOM_OPEN_SETTINGS_CHANNEL = "loom:open-settings";

export function focusWindowForSettings(window) {
  if (!window || window.isDestroyed?.()) return false;
  if (window.isMinimized?.()) window.restore();
  if (!window.isVisible?.()) window.show();
  window.focus?.();
  return true;
}

export function sendOpenSettingsToWindow(window) {
  if (!focusWindowForSettings(window)) return false;
  window.webContents?.send?.(LOOM_OPEN_SETTINGS_CHANNEL);
  return true;
}

export function buildAppMenuTemplate({ appName = LOOM_APP_NAME, onOpenSettings, platform = process.platform } = {}) {
  const appMenu = [
    { role: "about", label: `About ${appName}` },
    {
      label: "Settings…",
      accelerator: "CommandOrControl+,",
      click: onOpenSettings,
    },
    { type: "separator" },
    { role: "services" },
    { type: "separator" },
    { role: "hide", label: `Hide ${appName}` },
    { role: "hideOthers" },
    { role: "unhide" },
    { type: "separator" },
    { role: "quit", label: `Quit ${appName}` },
  ];

  const template = [
    ...(platform === "darwin"
      ? [
          {
            label: appName,
            submenu: appMenu,
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(platform === "darwin"
          ? [{ type: "separator" }, { role: "front" }]
          : [{ role: "close" }]),
      ],
    },
  ];

  return template;
}
