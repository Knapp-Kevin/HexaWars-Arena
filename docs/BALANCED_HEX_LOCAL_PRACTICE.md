# Versioned balanced hex local practice

Status: **experimental, unranked only**, 2026-11-18. Tracks issue #12.
This is a gameplay topology change, **not** a renderer-only trick.

## Available arena contracts

| Mode | Identifier | Cells | Default for |
| --- | --- | ---: | --- |
| Classic | `hexawars-legacy81-v1` | 81 | Original server matches, existing saved games, current engine `createMatch(seed)`, original `newPractice(seed)` API |
| Balanced Hex preview | `hexawars-balanced61-v1` | 61 | New browser unranked practice when chosen on start screen |

The original `initBoard(9, seed)`, its seeded terrain and the original
`practice:<seed>` match identifier remain **unchanged**. This preserves the
historical replay input and deterministic rules-version boundary.

## Topology and fairness invariants

`initHexDiskBoard(4,seed)` uses the set of cube coords
`max(|q|,|r|,|s|) <= 4` with `q+r+s=0`. Row lengths:
`5,6,7,8,9,8,7,6,5`, totaling **61 hexes**. This is a regular hex
silhouette with no disconnected pointer or edge.

A true cube-coordinate reflection, `(q,r,s)->(s,r,q)`, pairs terrain under
the same position+seed hash. Spawn positions are the original `q=±1,±2,±3,
r=0` and both sides receive equivalent infantry/scout/heavy assignments.
Those six spawn cells are forced to plain on **this versioned topology only**,
preventing starting on water or mountains and providing a connected central
corridor. Terrain mirror symmetry and spawn parity have source-level tests.

The original validator, fog observer, action costs, movement, simultaneous
resolution, bot policy and victory implementation still run for both
topologies. Territory percentages adapt to the actual `state.visible.length`
(61 instead of 81), so a 60% territory condition means a different absolute
cell count; this is an **intentional gameplay change** confined to the new
ruleset ID. The new mode is unranked and client-authoritative, not suitable
for competitive results or tamper-resistant matchmaking.

## Production rules governance

- Do **not** promote `hexawars-balanced61-v1` into original ranked/server
  `createMatch` until owner sign-off and match rules-version storage/replay
  verification have been approved.
- Do **not** reinterpret an old 81-cell replay as a 61-cell one, even when
  the seed is identical.
- Both modes are selectable and tested on the **same public site**, including
  SVG and Verdant 3D, and all movement/attack orders still go through the
  existing authoritative validator.
- Future ranked fairness must study more than terrain symmetry: 200+ seeds,
  win rates by faction, spawn terrain/path reachability, side-first effects,
  duration, device performance and adversarial fog/input tests.

## Verification

`bun test tests/engine/board.test.ts`: exact ring geometry, reflected
terrain, equal starting forces, deterministic seed and unchanged legacy board.
`node --test qa/practice.test.mjs` after Pages build: source-to-browser
state parity, version IDs, historical match ID, complete bot cohorts and
invalid-action rejection. Chrome tests exercise both selectable modes and
3D/2D projections. Verify published site after merging a green PR.
