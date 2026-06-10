# Plan: Phase 4 Gemini Native Adapter v1.0

## Objective
Implement a native Google Gemini provider adapter using Loom’s existing `ProviderAdapter` and `ProviderPipeline` contracts. This includes unary and streaming text generation support directly speaking the Gemini API contract (`generateContent` / `streamGenerateContent`), without depending on LiteLLM or OpenAI-compatible wrappers.

## Target Architecture
Loom UI -> gemini-native profile -> GeminiProviderAdapter -> GeminiRuntime -> api.generativelanguage.googleapis.com (or fake local endpoint for Level 1 compatibility)

## Technical Prerequisites
- `ProviderAdapter` and `ProviderPipeline` interfaces.
- Custom stateful brace-balanced JSON stream parser in Rust to extract and parse individual JSON objects from the chunked JSON array response.
- Config enums, override mappings, environment overrides, and capability routing.
