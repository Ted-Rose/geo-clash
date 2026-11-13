# Design

## Context

See proposal.md — Why. All changes are Tailwind-class-level edits in
four client components; no state, events, or behavior changes.

Current measurements that drive the numbers below:

- `GameMenu` burger button: `absolute top-3 left-3`, `w-11 h-11`
  (44 px), `☰` text glyph at `text-xl`. Occupied band:
  `left 12 px … 56 px`.
- Clash `HUD` container: `pl-14` (56 px) — Time chip starts exactly
  at the burger's right edge → 0 px gap. Right inset is `pr-3`
  (12 px) before the Lives chip.
- Snake `HUD` container: `left-14 right-3`, chips in `flex gap-2`
  (left-clustered).
- Lobby gear button: `fixed top-3 right-3`, `w-11 h-11`, SVG `w-6
  h-6`, inside a `max-w-md` column whose `<h1>` starts ~24 px below
  the top on mobile — the gear floats above/beside the heading
  depending on viewport width.

## Goals / Non-Goals

**Goals:**

- Symmetric, predictable top-bar spacing on a phone in portrait.
- One burger button that looks modern and renders identically on
  iOS/Android/desktop.
- Gear visually attached to the heading it belongs to.

**Non-Goals:**

- No redesign of colors, typography scale, or panel contents.
- No changes to GameMenu's open/close behavior, player list, or
  `children` slot contract.
- No restructuring of the HUD chip internals (labels/values stay).

## Decisions

- **Burger size**: `w-12 h-12` (48 px). Already ≥ 44 px touch-target
  minimum, still smaller than the 64 px+ that would crowd the HUD.
  Icon becomes an inline SVG (three rounded bars, ~`w-6 h-6`,
  `stroke="currentColor"`) instead of `☰` — text glyphs render
  differently per platform. Slightly larger `rounded-xl` is kept for
  consistency with the HUD chips.
- **HUD left inset formula**: `left-3` (menu) + menu width + `gap-3`
  = `12 + 48 + 12 = 72 px` → snake HUD `left-[72px]`, clash HUD
  `pl-[72px]`. Right inset stays `right-3`/`pr-3`, so burger→first-
  chip gap (12 px) equals last-chip→edge gap (12 px) — the symmetric
  spacing the request asks for. Implement as the same arbitrary
  value in both HUDs; if the burger size is tuned later, both HUDs
  must be updated together (note in code comments is acceptable, do
  not introduce a shared constant file for two usages).
- **Snake chip distribution**: `justify-between` on the existing flex
  row (replacing bare `gap-2`) spreads Alive/Score/Time edge-to-edge
  inside the inset bounds. Keep `flex-wrap` so narrow screens still
  wrap instead of overflowing.
- **Gear placement**: drop `fixed`; render the button in a
  `flex items-center justify-between` row with the `<h1>` inside the
  existing `max-w-md` column. Button shrinks to `w-10 h-10`, SVG to
  `w-5 h-5`. The dropdown panel keeps `absolute right-0 mt-2`
  anchored to a `relative` wrapper around the button, and the
  click-outside overlay is unchanged.
- **Menu panel**: bump `min-w-[180px]` → `min-w-[200px]` and item
  text `text-sm` → `text-base` so the opened menu feels proportional
  to the bigger button; Leave/children/players rows keep their
  structure.

## Risks / Trade-offs

- [Snake chips could overlap the burger on very narrow screens if
  they wrap] → `flex-wrap` retained; wrapped rows drop below the bar,
  acceptable for ≤ 3 chips.
- [Gear no longer `fixed` scrolls away with the lobby] → desired:
  the lobby is a short form, and anchoring to the heading is the
  request.
- [Hardcoded `72 px` duplicates the burger width in two files] →
  accepted trade-off; introducing a shared layout-constants module
  for two consumers adds more indirection than value.
