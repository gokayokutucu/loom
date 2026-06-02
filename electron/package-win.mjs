import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronDist = path.join(repoRoot, "node_modules", "electron", "dist");
const packageRoot = path.join(repoRoot, "dist-electron");
const appPath = path.join(packageRoot, "Loom-win32-x64");
const resourcesPath = path.join(appPath, "resources");
const appResourcesPath = path.join(resourcesPath, "app");
const sidecarResourcesPath = path.join(resourcesPath, "loom-service");

const iconSourcePath = path.join(repoRoot, "build-assets", "loom_logo_rounded.png");
const bundleIconFile = "loom_logo.ico";
const bundleIconPath = path.join(resourcesPath, bundleIconFile);

const targetDir = process.env.CARGO_TARGET_DIR || path.join(repoRoot, "services", "loom-service", "target");

// Check both the target-specific dir and the default release dir for the compiled binary.
const possibleServiceBinaries = [
  path.join(targetDir, "x86_64-pc-windows-msvc", "release", "loom-service.exe"),
  path.join(targetDir, "release", "loom-service.exe"),
  // Fallbacks just in case
  path.join(repoRoot, "services", "loom-service", "target", "x86_64-pc-windows-msvc", "release", "loom-service.exe"),
  path.join(repoRoot, "services", "loom-service", "target", "release", "loom-service.exe"),
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

async function convertPngToIco(pngPath, icoPath) {
  const pngBuffer = await fs.readFile(pngPath);
  const icoHeader = Buffer.alloc(22);
  
  // ICONDIR
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // Type (1 = icon)
  icoHeader.writeUInt16LE(1, 4); // Count (1 image)

  // ICONDIRENTRY
  icoHeader.writeUInt8(0, 6); // Width (0 means 256 or actual width, using 0 for large icons)
  icoHeader.writeUInt8(0, 7); // Height
  icoHeader.writeUInt8(0, 8); // Color count
  icoHeader.writeUInt8(0, 9); // Reserved
  icoHeader.writeUInt16LE(1, 10); // Color planes
  icoHeader.writeUInt16LE(32, 12); // Bits per pixel
  icoHeader.writeUInt32LE(pngBuffer.length, 14); // Image size
  icoHeader.writeUInt32LE(22, 18); // Image offset

  await fs.writeFile(icoPath, Buffer.concat([icoHeader, pngBuffer]));
}

async function packageWin64App() {
  await assertExists(electronDist, "Electron dist template");
  await assertExists(path.join(repoRoot, "dist", "index.html"), "React build");
  const serviceBinaryPath = await findServiceBinary();
  await assertExists(iconSourcePath, "Loom logo png for conversion");

  // Reset output directory
  await fs.rm(appPath, { recursive: true, force: true });
  await fs.mkdir(packageRoot, { recursive: true });
  
  // Copy electron base
  await fs.cp(electronDist, appPath, { recursive: true, verbatimSymlinks: true });

  // Cleanup unnecessary default app
  await fs.rm(path.join(resourcesPath, "default_app.asar"), { force: true });
  
  // Rename electron executable
  const exePath = path.join(appPath, "electron.exe");
  const targetExePath = path.join(appPath, "Loom.exe");
  if (await fs.stat(exePath).catch(() => null)) {
    await fs.rename(exePath, targetExePath);
  }

  // Copy our app
  await fs.rm(appResourcesPath, { recursive: true, force: true });
  await fs.mkdir(appResourcesPath, { recursive: true });
  await fs.cp(path.join(repoRoot, "dist"), path.join(appResourcesPath, "dist"), { recursive: true });
  await copyElectronEntrypoints();
  await writePackageManifest();

  // Create icon
  await convertPngToIco(iconSourcePath, bundleIconPath);

  // Copy sidecar
  await fs.mkdir(sidecarResourcesPath, { recursive: true });
  await fs.copyFile(serviceBinaryPath, path.join(sidecarResourcesPath, "loom-service.exe"));

  console.log(`Packaged Loom Windows x64 app: ${appPath}`);
  console.log(`Packaged sidecar: ${path.join(sidecarResourcesPath, "loom-service.exe")}`);
}

await packageWin64App();
