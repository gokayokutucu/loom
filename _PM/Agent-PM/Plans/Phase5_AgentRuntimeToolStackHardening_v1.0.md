# Agent Phase 1A: Agent Runtime Tool Stack Hardening v1.0

## Objective

Apply the accepted Agent Runtime and Tool Runtime audit findings without adding tool execution, registry seeds, persistence, retrieval, MCP, or product UI behavior.

## Scope

- Make terminal run-store transitions authoritative for emitted terminal events.
- Separate structured sensitive-key redaction from free-form display text sanitization.
- Restrict isolated tool-registry construction to tests.
- Prove the AppState-owned ToolRegistry is used by the complete Agent Runtime path.
- Document and test the Arc-backed Ollama cancellation sharing contract.

## Deferred

- AppState centralized test builder.
- Visible-content sanitizer false positives.
- Static guard refactoring.
- Async synchronization conversion.
- Cancellation source metadata.
- Tool execution, seeding, permissions UI, MCP, retrieval, and persistence.

## Changelog

- v1.0: Initial hardening plan from the accepted independent audit findings.
