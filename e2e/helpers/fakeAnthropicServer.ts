import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";

export type FakeAnthropicScenario =
  | "normal"
  | "missing-usage"
  | "long-running"
  | "auth-error"
  | "rate-limit"
  | "provider-error"
  | "malformed";

export interface FakeAnthropicChatRequest {
  model?: string;
  messages?: Array<{ role?: string; content?: string }>;
  stream?: boolean;
  system?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface FakeAnthropicRequestRecord {
  model?: string;
  stream?: boolean;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  promptText: string;
  apiKeyLeakedInPrompt: boolean;
  apiKeyHeaderPresent: boolean;
  anthropicVersionHeaderPresent: boolean;
  closedBeforeDone: boolean;
  completed: boolean;
}

export interface FakeAnthropicServer {
  baseUrl: string;
  requests: FakeAnthropicRequestRecord[];
  close: () => Promise<void>;
}

export async function startFakeAnthropicServer(
  scenarioOrScript: FakeAnthropicScenario | FakeAnthropicScript
): Promise<FakeAnthropicServer> {
  const script =
    typeof scenarioOrScript === "string" ? scriptForScenario(scenarioOrScript) : scenarioOrScript;
  const port = await findFreePort();
  const requests: FakeAnthropicRequestRecord[] = [];

  const server = createServer(async (request, response) => {
    const apiKeyHeader = request.headers["x-api-key"];
    const apiKeyHeaderPresent =
      typeof apiKeyHeader === "string" && apiKeyHeader.trim().length > 0;
    const anthropicVersionHeader = request.headers["anthropic-version"];
    const anthropicVersionHeaderPresent =
      typeof anthropicVersionHeader === "string" && anthropicVersionHeader.trim().length > 0;

    if (request.method === "GET" && request.url === "/v1/models") {
      const record: FakeAnthropicRequestRecord = {
        promptText: "GET /v1/models",
        apiKeyLeakedInPrompt: false,
        apiKeyHeaderPresent,
        anthropicVersionHeaderPresent,
        closedBeforeDone: false,
        completed: false,
      };
      requests.push(record);

      if (script.error) {
        writeJson(response, script.error.status, errorBody(script.error));
        record.completed = true;
        return;
      }

      if (typeof scenarioOrScript === "string" && scenarioOrScript === "malformed") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{malformed-json-models-list");
        record.completed = true;
        return;
      }

      writeJson(response, 200, {
        data: [
          {
            id: "claude-3-5-sonnet-latest",
          },
          {
            id: "claude-3-opus-latest",
          },
        ],
      });
      record.completed = true;
      return;
    }

    if (request.method !== "POST" || request.url !== "/v1/messages") {
      response.writeHead(404);
      response.end();
      return;
    }

    const body = await readJsonBody<FakeAnthropicChatRequest>(request);
    const promptText = (body.messages ?? []).map((message) => message.content ?? "").join("\n");
    const record: FakeAnthropicRequestRecord = {
      model: body.model,
      stream: body.stream,
      temperature: body.temperature,
      topP: body.top_p,
      maxTokens: body.max_tokens,
      promptText,
      apiKeyLeakedInPrompt: secretLeakedInText(promptText),
      apiKeyHeaderPresent,
      anthropicVersionHeaderPresent,
      closedBeforeDone: false,
      completed: false,
    };
    requests.push(record);

    if (!body.stream) {
      if (script.error) {
        writeJson(response, script.error.status, errorBody(script.error));
        record.completed = true;
        return;
      }
      writeJson(response, 200, {
        id: "msg-anthropic-e2e",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: script.nonStreamingText ?? "Anthropic non-streaming visible response.",
          },
        ],
        model: body.model ?? "claude-3-5-sonnet-latest",
        stop_reason: "end_turn",
        usage: script.includeUsage ? { input_tokens: 12, output_tokens: 25 } : undefined,
      });
      record.completed = true;
      return;
    }

    if (script.error) {
      writeJson(response, script.error.status, errorBody(script.error));
      record.completed = true;
      return;
    }

    request.on("close", () => {
      if (!record.completed) record.closedBeforeDone = true;
    });
    response.on("close", () => {
      if (!record.completed) record.closedBeforeDone = true;
    });

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    for (const chunk of script.chunks) {
      if (response.destroyed || response.closed) return;
      response.write(`event: ${chunk.event}\n`);
      response.write(`data: ${JSON.stringify(chunk.data)}\n\n`);
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

export interface FakeAnthropicScript {
  chunks: Array<{ event: string; data: unknown; delayMs: number }>;
  includeUsage?: boolean;
  nonStreamingText?: string;
  error?: {
    status: 401 | 429 | 500;
    type: string;
    message: string;
  };
}

function scriptForScenario(scenario: FakeAnthropicScenario): FakeAnthropicScript {
  switch (scenario) {
    case "missing-usage":
      return { chunks: normalChunks(false), includeUsage: false };
    case "long-running":
      return { chunks: longRunningChunks(), includeUsage: true };
    case "auth-error":
      return {
        chunks: [],
        error: {
          status: 401,
          type: "authentication_error",
          message: "Invalid API key ant-fake-secret-e2e raw_thinking hidden_reasoning",
        },
      };
    case "rate-limit":
      return {
        chunks: [],
        error: {
          status: 429,
          type: "rate_limit_error",
          message: "Rate limit exceeded ant-fake-secret-e2e raw_thinking hidden_reasoning",
        },
      };
    case "provider-error":
      return {
        chunks: [],
        error: {
          status: 500,
          type: "api_error",
          message: "Anthropic provider failed ant-fake-secret-e2e raw_thinking hidden_reasoning",
        },
      };
    case "malformed":
      return {
        chunks: [
          {
            event: "message_start",
            data: { type: "message_start", message: { usage: { input_tokens: 12 } } },
            delayMs: 20,
          },
          {
            event: "content_block_delta",
            data: "{not-json-ant-fake-secret-e2e-raw_thinking",
            delayMs: 0,
          },
        ],
        includeUsage: false,
      };
    case "normal":
    default:
      return { chunks: normalChunks(true), includeUsage: true };
  }
}

function secretLeakedInText(value: string) {
  return ["ant-fake-secret-e2e"].some((secret) =>
    value.includes(secret)
  );
}

function normalChunks(includeUsage: boolean) {
  const chunks = [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg-anthropic-e2e",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-3-5-sonnet-latest",
          stop_reason: null,
          usage: includeUsage ? { input_tokens: 12 } : undefined,
        },
      },
      delayMs: 120,
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      delayMs: 40,
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Anthropic native visible stream persisted. " },
      },
      delayMs: 80,
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Final visible Anthropic delta." },
      },
      delayMs: 40,
    },
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 0 },
      delayMs: 20,
    },
  ];

  if (includeUsage) {
    chunks.push({
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 25 },
      },
      delayMs: 20,
    });
  }

  chunks.push({
    event: "message_stop",
    data: { type: "message_stop" },
    delayMs: 0,
  });

  return chunks;
}

function longRunningChunks() {
  const chunks = [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg-anthropic-e2e",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-3-5-sonnet-latest",
          stop_reason: null,
          usage: { input_tokens: 12 },
        },
      },
      delayMs: 120,
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      delayMs: 40,
    },
  ];

  for (let index = 0; index < 40; index += 1) {
    chunks.push({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: `Anthropic cancellable chunk ${index}. ` },
      },
      delayMs: 150,
    });
  }

  chunks.push(
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 0 },
      delayMs: 20,
    },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 45 },
      },
      delayMs: 20,
    },
    {
      event: "message_stop",
      data: { type: "message_stop" },
      delayMs: 0,
    }
  );

  return chunks;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function errorBody(error: NonNullable<FakeAnthropicScript["error"]>) {
  return {
    error: {
      type: error.type,
      message: error.message,
    },
  };
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
