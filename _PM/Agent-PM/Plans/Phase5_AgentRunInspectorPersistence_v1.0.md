# Phase 5 Agent Run Inspector Persistence v1.0

## Objective

Connect the experimental Agent Run Inspector to durable Agent Run history APIs so developers can inspect persisted run summaries, steps, and safe event metadata.

## Scope

- Keep the existing transient live-run inspector.
- Add Loom-scoped durable history loading.
- Add selected-run step and event inspection.
- Render only safe persisted metadata.
- Keep Main generation and Quick Ask isolated.

## Privacy Rules

- Do not render prompt text.
- Do not render provider prompt envelopes.
- Do not render provider delta text from durable event logs.
- Do not render tool output summaries.
- Do not render raw thinking or hidden reasoning markers.
- Do not render credentials, Authorization headers, bearer values, API keys, secrets, or passwords.

## Technical Notes

- History APIs remain experimental and service-gated.
- The current run list API is Loom-scoped and requires a Loom ID.
- Frontend helpers stay separate from normal chat and Quick Ask clients.
- Durable event payload rendering uses an explicit allowlist.

## Changelog

- v1.0: Initial plan for durable Agent Run Inspector history integration.
