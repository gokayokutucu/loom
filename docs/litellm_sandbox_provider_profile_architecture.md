# Architecture Note: Provider Profile Abstraction

**Task:** LITELLM-SANDBOX-002  
**Branch:** feature/litellm-sandbox-001  
**Date:** 2026-06-06  
**Status:** infrastructure-only, no UI, no runtime behavior change unless env-var activated

---

## Current Provider Flow (Before This Task)

```
LOOM_SERVICE_CONFIG_PATH
        │
        ▼
load_or_create_config()
  └─ parse loom-service.toml
        │
        ▼
LoomServiceConfig {
  providers: ProviderSection {
    main_provider_profile_id: Option<String>,   // which profile is active
    main_model_id: Option<String>,              // explicit model for main gen
    profiles: Vec<ProviderProfileConfig>,       // all profiles
  }
}
        │
        ▼
apply_env_overrides_from()
  ├─ LOOM_SERVICE_E2E_PROVIDER_PROFILE=nvidia  → inject & select nvidia profile
  └─ LOOM_SERVICE_E2E_ENABLE_PROVIDER_PROFILE=nvidia → inject but keep Ollama active
        │
        ▼
validate_config()
  └─ validate_provider_profiles()
  └─ validate_main_provider_assignment()
        │
        ▼
ProviderRegistry::new_for_main_generation(config, secret_store)
  ├─ if main_provider_profile_id is set AND matching enabled OpenAiCompatible profile:
  │    → OpenAiCompatibleProviderAdapter (resolves secret from ProviderSecretStore)
  └─ else → OllamaProviderAdapter (fallback, always present)
        │
        ▼
GET /providers → RuntimeProviderStatus[] → Frontend
```

### Provider Profile Data Contract

```rust
ProviderProfileConfig {
    id: String,                          // unique profile key
    provider_kind: ProviderKind,         // Ollama | OpenAiCompatible | CustomHttpLater
    transport_kind: ProviderTransportKind, // Ollama | NativeOpenAiCompatible | RigOpenAiCompatible
    vendor: ProviderVendor,              // Ollama | Nvidia | OpenAi | Custom
    display_name: String,
    enabled: bool,
    experimental: bool,
    base_url: Option<String>,
    default_model: Option<String>,
    requires_secret: bool,
    secret_ref: Option<String>,          // "env:VAR" or "provider:<id>:apiKey"
    model_discovery: ProviderModelDiscoveryConfig,
    request_defaults: ProviderRequestDefaultsConfig,
    security: ProviderSecurityPolicyConfig,
    capabilities: ProviderCapabilitiesConfig,
    metadata_json: Option<Value>,
}
```

### Secret Handling

Secrets are NEVER stored in config or serialized to TOML. Two mechanisms exist:

1. `env:<UPPERCASE_VAR>` — resolved from process environment at request time, read-only via API.
2. `provider:<profileId>:apiKey` — in-memory `Arc<RwLock<HashMap>>`, set via `/provider-secrets` REST API, cleared on service restart.

---

## Proposed Provider Profile Model (Task Interface)

The task specification requested:

```typescript
interface ProviderProfile {
  id: string
  name: string
  baseUrl: string
  apiKey?: string
  providerKind: "openai" | "litellm" | "local" | "mock"
}
```

**Resolution:** The existing `ProviderProfileConfig` already satisfies this contract with stronger typing:

| Requested field | Existing field | Notes |
|---|---|---|
| `id` | `id: String` | exact match |
| `name` | `display_name: String` | camelCase in frontend: `displayName` |
| `baseUrl` | `base_url: Option<String>` | camelCase: `baseUrl` |
| `apiKey` | `secret_ref: Option<String>` | never stored as raw key; indirected through SecretStore |
| `providerKind: "litellm"` | `vendor: ProviderVendor::Custom` + `metadata_json.sandboxTool` | LiteLLM is identified by profile ID and metadata, not a new enum variant |

**Design decision:** No new `ProviderVendor::LiteLLM` variant was added.
- Adding a new enum variant to `ProviderVendor` would require changes to: `config.rs` TOML parser, `adapter.rs` match arms, frontend `ProviderVendor` union type, and serialization tests.
- `ProviderVendor::Custom` already exists for exactly this scenario — a third-party gateway that uses an existing transport protocol.
- LiteLLM is identifiable by: `profile.id == "litellm-sandbox"`, `vendor == Custom`, and `metadata_json.sandboxTool == "tools/litellm-sandbox"`.

---

## What Was Added (This Task)

### 1. `ProviderProfileConfig::litellm_sandbox_example()` — `providers/config.rs`

A profile factory following the same pattern as `nvidia_openai_compatible_example()`:

```
id:              "litellm-sandbox"
provider_kind:   OpenAiCompatible
transport_kind:  NativeOpenAiCompatible
vendor:          Custom
enabled:         false  (default-off)
experimental:    true
base_url:        "http://127.0.0.1:4000/v1"
default_model:   None   (must be supplied via env)
requires_secret: true
secret_ref:      "env:LOOM_LITELLM_API_KEY"
allow_insecure_http_remote: true  (localhost sandbox)
```

