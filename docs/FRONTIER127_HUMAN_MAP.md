# Frontier127 v1: larger human-first battlefield

Status: gameplay candidate, not ranked. This is an additive rules-versioned
topology. The old `hexawars-balanced61-v1` and `hexawars-legacy81-v1`
must keep their exact units, terrain, match identifiers and replays.

## Player experience

- Primary unranked mode: a **radius-six hex disk, 127 actual playable cells**.
  This is 66 more cells than Balanced61, not a visual upscale.
- Five deployed squads per army, instead of three, make the expanded board
  strategically occupied from the first round. This mode temporarily uses
  existing Scout, Infantry and Heavy mechanics; it does **not** claim to
  restore the original five distinct classes.
- Both armies receive identical formations at 180-degree rotated locations:
  scouts on the center/front flank, infantry supporting the approaches, and
  a heavy on an outer flank. Stable per-seat/unit identifiers are unique.
- Seeded random terrain is mirrored by full 180-degree rotation. Deliberate
  open central corridors, two forest-covered flank routes, and symmetrical
  water/mountain obstacles create understandable choices. Spawns are always
  passable; no disconnected start or seed-specific unfair terrain advantage.
- Terrain stays public as before; enemy positions remain subject to
  existing seat-specific fog. No speculative hidden target discovery.
- 2D camera: zoom buttons, scroll wheel, pinch, drag-pan while zoomed,
  keyboard zoom and arrow-key pan, and a Fit control. The map camera changes
  only SVG viewBox coordinates and NEVER controls legal commands or AI state.
  3D continues using the same legal Worker projection and its own Verdant
  perspective camera. Both views expose the same existing controls.
- On phones, orders remain reachable at the bottom in both 2D and 3D;
  the board remains visually dominant, with short player-facing instructions.

## Contract and remaining restoration

This feature introduces `hexawars-frontier127-v1`. It is unranked and
receives its own match ID; it never mutates earlier 61/81 contracts.

The archived original five roles are Scout, Raider, Interceptor, Siege,
Captain, with role-specific stats and abilities. Restoring those is separate
follow-up work because they alter legal movement/attacks, combat outcomes,
fog, token silhouettes and match protocol. In particular the original
Siege **cannot move and fire in the same round**. Do not implement the
silhouettes without restoring those verified gameplay constraints.

Longer travel and a new unit count can change bot quality. Before calling
this alpha ready, qualify seed cohorts, full source tests, Node transpiled
browser parity, 2D drag/touch/keyboard, 3D picking and mobile bottom
controls, historical board selection, complete-match/rematch, and public
Pages smoke on the merged exact head.

## Future fidelity tasks

1. Five distinct tactical unit roles with full canonical action validation
   and combat/fog behavior in a NEW versioned ruleset.
2. Territory claim/recompute and legible progress toward win condition.
3. Larger-map bot pursuit quality, tactical movement, cover, chokepoints and
   difficulty selection based on measured human/bot matches.
4. Readable unit roster, focused-selection camera, compact icon-led orders
   and coherent 2D/3D combat animations. Do not substitute art for rules.
