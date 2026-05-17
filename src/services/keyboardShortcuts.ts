import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowRight,
  Home,
  Keyboard,
  LocateFixed,
  Plus,
  RefreshCw,
  Square,
} from "lucide-react";

export type ShortcutPlatform = "apple" | "windows";

export type KeyboardCommandId =
  | "focus-address-bar"
  | "new-loom"
  | "back"
  | "forward"
  | "reload"
  | "home"
  | "stop";

export interface KeyboardShortcutDefinition {
  id: KeyboardCommandId;
  title: string;
  description: string;
  category: "Navigation" | "Loom";
  mac: string[];
  windows: string[];
  Icon: LucideIcon;
}

export const keyboardShortcutDefinitions: KeyboardShortcutDefinition[] = [
  {
    id: "focus-address-bar",
    title: "Focus Address Bar",
    description: "Search Looms, paste a Loom address, or start from free text.",
    category: "Navigation",
    mac: ["Command", "Option", "F"],
    windows: ["Ctrl", "Alt", "F"],
    Icon: LocateFixed,
  },
  {
    id: "new-loom",
    title: "New Loom",
    description: "Open a clean Loom draft and place focus in the prompt.",
    category: "Loom",
    mac: ["Command", "L"],
    windows: ["Ctrl", "L"],
    Icon: Plus,
  },
  {
    id: "back",
    title: "Back",
    description: "Move back through Loom navigation history.",
    category: "Navigation",
    mac: ["Command", "["],
    windows: ["Alt", "Left"],
    Icon: ArrowLeft,
  },
  {
    id: "forward",
    title: "Forward",
    description: "Move forward through Loom navigation history.",
    category: "Navigation",
    mac: ["Command", "]"],
    windows: ["Alt", "Right"],
    Icon: ArrowRight,
  },
  {
    id: "reload",
    title: "Reload",
    description: "Reload the current Loom app shell.",
    category: "Navigation",
    mac: ["Command", "R"],
    windows: ["Ctrl", "R"],
    Icon: RefreshCw,
  },
  {
    id: "home",
    title: "Home",
    description: "Return to the New Loom surface.",
    category: "Navigation",
    mac: ["Command", "Shift", "H"],
    windows: ["Alt", "Home"],
    Icon: Home,
  },
  {
    id: "stop",
    title: "Stop",
    description: "Stop the active Loom response when one is running.",
    category: "Loom",
    mac: ["Command", "."],
    windows: ["Esc"],
    Icon: Square,
  },
];

export function currentShortcutPlatform(): ShortcutPlatform {
  const platform =
    typeof navigator === "undefined"
      ? ""
      : `${navigator.platform} ${navigator.userAgent}`;
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "apple" : "windows";
}

export function shortcutKeysForPlatform(
  shortcut: KeyboardShortcutDefinition,
  platform = currentShortcutPlatform()
) {
  return platform === "apple" ? shortcut.mac : shortcut.windows;
}

export function displayKeyLabel(key: string, platform = currentShortcutPlatform()) {
  if (platform === "apple") {
    switch (key) {
      case "Command":
        return "⌘";
      case "Option":
      case "Alt":
        return "⌥";
      case "Shift":
        return "⇧";
      case "Left":
        return "←";
      case "Right":
        return "→";
      default:
        return key;
    }
  }
  switch (key) {
    case "Left":
      return "←";
    case "Right":
      return "→";
    default:
      return key;
  }
}

export function shortcutLabel(
  shortcut: KeyboardShortcutDefinition,
  platform = currentShortcutPlatform()
) {
  return shortcutKeysForPlatform(shortcut, platform)
    .map((key) => displayKeyLabel(key, platform))
    .join(" ");
}

export function compactShortcutLabel(
  shortcut: KeyboardShortcutDefinition,
  platform = currentShortcutPlatform()
) {
  return shortcutLabel(shortcut, platform);
}

export function primaryShortcutLabel(commandId: KeyboardCommandId) {
  const shortcut = keyboardShortcutDefinitions.find((item) => item.id === commandId);
  return shortcut ? shortcutLabel(shortcut) : "";
}

export function primaryCompactShortcutLabel(commandId: KeyboardCommandId) {
  const shortcut = keyboardShortcutDefinitions.find((item) => item.id === commandId);
  return shortcut ? compactShortcutLabel(shortcut) : "";
}

export function matchesKeyboardCommand(
  event: KeyboardEvent,
  commandId: KeyboardCommandId,
  platform = currentShortcutPlatform()
) {
  const key = event.key.toLowerCase();
  const isApple = platform === "apple";
  switch (commandId) {
    case "focus-address-bar":
      return isApple
        ? event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey && key === "f"
        : event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey && key === "f";
    case "new-loom":
      return isApple
        ? event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && key === "l"
        : event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && key === "l";
    case "back":
      return isApple
        ? event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && key === "["
        : event.altKey && !event.ctrlKey && !event.metaKey && key === "arrowleft";
    case "forward":
      return isApple
        ? event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && key === "]"
        : event.altKey && !event.ctrlKey && !event.metaKey && key === "arrowright";
    case "reload":
      return isApple
        ? event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && key === "r"
        : event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && key === "r";
    case "home":
      return isApple
        ? event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey && key === "h"
        : event.altKey && !event.ctrlKey && !event.metaKey && key === "home";
    case "stop":
      return isApple
        ? event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && key === "."
        : !event.metaKey && !event.ctrlKey && !event.altKey && key === "escape";
    default:
      return false;
  }
}

export const KeyboardShortcutsIcon = Keyboard;
