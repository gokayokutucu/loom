# Agent Phase 1B: Agent Run Persistence Post-Validation Plan v1.0

## Objective

Audit commit `7e61710` against its persistence, terminal consistency, step history, and privacy claims. Apply only blocking correctness fixes found by the audit.

## Scope

- Verify migration 0022 and repository contracts.
- Verify AgentRun identity remains independent from Response identity.
- Verify terminal status and terminal event consistency.
- Verify runtime step lifecycle persistence.
- Verify durable event payload allowlisting and credential rejection.
- Verify startup recovery and gated history routes.
- Verify Main generation and Quick Ask isolation.
- Validate fresh debug and packaged release sidecars.

## Accepted Audit Findings

- Terminal retries could append a second terminal event after the stored run was already terminal.
- Runtime emitted step events but did not write `agent_steps` rows.
- Durable event storage rejected raw-thinking markers but did not independently reject credential-shaped payloads.
- The required task test evidence document was missing.

## Out of Scope

- Main generation changes.
- Quick Ask changes.
- Tool execution, MCP, retrieval, or vector databases.
- Provider prompt or delta persistence.

## Changelog

- v1.0: Initial post-implementation audit and targeted hardening plan.
