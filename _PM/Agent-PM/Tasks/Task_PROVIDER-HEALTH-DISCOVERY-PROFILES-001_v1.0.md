# PROVIDER-HEALTH-DISCOVERY-PROFILES-001

## Objective

Expose safe per-profile provider runtime status for Settings provider profile cards without enabling remote providers, making external calls, or exposing secrets.

## Checklist

- [x] Audit `/health`, `/runtime/providers`, and model discovery behavior.
- [x] Keep top-level `/health` Ollama behavior intact.
- [x] Extend `/runtime/providers` with provider profile metadata and safe status fields.
- [x] Report disabled remote profiles without network calls.
- [x] Report missing secret without network calls.
- [x] Report Rig transport as feature-gated when `experimental-rig` is unavailable.
- [x] Report invalid profile config safely.
- [x] Preserve Ollama local readiness/status behavior.
- [x] Add frontend client method for runtime provider status list.
- [x] Show runtime status on Settings provider cards.
- [x] Add unit/client tests.

## Notes

Remote endpoint probing remains user-triggered through explicit model discovery/test flows.
