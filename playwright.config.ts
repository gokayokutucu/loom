import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.E2E_PORT ?? 5174);
const e2eUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: e2eUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx cross-env VITE_LOOM_ENGINE_MODE=typescript-local VITE_ENABLE_MOCK_DATA=true npm run dev -- --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: e2eUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
