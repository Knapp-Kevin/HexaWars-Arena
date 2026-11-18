# Human squad selection for a large board

Scope: browser-only interaction over seat-approved `practiceView` projections.
No authority, world-state, fog, damage, deployment or replay rules change.

## Player behavior

- The 2D battlefield shows a compact horizontally scrollable selector for
  every friendly squad, including role and current HP. On the Frontier127
  board that means five visible, keyboard-accessible 46-pixel targets.
- Selecting one squad focuses the SVG map on it and zooms to a readable
  tactical level. The player can still pan, pinch, scroll or select another
  squad; the Fit button restores the global overview. Only *explicit* squad
  quick selection changes the camera. Direct map clicks leave camera alone.
- The currently selected squad is marked both on the map and in the roster,
  with `aria-pressed` for assistive technology. Controls disable while
  Worker requests are pending. Unit health is from the latest authorized
  seat projection; hidden enemy information is never read.
- In 3D the existing touch-friendly command tray remains the one selector;
  do not cover it with a duplicated row. Picking a different friendly unit
  while another is selected now works and can focus Verdant on the chosen
  unit. Planning and legal target calculation remain Worker-authoritative.
- On victory/arena selection the selector is hidden; a new match rebuilds
  from the new unit IDs and HP, never from obsolete match state.

## Quality gate

Playwright Chrome desktop/mobile checks verify that five friendly controls
exist on Frontier127, a single selection is reflected in both roster and
SVG, selection changes only the camera viewBox, and 3D has no duplicate
overlay. Preserve full match/rematch, legacy arena selection, 2D/3D parity,
keyboard usability, existing source tests and seeded bot cohorts.

The original Scout/Raider/Interceptor/Siege/Captain class-specific rules
remain the next separate source-level fidelity milestone. This PR adds
no pretend abilities or placeholder combat classes.
