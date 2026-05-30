import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  createSidecarLifecycleState,
  sidecarEventForBinaryResolution,
  sidecarEventForPortAvailability,
  transitionSidecarLifecycle,
} from "./sidecar-lifecycle.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17633;
const HEALTH_TIMEOUT_MS = 20_000;
const RUNTIME_LOCK_FILENAME = "loom-service-runtime.lock.json";
const DEFAULT_GRACEFUL_DRAIN_TIMEOUT_MS = 120_000;
const DEFAULT_ORPHAN_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_QUIT_WAIT_TIMEOUT_MS = 5_000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findAvailablePort(host, preferredPort) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    if (await isPortAvailable(host, port)) return port;
  }
  throw new Error(`No available local loom-service port starting at ${preferredPort}.`);
}

async function fetchHealth(serviceUrl) {
  const response = await fetch(`${serviceUrl}/health`);
  if (!response.ok) {
    throw new Error(`/health returned HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchRuntimeStatus(serviceUrl) {
  const response = await fetch(`${serviceUrl}/runtime/status`);
  if (!response.ok) {
    throw new Error(`/runtime/status returned HTTP ${response.status}`);
  }
  return response.json();
}

async function requestDrainShutdown(serviceUrl, timeoutMs, reason = "electron_quit") {
  const response = await fetch(`${serviceUrl}/runtime/shutdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "drain", reason, timeoutMs }),
  });
  if (!response.ok) {
    throw new Error(`/runtime/shutdown returned HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForServiceExit(serviceUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetchRuntimeStatus(serviceUrl);
    } catch {
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function waitForHealth(serviceUrl, timeoutMs = HEALTH_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = new Error("loom-service health check has not run yet.");
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await fetchHealth(serviceUrl);
      if (
        health?.runtime === "loom-service" &&
        health?.database?.status === "ready" &&
        health?.config?.status === "ready"
      ) {
        return health;
      }
      lastError = new Error(`loom-service not ready: ${JSON.stringify(health)}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError;
}

function resolveRepoRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
}

function resolvePackagedBinaryPath() {
  return path.join(process.resourcesPath, "loom-service", "loom-service");
}

function isPackagedRuntime() {
  return fs.existsSync(resolvePackagedBinaryPath());
}

function readDevRuntimeMetadata(repoRoot) {
  const metadataPath = path.join(repoRoot, "electron-dev-runtime.json");
  if (!fs.existsSync(metadataPath)) return null;
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    if (metadata?.kind !== "loom-electron-dev-runtime") return null;
    if (typeof metadata.repoRoot !== "string" || metadata.repoRoot.length === 0) return null;
    return { repoRoot: metadata.repoRoot };
  } catch {
    return null;
  }
}

function resolveBinaryPath(repoRoot, app) {
  if (app?.isPackaged || isPackagedRuntime()) {
    return resolvePackagedBinaryPath();
  }
  return path.join(repoRoot, "services", "loom-service", "target", "debug", "loom-service");
}

function resolveElectronDataPaths(repoRoot, app) {
  // Production (packaged build): use Electron's userData directory.
  // On macOS this is ~/Library/Application Support/<AppName>/loom-service/
  if (app?.isPackaged || isPackagedRuntime()) {
    const dataDir = path.join(app.getPath("userData"), "loom-service");
    return {
      dataMode: "packaged",
      dataDir,
      configPath: path.join(dataDir, "loom-service.toml"),
      dbPath: path.join(dataDir, "loom.db"),
    };
  }

  // Development: always use services/loom-service/.data/dev/
  // electron-dev-runtime.json can override the repo root (used by packaged dev builds).
  const devRuntime = readDevRuntimeMetadata(repoRoot);
  const actualRepoRoot = devRuntime?.repoRoot ?? repoRoot;
  const devDir = path.join(actualRepoRoot, "services", "loom-service", ".data", "dev");
  return {
    dataMode: "dev",
    dataDir: devDir,
    configPath: path.join(devDir, "loom-service.toml"),
    dbPath: path.join(devDir, "loom.db"),
  };
}

