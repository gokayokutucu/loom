import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(os.tmpdir(), 'loom-cargo-target-win');

console.log(`\n--- Windows Build Pipeline ---`);
console.log(`Building Rust sidecar in temporary directory to avoid Windows file locks: ${targetDir}`);

try {
  // 1. Build the Rust sidecar using the isolated temp target directory
  execSync(`cargo build --manifest-path services/loom-service/Cargo.toml --release`, {
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    stdio: 'inherit',
    cwd: repoRoot
  });
  
  // 2. Build the React frontend
  console.log(`\nBuilding React frontend...`);
  execSync('npm run build', {
    stdio: 'inherit',
    cwd: repoRoot
  });

  // 3. Package the Electron app
  console.log(`\nPackaging Electron app...`);
  execSync('node electron/package-win.mjs', {
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    stdio: 'inherit',
    cwd: repoRoot
  });
  
  console.log(`\nWindows package built successfully!`);
} catch (error) {
  console.error("Windows build pipeline failed:", error.message);
  process.exit(1);
}
