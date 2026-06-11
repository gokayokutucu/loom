# Test: AGENT-RUNTIME-FOUNDATION-001 v1.0

- [ ] Run sequence verification test: verify `RunStarted` -> `StepStarted(ProviderCall)` -> `ProviderDelta` -> `ProviderCompleted` -> `RunCompleted` event flow.
- [ ] Raw thinking/reasoning privacy test: verify `ThinkingDelta` and `ThinkingStatus` are ignored, and that serialized `AgentEvent` payloads do not contain forbidden strings (`raw_thinking`, `thinking_text`, `chain_of_thought`, `hidden_reasoning`).
- [ ] Error mapping test: verify that provider errors result in a safe `RunFailed` event.
- [ ] Placeholder steps test: verify that `ContextBuild`, `ToolCallPlaceholder`, `ArtifactPlaceholder`, and `ValidationPlaceholder` emit correct start/completion events without executing actual functionality.
- [ ] Verify that existing Main generation and Quick Ask unit and E2E tests still pass without regressions.
