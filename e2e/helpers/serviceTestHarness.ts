import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RustHttpLoomEngineClient } from "../../src/engine";
import type { EngineResponseEvent } from "../../src/engine/LoomEngineTypes";

export type DeterministicProviderMode = "event-sourcing";

export interface ServiceTestHarnessOptions {
  deterministicProvider?: DeterministicProviderMode;
  requestTimeoutMs?: number;
  startApp?: boolean;
}

export interface ServiceTestHarness {
  client: RustHttpLoomEngineClient;
  serviceUrl: string;
  appUrl?: string;
  dbPath: string;
  configPath: string;
  tempDir: string;
  fetchJson: <T>(path: string, init?: RequestInit) => Promise<T>;
  sendPrompt: (loomId: string, promptText: string) => Promise<CollectedAnswer>;
  runPendingContextJobs: (maxRuns?: number) => Promise<void>;
  getProof: (loomId: string) => Promise<E2eProofResponse>;
  cleanup: () => Promise<CleanupResult>;
}

export interface CleanupResult {
  serviceStopped: boolean;
  appStopped?: boolean;
  tempDirRemoved: boolean;
  tempDir: string;
  dbPath: string;
  configPath: string;
  appUrl?: string;
  warnings: string[];
}

export interface CollectedAnswer {
  answer: string;
  userResponseId?: string;
  assistantResponseId?: string;
  events: EngineResponseEvent[];
}

export interface E2eProofResponse {
  loomId: string;
  responseCount: number;
  responseIds: string[];
  partKinds: string[];
  tablePartCount: number;
  codeBlocks: Array<{
    codeBlockId: string;
    responseId: string;
    language?: string;
    exactHash: string;
    code: string;
  }>;
  tags: string[];
  topics: string[];
  graphLinkKinds: string[];
  rawThinkingPresent: boolean;
}

