import { spawn } from "node:child_process";
import electronPath from "electron";

const DEV_SERVER_URL = process.env.LOOM_ELECTRON_DEV_SERVER_URL || "http://localhost:5173/";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function isDevServerReady() {
  try {
    const response = await fetch(DEV_SERVER_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDevServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await isDevServerReady()) return;
    await sleep(250);
  }
  throw new Error(`Vite dev server did not become ready at ${DEV_SERVER_URL}.`);
}

let viteProcess = null;

if (!(await isDevServerReady())) {
  viteProcess = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], {
    stdio: "inherit",
    env: process.env,
  });
  await waitForDevServer();
}

const electronProcess = spawn(electronPath, ["electron/main.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    LOOM_ELECTRON_DEV_SERVER_URL: DEV_SERVER_URL,
  },
});

electronProcess.once("exit", (code, signal) => {
  if (viteProcess) viteProcess.kill("SIGTERM");
  process.exit(code ?? (signal ? 1 : 0));
});
