# PROVIDER-PROFILE-CONFIG-REMOTE-001

## Objective

Prepare non-secret provider profile configuration for remote OpenAI-compatible providers without enabling them by default.

## Checklist

- [x] Audit existing provider profile config fields.
- [x] Preserve existing Ollama default behavior.
- [x] Add explicit provider transport and vendor fields.
- [x] Keep remote providers disabled unless configured.
- [x] Preserve `secretRef` as the only secret pointer in config.
- [x] Add NVIDIA OpenAI-compatible disabled example profile shape.
- [x] Validate invalid `secretRef` and raw secret-looking config values.
- [x] Keep Rig transport feature-gated.
- [x] Run Rust/service/frontend validation.

## Notes

No Settings UI, live provider calls, or default provider behavior changes were added.
