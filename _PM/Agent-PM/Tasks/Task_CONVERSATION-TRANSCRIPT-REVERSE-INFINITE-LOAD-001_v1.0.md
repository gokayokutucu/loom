# Task: CONVERSATION-TRANSCRIPT-REVERSE-INFINITE-LOAD-001

## Objective

Implement paged reverse loading for long Loom transcripts so the UI does not fetch or render every response body by default.

## Checklist

- [x] Audit current Loom detail and transcript hydration paths.
- [x] Add service transcript page/outline contract.
- [x] Add repository queries for latest, older, newer, and around-target transcript ranges.
- [x] Add Rust API tests for paging, cursors, outline safety, and no raw thinking leakage.
- [x] Add engine client types and Rust HTTP mappings.
- [x] Update initial UI hydration to avoid loading all response bodies by default.
- [x] Add scroll-top older-page loading with scroll position preservation.
- [x] Feed minimap from lightweight outline metadata where possible.
- [x] Add product-service-backed E2E coverage for long transcript paging.
- [x] Run service, frontend, unit, and E2E validation.

## Changelog

- v1.0: Initial task tracking for reverse infinite transcript loading.
