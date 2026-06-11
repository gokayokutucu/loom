# Phase 5: Experimental Agent Run Inspector Plan v1.0

## Objective

Add a minimal, gated Settings surface that can manually exercise the experimental Agent Runtime NDJSON route without changing Main generation, Quick Ask, or normal chat streaming.

## Scope

- Place the inspector in Settings → Advanced.
- Hide it outside development builds unless `VITE_ENABLE_EXPERIMENTAL_AGENT_INSPECTOR=true` is set at build time.
- Keep the experimental HTTP/NDJSON client separate from `LoomEngineClient` and normal generation clients.
- Render only whitelisted, sanitized `AgentEvent` fields.
- Keep the prompt transient in component state and the single request body.
- Validate the production frontend build, unit suite, standard Loom validation, and packaged Electron startup.

## Privacy Decisions

- No event payload JSON is rendered or persisted.
- Raw thinking, hidden reasoning, authorization values, bearer tokens, API keys, and provider raw payload fields are omitted or redacted.
- The inspector does not write to localStorage, service config, SQLite, Loom responses, diagnostics, or exports.

## Changelog

- v1.0: Initial implementation plan for AGENT-UI-RUN-INSPECTOR-001.