function runtimeLockPath(dataDir) {
  return path.join(dataDir, RUNTIME_LOCK_FILENAME);
}

function readRuntimeLock(dataDir) {
  const lockPath = runtimeLockPath(dataDir);
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function writeRuntimeLock(dataDir, metadata) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(runtimeLockPath(dataDir), `${JSON.stringify(metadata, null, 2)}\n`);
}

function removeRuntimeLock(dataDir, expectedPid) {
  const lockPath = runtimeLockPath(dataDir);
  if (!fs.existsSync(lockPath)) return;
  const lock = readRuntimeLock(dataDir);
  if (expectedPid && lock?.pid && Number(lock.pid) !== Number(expectedPid)) return;
  fs.rmSync(lockPath, { force: true });
}

function processExists(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function samePath(left, right) {
  if (!left || !right) return false;
  return path.resolve(left) === path.resolve(right);
}

function canAttachExternalRuntime(runtimeStatus) {
  return (
    runtimeStatus?.lifecycleState === "ready" &&
    (runtimeStatus.runtimeOwnerKind === "dev" || runtimeStatus.runtimeOwnerKind === "manual")
  );
}

export class LoomServiceSidecarManager {
  constructor({ app, repoRoot = resolveRepoRoot(), preferredPort = DEFAULT_PORT, logger } = {}) {
    this.app = app;
    this.repoRoot = repoRoot;
    this.preferredPort = Number(process.env.LOOM_ELECTRON_SERVICE_PORT || preferredPort);
    this.host = process.env.LOOM_ELECTRON_SERVICE_HOST || DEFAULT_HOST;
    this.logger = logger;
    this.child = null;
    this.lifecycle = createSidecarLifecycleState();
    this.status = {
      state: "stopped",
      serviceUrl: undefined,
      pid: undefined,
      port: undefined,
      binaryPath: resolveBinaryPath(repoRoot, app),
      configPath: undefined,
      dbPath: undefined,
      dataMode: undefined,
      health: undefined,
      error: undefined,
      startedByElectron: false,
      appSessionId: logger?.sessionId,
      logPath: logger?.logPath,
      lastCheckedAt: undefined,
    };
  }

  getStatus() {
    return { ...this.status };
  }

  transition(event) {
    this.lifecycle = transitionSidecarLifecycle(this.lifecycle, event);
    return this.lifecycle;
  }

  async start(options = {}) {
    if (this.child && this.status.serviceUrl) return this.getStatus();

    this.transition("START_REQUESTED");
    this.logger?.info("sidecar.start_requested", {
      preferredPort: this.preferredPort,
      host: this.host,
    });
    const binaryPath = resolveBinaryPath(this.repoRoot, this.app);
    const binaryExists = fs.existsSync(binaryPath);
    const binaryTransition = this.transition(sidecarEventForBinaryResolution(binaryExists));
    if (!binaryExists) {
      this.status = {
        ...this.status,
        state: binaryTransition.state,
        binaryPath,
        error: `loom-service binary is missing at ${binaryPath}. Build it first.`,
        appSessionId: this.logger?.sessionId,
        logPath: this.logger?.logPath,
        lastCheckedAt: new Date().toISOString(),
      };
      this.logger?.error("sidecar.binary_missing", { binaryPath });
      throw new Error(`loom-service binary is missing at ${binaryPath}. Build it first.`);
    }

    const port = this.preferredPort;
    const serviceUrl = `http://${this.host}:${port}`;
    const { configPath, dbPath, dataMode } = resolveElectronDataPaths(this.repoRoot, this.app);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.status = {
      ...this.status,
      state: "starting",
      serviceUrl,
      port,
      binaryPath,
      configPath,
      dbPath,
      dataMode,
      error: undefined,
      startedByElectron: true,
      appSessionId: this.logger?.sessionId,
      logPath: this.logger?.logPath,
      lastCheckedAt: new Date().toISOString(),
    };
    this.logger?.info("sidecar.starting", {
      serviceUrl,
      binaryPath,
      configPath,
      dbPath,
      dataMode,
    });

    if (typeof options.onStarting === "function") {
      options.onStarting(this.getStatus());
    }

    const recoveredStatus = await this.recoverExistingRuntime({
      dataDir: path.dirname(configPath),
      serviceUrl,
      dbPath,
      binaryPath,
      configPath,
      dataMode,
      onStarting: options.onStarting,
    });
    if (recoveredStatus) return recoveredStatus;

    const portAvailable = await isPortAvailable(this.host, port);
    const portTransition = this.transition(sidecarEventForPortAvailability(portAvailable));
    if (!portAvailable) {
      this.status = {
        ...this.status,
        state: portTransition.state,
        error: `loom-service port ${port} is already in use by an unknown runtime. Refusing to start a second SQLite writer.`,
        appSessionId: this.logger?.sessionId,
        logPath: this.logger?.logPath,
        lastCheckedAt: new Date().toISOString(),
      };
      this.logger?.error("sidecar.port_occupied_unknown", { serviceUrl, port });
      throw new Error(
        `loom-service port ${port} is already in use by an unknown runtime. Refusing to start a second SQLite writer.`,
      );
    }

    this.child = spawn(binaryPath, {
      cwd: this.repoRoot,
      env: {
        ...process.env,
        LOOM_SERVICE_HOST: this.host,
        LOOM_SERVICE_PORT: String(port),
        LOOM_SERVICE_CONFIG_PATH: configPath,
        LOOM_SERVICE_DB_PATH: dbPath,
        LOOM_SERVICE_RUNTIME_OWNER_KIND: "electron",
        LOOM_SERVICE_RESOURCES_PATH: process.resourcesPath,
        LOOM_SERVICE_OWNER_PID: String(process.pid),
        LOOM_SERVICE_GRACEFUL_DRAIN_TIMEOUT_MS: String(DEFAULT_GRACEFUL_DRAIN_TIMEOUT_MS),
        LOOM_SERVICE_ORPHAN_IDLE_TIMEOUT_MS: String(DEFAULT_ORPHAN_IDLE_TIMEOUT_MS),
        LOOM_SERVICE_DRAIN_AFTER_OWNER_LOST: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.status.pid = this.child.pid;
    this.logger?.info("sidecar.process_spawned", {
      pid: this.child.pid,
      serviceUrl,
      binaryPath,
    });
    this.transition("PROCESS_SPAWNED");
    writeRuntimeLock(path.dirname(configPath), {
      kind: "loom-service-runtime-lock",
      runtimeOwnerKind: "electron",
      pid: this.child.pid,
      parentPid: process.pid,
      serviceUrl,
      port,
      dbPath,
      configPath,
      binaryPath,
      state: "starting",
      startedAt: new Date().toISOString(),
    });

    this.child.stdout?.on("data", (chunk) => {
      this.logger?.info("loom_service.stdout", {
        pid: this.child?.pid,
        chunk: chunk.toString(),
      });
      process.stdout.write(`[loom-service:${this.child?.pid ?? "stopped"}] ${chunk}`);
    });
    this.child.stderr?.on("data", (chunk) => {
      this.logger?.warn("loom_service.stderr", {
        pid: this.child?.pid,
        chunk: chunk.toString(),
      });
      process.stderr.write(`[loom-service:${this.child?.pid ?? "stopped"}] ${chunk}`);
    });
    this.child.once("exit", (code, signal) => {
      const wasStopping = this.status.state === "stopping";
      const exitTransition = this.transition("PROCESS_EXITED");
      removeRuntimeLock(path.dirname(configPath), this.status.pid);
      this.child = null;
      this.status = {
        ...this.status,
        state: wasStopping ? "stopped" : exitTransition.state,
        error: wasStopping ? undefined : `loom-service exited with code ${code ?? "null"} signal ${signal ?? "null"}`,
        appSessionId: this.logger?.sessionId,
        logPath: this.logger?.logPath,
        lastCheckedAt: new Date().toISOString(),
      };
      this.logger?.info("sidecar.process_exited", {
        code,
        signal,
        state: this.status.state,
      });
    });

    let health;
    try {
      health = await waitForHealth(serviceUrl);
    } catch (error) {
      const failureTransition = this.transition({
        type: "HEALTH_FAILED",
        error: error instanceof Error ? error.message : String(error),
      });
      this.status = {
        ...this.status,
        state: failureTransition.state,
        error: failureTransition.error,
        appSessionId: this.logger?.sessionId,
        logPath: this.logger?.logPath,
        lastCheckedAt: new Date().toISOString(),
      };
      this.logger?.error("sidecar.health_failed", { error });
      throw error;
    }
    this.transition("HEALTH_READY");
    const runtimeStatus = await fetchRuntimeStatus(serviceUrl).catch(() => undefined);
    writeRuntimeLock(path.dirname(configPath), {
      kind: "loom-service-runtime-lock",
      runtimeOwnerKind: runtimeStatus?.runtimeOwnerKind ?? "electron",
      lifecycleState: runtimeStatus?.lifecycleState ?? "ready",
      pid: runtimeStatus?.pid ?? this.child.pid,
      parentPid: process.pid,
      serviceUrl,
      port,
      dbPath,
      configPath,
      binaryPath,
      state: "ready",
      startedAt: runtimeStatus?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this.status = {
      ...this.status,
      state: "ready",
      health,
      runtimeStatus,
      error: undefined,
      appSessionId: this.logger?.sessionId,
      logPath: this.logger?.logPath,
      lastCheckedAt: new Date().toISOString(),
    };
    this.logger?.info("sidecar.health_ready", {
      serviceUrl,
      pid: runtimeStatus?.pid ?? this.child.pid,
      lifecycleState: runtimeStatus?.lifecycleState,
    });
    this.lifecycle = createSidecarLifecycleState("ready");
    return this.getStatus();
  }

  async recoverExistingRuntime({
    dataDir,
    serviceUrl,
    dbPath,
    binaryPath,
    configPath,
    dataMode,
    onStarting,
  }) {
    const lock = readRuntimeLock(dataDir);
    if (lock?.pid && !processExists(lock.pid)) {
      removeRuntimeLock(dataDir, lock.pid);
    }

    const lockedRuntimeAlive = lock?.pid && processExists(lock.pid);
    if (!lockedRuntimeAlive && (await isPortAvailable(this.host, this.preferredPort))) {
      return null;
    }

    const runtimeUrl = lockedRuntimeAlive ? lock.serviceUrl || serviceUrl : serviceUrl;
    let runtimeStatus;
    try {
      runtimeStatus = await fetchRuntimeStatus(runtimeUrl);
    } catch (error) {
      if (lockedRuntimeAlive) {
        throw new Error(
          `Existing loom-service process ${lock.pid} did not expose runtime status; refusing to start a second SQLite writer.`,
        );
      }
      throw new Error(
        `loom-service port ${this.preferredPort} is occupied by an unknown process; refusing to start a second SQLite writer.`,
      );
    }

    if (lockedRuntimeAlive && !samePath(lock.dbPath, dbPath)) {
      throw new Error(
        `Existing loom-service lock points at a different DB (${lock.dbPath}); refusing to attach or start another writer.`,
      );
    }

    if (runtimeStatus.runtimeOwnerKind !== "electron") {
      if (canAttachExternalRuntime(runtimeStatus)) {
        const health = await fetchHealth(runtimeUrl).catch(() => undefined);
        this.status = {
          ...this.status,
          state: "ready",
          serviceUrl: runtimeUrl,
          port: Number(lock?.port ?? this.preferredPort),
          pid: runtimeStatus.pid ?? lock?.pid,
          binaryPath,
          configPath,
          dbPath,
          dataMode,
          runtimeStatus,
          health,
          error: undefined,
          startedByElectron: false,
          appSessionId: this.logger?.sessionId,
          logPath: this.logger?.logPath,
          lastCheckedAt: new Date().toISOString(),
        };
        this.logger?.info("sidecar.attached_external_runtime", {
          serviceUrl: runtimeUrl,
          pid: runtimeStatus.pid ?? lock?.pid,
          runtimeOwnerKind: runtimeStatus.runtimeOwnerKind,
        });
        this.lifecycle = createSidecarLifecycleState("ready");
        return this.getStatus();
      }
      this.transition("PORT_OCCUPIED_UNKNOWN");
      throw new Error(
        `Existing loom-service on ${runtimeUrl} is ${runtimeStatus.runtimeOwnerKind}; Electron will not kill or replace unknown/manual runtimes.`,
      );
    }

    if (runtimeStatus.lifecycleState === "draining" || runtimeStatus.lifecycleState === "stopping") {
      this.status = {
        ...this.status,
        state: "draining",
        serviceUrl: runtimeUrl,
        port: Number(lock?.port ?? this.preferredPort),
        pid: runtimeStatus.pid ?? lock?.pid,
        binaryPath,
        configPath,
        dbPath,
        dataMode,
        runtimeStatus,
        startedByElectron: false,
        appSessionId: this.logger?.sessionId,
        logPath: this.logger?.logPath,
        lastCheckedAt: new Date().toISOString(),
      };
      this.logger?.info("sidecar.waiting_for_draining_runtime", {
        serviceUrl: runtimeUrl,
        pid: runtimeStatus.pid ?? lock?.pid,
      });
      if (typeof onStarting === "function") {
        onStarting(this.getStatus());
      }
      const exited = await waitForServiceExit(
        runtimeUrl,
        runtimeStatus.gracefulDrainTimeoutMs + DEFAULT_ORPHAN_IDLE_TIMEOUT_MS,
      );
      if (!exited) {
        throw new Error(
          "Previous Electron-owned loom-service is still draining. Refusing to start a second SQLite writer.",
        );
      }
      removeRuntimeLock(dataDir, runtimeStatus.pid ?? lock?.pid);
      return null;
    }

    this.status = {
      ...this.status,
      state: "ready",
      serviceUrl: runtimeUrl,
      port: Number(lock?.port ?? this.preferredPort),
      pid: runtimeStatus.pid ?? lock?.pid,
      binaryPath,
      configPath,
      dbPath,
      dataMode,
      runtimeStatus,
      health: await fetchHealth(runtimeUrl).catch(() => undefined),
      error: undefined,
      startedByElectron: true,
      appSessionId: this.logger?.sessionId,
      logPath: this.logger?.logPath,
      lastCheckedAt: new Date().toISOString(),
    };
    this.logger?.info("sidecar.recovered_electron_runtime", {
      serviceUrl: runtimeUrl,
      pid: runtimeStatus.pid ?? lock?.pid,
      lifecycleState: runtimeStatus.lifecycleState,
    });
    this.lifecycle = createSidecarLifecycleState("ready");
    writeRuntimeLock(dataDir, {
      ...(lock ?? {}),
      kind: "loom-service-runtime-lock",
      runtimeOwnerKind: "electron",
      lifecycleState: runtimeStatus.lifecycleState,
      pid: runtimeStatus.pid ?? lock?.pid,
      parentPid: process.pid,
      serviceUrl: runtimeUrl,
      port: Number(lock?.port ?? this.preferredPort),
      dbPath,
      configPath,
      binaryPath,
      updatedAt: new Date().toISOString(),
    });
    return this.getStatus();
  }

  async refreshStatus() {
    if (!this.status.serviceUrl) return this.getStatus();
    try {
      const health = await fetchHealth(this.status.serviceUrl);
      const runtimeStatus = await fetchRuntimeStatus(this.status.serviceUrl).catch(() => undefined);
      this.status = {
        ...this.status,
        state:
          runtimeStatus?.lifecycleState === "draining" ||
          runtimeStatus?.lifecycleState === "stopping"
            ? runtimeStatus.lifecycleState
            : this.child || this.status.startedByElectron
              ? "ready"
              : this.status.state,
        health,
        runtimeStatus,
        error: undefined,
        appSessionId: this.logger?.sessionId,
        logPath: this.logger?.logPath,
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.status = {
        ...this.status,
        state: this.child ? "error" : this.status.state,
        error: error instanceof Error ? error.message : String(error),
        appSessionId: this.logger?.sessionId,
        logPath: this.logger?.logPath,
        lastCheckedAt: new Date().toISOString(),
      };
      this.logger?.warn("sidecar.refresh_failed", { error });
    }
    return this.getStatus();
  }

  async stop({ waitMs = DEFAULT_QUIT_WAIT_TIMEOUT_MS } = {}) {
    if (!this.status.serviceUrl) return this.getStatus();
    if (!this.child && this.status.startedByElectron === false) {
      this.lifecycle = createSidecarLifecycleState("stopped");
      this.status = {
        ...this.status,
        state: "stopped",
        error: undefined,
        appSessionId: this.logger?.sessionId,
        logPath: this.logger?.logPath,
        lastCheckedAt: new Date().toISOString(),
      };
      return this.getStatus();
    }
    const child = this.child;
    this.transition("STOP_REQUESTED");
    this.status = { ...this.status, state: "stopping", lastCheckedAt: new Date().toISOString() };
    this.logger?.info("sidecar.stop_requested", {
      serviceUrl: this.status.serviceUrl,
      pid: this.status.pid,
      startedByElectron: this.status.startedByElectron,
    });

    try {
      const runtimeStatus = await fetchRuntimeStatus(this.status.serviceUrl);
      if (runtimeStatus.runtimeOwnerKind === "electron") {
        await requestDrainShutdown(
          this.status.serviceUrl,
          DEFAULT_GRACEFUL_DRAIN_TIMEOUT_MS,
          "electron_quit",
        );
      } else {
        throw new Error(
          `Refusing to stop non-Electron loom-service owner ${runtimeStatus.runtimeOwnerKind}.`,
        );
      }
    } catch (error) {
      this.status = {
        ...this.status,
        state: "error",
        error: error instanceof Error ? error.message : String(error),
        appSessionId: this.logger?.sessionId,
        logPath: this.logger?.logPath,
        lastCheckedAt: new Date().toISOString(),
      };
      this.logger?.error("sidecar.stop_failed", { error });
      return this.getStatus();
    }

    const exited = await waitForServiceExit(this.status.serviceUrl, waitMs);
    if (!exited) {
      this.status = {
        ...this.status,
        state: "draining",
        health: undefined,
        error: undefined,
        appSessionId: this.logger?.sessionId,
        logPath: this.logger?.logPath,
        lastCheckedAt: new Date().toISOString(),
      };
      this.logger?.info("sidecar.stop_waiting_for_drain", {
        serviceUrl: this.status.serviceUrl,
        pid: this.status.pid,
      });
      return this.getStatus();
    }

    this.child = null;
    removeRuntimeLock(path.dirname(this.status.configPath), child?.pid ?? this.status.pid);
    this.status = {
      ...this.status,
      state: "stopped",
      pid: undefined,
      health: undefined,
      error: undefined,
      appSessionId: this.logger?.sessionId,
      logPath: this.logger?.logPath,
      lastCheckedAt: new Date().toISOString(),
    };
    this.logger?.info("sidecar.stopped");
    this.lifecycle = createSidecarLifecycleState("stopped");
    return this.getStatus();
  }

  async restart(options = {}) {
    const previousPort = this.status.port ?? this.preferredPort;
    const previousServiceUrl = this.status.serviceUrl;
    this.transition("RESTART_REQUESTED");
    this.status = {
      ...this.status,
      state: "restarting",
      error: undefined,
      appSessionId: this.logger?.sessionId,
      logPath: this.logger?.logPath,
      lastCheckedAt: new Date().toISOString(),
    };
    this.logger?.info("sidecar.restart_requested", {
      previousServiceUrl,
      previousPort,
    });
    if (typeof options.onRestarting === "function") {
      options.onRestarting(this.getStatus());
    }

    await this.stop();
    this.preferredPort = previousPort;
    const nextStatus = await this.start({
      onStarting: (startingStatus) => {
        this.status = { ...startingStatus, state: "restarting" };
        if (typeof options.onRestarting === "function") {
          options.onRestarting(this.getStatus());
        }
      },
    });
    return {
      ...nextStatus,
      previousServiceUrl,
      serviceUrlChanged: Boolean(previousServiceUrl && nextStatus.serviceUrl !== previousServiceUrl),
    };
  }
}
