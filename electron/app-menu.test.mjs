import { describe, expect, it, vi } from "vitest";
import {
  buildAppMenuTemplate,
  focusWindowForSettings,
  LOOM_APP_NAME,
  LOOM_OPEN_SETTINGS_CHANNEL,
  sendOpenSettingsToWindow,
} from "./app-menu.mjs";

describe("Electron macOS app menu", () => {
  it("uses Loom as the visible app name", () => {
    expect(LOOM_APP_NAME).toBe("Loom");
    const [appMenu] = buildAppMenuTemplate({ platform: "darwin" });

    expect(appMenu.label).toBe("Loom");
    expect(appMenu.submenu[0]).toMatchObject({
      role: "about",
      label: "About Loom",
    });
    expect(appMenu.submenu).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "hide", label: "Hide Loom" }),
        expect.objectContaining({ role: "quit", label: "Quit Loom" }),
      ])
    );
  });

  it("places Settings under About with the macOS shortcut", () => {
    const onOpenSettings = vi.fn();
    const [appMenu] = buildAppMenuTemplate({ onOpenSettings, platform: "darwin" });
    const settingsItem = appMenu.submenu[1];

    expect(settingsItem).toMatchObject({
      label: "Settings…",
      accelerator: "CommandOrControl+,",
      click: onOpenSettings,
    });
    expect(appMenu.submenu[2]).toMatchObject({ type: "separator" });
    expect(appMenu.submenu[3]).toMatchObject({ role: "services" });
  });

  it("focuses the main window and sends the open settings event", () => {
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      isVisible: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        send: vi.fn(),
      },
    };

    expect(focusWindowForSettings(window)).toBe(true);
    expect(window.restore).toHaveBeenCalled();
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();

    expect(sendOpenSettingsToWindow(window)).toBe(true);
    expect(window.webContents.send).toHaveBeenCalledWith(LOOM_OPEN_SETTINGS_CHANNEL);
  });
});
