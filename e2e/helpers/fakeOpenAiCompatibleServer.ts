import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";

export type FakeOpenAiCompatibleScenario =
  | "normal"
  | "nvidia-normal"
  | "missing-usage"
  | "long-running"
  | "auth-error"
  | "rate-limit"
  | "provider-error"
  | "malformed";

export interface FakeOpenAiCompatibleChatRequest {
  model?: string;
  messages?: Array<{ role?: string; content?: string }>;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface FakeOpenAiCompatibleRequestRecord {
  model?: string;
  stream?: boolean;
  includeUsage?: boolean;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  promptText: string;
  apiKeyLeakedInPrompt: boolean;
  authorizationHeaderPresent: boolean;
  rawAuthorizationHeaderStored: false;
  closedBeforeDone: boolean;
  completed: boolean;
}

export interface FakeOpenAiCompatibleServer {
  baseUrl: string;
  requests: FakeOpenAiCompatibleRequestRecord[];
  close: () => Promise<void>;
}

export async function startFakeOpenAiCompatibleServer(
  scenarioOrScript: FakeOpenAiCompatibleScenario | FakeOpenAiCompatibleScript
): Promise<FakeOpenAiCompatibleServer> {
  const script =
    typeof scenarioOrScript === "string" ? scriptForScenario(scenarioOrScript) : scenarioOrScript;
  const port = await findFreePort();
  const requests: FakeOpenAiCompatibleRequestRecord[] = [];

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404);
      response.end();
      return;
    }

    const body = await readJsonBody<FakeOpenAiCompatibleChatRequest>(request);
    const promptText = (body.messages ?? []).map((message) => message.content ?? "").join("\n");
    const authorizationHeader = request.headers.authorization;
    const record: FakeOpenAiCompatibleRequestRecord = {
      model: body.model,
      stream: body.stream,
      includeUsage: body.stream_options?.include_usage,
      temperature: body.temperature,
      topP: body.top_p,
      maxTokens: body.max_tokens,
      promptText,
      apiKeyLeakedInPrompt: secretLeakedInText(promptText),
      authorizationHeaderPresent:
        typeof authorizationHeader === "string" && authorizationHeader.trim().length > 0,
      rawAuthorizationHeaderStored: false,
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
        id: "chatcmpl-rig-e2e",
        object: "chat.completion",
        model: body.model ?? "fake-rig-openai-compatible:e2e",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: script.nonStreamingText ?? "Rig non-streaming visible response.",
            },
            finish_reason: "stop",
          },
        ],
        usage: script.includeUsage ? { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 } : undefined,
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
      if (typeof chunk.data === "string") {
        response.write(`data: ${chunk.data}\n\n`);
      } else {
        writeSse(response, chunk.data);
      }
      await delay(chunk.delayMs);
    }

    record.completed = true;
    response.write("data: [DONE]\n\n");
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => closeServer(server),
  };
}

export interface FakeOpenAiCompatibleScript {
  chunks: Array<{ data: unknown | string; delayMs: number }>;
  includeUsage?: boolean;
  nonStreamingText?: string;
  error?: {
    status: 401 | 429 | 500;
    code: string;
    message: string;
  };
}

function scriptForScenario(scenario: FakeOpenAiCompatibleScenario): FakeOpenAiCompatibleScript {
  switch (scenario) {
    case "nvidia-normal":
      return { chunks: nvidiaNormalChunks(), includeUsage: true };
    case "missing-usage":
      return { chunks: normalChunks(false), includeUsage: false };
    case "long-running":
      return { chunks: longRunningChunks(), includeUsage: true };
    case "auth-error":
      return {
        chunks: [],
        error: {
          status: 401,
          code: "invalid_api_key",
          message: "Invalid API key sk-rig-secret-e2e raw_thinking hidden_reasoning",
        },
      };
    case "rate-limit":
      return {
        chunks: [],
        error: {
          status: 429,
          code: "rate_limit_exceeded",
          message: "Rate limit exceeded sk-rig-secret-e2e raw_thinking hidden_reasoning",
        },
      };
    case "provider-error":
      return {
        chunks: [],
        error: {
          status: 500,
          code: "provider_error",
          message: "Provider failed sk-rig-secret-e2e raw_thinking hidden_reasoning",
        },
      };
    case "malformed":
      return {
        chunks: [
          {
            data: {
              id: "chatcmpl-rig-e2e",
              model: "fake-rig-openai-compatible:e2e",
              choices: [
                {
                  index: 0,
                  delta: { reasoning_content: "raw_thinking hidden_reasoning sk-rig-secret-e2e" },
                  finish_reason: null,
                },
              ],
            },
            delayMs: 20,
          },
          { data: "{not-json sk-rig-secret-e2e raw_thinking", delayMs: 0 },
        ],
        includeUsage: false,
      };
    case "normal":
    default:
      return { chunks: normalChunks(true), includeUsage: true };
  }
}

