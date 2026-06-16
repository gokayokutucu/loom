# Test AGENT-RUN-INSPECTOR-PERSISTENCE-001 v1.0

## Test Plan

- [x] Inspector remains hidden when the experimental UI gate is disabled.
- [x] Inspector renders explicit experimental labeling when enabled.
- [x] Recent Runs section is visible when inspector is enabled.
- [x] History helper calls the experimental durable run list endpoint.
- [x] History helper requires a Loom ID before making a request.
- [x] Disabled experimental history route is surfaced as a safe unavailable message.
- [x] Selecting a run can load steps and events through durable endpoints.
- [x] Durable event payloads are allowlisted.
- [x] Provider delta text is not exposed by durable event rendering.
- [x] Prompt-like fields are not exposed by durable event rendering.
- [x] Authorization-like values are not exposed by durable event rendering.
- [x] Normal Main generation endpoint is not called by inspector helpers.
- [x] Quick Ask endpoint is not called by inspector helpers.
- [x] Full frontend and service validation passes.
- [x] Electron packaged validation passes.

## Expected Commands

- `npm run build`
- `npm run test:unit`
- `./loom.sh --publish --test`
- `npm run electron:package:dev`
