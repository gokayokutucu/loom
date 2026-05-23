import fs from "node:fs";
import path from "node:path";

function safeSerialize(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

function jsonReplacer(_key, value) {
  return safeSerialize(value);
}

export function createAppLogger({ app, sessionId }) {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const dateStamp = new Date().toISOString().slice(0, 10);
  const logPath = path.join(logDir, `loom-${dateStamp}.jsonl`);

  function write(level, event, data = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      appSessionId: sessionId,
      event,
      ...safeSerialize(data),
    };
    fs.appendFileSync(logPath, `${JSON.stringify(entry, jsonReplacer)}\n`);
  }

  return {
    sessionId,
    logPath,
    info: (event, data) => write("info", event, data),
    warn: (event, data) => write("warn", event, data),
    error: (event, data) => write("error", event, data),
  };
}
