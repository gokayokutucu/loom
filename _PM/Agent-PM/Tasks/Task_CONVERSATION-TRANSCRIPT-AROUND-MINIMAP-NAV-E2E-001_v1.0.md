# Task: CONVERSATION-TRANSCRIPT-AROUND-MINIMAP-NAV-E2E-001

## Objective

Complete around-page loading for unloaded minimap navigation and add product-service-backed E2E coverage for reverse transcript paging.

## Checklist

- [x] Audit current minimap click and DOM anchor behavior.
- [x] Keep minimap outline metadata lightweight and body-free.
- [x] Render minimap outline items even when their response DOM anchor is not mounted.
- [x] Add pane-local unloaded response navigation callback.
- [x] Fetch `direction=around` transcript page when minimap target is not loaded.
- [x] Replace rendered window with around page to avoid mounting the full transcript.
- [x] Scroll target response after DOM mount.
- [x] Add E2E fixture endpoint for long transcript temp-DB tests.
- [x] Add product-service-backed Playwright test for initial page, older prepend, and unloaded outline navigation.
- [x] Execute Playwright E2E in an environment where local port binding is allowed.

## Changelog

- v1.0: Added task tracking for around-page minimap navigation completion.
