# Plan: Phase 1 Cross-Platform Build - v1.0

## Objective
Implement robust Windows and Linux build and packaging capabilities for the Loom application, supporting `x86_64-pc-windows-msvc` and `x86_64-unknown-linux-gnu` target environments, respectively.

## Scope
- Cross-platform path normalization in Electron main process (`electron/sidecar-manager.mjs`).
- Windows-specific packaging Node script (`electron/package-win.mjs`) and PNG-to-ICO converter.
- Linux-specific packaging Node script (`electron/package-linux.mjs`).
- Windows-specific distribution Node script (`electron/dist-win.mjs`) for ZIP/NSIS installers.
- Linux-specific distribution Node script (`electron/dist-linux.mjs`) for Tar/Deb installers.
- Add NPM scripts in `package.json`.

## Technical Prerequisites
- Node.js environment with workspace packages installed.
- Rust compiler and Cargo setup for target compilation.
- (Optional) NSIS installer tools for Windows executables, `dpkg-deb` for Linux packages.

## Proposed Changes
*Refer to the main `implementation_plan.md` in the agent workspace root for the file-by-file mapping.*

## Changelog
- **v1.0**: Initial design and implementation setup for Windows and Linux packaging.
