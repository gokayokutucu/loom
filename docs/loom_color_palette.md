# Loom Color Palette

This palette is the source of truth for Loom's current accent, link, focus, and warm-neutral UI colors.

## Loom Neutral Surface Palette

| Token | Value | Usage |
|---|---|---|
| `--loom-bg-surface` | `#1b1c19` | Main Loom surface / conversational substrate |
| `--weft-panel-bg` | `#292a27` | Split Weft contextual panel background |
| `--weft-panel-surface` | `#292a27` | Split Weft content/input surface |
| `--loom-sidebar-bg` | `#242424` | Left panel and top browser bar background |
| `--loom-input-bg` | `#292a27` | Composer, inputs, and elevated text-entry surfaces |
| `--loom-control-bg` | `#2e2e2e` | Inactive button/control background |
| `--loom-control-active-bg` | `#393939` | Active button/control background |
| `--loom-pinned-control-bg` | `#343434` | Pinned shortcut button background |
| `--loom-pinned-control-active-bg` | `#424242` | Pinned shortcut hover/active background |
| `--loom-switch-off-bg` | `#111111` | Off segment / switch section background |
| `--loom-switch-on-bg` | `#282826` | On segment / switch section background |

## Accent — Orange

| Token | Value | Usage |
|---|---|---|
| `--accent` | `#ff5f3a` | Primary accent, CTAs, active states |
| `--accent-soft` | `rgba(255, 95, 58, 0.16)` | Hover fills, soft highlights |
| `--accent-fallback` | `#ff7043` | Graph edge fallback / legacy |
| `--accent-fallback-soft` | `rgba(255, 112, 67, 0.16)` | Graph edge soft fill / legacy |

## Link & Focus — Blue

| Token | Value | Usage |
|---|---|---|
| `--loom-link-token` | `#7ab7ff` | Link color, Weft token highlight |
| `--loom-link-bg` | `rgba(74, 144, 226, 0.13)` | Link background tint |
| `--loom-link-border` | `rgba(74, 144, 226, 0.32)` | Link border, token outline |
| `--loom-focus` | `#9bbcff` | Focus rings, keyboard navigation |

Compatibility aliases:

| Token | Maps to |
|---|---|
| `--focus` | `--loom-focus` |
| `--loom-link-blue` | `--loom-link-token` |
| `--loom-link-token-bg` | `--loom-link-bg` |
| `--loom-link-token-border` | `--loom-link-border` |

## Claude UI — Borrowed Neutrals

Reference tones extracted from Claude's interface; useful for surfaces and text if Loom adopts a similar warm-neutral base.

| Token | Value | Usage |
|---|---|---|
| `--claude-canvas-bg` | `#fafaf8` | Main background |
| `--claude-panel-surface` | `#ffffff` | Cards, dialogs |
| `--claude-sidebar-bg` | `#f5f4ef` | Side panels, dock |
| `--claude-active-row` | `#ebebeb` | Selected list item |
| `--claude-border-light` | `#e3e2dc` | Card frames, separators |
| `--claude-border-mid` | `#cccbc4` | Input frames, dividers |
| `--claude-text-primary` | `#1a1915` | Headings |
| `--claude-text-secondary` | `#4a4a45` | Body content |
| `--claude-text-muted` | `#6e6e68` | Metadata, placeholders |
| `--claude-badge-bg` | `#ebe9e2` | Chips, model badges |

## Panel Depth Hierarchy

Loom uses warm-neutral depth to separate reading, writing, navigation, and contextual exploration surfaces.

| Surface | Value | Meaning |
|---|---:|---|
| Loom surface | `#1b1c19` | Primary conversational substrate |
| Weft surface | `#292a27` | Contextual split exploration surface |
| Left panel / topbar | `#242424` | Navigation and browser-like continuity |
| Input surface | `#292a27` | Elevated writing and form surface |
| Inactive controls | `#2e2e2e` | Resting controls and hover fills |
| Active controls | `#393939` | Selected buttons and active rows |
| Pinned controls | `#343434` / `#424242` | Slightly brighter sidebar shortcut buttons |
| Switch off section | `#111111` | Off-state segment background |
| Switch on section | `#282826` | On-state segment background |

The hierarchy is intentional: center Loom content remains primary, while contextual right-side surfaces recede.

## Weft Split-View Atmosphere

Split-view Wefts inherit part of the right-panel contextual depth language. A Weft in the right split panel should feel:

- recessed
- contextual
- traversal-oriented
- linked to the origin Loom

The center Loom remains the primary conversational substrate. Weft atmosphere preserves neutral Loom readability, avoids blue glow on the chat/input surface, becomes active only during split/right-panel projection, and disappears when a Weft is opened as a full Loom.

| Token | Value | Usage |
|---|---|---|
| `--weft-panel-bg` | `#292a27` | Split Weft contextual panel background |
| `--weft-panel-surface` | `#292a27` | Split Weft content/input surface |
| `--weft-surface-tint` | `rgba(255, 255, 255, 0.018)` | Neutral split Weft tint |
| `--weft-surface-border` | `rgba(255, 255, 255, 0.08)` | Low-contrast split Weft borders |
| `--weft-separator-glow` | `rgba(255, 255, 255, 0.06)` | Soft neutral separator illumination |
| `--weft-focus-ring` | `rgba(255, 255, 255, 0.12)` | Focused/hovered split Weft edge |
| `--weft-header-tint` | `rgba(255, 255, 255, 0.024)` | Quiet neutral header-depth tint |
| `--weft-depth-shadow` | `rgba(0, 0, 0, 0.24)` | Recessed right-panel shadow |

Orange accents remain reserved for execution, generation, CTA/action states, and active invocation states. Orange must not be used for Weft panel backgrounds.

## Implementation Notes

- `src/styles.css` defines these tokens at `:root`.
- Dark themes keep Loom's graphite surfaces while using the same orange and blue tokens for actions, links, focus rings, and graph highlights.
- Light/system-light themes use the Claude borrowed neutrals for page, sidebar, panel, border, and text surfaces.
- Legacy graph and link CSS should use token aliases rather than new hardcoded orange or blue values.
- Split Weft styling is scoped to `.weft-split-panel`; full Weft views keep the standard center Loom surface.
