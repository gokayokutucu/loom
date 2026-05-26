import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronTemplateApp = path.join(repoRoot, "node_modules", "electron", "dist", "Electron.app");
const packageRoot = path.join(repoRoot, "dist-electron");
const appPath = path.join(packageRoot, "Loom.app");
const resourcesPath = path.join(appPath, "Contents", "Resources");
const appResourcesPath = path.join(resourcesPath, "app");
const sidecarResourcesPath = path.join(resourcesPath, "loom-service");
const bundledWhisperSourcePath = path.join(repoRoot, "resources", "bin", "whisper");
const bundledWhisperResourcesPath = path.join(resourcesPath, "bin", "whisper");
const iconSourcePath = path.join(repoRoot, "public", "loom_logo.icns");
const bundleIconFile = "loom_logo.icns";
const bundleIconPath = path.join(resourcesPath, bundleIconFile);
const macEntitlementsPath = path.join(repoRoot, "electron", "entitlements.mac.plist");
const serviceBinaryPath = path.join(
  repoRoot,
  "services",
  "loom-service",
  "target",
  "aarch64-apple-darwin",
  "release",
  "loom-service"
);
const microphoneUsageDescription =
  "Loom AI needs microphone access for speech-to-text and voice AI interactions.";

async function assertExists(target, label) {
  try {
    await fs.access(target);
  } catch {
    throw new Error(`${label} is missing at ${target}`);
  }
}

async function assertMissing(target, label) {
  try {
    await fs.access(target);
  } catch {
    return;
  }
  throw new Error(`${label} should not exist at ${target}`);
}

async function assertFilesEqual(left, right, label) {
  const [leftBuffer, rightBuffer] = await Promise.all([fs.readFile(left), fs.readFile(right)]);
  if (!leftBuffer.equals(rightBuffer)) {
    throw new Error(`${label} mismatch: ${left} differs from ${right}`);
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
  await fs.writeFile(path.join(appResourcesPath, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyElectronEntrypoints() {
  await fs.mkdir(path.join(appResourcesPath, "electron"), { recursive: true });
  for (const file of [
    "main.mjs",
    "app-logger.mjs",
    "preload.cjs",
    "sidecar-manager.mjs",
    "sidecar-lifecycle.mjs",
  ]) {
    await fs.copyFile(path.join(repoRoot, "electron", file), path.join(appResourcesPath, "electron", file));
  }
}

async function copyBundledWhisperRuntimeIfPresent() {
  try {
    await fs.access(bundledWhisperSourcePath);
  } catch {
    return false;
  }
  await fs.mkdir(path.dirname(bundledWhisperResourcesPath), { recursive: true });
  await fs.cp(bundledWhisperSourcePath, bundledWhisperResourcesPath, { recursive: true });
  return true;
}

async function patchInfoPlist() {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const original = await fs.readFile(plistPath, "utf8");
  let patched = original
    .replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]+(<\/string>)/, "$1Loom$2")
    .replace(/(<key>CFBundleName<\/key>\s*<string>)[^<]+(<\/string>)/, "$1Loom$2")
    .replace(/(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]+(<\/string>)/, "$1ai.loom.app$2")
    .replace(/(<key>CFBundleIconFile<\/key>\s*<string>)[^<]+(<\/string>)/, `$1${bundleIconFile}$2`);
  if (patched.includes("<key>NSMicrophoneUsageDescription</key>")) {
    patched = patched.replace(
      /(<key>NSMicrophoneUsageDescription<\/key>\s*<string>)[^<]*(<\/string>)/,
      `$1${microphoneUsageDescription}$2`
    );
  } else {
    patched = patched.replace(
      /<\/dict>\s*<\/plist>\s*$/,
      `\t<key>NSMicrophoneUsageDescription</key>\n\t<string>${microphoneUsageDescription}</string>\n</dict>\n</plist>\n`
    );
  }
  await fs.writeFile(plistPath, patched);
}

async function verifyMacBundleIcon() {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const plist = await fs.readFile(plistPath, "utf8");
  await assertExists(bundleIconPath, "Packaged Loom app icon");
  await assertMissing(path.join(resourcesPath, "electron.icns"), "Old Electron app icon");
  if (!plist.includes(`<key>CFBundleIconFile</key>\n\t<string>${bundleIconFile}</string>`)) {
    throw new Error(`Info.plist does not point CFBundleIconFile at ${bundleIconFile}`);
  }
  await assertFilesEqual(iconSourcePath, bundleIconPath, "Packaged Loom app icon");
}

async function signMacAppWithEntitlements() {
  await assertExists(macEntitlementsPath, "macOS entitlements");
  await execFileAsync("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--entitlements",
    macEntitlementsPath,
    appPath,
  ]);
}

async function packageMacArm64App() {
  await assertExists(electronTemplateApp, "Electron app template");
  await assertExists(path.join(repoRoot, "dist", "index.html"), "React build");
  await assertExists(serviceBinaryPath, "loom-service macOS arm64 release binary");
  await assertExists(iconSourcePath, "Loom app icon");

  await fs.rm(packageRoot, { recursive: true, force: true });
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.cp(electronTemplateApp, appPath, { recursive: true, verbatimSymlinks: true });
  await fs.rm(path.join(resourcesPath, "electron.icns"), { force: true });

  await fs.rm(appResourcesPath, { recursive: true, force: true });
  await fs.cp(path.join(repoRoot, "dist"), path.join(appResourcesPath, "dist"), { recursive: true });
  await copyElectronEntrypoints();
  await writePackageManifest();
  await fs.copyFile(iconSourcePath, bundleIconPath);
  const bundledWhisperCopied = await copyBundledWhisperRuntimeIfPresent();

  await fs.mkdir(sidecarResourcesPath, { recursive: true });
  await fs.copyFile(serviceBinaryPath, path.join(sidecarResourcesPath, "loom-service"));
  await fs.chmod(path.join(sidecarResourcesPath, "loom-service"), 0o755);

  await patchInfoPlist();
  await signMacAppWithEntitlements();
  await verifyMacBundleIcon();

  console.log(`Packaged Loom macOS arm64 app: ${appPath}`);
  console.log(`Packaged sidecar: ${path.join(sidecarResourcesPath, "loom-service")}`);
  if (!bundledWhisperCopied) {
    console.log(`No bundled Whisper runtime found at ${bundledWhisperSourcePath}`);
  }
}

await packageMacArm64App();
