# Plan: Phase 4 Anthropic Native Adapter v1.0

## Objective
Implement native Anthropic Messages API support for text generation and streaming.

## Target Architecture
Loom UI -> anthropic-native profile -> AnthropicProviderAdapter -> AnthropicRuntime -> api.anthropic.com (or local mock for Level 1 compatibility)

## Technical Prerequisites
- `ProviderAdapter` and `ProviderPipeline` interfaces
- SSE stream parser in Rust for custom events
- Config variables and enums mapping
