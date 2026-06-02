import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8")).version ?? "0.1.0";
const releaseDir = path.join(repoRoot, "release");
const appPath = path.join(repoRoot, "dist-electron", "Loom-win32-x64");
const zipPath = path.join(releaseDir, `Loom-${version}-win-x64.zip`);
const setupPath = path.join(releaseDir, `Loom-${version}-Setup.exe`);

async function assertExists(target, label) {
  try {
    await fs.access(target);
  } catch {
    throw new Error(`${label} is missing at ${target}`);
  }
}

async function createZip() {
  await fs.mkdir(releaseDir, { recursive: true });
  await fs.rm(zipPath, { force: true });
  console.log("Creating ZIP archive...");
  try {
    // PowerShell Compress-Archive is built-in on Windows 10+
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${appPath}\\*' -DestinationPath '${zipPath}' -Force`
    ]);
    console.log(`Created Loom Windows x64 ZIP: ${zipPath}`);
  } catch (error) {
    console.warn("Failed to create ZIP archive using PowerShell:", error);
  }
}

async function findMakensis() {
  const commonPaths = [
    "makensis",
    "C:\\Program Files (x86)\\NSIS\\makensis.exe",
    "C:\\Program Files\\NSIS\\makensis.exe",
  ];
  for (const p of commonPaths) {
    try {
      if (p === "makensis") {
        await execFileAsync("makensis", ["/VERSION"]);
        return p;
      }
      await fs.access(p);
      return p;
    } catch {
      // ignore
    }
  }
  return null;
}

async function createInstaller() {
  const makensisPath = await findMakensis();
  if (!makensisPath) {
    console.log("NSIS (makensis) not found. Skipping Setup executable generation.");
    console.log("To build an installer, please install NSIS from https://nsis.sourceforge.io/");
    return;
  }

  console.log(`Found NSIS at ${makensisPath}. Creating Setup executable...`);
  
  const nsiScriptPath = path.join(releaseDir, "installer.nsi");
  const iconPath = path.join(appPath, "resources", "loom_logo.ico");

  // A basic NSIS script to package the directory
  const nsiContent = `
!define APP_NAME "Loom"
!define APP_VERSION "${version}"
!define APP_EXE "Loom.exe"

OutFile "${setupPath}"
InstallDir "$PROGRAMFILES64\\Loom"
RequestExecutionLevel admin

Page directory
Page instfiles

Section "Loom"
  SetOutPath $INSTDIR
  File /r "${appPath}\\*.*"
  CreateShortcut "$SMPROGRAMS\\Loom.lnk" "$INSTDIR\\Loom.exe" "" "${iconPath}" 0
  CreateShortcut "$DESKTOP\\Loom.lnk" "$INSTDIR\\Loom.exe" "" "${iconPath}" 0
  
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Loom" "DisplayName" "\${APP_NAME}"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Loom" "UninstallString" '"$INSTDIR\\Uninstall.exe"'
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\\Loom.lnk"
  Delete "$DESKTOP\\Loom.lnk"
  DeleteRegKey HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Loom"
SectionEnd
  `;

  await fs.writeFile(nsiScriptPath, nsiContent);

  try {
    await execFileAsync(makensisPath, [nsiScriptPath]);
    console.log(`Created Loom Windows x64 Setup: ${setupPath}`);
  } catch (error) {
    console.error("NSIS compilation failed:", error);
  } finally {
    await fs.rm(nsiScriptPath, { force: true });
  }
}

async function run() {
  await assertExists(appPath, "Packaged Loom Windows app");
  await createZip();
  await createInstaller();
}

await run();
