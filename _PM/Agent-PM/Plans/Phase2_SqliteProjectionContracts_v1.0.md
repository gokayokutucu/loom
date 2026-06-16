# Phase 2 SQLite Projection Contracts v1.0

## Objective

Define the SQLite-side retrieval projection contracts required before future LanceDB and Tantivy adapters.

SQLite remains the source of truth. Future retrieval indexes are rebuildable projections that consume deterministic SQLite candidates and never mint their own canonical source identity.

## Scope

- Add canonical projection identity fields: `source_kind`, `source_id`, `chunk_ref`, `content_digest`, and `projection_version`.
- Add minimal SQLite projection lifecycle metadata tables.
- Add repository enumeration for safe projection candidates.
- Add SQLite-only rebuild planning metadata.
- Prove privacy exclusions for agent audit trails, raw thinking, provider deltas, prompt envelopes, and secrets.

## Source Eligibility Matrix

| Source | Eligibility | Notes |
| --- | --- | --- |
| Response | Eligible | Assistant/user response content owned by SQLite. |
| Reference | Eligible | Selected text, label, and target URI metadata only. |
| Attachment chunk | Eligible | Parsed attachment chunks after successful parse. |
| Memory | Eligible | Confirmed, active memories only. |
| Response capsule | Eligible | Ready response context capsule summaries. |
| Loom checkpoint | Eligible | Ready checkpoint summary artifacts. |
| Agent run | Forbidden | Audit trail, not knowledge. |
| Agent event | Forbidden | Audit trail; provider deltas are excluded. |
| Provider payload | Forbidden | Not persisted or indexed. |
| Prompt envelope | Forbidden | Not a projection source. |
| Raw thinking | Forbidden | Never indexed, embedded, persisted, exported, or used as future context. |
| Secrets/credentials | Forbidden | Rejected by projection privacy guard. |

## Identity Contract

- `source_kind`: canonical source family such as `response`, `reference`, `attachment_chunk`, `memory`, `response_capsule`, or `checkpoint`.
- `source_id`: stable SQLite source identifier.
- `chunk_ref`: stable source-local chunk reference.
- `content_digest`: SHA-256 digest of the projection content.
- `projection_version`: stable projection contract version.

## Rollout Notes

- This phase does not implement LanceDB.
- This phase does not implement Tantivy.
- This phase does not compute embeddings.
- This phase does not implement a hybrid retrieval service.
- This phase does not implement Context Manager prompt assembly.
- Retrieval engines remain candidate producers only.
