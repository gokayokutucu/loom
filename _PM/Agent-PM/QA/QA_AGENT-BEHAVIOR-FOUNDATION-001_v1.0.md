# QA: AGENT-BEHAVIOR-FOUNDATION-001 v1.0

- [x] Scope remains runtime entity/state/event foundation only.
- [x] No provider execution behavior was added.
- [x] No tool execution, tool scheduler, planner, memory extraction, A2A, UI, or retrieval behavior was added.
- [x] AgentDefinition persistence stores refs and metadata, not prompts or instruction bodies.
- [x] AgentRun persistence stores safe identities, state, timestamps, usage counts, and safe errors only.
- [x] `parent_run_id` and `root_run_id` are supported for run trees.
- [x] Required lifecycle states and transitions are tested.
- [x] Parent cancellation cascades through descendants.
- [x] Cancellation is idempotent.
- [x] Cancellation events are emitted exactly once per cancelled run.
- [x] Durable event payloads remain safe and append-only.
- [x] Full validation stack passes.
- [x] Local commit is created and push is not performed.

## Known Limitations

- This task does not execute providers, tools, planners, memory extraction, A2A, or UI flows.
- The existing recovery compatibility state `interrupted` remains for service restart recovery alignment with the frozen canonical state-machine document.
