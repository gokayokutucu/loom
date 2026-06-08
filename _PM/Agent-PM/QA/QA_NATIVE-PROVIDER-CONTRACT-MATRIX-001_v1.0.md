# QA Checklist: NATIVE-PROVIDER-CONTRACT-MATRIX-001 (v1.0)

Verification checks for the contract matrix document:

## Document Structure & Content
- [x] Authentications: OpenAI (`Authorization: Bearer`), Anthropic (`x-api-key`), Gemini (`x-goog-api-key` or query param `key`).
- [x] Endpoints: OpenAI (`/v1/chat/completions`), Anthropic (`/v1/messages`), Gemini (`/v1beta/models/{model}:generateContent` / `:streamGenerateContent`).
- [x] Message shapes: OpenAI (`messages` as `[{role, content}]`), Anthropic (`messages` as `[{role, content}]` but system is top-level), Gemini (`contents` as `[{role, parts: [{text}]}]`).
- [x] Streaming events: OpenAI (standard SSE `data: {...}` chunks), Anthropic (SSE event types `message_start`, `content_block_start`, `content_block_delta`, etc.), Gemini (JSON stream array chunks).
- [x] Tool calling: OpenAI (`tools` and `tool_calls`), Anthropic (`tools` and tool/tool_result block content), Gemini (`tools` and `functionCalls`/`functionResponses`).
- [x] Usage tracking: OpenAI (`usage`), Anthropic (`usage` in message_start/message_delta), Gemini (`usageMetadata`).
- [x] Minimal smoke curls: Valid and executable examples provided for both non-streaming and streaming.
- [x] Recommendation order is justified.
