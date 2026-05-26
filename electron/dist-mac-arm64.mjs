import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8")).version ?? "0.1.0";
const releaseDir = path.join(repoRoot, "release");
const appPath = path.join(repoRoot, "dist-electron", "Loom.app");
const stagingDir = path.join(releaseDir, "dmg-staging-arm64");
const rwDmgPath = path.join(releaseDir, `Loom-${version}-mac-arm64.rw.dmg`);
const dmgPath = path.join(releaseDir, `Loom-${version}-mac-arm64.dmg`);
const volumeName = "Loom";
const iconSourcePath = path.join(repoRoot, "public", "loom_logo.icns");

async function assertExists(target, label) {
  try {
    await fs.access(target);
  } catch {
    throw new Error(`${label} is missing at ${target}`);
  }
}

async function detachDevice(device) {
  await execFileAsync("/usr/bin/hdiutil", ["detach", device, "-quiet"]).catch(async () => {
    await execFileAsync("/usr/bin/hdiutil", ["detach", device, "-force", "-quiet"]).catch(() => undefined);
  });
}

async function createDmg() {
  await assertExists(appPath, "Packaged Loom.app");
  await assertExists(iconSourcePath, "Loom DMG icon");
  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.rm(rwDmgPath, { force: true });
  await fs.rm(dmgPath, { force: true });
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.cp(appPath, path.join(stagingDir, "Loom.app"), { recursive: true, verbatimSymlinks: true });
  await fs.symlink("/Applications", path.join(stagingDir, "Applications"));

  await execFileAsync("/usr/bin/hdiutil", [
    "create",
    "-volname",
    volumeName,
    "-srcfolder",
    stagingDir,
    "-fs",
    "HFS+",
    "-format",
    "UDRW",
    "-ov",
    rwDmgPath,
  ]);

  const { stdout } = await execFileAsync("/usr/bin/hdiutil", ["attach", rwDmgPath, "-readwrite", "-noverify", "-noautoopen"]);
  const device = stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .find((entry) => entry.startsWith("/dev/disk"));
  if (!device) throw new Error(`Could not determine attached DMG device:\n${stdout}`);
  const mountPoint =
    stdout
      .split("\n")
      .map((line) => line.match(/(\/Volumes\/.+)$/)?.[1])
      .find(Boolean) ?? `/Volumes/${volumeName}`;

  try {
    await fs.copyFile(iconSourcePath, path.join(mountPoint, ".VolumeIcon.icns"));
    await execFileAsync("/usr/bin/SetFile", ["-a", "C", mountPoint]);
    await execFileAsync("/usr/bin/SetFile", ["-a", "V", path.join(mountPoint, ".VolumeIcon.icns")]).catch(() => undefined);
  } finally {
    await detachDevice(device);
  }

  await execFileAsync("/usr/bin/hdiutil", ["convert", rwDmgPath, "-format", "UDZO", "-imagekey", "zlib-level=9", "-o", dmgPath]);
  await fs.rm(rwDmgPath, { force: true });
  await fs.rm(stagingDir, { recursive: true, force: true });
  console.log(`Created Loom macOS arm64 DMG: ${dmgPath}`);
}

await createDmg();
