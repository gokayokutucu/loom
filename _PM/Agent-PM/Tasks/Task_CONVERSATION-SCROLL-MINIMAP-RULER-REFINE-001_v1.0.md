# Task_CONVERSATION-SCROLL-MINIMAP-RULER-REFINE-001_v1.0

## Objective

Refine the existing conversation minimap into a compact right-top ruler with evenly spaced ticks, active item emphasis, and a visible hover outline card.

## Scope

- [x] Audit current minimap mount, geometry, item guard, and hover outline behavior.
- [x] Lower the minimap visibility guard to two conversation items.
- [x] Replace document-proportional tick placement with evenly spaced ruler ticks.
- [x] Remove the viewport thumb that made the minimap read as a second scrollbar.
- [x] Preserve same-pane tick and outline row jump behavior.
- [x] Fix hover/focus outline visibility and clickability.
- [x] Hide the outline card's visual scrollbar while preserving internal scroll.
- [x] Normalize Markdown artifacts before rendering outline row labels.
- [x] Keep the compact ruler at a fixed height.
- [x] Render all ticks for 2-20 navigable items.
- [x] Render a moving 20-tick window for dense conversations.
- [x] Keep the active/nearest item visible in the dense tick window.
- [x] Keep the hover outline listing all response titles with internal scrolling.
- [x] Align selected outline rows near the top of the scrollable outline card when possible.
- [x] Add revision child rows only to the hover outline.
- [x] Keep revision rows out of the compact right-side tick ruler.
- [x] Reuse existing Revision Weft split-pane navigation on revision row click.
- [x] Run build, unit, product E2E, and diff validation.
- [x] Run browser smoke on the visible dev app.

## Notes

No Flow Rail redesign, Weft/Revision indentation, or identity behavior changes are included in this task.
