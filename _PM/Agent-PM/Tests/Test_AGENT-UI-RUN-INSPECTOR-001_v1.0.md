# Test: AGENT-UI-RUN-INSPECTOR-001 v1.0

- [x] Inspector renders nothing when its frontend gate is disabled.
- [x] Development or explicit build gate enables the inspector.
- [x] Start uses only `POST /__loom/experimental/agent/run`.
- [x] Split NDJSON chunks parse incrementally into safe event rows.
- [x] Terminal completed, failed, and cancelled event types map to stable UI status.
- [x] Raw thinking, hidden reasoning, credentials, and provider raw payloads are not rendered.
- [x] Non-200, invalid JSON, empty stream, and missing-terminal failures produce safe errors.
- [x] Static guard proves the inspector client does not call Main generation or Quick Ask endpoints.
- [x] `npm run test:unit` passes: 32 files, 553 tests.
- [x] `npm run build` passes.
- [x] `./loom.sh --publish --test` passes after rerunning with local port binding allowed: 767 Rust tests and 553 frontend tests.
- [x] `npm run electron:package:dev` produces `dist-electron/Loom.app`.
- [x] Packaged icon source/resource match, `CFBundleIconFile=loom_logo.icns`, and `electron.icns` is absent.
- [ ] Clean packaged startup on an isolated service port; environment approval was unavailable after the expected mismatch check against the running debug service.
