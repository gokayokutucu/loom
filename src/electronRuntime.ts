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
  dataMode?: "shared-dev" | "isolated-dev" | "packaged";
  health?: unknown;
  error?: string;
  startedByElectron?: boolean;
  lastCheckedAt?: string;
  previousServiceUrl?: string;
  serviceUrlChanged?: boolean;
}

interface LoomDesktopBridge {
  getRuntimeInfo: () => LoomDesktopRuntimeInfo;
  runtime?: {
    status: () => Promise<LoomDesktopRuntimeStatus>;
    restart: () => Promise<LoomDesktopRuntimeStatus>;
  };
  runtimeStatus?: () => Promise<unknown>;
  windowControls?: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
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
