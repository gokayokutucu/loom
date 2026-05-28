export interface LoomDesktopRuntimeInfo {
  isElectron: boolean;
  platform: "aix" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd" | "web";
  serviceUrl?: string;
}

export interface LoomDesktopRuntimeStatus {
  state:
    | "stopped"
    | "starting"
    | "ready"
    | "restarting"
    | "stopping"
    | "error"
    | "exited"
    | "unavailable";
  serviceUrl?: string;
  pid?: number;
  port?: number;
  binaryPath?: string;
  configPath?: string;
  dbPath?: string;
  dataMode?: "dev" | "packaged";
  health?: unknown;
  error?: string;
  startedByElectron?: boolean;
  appSessionId?: string;
  logPath?: string;
  lastCheckedAt?: string;
  previousServiceUrl?: string;
  serviceUrlChanged?: boolean;
}

export interface LoomDesktopMicrophonePermissionStatus {
  platform: LoomDesktopRuntimeInfo["platform"];
  status:
    | "not-determined"
    | "granted"
    | "denied"
    | "restricted"
    | "unknown"
    | "unsupported";
  opened?: boolean;
}

import type {
  AddressBarContextMenuParams,
  AddressBarContextMenuResult,
} from "./services/addressBarContextMenu";
import type {
  ComposerContextMenuParams,
  ComposerContextMenuResult,
} from "./services/composerContextMenu";

interface LoomDesktopBridge {
  getRuntimeInfo: () => LoomDesktopRuntimeInfo;
  runtime?: {
    status: () => Promise<LoomDesktopRuntimeStatus>;
    restart: () => Promise<LoomDesktopRuntimeStatus>;
  };
  runtimeStatus?: () => Promise<unknown>;
  logs?: {
    info: (event: string, data?: Record<string, unknown>) => Promise<void>;
    warn: (event: string, data?: Record<string, unknown>) => Promise<void>;
    error: (event: string, data?: Record<string, unknown>) => Promise<void>;
  };
  windowControls?: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
  };
  permissions?: {
    microphoneStatus: () => Promise<LoomDesktopMicrophonePermissionStatus>;
    openMicrophoneSettings: () => Promise<LoomDesktopMicrophonePermissionStatus>;
  };
  addressBar?: {
    showContextMenu: (
      params: AddressBarContextMenuParams
    ) => Promise<AddressBarContextMenuResult>;
  };
  composer?: {
    showContextMenu: (
      params: ComposerContextMenuParams
    ) => Promise<ComposerContextMenuResult>;
  };
  attachments?: {
    openPath: (tempPath: string) => Promise<{ opened: boolean; error?: string }>;
  };
  appMenu?: {
    onOpenSettings: (callback: () => void) => () => void;
  };
}

declare global {
  interface Window {
    loomDesktop?: LoomDesktopBridge;
  }
}

export function getElectronRuntimeInfo(): LoomDesktopRuntimeInfo | null {
  if (typeof window === "undefined") return null;
  const bridge = window.loomDesktop;
  if (!bridge) return null;
  try {
    return bridge.getRuntimeInfo();
  } catch {
    return null;
  }
}

export function getElectronLoomServiceUrl(): string | null {
  const runtime = getElectronRuntimeInfo();
  if (!runtime?.isElectron || !runtime.serviceUrl) return null;
  return runtime.serviceUrl;
}

export function getElectronWindowControls() {
  if (typeof window === "undefined") return null;
  return window.loomDesktop?.windowControls ?? null;
}

export function getElectronRuntimeBridge() {
  if (typeof window === "undefined") return null;
  return window.loomDesktop?.runtime ?? null;
}

export function getElectronPermissionsBridge() {
  if (typeof window === "undefined") return null;
  return window.loomDesktop?.permissions ?? null;
}

export function getElectronAddressBarBridge() {
  if (typeof window === "undefined") return null;
  return window.loomDesktop?.addressBar ?? null;
}

export function getElectronAttachmentsBridge() {
  if (typeof window === "undefined") return null;
  return window.loomDesktop?.attachments ?? null;
}

export function getElectronComposerBridge() {
  if (typeof window === "undefined") return null;
  return window.loomDesktop?.composer ?? null;
}

export function getElectronAppMenuBridge() {
  if (typeof window === "undefined") return null;
  return window.loomDesktop?.appMenu ?? null;
}

export function logElectronEvent(
  level: "info" | "warn" | "error",
  event: string,
  data?: Record<string, unknown>
) {
  if (typeof window === "undefined") return;
  const logs = window.loomDesktop?.logs;
  if (!logs) return;
  void logs[level](event, data).catch(() => undefined);
}