export async function createServiceTestHarness(
  options: ServiceTestHarnessOptions = {}
): Promise<ServiceTestHarness> {
  const port = await findFreePort();
  const tempDir = await mkdtemp(join(tmpdir(), "loom-e2e-"));
  const dbPath = join(tempDir, "loom-e2e.sqlite");
  const configPath = join(tempDir, "loom-service.toml");
  assertTempPath(tempDir, dbPath);
  assertTempPath(tempDir, configPath);

  const serviceUrl = `http://127.0.0.1:${port}`;
  const service = spawn("cargo", ["run", "--manifest-path", "services/loom-service/Cargo.toml"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOOM_SERVICE_CONFIG_PATH: configPath,
      LOOM_SERVICE_DB_PATH: dbPath,
      LOOM_SERVICE_HOST: "127.0.0.1",
      LOOM_SERVICE_PORT: String(port),
      LOOM_SERVICE_LOG: "warn,sqlx=warn",
      LOOM_OLLAMA_BASE_URL: "http://127.0.0.1:9",
      ...(options.deterministicProvider
        ? { LOOM_SERVICE_E2E_PROVIDER: options.deterministicProvider }
        : {}),
    },
  });
  const logs: string[] = [];
  service.stdout.on("data", (chunk: Buffer) => logs.push(chunk.toString("utf8")));
  service.stderr.on("data", (chunk: Buffer) => logs.push(chunk.toString("utf8")));

  try {
    await waitForHttp(`${serviceUrl}/health`, service, logs, "loom-service");
  } catch (error) {
    await stopProcess(service);
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  let app: ChildProcessWithoutNullStreams | undefined;
  let appUrl: string | undefined;
  const appLogs: string[] = [];
  if (options.startApp) {
    const appPort = await findFreePort();
    appUrl = `http://127.0.0.1:${appPort}`;
    app = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VITE_LOOM_ENGINE_MODE: "rust-service",
        VITE_LOOM_ENGINE_STRICT_RUST: "true",
        VITE_LOOM_SERVICE_URL: serviceUrl,
      },
    });
    app.stdout.on("data", (chunk: Buffer) => appLogs.push(chunk.toString("utf8")));
    app.stderr.on("data", (chunk: Buffer) => appLogs.push(chunk.toString("utf8")));
    try {
      await waitForHttp(appUrl, app, appLogs, "Vite app");
    } catch (error) {
      await stopProcess(app);
      await stopProcess(service);
      await rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  const client = new RustHttpLoomEngineClient({
    serviceUrl,
    requestTimeoutMs: options.requestTimeoutMs ?? 20_000,
  });

  const fetchJson = async <T>(path: string, init: RequestInit = {}) => {
    const response = await fetch(`${serviceUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  };

  return {
    client,
    serviceUrl,
    appUrl,
    dbPath,
    configPath,
    tempDir,
    fetchJson,
    sendPrompt: async (loomId: string, promptText: string) => {
      const events: EngineResponseEvent[] = [];
      let answer = "";
      let userResponseId: string | undefined;
      let assistantResponseId: string | undefined;
      for await (const event of client.sendMessage({
        loomId,
        promptText,
        references: [],
        responseMode: "auto",
        source: "composer",
        model: "deterministic-event-sourcing:e2e",
        options: { numCtx: 8192, numPredict: 1024 },
        persistWorkflow: true,
      })) {
        events.push(event);
        if (event.type === "user_message_created") {
          userResponseId = event.payload.responseId;
        }
        if (event.type === "assistant_placeholder_created") {
          assistantResponseId = event.payload.responseId;
        }
        if (event.type === "content_delta") {
          answer += event.payload.delta;
        }
      }
      return { answer, userResponseId, assistantResponseId, events };
    },
    runPendingContextJobs: async (maxRuns = 8) => {
      for (let index = 0; index < maxRuns; index += 1) {
        await fetchJson<unknown>("/context/jobs/run-next", { method: "POST" });
      }
    },
    getProof: async (loomId: string) =>
      fetchJson<E2eProofResponse>(`/dev/e2e-proof/${encodeURIComponent(loomId)}`),
    cleanup: async () => {
      const warnings: string[] = [];
      const appStopped = app ? await stopProcess(app) : undefined;
      if (app && !appStopped) warnings.push(`Vite app did not stop cleanly for ${appUrl}`);
      const serviceStopped = await stopProcess(service);
      if (!serviceStopped) warnings.push(`loom-service did not stop cleanly for ${serviceUrl}`);
      await rm(tempDir, { recursive: true, force: true });
      const tempDirRemoved = !(await pathExists(tempDir));
      if (!tempDirRemoved) warnings.push(`temp directory was not removed: ${tempDir}`);
      return {
        serviceStopped,
        appStopped,
        tempDirRemoved,
        tempDir,
        dbPath,
        configPath,
        appUrl,
        warnings,
      };
    },
  };
}

export async function createServiceBackedConversationScenario(): Promise<ServiceTestHarness> {
  return createServiceTestHarness({ deterministicProvider: "event-sourcing" });
}

function assertTempPath(tempDir: string, path: string) {
  if (!path.startsWith(tempDir) || !tempDir.startsWith(tmpdir())) {
    throw new Error(`Refusing to use non-temp E2E path: ${path}`);
  }
}

async function waitForHttp(
  url: string,
  process: ChildProcessWithoutNullStreams,
  logs: string[],
  label: string
) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (process.exitCode !== null) {
      throw new Error(`${label} exited early with ${process.exitCode}\n${logs.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Process is still starting.
    }
    await delay(250);
  }
  throw new Error(`${label} did not become ready\n${logs.join("")}`);
}

async function stopProcess(process: ChildProcessWithoutNullStreams) {
  if (process.exitCode !== null) return true;
  process.kill("SIGINT");
  const stopped = await Promise.race([
    new Promise<boolean>((resolve) => process.once("exit", () => resolve(true))),
    delay(3_000).then(() => false),
  ]);
  if (!stopped && process.exitCode === null) {
    process.kill("SIGKILL");
    await new Promise<void>((resolve) => process.once("exit", () => resolve()));
    return false;
  }
  return true;
}

async function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a TCP port.")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
