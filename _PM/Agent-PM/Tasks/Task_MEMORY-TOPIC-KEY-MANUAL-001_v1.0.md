# Task MEMORY-TOPIC-KEY-MANUAL-001 v1.0

## Goal

Complete and prove the manual `topicKey` API surface for explicit Memory saves without adding automatic topic generation or a Memory UI.

## Checklist

- [x] Audit the existing Memory API, repository, frontend, and design contracts.
- [x] Confirm caller-provided topic keys already persist and participate in same-scope supersession.
- [x] Keep `topicKey` optional and prevent automatic generation or normalization.
- [x] Keep camelCase as the canonical JSON contract.
- [x] Reject noncanonical `topic_key` instead of silently ignoring it.
- [x] Return `topicKey` in Memory response DTOs.
- [x] Preserve deterministic validation and conflict semantics.
- [x] Keep the manual surface API-only because no Memory-save UI/client exists.
- [x] Complete automated, debug runtime, and packaged-sidecar validation.
- [x] Commit with `feat: expose manual memory topic keys`.

## Boundaries

No automatic topic generation, semantic deduplication, tag hierarchy, background extraction, Memory Graph, read-policy change, projection change, Context Manager change, Retrieval change, Main generation change, or Quick Ask change is included.
