# Task List: Phase 1 Cross-Platform Build - v1.0

- [x] Update path resolution logic in `electron/sidecar-manager.mjs` for `.exe` on Windows.
- [x] Create `electron/package-win.mjs` with PNG-to-ICO conversion and Windows packaging.
- [x] Create `electron/package-linux.mjs` for Linux packaging.
- [x] Create `electron/dist-win.mjs` for Windows zip and NSIS installers.
- [x] Create `electron/dist-linux.mjs` for Linux tar.gz and deb installers.
- [x] Add `electron:package:win`, `electron:dist:win`, `electron:package:linux`, and `electron:dist:linux` commands to `package.json`.
- [x] Run `npm run service:check` and `npm run service:test` to verify Rust sidecar builds.
- [x] Run `npm run build` to verify React UI compiles successfully.
- [x] Run `npm run test:e2e`.
- [x] Execute `npm run electron:package:win` to verify Windows packaging manually.
- [x] Fix Windows `os error 2` lock issue by creating `build-win.mjs` wrapper and isolated cargo target directory.
- [x] Fix Windows `spawn UNKNOWN` bug by replacing `new URL(import.meta.url).pathname` with `fileURLToPath(import.meta.url)` in `sidecar-manager.mjs` to resolve `cwd` correctly.
