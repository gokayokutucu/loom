import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronDist = path.join(repoRoot, "node_modules", "electron", "dist");
const packageRoot = path.join(repoRoot, "dist-electron");
const appPath = path.join(packageRoot, "Loom-linux-x64");
const resourcesPath = path.join(appPath, "resources");
const appResourcesPath = path.join(resourcesPath, "app");
const sidecarResourcesPath = path.join(resourcesPath, "loom-service");

const iconSourcePath = path.join(repoRoot, "build-assets", "loom_logo_rounded.png");
const bundleIconPath = path.join(resourcesPath, "loom_logo.png");

// Check both the target-specific dir and the default release dir for the compiled binary.
const possibleServiceBinaries = [
  path.join(repoRoot, "services", "loom-service", "target", "x86_64-unknown-linux-gnu", "release", "loom-service"),
  path.join(repoRoot, "services", "loom-service", "target", "release", "loom-service"),
];

async function assertExists(target, label) {
  try {
    await fs.access(target);
  } catch {
    throw new Error(`${label} is missing at ${target}`);
  }
}

async function findServiceBinary() {
  for (const p of possibleServiceBinaries) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // ignore
    }
  }
  throw new Error(`loom-service release binary is missing. Please run cargo build --release.`);
}

async function writePackageManifest() {
  const manifest = {
    name: "loom",
    productName: "Loom",
    version: "0.1.0",
    private: true,
    type: "module",
    main: "electron/main.mjs",
  };
  await fs.writeFile(path.join(appResourcesPath, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyElectronEntrypoints() {
  await fs.mkdir(path.join(appResourcesPath, "electron"), { recursive: true });
  for (const file of [
    "main.mjs",
    "app-menu.mjs",
    "app-logger.mjs",
    "preload.cjs",
    "sidecar-manager.mjs",
    "sidecar-lifecycle.mjs",
  ]) {
    await fs.copyFile(path.join(repoRoot, "electron", file), path.join(appResourcesPath, "electron", file));
  }
}

async function packageLinux64App() {
  await assertExists(electronDist, "Electron dist template");
  await assertExists(path.join(repoRoot, "dist", "index.html"), "React build");
  const serviceBinaryPath = await findServiceBinary();
  await assertExists(iconSourcePath, "Loom logo png");

  // Reset output directory
  await fs.rm(appPath, { recursive: true, force: true });
  await fs.mkdir(packageRoot, { recursive: true });
  
  // Copy electron base
  await fs.cp(electronDist, appPath, { recursive: true, verbatimSymlinks: true });

  // Cleanup unnecessary default app
  await fs.rm(path.join(resourcesPath, "default_app.asar"), { force: true });
  
  // Rename electron executable
  const exePath = path.join(appPath, "electron");
  const targetExePath = path.join(appPath, "Loom");
  if (await fs.stat(exePath).catch(() => null)) {
    await fs.rename(exePath, targetExePath);
  }

  // Copy our app
  await fs.rm(appResourcesPath, { recursive: true, force: true });
  await fs.mkdir(appResourcesPath, { recursive: true });
  await fs.cp(path.join(repoRoot, "dist"), path.join(appResourcesPath, "dist"), { recursive: true });
  await copyElectronEntrypoints();
  await writePackageManifest();

  // Copy icon
  await fs.copyFile(iconSourcePath, bundleIconPath);

  // Copy sidecar
  await fs.mkdir(sidecarResourcesPath, { recursive: true });
  const finalSidecarPath = path.join(sidecarResourcesPath, "loom-service");
  await fs.copyFile(serviceBinaryPath, finalSidecarPath);
  await fs.chmod(finalSidecarPath, 0o755);

  console.log(`Packaged Loom Linux x64 app: ${appPath}`);
  console.log(`Packaged sidecar: ${finalSidecarPath}`);
}

await packageLinux64App();
