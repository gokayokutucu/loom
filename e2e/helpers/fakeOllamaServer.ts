import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";

export type FakeOllamaScenario = "normal" | "long-running" | "malformed";

export interface FakeOllamaChatRequest {
  model?: string;
  messages?: Array<{ role?: string; content?: string }>;
  stream?: boolean;
  think?: boolean;
  request_id?: string;
}

export interface FakeOllamaRequestRecord {
  requestId?: string;
  model?: string;
  stream?: boolean;
  think?: boolean;
  promptText: string;
  closedBeforeDone: boolean;
  completed: boolean;
}

export interface FakeOllamaServer {
  baseUrl: string;
  requests: FakeOllamaRequestRecord[];
  close: () => Promise<void>;
}

export async function startFakeOllamaServer(
  scenario: FakeOllamaScenario
): Promise<FakeOllamaServer> {
  const port = await findFreePort();
  const requests: FakeOllamaRequestRecord[] = [];
  let chatCount = 0;

  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/tags") {
      writeJson(response, {
        models: [{ name: "fake-provider-pipeline:e2e" }],
      });
      return;
    }

    if (request.method === "GET" && request.url === "/api/version") {
      writeJson(response, { version: "0.0.0-e2e" });
      return;
    }

    if (request.method !== "POST" || request.url !== "/api/chat") {
      response.writeHead(404);
      response.end();
      return;
    }

    const body = await readJsonBody<FakeOllamaChatRequest>(request);
    chatCount += 1;
    const record: FakeOllamaRequestRecord = {
      requestId: body.request_id,
      model: body.model,
      stream: body.stream,
      think: body.think,
      promptText: (body.messages ?? []).map((message) => message.content ?? "").join("\n"),
      closedBeforeDone: false,
      completed: false,
    };
    requests.push(record);

    request.on("close", () => {
      if (!record.completed) record.closedBeforeDone = true;
    });
    response.on("close", () => {
      if (!record.completed) record.closedBeforeDone = true;
    });

    response.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    });

    if (scenario === "malformed") {
      await writeNdjson(response, {
        message: { thinking: "raw_thinking hidden provider chain" },
        done: false,
      });
      response.write("not-json raw_thinking sk-secret-provider\n");
      record.completed = true;
      response.end();
      return;
    }

    const chunks =
      scenario === "long-running"
        ? longRunningChunks()
        : normalChunks(chatCount === 1 ? "initial" : "retry");
    for (const chunk of chunks) {
      if (response.destroyed || response.closed) return;
      await writeNdjson(response, chunk.event);
      await delay(chunk.delayMs);
    }

    record.completed = true;
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => closeServer(server),
  };
}

function normalChunks(label: "initial" | "retry") {
  const prefix =
    label === "initial"
      ? "ProviderPipeline normal stream persisted visible answer."
      : "ProviderPipeline retry replacement stream persisted visible answer.";
  return [
    {
      event: {
        message: { thinking: "raw hidden provider reasoning must stay private" },
        done: false,
      },
      delayMs: 300,
    },
    { event: { message: { content: `${prefix} ` }, done: false }, delayMs: 80 },
    { event: { message: { content: "Final visible delta." }, done: false }, delayMs: 40 },
    {
      event: {
        done: true,
        done_reason: "stop",
        prompt_eval_count: 11,
        eval_count: label === "initial" ? 7 : 9,
      },
      delayMs: 0,
    },
  ];
}

function longRunningChunks() {
  const chunks = [
    {
      event: {
        message: { thinking: "raw hidden provider reasoning must stay private" },
        done: false,
      },
      delayMs: 120,
    },
  ];
  for (let index = 0; index < 40; index += 1) {
    chunks.push({
      event: {
        message: { content: `ProviderPipeline cancellable chunk ${index}. ` },
        done: false,
      },
      delayMs: 150,
    });
  }
  chunks.push({
    event: { done: true, done_reason: "stop", prompt_eval_count: 5, eval_count: 40 },
    delayMs: 0,
  });
  return chunks;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function writeJson(response: ServerResponse, body: unknown) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function writeNdjson(response: ServerResponse, body: unknown) {
  response.write(`${JSON.stringify(body)}\n`);
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createNetServer();
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

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
