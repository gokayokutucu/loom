import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17633;
const HEALTH_TIMEOUT_MS = 20_000;

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

async function waitForExit(child, timeoutMs = 4_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const forceKill = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function fetchHealth(serviceUrl) {
  const response = await fetch(`${serviceUrl}/health`);
  if (!response.ok) {
    throw new Error(`/health returned HTTP ${response.status}`);
  }
  return response.json();
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
    return {
      repoRoot: metadata.repoRoot,
      dataMode: metadata.dataMode === "isolated-dev" ? "isolated-dev" : "shared-dev",
    };
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
  const devRuntime = readDevRuntimeMetadata(repoRoot);
  if (devRuntime) {
    const serviceDataDir = path.join(devRuntime.repoRoot, "services", "loom-service", ".data");
    const electronConfigDir = path.join(serviceDataDir, "electron-dev");
    return {
      dataMode: devRuntime.dataMode,
      dataDir: electronConfigDir,
      configPath: path.join(electronConfigDir, "loom-service.toml"),
      dbPath:
        devRuntime.dataMode === "shared-dev"
          ? path.join(serviceDataDir, "loom.db")
          : path.join(electronConfigDir, "loom.db"),
    };
  }

  if (app?.isPackaged || isPackagedRuntime()) {
    const dataDir = path.join(app.getPath("userData"), "loom-service");
    return {
      dataMode: "packaged",
      dataDir,
      configPath: path.join(dataDir, "loom-service.toml"),
      dbPath: path.join(dataDir, "loom.db"),
    };
  }

  const serviceDataDir = path.join(repoRoot, "services", "loom-service", ".data");
  const electronConfigDir = path.join(serviceDataDir, "electron-dev");
  const dataMode =
    process.env.LOOM_ELECTRON_DATA_MODE === "isolated-dev"
      ? "isolated-dev"
      : "shared-dev";

  return {
    dataMode,
    dataDir: electronConfigDir,
    configPath: path.join(electronConfigDir, "loom-service.toml"),
    dbPath:
      dataMode === "shared-dev"
        ? path.join(serviceDataDir, "loom.db")
        : path.join(electronConfigDir, "loom.db"),
  };
}

export class LoomServiceSidecarManager {
  constructor({ app, repoRoot = resolveRepoRoot(), preferredPort = DEFAULT_PORT } = {}) {
    this.app = app;
    this.repoRoot = repoRoot;
    this.preferredPort = Number(process.env.LOOM_ELECTRON_SERVICE_PORT || preferredPort);
    this.host = process.env.LOOM_ELECTRON_SERVICE_HOST || DEFAULT_HOST;
    this.child = null;
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
      lastCheckedAt: undefined,
    };
  }

  getStatus() {
    return { ...this.status };
  }

  async start(options = {}) {
    if (this.child && this.status.serviceUrl) return this.getStatus();

    const binaryPath = resolveBinaryPath(this.repoRoot, this.app);
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`loom-service binary is missing at ${binaryPath}. Build it first.`);
    }

    const port = await findAvailablePort(this.host, this.preferredPort);
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
      lastCheckedAt: new Date().toISOString(),
    };

    if (typeof options.onStarting === "function") {
      options.onStarting(this.getStatus());
    }

    this.child = spawn(binaryPath, {
      cwd: this.repoRoot,
      env: {
        ...process.env,
        LOOM_SERVICE_HOST: this.host,
        LOOM_SERVICE_PORT: String(port),
        LOOM_SERVICE_CONFIG_PATH: configPath,
        LOOM_SERVICE_DB_PATH: dbPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.status.pid = this.child.pid;

    this.child.stdout?.on("data", (chunk) => {
      process.stdout.write(`[loom-service:${this.child?.pid ?? "stopped"}] ${chunk}`);
    });
    this.child.stderr?.on("data", (chunk) => {
      process.stderr.write(`[loom-service:${this.child?.pid ?? "stopped"}] ${chunk}`);
    });
    this.child.once("exit", (code, signal) => {
      const wasStopping = this.status.state === "stopping";
      this.child = null;
      this.status = {
        ...this.status,
        state: wasStopping ? "stopped" : "exited",
        error: wasStopping ? undefined : `loom-service exited with code ${code ?? "null"} signal ${signal ?? "null"}`,
        lastCheckedAt: new Date().toISOString(),
      };
    });

    const health = await waitForHealth(serviceUrl);
    this.status = {
      ...this.status,
      state: "ready",
      health,
      error: undefined,
      lastCheckedAt: new Date().toISOString(),
    };
    return this.getStatus();
  }

  async refreshStatus() {
    if (!this.status.serviceUrl) return this.getStatus();
    try {
      const health = await fetchHealth(this.status.serviceUrl);
      this.status = {
        ...this.status,
        state: this.child ? "ready" : this.status.state,
        health,
        error: undefined,
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.status = {
        ...this.status,
        state: this.child ? "error" : this.status.state,
        error: error instanceof Error ? error.message : String(error),
        lastCheckedAt: new Date().toISOString(),
      };
    }
    return this.getStatus();
  }

  async stop() {
    if (!this.child) return this.getStatus();
    const child = this.child;
    this.status = { ...this.status, state: "stopping", lastCheckedAt: new Date().toISOString() };

    await waitForExit(child);

    this.child = null;
    this.status = {
      ...this.status,
      state: "stopped",
      pid: undefined,
      health: undefined,
      error: undefined,
      lastCheckedAt: new Date().toISOString(),
    };
    return this.getStatus();
  }

  async restart(options = {}) {
    const previousPort = this.status.port ?? this.preferredPort;
    const previousServiceUrl = this.status.serviceUrl;
    this.status = {
      ...this.status,
      state: "restarting",
      error: undefined,
      lastCheckedAt: new Date().toISOString(),
    };
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
