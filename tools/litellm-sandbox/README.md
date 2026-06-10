# LiteLLM Sandbox — Loom Provider Integration Sandbox

A **local-only, optional** gateway for testing Loom's OpenAI-compatible provider
path against real hosted models (OpenAI, Anthropic, Gemini) and local Ollama
models — without touching Loom's core Rust or frontend code.

> **Scope boundary**
> LiteLLM is not a Loom core dependency and is not imported anywhere in the
> Loom source tree. Loom talks to this sandbox exactly as it would to any
> `native_openai_compatible` provider profile — via HTTP on port 4000.

---

## Contents

```
tools/litellm-sandbox/
├── docker-compose.yml     # Starts the LiteLLM proxy container
├── litellm_config.yaml    # Model aliases and gateway settings
├── .env.example           # Template for API keys (copy to .env, never commit)
├── scripts/
│   └── smoke.sh           # Quick smoke test (curl + validation)
└── README.md              # This file
```

---

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Docker Desktop (macOS) | 4.x | Or any Docker engine + Compose v2+ |
| `docker compose` | v2 / v5 | `docker compose version` to check |
| `curl` | any | For the smoke test |
| `jq` | any | Optional — smoke output is shown either way |

---

## Quick start

### 1. Copy the env template

```bash
cd tools/litellm-sandbox
cp .env.example .env
```

Open `.env` and fill in only the keys for the providers you want to test:

```dotenv
LITELLM_MASTER_KEY=loom-sandbox-key-change-me   # change this to anything non-empty
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...
```

Leave any unused provider key blank — LiteLLM will simply skip aliases that
have no key.

### 2. Start the sandbox

```bash
docker compose up -d
docker compose logs -f     # watch startup; ready when you see "LiteLLM: Uvicorn running"
```

The proxy listens on **`http://127.0.0.1:4000`** with an OpenAI-compatible API.

### 3. Run the smoke test

```bash
./scripts/smoke.sh
# or pick a model alias:
MODEL=claude-3-haiku ./scripts/smoke.sh
MODEL=gemini-2.0-flash ./scripts/smoke.sh
MODEL=ollama-qwen ./scripts/smoke.sh
```

### 4. Stop the sandbox

```bash
docker compose down
```

---

## Manual curl example

```bash
curl -s http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer loom-sandbox-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello from Loom sandbox"}],
    "stream": false
  }' | jq .choices[0].message.content
```

Streaming (SSE) request:

```bash
curl -s http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer loom-sandbox-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Count to 5"}],
    "stream": true
  }'
```

---

## How to point Loom at this sandbox

The sandbox speaks the standard OpenAI streaming SSE protocol. Any Loom
provider profile that uses `transportKind: native_openai_compatible` can be
aimed at it.

### Option A — Loom Settings UI (when provider profile UI is wired)

1. Open Loom → Settings → Providers
2. Add a new remote profile:
   - **Base URL**: `http://127.0.0.1:4000/v1`
   - **API key**: value of `LITELLM_MASTER_KEY` from your `.env`
   - **Model**: one of the aliases in `litellm_config.yaml` (e.g. `gpt-4o-mini`)

### Option B — E2E environment variable (experimental Rig path)

```bash
LOOM_SERVICE_E2E_PROVIDER=rig-openai-compatible \
LOOM_SERVICE_E2E_OPENAI_BASE_URL=http://127.0.0.1:4000/v1 \
LOOM_SERVICE_E2E_OPENAI_API_KEY=loom-sandbox-key-change-me \
  ./services/loom-service/target/debug/loom-service
```

### Option C — Provider profile config (static YAML/TOML when supported)

When Loom gains static provider profile loading, point the profile's
`base_url` at `http://127.0.0.1:4000/v1` and set `transport_kind:
native_openai_compatible`.

---

## Available model aliases

| Alias | Provider | Requires |
|---|---|---|
| `gpt-4o` | OpenAI | `OPENAI_API_KEY` |
| `gpt-4o-mini` | OpenAI | `OPENAI_API_KEY` |
| `claude-3-5-sonnet` | Anthropic | `ANTHROPIC_API_KEY` |
| `claude-3-haiku` | Anthropic | `ANTHROPIC_API_KEY` |
| `gemini-2.0-flash` | Google | `GEMINI_API_KEY` |
| `gemini-1.5-pro` | Google | `GEMINI_API_KEY` |
| `ollama-qwen` | Local Ollama | Ollama running on host |

Add or remove aliases freely in `litellm_config.yaml` — no Loom code changes
required.

---

## What is intentionally out of scope

| Excluded | Reason |
|---|---|
| Importing LiteLLM into Rust or TypeScript | LiteLLM is a sandbox tool, not a Loom dependency |
| Committing `.env` or real API keys | Covered by root `.gitignore` |
| Using this container in CI | No live provider keys in CI; use Loom's fake-server tests instead |
| Replacing Loom's native Ollama path | Ollama runs natively; this sandbox is for hosted provider testing only |
| Production deployment | This is a local dev sandbox only |
| Persistent LiteLLM database | Stateless proxy only; no SQLite or Redis wired |

---

## Health check

```bash
# Proxy liveness (no auth required):
curl -sf http://127.0.0.1:4000/health/liveliness && echo "alive"

# Proxy readiness (no auth required):
curl -sf http://127.0.0.1:4000/health/readiness && echo "ready"

# List configured models (requires master key):
curl -s http://127.0.0.1:4000/v1/models \
  -H "Authorization: Bearer loom-sandbox-key-change-me" | jq .
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Container exits immediately | Run `docker compose logs loom-litellm-sandbox` — usually a missing or malformed `litellm_config.yaml` |
| `401 Unauthorized` | Check `LITELLM_MASTER_KEY` in `.env` matches what you send in `Authorization: Bearer` |
| `Model not found` | Alias is not in `litellm_config.yaml` or the provider key is blank in `.env` |
| Ollama alias fails | Ollama must be running on the host; check `OLLAMA_BASE_URL` in `.env` |
| `Connection refused :4000` | Container not started; run `docker compose up -d` |

---

## Follow-up tasks (NEXT candidates)

- `LITELLM-SANDBOX-002` — Wire a named Loom provider profile config entry that
  points to the sandbox by default when `LOOM_SANDBOX_PROVIDER=litellm` is set.
- `LITELLM-SANDBOX-003` — Add an E2E test that starts the sandbox container,
  sends a `/ask/quick` request through `loom-service`, and validates the
  streaming contract — using a deterministic echo model to avoid live API calls.
- `LITELLM-SANDBOX-004` — Add a `--sandbox` flag to `loom.sh` that starts and
  stops the container around a targeted E2E run.
