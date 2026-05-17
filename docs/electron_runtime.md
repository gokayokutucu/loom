# Electron Runtime Shell

Loom supports two UI hosts over the same React/Vite renderer:

- Web mode: Vite/browser deployment uses the existing `/__loom` proxy to reach a developer or deployed `loom-service`.
- Electron mode: the Electron main process starts a local Rust `loom-service` sidecar, verifies `/health`, and then loads the same React app.

## Runtime Authority

The Rust `loom-service` remains the product runtime authority. Electron is only a desktop shell and sidecar lifecycle owner. The renderer does not spawn processes, read SQLite, write config files directly, or hold provider secrets.

TypeScript-local runtime remains explicit legacy/dev/test scaffolding only. Electron does not reintroduce TypeScript fallback for product flows.

## Sidecar Lifecycle

In development, Electron resolves the sidecar binary at:

```text
services/loom-service/target/debug/loom-service
```

Electron chooses an available local port starting at `17633`, starts the sidecar with non-secret environment overrides, and waits for:

```text
GET /health
```

The health response must report `runtime = "loom-service"` with ready database and config status before the React UI is loaded.

Development Electron config is isolated under:

```text
services/loom-service/.data/electron-dev/
```

In default development mode, Electron uses its own sidecar process and config file, but points that config at the shared web/dev SQLite database:

```text
services/loom-service/.data/loom.db
```

This mode is reported as `shared-dev`. It lets the Vite/browser app and Electron app see the same Looms, Responses, Bookmarks, and History while still keeping service process ownership separate. It is intended for one active host at a time; simultaneous writes from two service processes can still contend on SQLite locks.

For isolated desktop testing, set:

```text
LOOM_ELECTRON_DATA_MODE=isolated-dev
```

That mode uses:

```text
services/loom-service/.data/electron-dev/loom.db
```

Packaged Electron builds use the app user data directory for both config and SQLite data.

Electron does not kill or reuse unrelated browser/dev `loom-service` processes. Electron only stops or restarts the child process it started.

On app quit, Electron sends a graceful termination signal to its own sidecar and falls back to a forced child-process kill only for that Electron-owned process. Unknown services on nearby ports are never killed automatically.

## Settings Restart

Settings -> Runtime exposes a desktop-only "Restart local runtime" action. The button calls the narrow preload runtime bridge:

```text
window.loomDesktop.runtime.status()
window.loomDesktop.runtime.restart()
```

The renderer cannot choose a binary path, port, command, environment, or process id. The Electron main process restarts only its tracked child process, starts the known `loom-service` binary again, waits for `/health`, and returns the new status with PID, port, service URL, binary path, DB path, config path, and last checked time.

In web mode the restart action is disabled with explanatory copy because browser deployments do not own a local runtime process.

## Renderer Endpoint

Web mode keeps the default service URL:

```text
/__loom
```

Electron mode exposes only a narrow preload bridge:

```text
window.loomDesktop.getRuntimeInfo()
```

The renderer reads `serviceUrl` from that bridge and sends service calls directly to the Electron-started local sidecar. No broad filesystem, process, or secret bridge is exposed.

## Security Defaults

The Electron window uses:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- a narrow preload surface for runtime info/status/restart and window controls only

The renderer cannot execute arbitrary commands or manage SQLite directly.

## Packaging Status

Dev packaging is available as a local unsigned `.app` artifact:

```text
npm run electron:package:dev
```

The command builds the Rust sidecar, builds the shared React renderer, copies Electron's local app template, and bundles:

- `dist/`
- `electron/main.mjs`
- `electron/preload.cjs`
- `electron/sidecar-manager.mjs`
- `services/loom-service/target/debug/loom-service`

The generated app is:

```text
dist-electron/Loom.app
```

This is a developer artifact only. It is not signed, notarized, or wrapped in a DMG. Production signing, notarization, auto-update, Ollama onboarding, and Whisper/STT binary onboarding remain future work.
