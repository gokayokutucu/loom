# PROVIDER-SETTINGS-PROFILES-UX-001

## Objective

Expose provider profiles in Settings with write-only API key handling, while keeping remote providers disabled by default and preserving non-secret config.

## Checklist

- [x] Audit existing Settings provider UI and service config access.
- [x] Add frontend provider profile config types.
- [x] Add provider secret status/set/delete/test client methods.
- [x] Preserve service `providers.profiles` during hydrate.
- [x] Add testable provider profile classification and enable-gate helpers.
- [x] Show provider profile cards in Settings.
- [x] Keep Ollama local behavior unchanged.
- [x] Show remote/experimental/Rig badges when profiles are present.
- [x] Add write-only API key set/replace/remove/test controls.
- [x] Clear API key input after save/remove.
- [x] Gate remote enable behind privacy acknowledgement and saved key.
- [x] Avoid provider runtime routing or generation behavior changes.

## Notes

Remote provider profiles are displayed only when present in service config. Main/Quick model selection remains model-string based for this task.