### 2. `apply_e2e_litellm_sandbox_profile()` — `config.rs`

Function that applies the litellm-sandbox profile at startup from env vars:

| Env Var | Purpose |
|---|---|
| `LOOM_SERVICE_E2E_PROVIDER_PROFILE=litellm-sandbox` | Inject and select as main provider |
| `LOOM_SERVICE_E2E_ENABLE_PROVIDER_PROFILE=litellm-sandbox` | Inject but keep Ollama as main |
| `LOOM_LITELLM_BASE_URL` | Override base URL (default: `http://127.0.0.1:4000/v1`) |
| `LOOM_LITELLM_MODEL` | Model alias to use (required when selecting for main) |
| `LOOM_LITELLM_API_KEY` | LiteLLM master key (resolved via `env:LOOM_LITELLM_API_KEY`) |

### 3. `apply_env_overrides_from()` — `config.rs`

Two new branches in the env-override dispatcher:
```
LOOM_SERVICE_E2E_PROVIDER_PROFILE=litellm-sandbox → select for main
LOOM_SERVICE_E2E_ENABLE_PROVIDER_PROFILE=litellm-sandbox → inject only
```

### 4. Tests — `config.rs` (4 new)

| Test | Proves |
|---|---|
| `litellm_sandbox_example_is_disabled_by_default` | Profile disabled by default, not in default config |
| `e2e_litellm_sandbox_profile_selects_for_main` | Full injection + main selection + secret safety |
| `e2e_litellm_sandbox_enable_does_not_select_main` | Enable-only path keeps Ollama active |
| `e2e_litellm_sandbox_profile_errors_without_model` | Missing model fails with clear message |

---

## Files Affected

| File | Change |
|---|---|
| `services/loom-service/src/providers/config.rs` | +`litellm_sandbox_example()` factory method |
| `services/loom-service/src/config.rs` | +`apply_e2e_litellm_sandbox_profile()`, +env-var branches, +4 tests |
| `tools/litellm-sandbox/docker-compose.yml` | (SANDBOX-001) Container definition |
| `tools/litellm-sandbox/litellm_config.yaml` | (SANDBOX-001) Model aliases |
| `tools/litellm-sandbox/.env.example` | (SANDBOX-001) Key template |
| `tools/litellm-sandbox/README.md` | (SANDBOX-001) Updated with Loom env vars |
| `tools/litellm-sandbox/scripts/smoke.sh` | (SANDBOX-001) Smoke test |
| `.gitignore` | (SANDBOX-001) Explicit sandbox .env exclusion |

---

## What Was NOT Changed

- No new `ProviderVendor` enum variant → no serialization/frontend breaking change
- No UI components modified
- No settings screens added
- No `PATCH /config` handler changed
- No `GET /providers` handler changed
- No Ollama path modified
- No OpenAI/NVIDIA path modified
- No secrets stored anywhere

---

## Migration Risk

| Risk | Level | Mitigation |
|---|---|---|
| Existing Ollama path broken | None | No changes to Ollama adapter or selection logic |
| Existing NVIDIA/OpenAI path broken | None | Both selection branches (`nvidia` vs `litellm-sandbox`) are independent `else if` chains |
| Secret leaked via config serialization | None | `requires_secret=true` + `secret_ref="env:..."` pattern prevents any key from hitting TOML or API |
| Profile appears without opt-in | None | `enabled: false` in template, only injected when specific env vars are set |
| validate_config rejects litellm profile | None | 4 tests verify round-trip through `validate_config()` |
| Frontend shows unknown vendor | Minimal | `vendor: "custom"` is already a valid `ProviderVendor` in frontend types |

---

## How to Activate the LiteLLM Sandbox

```bash
# 1. Start the sandbox
cd tools/litellm-sandbox
cp .env.example .env && vim .env   # fill in LITELLM_MASTER_KEY + at least one API key
docker compose up -d

# 2. Start loom-service targeting the sandbox as main provider
LOOM_SERVICE_E2E_PROVIDER_PROFILE=litellm-sandbox \
LOOM_LITELLM_BASE_URL=http://127.0.0.1:4000/v1 \
LOOM_LITELLM_MODEL=gpt-4o-mini \
LOOM_LITELLM_API_KEY=loom-sandbox-key-change-me \
  ./services/loom-service/target/debug/loom-service

# 3. Verify the profile is visible
curl -s http://127.0.0.1:17633/providers | jq '.[] | select(.providerProfileId=="litellm-sandbox")'
```

---

## Follow-up Tasks

| ID | Description |
|---|---|
| `LITELLM-SANDBOX-003` | E2E streaming test: start sandbox container, route `/ask/quick` through `loom-service`, validate `ProviderContractEvent` stream |
| `PROVIDER-ABSTRACTION-001` | TypeScript-layer `ProviderProfile` hook that surfaces sandbox profile in UI without modifying core types |
| `LITELLM-SANDBOX-004` | Add `--sandbox` flag to `loom.sh` that starts/stops the container around a targeted E2E run |
