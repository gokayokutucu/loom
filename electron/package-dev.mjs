import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronTemplateApp = path.join(
  repoRoot,
  "node_modules",
  "electron",
  "dist",
  "Electron.app"
);
const packageRoot = path.join(repoRoot, "dist-electron");
const appPath = path.join(packageRoot, "Loom.app");
const resourcesPath = path.join(appPath, "Contents", "Resources");
const appResourcesPath = path.join(resourcesPath, "app");
const sidecarResourcesPath = path.join(resourcesPath, "loom-service");
const serviceBinaryPath = path.join(
  repoRoot,
  "services",
  "loom-service",
  "target",
  "debug",
  "loom-service"
);

async function assertExists(target, label) {
  try {
    await fs.access(target);
  } catch {
    throw new Error(`${label} is missing at ${target}`);
  }
}

async function writePackageManifest() {
  const manifest = {
    name: "loom-ai",
    version: "0.1.0",
    private: true,
    type: "module",
    main: "electron/main.mjs",
  };
  await fs.writeFile(
    path.join(appResourcesPath, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

async function writeDevRuntimeMetadata() {
  const metadata = {
    kind: "loom-electron-dev-runtime",
    repoRoot,
    dataMode: process.env.LOOM_ELECTRON_DATA_MODE === "isolated-dev" ? "isolated-dev" : "shared-dev",
  };
  await fs.writeFile(
    path.join(appResourcesPath, "electron-dev-runtime.json"),
    `${JSON.stringify(metadata, null, 2)}\n`
  );
}

async function patchInfoPlist() {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const original = await fs.readFile(plistPath, "utf8");
  const patched = original
    .replace(
      /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]+(<\/string>)/,
      "$1Loom$2"
    )
    .replace(
      /(<key>CFBundleName<\/key>\s*<string>)[^<]+(<\/string>)/,
      "$1Loom$2"
    )
    .replace(
      /(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]+(<\/string>)/,
      "$1ai.loom.dev$2"
    );
  await fs.writeFile(plistPath, patched);
}

async function packageDevApp() {
  await assertExists(electronTemplateApp, "Electron app template");
  await assertExists(path.join(repoRoot, "dist", "index.html"), "React build");
  await assertExists(serviceBinaryPath, "loom-service debug binary");

  await fs.rm(packageRoot, { recursive: true, force: true });
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.cp(electronTemplateApp, appPath, {
    recursive: true,
    verbatimSymlinks: true,
  });

  await fs.rm(appResourcesPath, { recursive: true, force: true });
  await fs.mkdir(path.join(appResourcesPath, "electron"), { recursive: true });
  await fs.cp(path.join(repoRoot, "dist"), path.join(appResourcesPath, "dist"), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(repoRoot, "electron", "main.mjs"),
    path.join(appResourcesPath, "electron", "main.mjs")
  );
  await fs.copyFile(
    path.join(repoRoot, "electron", "preload.cjs"),
    path.join(appResourcesPath, "electron", "preload.cjs")
  );
  await fs.copyFile(
    path.join(repoRoot, "electron", "sidecar-manager.mjs"),
    path.join(appResourcesPath, "electron", "sidecar-manager.mjs")
  );
  await writePackageManifest();
  await writeDevRuntimeMetadata();

  await fs.mkdir(sidecarResourcesPath, { recursive: true });
  await fs.copyFile(serviceBinaryPath, path.join(sidecarResourcesPath, "loom-service"));
  await fs.chmod(path.join(sidecarResourcesPath, "loom-service"), 0o755);
  await patchInfoPlist();

  console.log(`Packaged Loom dev app: ${appPath}`);
}

await packageDevApp();
