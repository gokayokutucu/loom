# Native Provider Contract Matrix

This document defines the native API contracts for OpenAI, Anthropic Claude, and Google Gemini Developer APIs. It serves as the architectural reference matrix before implementing native backend adapters.

---

## 1. Comparison Matrix

| Property | OpenAI API | Anthropic Claude API | Google Gemini API |
| :--- | :--- | :--- | :--- |
| **API Protocol & Auth** | Custom Headers<br>`Authorization: Bearer <API_KEY>` | Custom Headers<br>`x-api-key: <API_KEY>`<br>`anthropic-version: 2023-06-01` | Custom Headers or Query Parameter<br>`x-goog-api-key: <API_KEY>`<br>OR `?key=<API_KEY>` |
| **Request Endpoint** | POST `/v1/chat/completions` | POST `/v1/messages` | POST `/v1beta/models/{model}:generateContent` (Unary)<br>POST `/v1beta/models/{model}:streamGenerateContent` (Streaming) |
| **Request Body Shape** | `{"model": "...", "messages": [...], "stream": true, "temperature": 0.7, "max_tokens": 100}` | `{"model": "...", "messages": [...], "system": "...", "stream": true, "max_tokens": 1024}` | `{"contents": [...], "systemInstruction": {...}, "generationConfig": {"temperature": 0.7, "maxOutputTokens": 100}}` |
| **Message Structure** | Array of `{role, content}`<br>Roles: `system`, `user`, `assistant`, `tool`<br>Content: String or Multi-modal array. | Array of `{role, content}`<br>Roles: `user`, `assistant` (System is top-level)<br>Content: String or array of block objects. | Array of `{role, parts}`<br>Roles: `user`, `model`<br>Parts: Array of `{text}`, `{inlineData}`, `{functionCall}`, or `{functionResponse}` |
| **System Prompt** | Inline as a message block with `"role": "system"` | Top-level string field: `"system": "..."` | Top-level object field:<br>`"systemInstruction": {"parts": [{"text": "..."}]}` |
| **Streaming Protocol** | Server-Sent Events (SSE)<br>`data: {JSON}`<br>Terminal chunk: `data: [DONE]` | Server-Sent Events (SSE) with custom events<br>`event: <type>` followed by `data: {JSON}` | Chunked Transfer Encoding<br>Returns a JSON array of objects over time:<br>`[\n  {...chunk1...},\n  {...chunk2...}\n]` |
| **Streaming Events** | `data: {"choices": [{"delta": {"content": "..."}}]}` | Multiple event types:<br>- `message_start` (metadata)<br>- `content_block_start`<br>- `content_block_delta` (holds `delta.text`)<br>- `content_block_stop`<br>- `message_delta` (metadata)<br>- `message_stop` | JSON chunks with candidates array:<br>`{"candidates": [{"content": {"parts": [{"text": "..."}]}}]}` |
| **Tool Calling Format** | **Request:** `tools: [{"type": "function", "function": {name, description, parameters}}]`<br>**Response:** `choices[0].message.tool_calls: [{"id", "type": "function", "function": {name, arguments}}]` | **Request:** `tools: [{"name", "description", "input_schema"}]`<br>**Response:** Content block with `"type": "tool_use"` containing `{"id", "name", "input"}` | **Request:** `tools: [{"functionDeclarations": [{name, description, parameters}]}]`<br>**Response:** Part with `"functionCall"` containing `{"name", "args"}` |
| **Usage/Token Reporting** | Returned in `usage` object:<br>`{"prompt_tokens", "completion_tokens", "total_tokens"}`<br>In streams: included in the final chunk if `stream_options.include_usage` is set. | Returned in `usage` object within:<br>- `message_start` (`input_tokens`)<br>- `message_delta` (`output_tokens`) | Returned in `usageMetadata` object in the last chunk of the stream:<br>`{"promptTokenCount", "candidatesTokenCount", "totalTokenCount"}` |
| **Error Shape** | `{"error": {"message": "...", "type": "...", "code": "..."}}` | `{"type": "error", "error": {"type": "...", "message": "..."}}` | `{"error": {"code": 400, "message": "...", "status": "INVALID_ARGUMENT"}}` |
| **Rate-Limit Headers** | Yes:<br>- `x-ratelimit-remaining-requests`<br>- `x-ratelimit-remaining-tokens`<br>- `x-ratelimit-reset-requests` | Yes:<br>- `anthropic-ratelimit-requests-remaining`<br>- `anthropic-ratelimit-tokens-remaining`<br>- `anthropic-ratelimit-input-tokens-remaining` | No. Rate limit exceeded returns HTTP 429 (`RESOURCE_EXHAUSTED`) with no counters in headers. |
| **Cancellation** | Aborting HTTP stream connection stops server-side generation within a few tokens. | Aborting HTTP stream connection stops server-side generation. | Aborting HTTP stream connection stops server-side generation. |

---

## 2. Minimal Smoke Request Templates

### OpenAI

#### Non-Streaming Smoke Request
```bash
curl -X POST https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello"}
    ],
    "max_tokens": 50
  }'
```

#### Streaming Smoke Request
```bash
curl -X POST https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello"}
    ],
    "stream": true,
    "stream_options": {"include_usage": true},
    "max_tokens": 50
  }'
```

---

### Anthropic Claude

#### Non-Streaming Smoke Request
```bash
curl -X POST https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "system": "You are a helpful assistant.",
    "messages": [
      {"role": "user", "content": "Hello"}
    ],
    "max_tokens": 50
  }'
```

#### Streaming Smoke Request
```bash
curl -X POST https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "system": "You are a helpful assistant.",
    "messages": [
      {"role": "user", "content": "Hello"}
    ],
    "stream": true,
    "max_tokens": 50
  }'
```

---

### Google Gemini

#### Non-Streaming Smoke Request
```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [{"text": "Hello"}]
      }
    ],
    "systemInstruction": {
      "parts": [{"text": "You are a helpful assistant."}]
    },
    "generationConfig": {
      "maxOutputTokens": 50
    }
  }'
```

#### Streaming Smoke Request
```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [{"text": "Hello"}]
      }
    ],
    "systemInstruction": {
      "parts": [{"text": "You are a helpful assistant."}]
    },
    "generationConfig": {
      "maxOutputTokens": 50
    }
  }'
```

---

## 3. Recommended Native Adapter Implementation Order

We recommend implementing the native adapters in the following order:

1. **OpenAI Native**:
   - *Rationale*: OpenAI's JSON message structures, configuration layout, and standard SSE streaming framing are widely used as the default interface across many mock systems and developer proxies. Starting here defines the clean native interface contract in Rust and implements the baseline unit tests.
2. **Anthropic Native**:
   - *Rationale*: Uses a standard SSE connection but requires custom stream decoding to handle various event envelopes (`content_block_start`, `content_block_delta`, `message_delta`, etc.) instead of a unified message chunk structure. Implementing it second expands the stream parsing framework to handle advanced event lifecycle hooks.
3. **Gemini Native**:
   - *Rationale*: Gemini deviates significantly from both OpenAI and Anthropic by using distinct fields (`contents`/`parts` vs `messages`, `systemInstruction` vs `system`), different parameter names (`maxOutputTokens` vs `max_tokens`), and a chunked JSON array stream format instead of standard Server-Sent Events. Implementing it last ensures that the service's adapter abstractions are sufficiently general to handle non-SSE streaming and unique serialization layouts.
