# Proposal

## Why

The in-game top bars and the shared burger menu have visible
spacing/layout defects on mobile: the Snake HUD chips cluster on the
left instead of filling the bar, the Clash HUD's Time chip sits flush
against the burger menu with zero gap, the burger button is small and
relies on the platform-dependent `☰` text glyph, and the lobby's
settings gear floats `fixed` at the viewport corner, disconnected
from the "Parku Cīņas" heading.

## What Changes

- **Snake HUD** (`client/src/snake/HUD.jsx`): distribute the Alive /
  Score / Time chips evenly across the full width of the top bar
  instead of left-clustering them with `gap-2`.
- **Clash HUD** (`client/src/clash/HUD.jsx`): give the Time chip a
  real gap from the burger menu — the same spacing the Lives chip has
  from the right screen edge (`gap-3` / 12 px rhythm), not the
  current flush `pl-14`.
- **Burger menu button** (`client/src/shared/GameMenu.jsx` — shared
  by both games): enlarge it (≈48 px target) and replace the `☰`
  text glyph with an inline SVG hamburger icon so it renders
  identically across platforms and looks like a modern app bar
  button. Menu panel spacing/type may be scaled up slightly to match.
- **HUD left insets** (both HUDs): the clearance each HUD reserves
  for the burger (`left-14` / `pl-14`, currently exactly 56 px =
  burger edge, zero gap) must scale with the new burger width plus
  the standard `gap-3` gap.
- **Lobby settings gear** (`client/src/shared/LobbyScreen.jsx`):
  stop floating it `fixed` at the viewport top-right; place it on the
  same line as the "Parku Cīņas" heading (flex row, vertically
  centered) at a slightly smaller size so it reads as part of the
  header. The settings dropdown stays anchored to the button.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — pure client-side visual polish with no spec-level behavior
change. `skip_specs: true` is set in `.openspec.yaml`, matching the
repo convention for refactors/tooling changes.

## Impact

- **Workspaces**: `client/` only. No `server/` changes.
- **Files**: `client/src/snake/HUD.jsx`, `client/src/clash/HUD.jsx`,
  `client/src/shared/GameMenu.jsx`,
  `client/src/shared/LobbyScreen.jsx`, and any component tests that
  assert on the touched markup
  (`client/src/test/components/GameMenu.test.jsx`,
  `client/src/test/components/LobbyScreen.test.jsx`,
  `client/src/test/components/HUD.test.jsx`,
  `client/src/test/snake/HUD.test.jsx`).
- **Socket event contract**: not affected. **Seeded specs**:
  not affected.
- No new dependencies; Tailwind utility classes + inline SVG only.