function secretLeakedInText(value: string) {
  return ["sk-rig-secret-e2e", "nvapi-fake-secret-e2e"].some((secret) =>
    value.includes(secret)
  );
}

function normalChunks(includeUsage: boolean) {
  return [
    {
      data: {
        id: "chatcmpl-rig-e2e",
        model: "fake-rig-openai-compatible:e2e",
        choices: [
          {
            index: 0,
            delta: { reasoning_content: "raw_thinking hidden_reasoning sk-rig-secret-e2e" },
            finish_reason: null,
          },
        ],
      },
      delayMs: 120,
    },
    {
      data: {
        id: "chatcmpl-rig-e2e",
        model: "fake-rig-openai-compatible:e2e",
        choices: [
          {
            index: 0,
            delta: { content: "Rig OpenAI-compatible visible stream persisted. " },
            finish_reason: null,
          },
        ],
      },
      delayMs: 80,
    },
    {
      data: {
        id: "chatcmpl-rig-e2e",
        model: "fake-rig-openai-compatible:e2e",
        choices: [
          {
            index: 0,
            delta: { content: "Final visible Rig delta." },
            finish_reason: null,
          },
        ],
      },
      delayMs: 40,
    },
    {
      data: {
        id: "chatcmpl-rig-e2e",
        model: "fake-rig-openai-compatible:e2e",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: includeUsage ? { prompt_tokens: 13, total_tokens: 20 } : undefined,
      },
      delayMs: 0,
    },
  ];
}

function nvidiaNormalChunks() {
  return [
    {
      data: {
        id: "chatcmpl-nvidia-e2e",
        model: "nvidia/e2e-openai-compatible",
        choices: [
          {
            index: 0,
            delta: { reasoning_content: "raw_thinking hidden_reasoning nvapi-fake-secret-e2e" },
            finish_reason: null,
          },
        ],
      },
      delayMs: 80,
    },
    {
      data: {
        id: "chatcmpl-nvidia-e2e",
        model: "nvidia/e2e-openai-compatible",
        choices: [
          {
            index: 0,
            delta: { content: "NVIDIA OpenAI-compatible visible stream persisted. " },
            finish_reason: null,
          },
        ],
      },
      delayMs: 60,
    },
    {
      data: {
        id: "chatcmpl-nvidia-e2e",
        model: "nvidia/e2e-openai-compatible",
        choices: [
          {
            index: 0,
            delta: { content: "Final visible NVIDIA delta." },
            finish_reason: null,
          },
        ],
      },
      delayMs: 40,
    },
    {
      data: {
        id: "chatcmpl-nvidia-e2e",
        model: "nvidia/e2e-openai-compatible",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
      delayMs: 0,
    },
  ];
}

function longRunningChunks() {
  const chunks = [
    {
      data: {
        id: "chatcmpl-rig-e2e",
        model: "fake-rig-openai-compatible:e2e",
        choices: [
          {
            index: 0,
            delta: { reasoning_content: "raw_thinking hidden_reasoning sk-rig-secret-e2e" },
            finish_reason: null,
          },
        ],
      },
      delayMs: 120,
    },
  ];
  for (let index = 0; index < 40; index += 1) {
    chunks.push({
      data: {
        id: "chatcmpl-rig-e2e",
        model: "fake-rig-openai-compatible:e2e",
        choices: [
          {
            index: 0,
            delta: { content: `Rig cancellable chunk ${index}. ` },
            finish_reason: null,
          },
        ],
      },
      delayMs: 150,
    });
  }
  chunks.push({
    data: {
      id: "chatcmpl-rig-e2e",
      model: "fake-rig-openai-compatible:e2e",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, total_tokens: 45 },
    },
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

function writeSse(response: ServerResponse, body: unknown) {
  response.write(`data: ${JSON.stringify(body)}\n\n`);
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function errorBody(error: NonNullable<FakeOpenAiCompatibleScript["error"]>) {
  return {
    error: {
      message: error.message,
      type: error.code,
      code: error.code,
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
