import { _electron as electron } from "playwright";

const app = await electron.launch({
  args: ["electron/main.mjs"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    LOOM_ELECTRON_DEV_SERVER_URL:
      process.env.LOOM_ELECTRON_DEV_SERVER_URL || "http://localhost:5173/",
  },
});

try {
  const page = await app.firstWindow({ timeout: 20_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.loomDesktop?.runtime), null, {
    timeout: 20_000,
  });

  const before = await page.evaluate(() => window.loomDesktop.runtime.status());
  let restarted;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      restarted = await page.evaluate(() => window.loomDesktop.runtime.restart());
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForLoadState("domcontentloaded", { timeout: 20_000 });
      await page.waitForFunction(() => Boolean(window.loomDesktop?.runtime), null, {
        timeout: 20_000,
      });
    }
  }
  await page.waitForFunction(
    () => window.loomDesktop?.runtime?.status().then((status) => status.state === "ready"),
    null,
    { timeout: 30_000 }
  );
  const after = await page.evaluate(() => window.loomDesktop.runtime.status());

  console.log(JSON.stringify({ before, restarted, after }, null, 2));
} finally {
  await app.close();
}
