import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";

// Scenarios supported by the fake Gemini server
export type FakeGeminiScenario =
  | "normal"
  | "missing-usage"
  | "long-running"
  | "auth-error"
  | "rate-limit"
  | "provider-error"
  | "malformed";

export interface FakeGeminiChatRequest {
  contents?: Array<{
    role?: string;
    parts?: Array<{ text?: string }>;
  }>;
  systemInstruction?: {
    parts?: Array<{ text?: string }>;
  };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
}

export interface FakeGeminiRequestRecord {
  model?: string;
  stream: boolean;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  promptText: string;
  apiKeyLeakedInPrompt: boolean;
  apiKeyHeaderPresent: boolean;
  closedBeforeDone: boolean;
  completed: boolean;
}

export interface FakeGeminiServer {
  baseUrl: string;
  requests: FakeGeminiRequestRecord[];
  close: () => Promise<void>;
}

export async function startFakeGeminiServer(
  scenarioOrScript: FakeGeminiScenario | FakeGeminiScript
): Promise<FakeGeminiServer> {
  const script =
    typeof scenarioOrScript === "string" ? scriptForScenario(scenarioOrScript) : scenarioOrScript;
  const port = await findFreePort();
  const requests: FakeGeminiRequestRecord[] = [];

  const server = createServer(async (request, response) => {
    const apiKeyHeader = request.headers["x-goog-api-key"];
    const apiKeyHeaderPresent =
      typeof apiKeyHeader === "string" && apiKeyHeader.trim().length > 0;

    // 1) Model listing endpoint
    if (request.method === "GET" && request.url === "/v1beta/models") {
      const record: FakeGeminiRequestRecord = {
        promptText: "GET /v1beta/models",
        stream: false,
        apiKeyLeakedInPrompt: false,
        apiKeyHeaderPresent,
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
        models: [
          {
            name: "models/gemini-1.5-flash",
          },
          {
            name: "models/gemini-1.5-pro",
          },
        ],
      });
      record.completed = true;
      return;
    }

    // 2) Chat completions endpoint (unary / stream)
    const streamMatch = request.url?.match(/\/v1beta\/models\/(.+):streamGenerateContent$/);
    const unaryMatch = request.url?.match(/\/v1beta\/models\/(.+):generateContent$/);
    const isStream = !!streamMatch;
    const model = streamMatch?.[1] || unaryMatch?.[1];

    if (request.method !== "POST" || (!isStream && !unaryMatch)) {
      response.writeHead(404);
      response.end();
      return;
    }

    const body = await readJsonBody<FakeGeminiChatRequest>(request);
    const promptText = (body.contents ?? [])
      .flatMap((content) => (content.parts ?? []).map((part) => part.text ?? ""))
      .join("\n");

    const record: FakeGeminiRequestRecord = {
      model,
      stream: isStream,
      temperature: body.generationConfig?.temperature,
      topP: body.generationConfig?.topP,
      maxOutputTokens: body.generationConfig?.maxOutputTokens,
      promptText,
      apiKeyLeakedInPrompt: secretLeakedInText(promptText),
      apiKeyHeaderPresent,
      closedBeforeDone: false,
      completed: false,
    };
    requests.push(record);

    if (!isStream) {
      if (script.error) {
        writeJson(response, script.error.status, errorBody(script.error));
        record.completed = true;
        return;
      }
      writeJson(response, 200, {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  text: script.nonStreamingText ?? "Gemini non-streaming visible response.",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: script.includeUsage ? {
          promptTokenCount: 10,
          candidatesTokenCount: 8,
          totalTokenCount: 18,
        } : undefined,
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
      "Content-Type": "application/json",
      "Transfer-Encoding": "chunked",
    });

    // Write chunked JSON array
    response.write("[\n");
    let isFirst = true;

    for (const chunk of script.chunks) {
      if (response.destroyed || response.closed) return;
      if (!isFirst) {
        response.write(",\n");
      }
      isFirst = false;
      response.write(JSON.stringify(chunk.data) + "\n");
      await delay(chunk.delayMs);
    }

    response.write("\n]\n");
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

export interface FakeGeminiScript {
  chunks: Array<{ data: unknown; delayMs: number }>;
  includeUsage?: boolean;
  nonStreamingText?: string;
  error?: {
    status: 400 | 401 | 429 | 500;
    statusText: string;
    message: string;
  };
}

function scriptForScenario(scenario: FakeGeminiScenario): FakeGeminiScript {
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
          statusText: "UNAUTHENTICATED",
          message: "API key not valid gemini-fake-secret-e2e raw_thinking",
        },
      };
    case "rate-limit":
      return {
        chunks: [],
        error: {
          status: 429,
          statusText: "RESOURCE_EXHAUSTED",
          message: "Rate limit exceeded gemini-fake-secret-e2e raw_thinking",
        },
      };
    case "provider-error":
      return {
        chunks: [],
        error: {
          status: 500,
          statusText: "INTERNAL",
          message: "Internal server error gemini-fake-secret-e2e raw_thinking",
        },
      };
    case "malformed":
      return {
        chunks: [
          {
            data: { candidates: [{ content: { parts: [{ text: "Visible start. " }] } }] },
            delayMs: 20,
          },
          // Send non-JSON data inside array to trigger parse failure
          {
            data: "{not-json-gemini-fake-secret-e2e-raw_thinking",
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
  return ["gemini-fake-secret-e2e"].some((secret) =>
    value.includes(secret)
  );
}

function normalChunks(includeUsage: boolean) {
  const chunks = [
    {
      data: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Gemini native visible stream persisted. " }],
            },
            finishReason: "STOP",
          },
        ],
      },
      delayMs: 80,
    },
    {
      data: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Final visible Gemini delta." }],
            },
            finishReason: "STOP",
          },
        ],
      },
      delayMs: 40,
    },
  ];

  if (includeUsage) {
    chunks.push({
      data: {
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 8,
          totalTokenCount: 18,
        },
      },
      delayMs: 20,
    });
  }

  return chunks;
}

function longRunningChunks() {
  const chunks = [];

  for (let index = 0; index < 40; index += 1) {
    chunks.push({
      data: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: `Gemini cancellable chunk ${index}. ` }],
            },
            finishReason: "STOP",
          },
        ],
      },
      delayMs: 150,
    });
  }

  chunks.push({
    data: {
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 45,
        totalTokenCount: 55,
      },
    },
    delayMs: 20,
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

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function errorBody(error: NonNullable<FakeGeminiScript["error"]>) {
  return {
    error: {
      code: error.status,
      message: error.message,
      status: error.statusText,
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
