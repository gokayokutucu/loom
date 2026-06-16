# Task AGENT-RUN-INSPECTOR-PERSISTENCE-001 v1.0

## Goal

Update the Experimental Agent Run Inspector UI to use durable Agent Run history APIs added by Agent Run persistence.

## Checklist

- [x] Confirm branch and clean working tree before changes.
- [x] Confirm required persistence and ledger commits exist.
- [x] Inspect current inspector UI and client helpers.
- [x] Inspect durable Agent Run history API shapes.
- [x] Add frontend helpers for run list, steps, and events.
- [x] Add Loom-scoped Recent Runs UI.
- [x] Add selected-run steps and event inspection.
- [x] Keep live run testing behavior intact.
- [x] Sanitize durable history payload rendering through an allowlist.
- [x] Keep Main generation and Quick Ask endpoints untouched.
- [x] Add/update focused tests.
- [x] Run full validation.
- [x] Commit locally after validation.

## Notes

- The durable run list endpoint currently requires `loomId`; the UI reflects that constraint.
- No Rust service code is expected to change in this task.
