# Tasks

- [x] client: Enlarge the GameMenu burger button to `w-12 h-12`
  (48 px) and replace the `☰` text glyph with an inline SVG
  hamburger icon (three rounded bars, `stroke="currentColor"`,
  ~`w-6 h-6`) in `client/src/shared/GameMenu.jsx`.
- [x] client: Scale the opened GameMenu panel proportionally
  (`min-w-[200px]`, menu item text `text-base`) in
  `client/src/shared/GameMenu.jsx`.
- [x] client: In `client/src/snake/HUD.jsx`, change the chip row to
  spread evenly across the bar (`justify-between`, keep
  `flex-wrap`) and update the left inset to `left-[72px]` (burger
  48 px + `left-3` + `gap-3`).
- [x] client: In `client/src/clash/HUD.jsx`, update the left inset
  to `pl-[72px]` so the Time chip has the same 12 px gap from the
  burger as the Lives chip has from the right edge; keep `pr-3`.
- [x] client: In `client/src/shared/LobbyScreen.jsx`, remove the
  gear's `fixed` positioning, place the button on the same line as
  the "Parku Cīņas" `<h1>` (`flex items-center justify-between`
  inside the `max-w-md` column), shrink it to `w-10 h-10` with a
  `w-5 h-5` SVG, and keep the dropdown anchored via a `relative`
  wrapper.
- [x] client: Update/extend affected component tests
  (`client/src/test/components/GameMenu.test.jsx`,
  `client/src/test/components/LobbyScreen.test.jsx`,
  `client/src/test/components/HUD.test.jsx`,
  `client/src/test/snake/HUD.test.jsx`) if they assert on the
  changed markup; run `npm --prefix client test` scoped to those
  files.
- [x] client: Verify no source line exceeds 79 chars in edited files
  (`awk 'length > 79 {print FILENAME":"NR}' <file>`).
