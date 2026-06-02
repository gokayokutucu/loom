import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8")).version ?? "0.1.0";
const releaseDir = path.join(repoRoot, "release");
const appPath = path.join(repoRoot, "dist-electron", "Loom-linux-x64");
const tarPath = path.join(releaseDir, `Loom-${version}-linux-x64.tar.gz`);
const debPath = path.join(releaseDir, `loom_${version}_amd64.deb`);

async function assertExists(target, label) {
  try {
    await fs.access(target);
  } catch {
    throw new Error(`${label} is missing at ${target}`);
  }
}

async function createTarGz() {
  await fs.mkdir(releaseDir, { recursive: true });
  await fs.rm(tarPath, { force: true });
  console.log("Creating tar.gz archive...");
  try {
    await execFileAsync("tar", [
      "-czf",
      tarPath,
      "-C",
      path.dirname(appPath),
      path.basename(appPath)
    ]);
    console.log(`Created Loom Linux x64 archive: ${tarPath}`);
  } catch (error) {
    console.warn("Failed to create tar.gz archive using tar:", error);
  }
}

async function checkDpkgDeb() {
  try {
    await execFileAsync("dpkg-deb", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function createDeb() {
  if (!(await checkDpkgDeb())) {
    console.log("dpkg-deb not found. Skipping .deb generation.");
    return;
  }
  
  console.log("Creating Debian package...");
  const stagingDir = path.join(releaseDir, "deb-staging");
  await fs.rm(stagingDir, { recursive: true, force: true });
  
  const optLoomDir = path.join(stagingDir, "opt", "Loom");
  const binDir = path.join(stagingDir, "usr", "bin");
  const applicationsDir = path.join(stagingDir, "usr", "share", "applications");
  const iconsDir = path.join(stagingDir, "usr", "share", "icons", "hicolor", "256x256", "apps");
  const debianDir = path.join(stagingDir, "DEBIAN");
  
  await fs.mkdir(optLoomDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(applicationsDir, { recursive: true });
  await fs.mkdir(iconsDir, { recursive: true });
  await fs.mkdir(debianDir, { recursive: true });
  
  // Copy app to /opt/Loom
  await fs.cp(appPath, optLoomDir, { recursive: true, verbatimSymlinks: true });
  
  // Create symlink in /usr/bin
  await fs.symlink("/opt/Loom/Loom", path.join(binDir, "loom"));
  
  // Copy icon
  await fs.copyFile(
    path.join(optLoomDir, "resources", "loom_logo.png"),
    path.join(iconsDir, "loom.png")
  );
  
  // Create .desktop file
  const desktopFile = `[Desktop Entry]
Name=Loom
Exec=/opt/Loom/Loom %U
Terminal=false
Type=Application
Icon=loom
StartupWMClass=Loom
Comment=Loom local-first AI app
Categories=Utility;
`;
  await fs.writeFile(path.join(applicationsDir, "loom.desktop"), desktopFile);
  
  // Create DEBIAN/control file
  const controlFile = `Package: loom
Version: ${version}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Loom Team <team@loom.app>
Description: Loom local-first AI application.
`;
  await fs.writeFile(path.join(debianDir, "control"), controlFile);
  
  try {
    await execFileAsync("dpkg-deb", ["--build", stagingDir, debPath]);
    console.log(`Created Loom Linux x64 DEB: ${debPath}`);
  } catch (error) {
    console.error("dpkg-deb packaging failed:", error);
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}

async function run() {
  await assertExists(appPath, "Packaged Loom Linux app");
  await createTarGz();
  await createDeb();
}

await run();
