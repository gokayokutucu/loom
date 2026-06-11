# QA: AGENT-UI-RUN-INSPECTOR-001 v1.0

- [x] Inspector is located under Settings → Advanced, outside the primary Loom composer.
- [x] Inspector is visibly labelled Experimental.
- [x] Normal production builds hide the inspector unless explicitly enabled.
- [x] Main generation, Quick Ask, and existing chat streaming files are unchanged.
- [x] Prompt text is not persisted by the inspector.
- [x] Event rows use a safe whitelist rather than raw JSON rendering.
- [x] Production frontend bundle is fresh.
- [x] Development UI smoke shows the inspector and consumes real NDJSON events from the gated service route.
- [x] Browser smoke terminal state was safe `failed` because the selected model was unavailable; no prompt/private/provider payload appeared in rows.
- [ ] Packaged Electron app clean-start smoke remains incomplete: the existing debug runtime produced the expected fingerprint mismatch, and the isolated retry could not receive environment approval.
- [x] macOS packaged icon contract remains valid.
- [x] Final diff contains no unrelated runtime, Main generation, or Quick Ask files.
