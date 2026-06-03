# THINKING-PANEL-SCROLL-FOLLOW-USER-PAUSE-FIX-004

## Objective

Fix ThinkingPanel live reasoning scroll follow so a user scroll-up pauses auto-follow for two seconds, then incoming chunks resume following automatically.

## Checklist

- [x] Audit live ThinkingPanel scroll logic.
- [x] Replace near-bottom-gated resume with pause-window resume.
- [x] Ignore programmatic scroll events.
- [x] Pause immediately on upward wheel/touch/manual scroll.
- [x] Add unit coverage for pause and resume behavior.
- [x] Update product-service-backed E2E expectations.
- [x] Run full validation.

## Notes

The live reasoning stream remains transient and continues rendering through the Markdown response renderer.
