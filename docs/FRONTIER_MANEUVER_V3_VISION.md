# Frontier Maneuver v3: correct tactical sight without rewriting replays

**Status:** Unranked, experimental human-vs-AI profile. Implements issue #43.

## Why a third rules identity is necessary

The original `src/engine/fog.ts` independently rounds cube Q/R/S.
For an unobstructed ray from `(0,0,0)` to `(1,1,-2)` (distance two),
its midpoint is `(1,1,-1)`: not a cube coordinate, so the engine
treats a passable open-ground line as blocked.

This is not just a visualization problem. Enemy observations and human
attack highlights use the same fog projection. A two-hex-range unit
cannot select a genuinely visible target if that target is incorrectly
concealed.

## New default for NEW Frontier local sessions

| Profile | Command economy | Sight profile | Historical identity |
| --- | --- | --- | --- |
| Original | 1 move, 1 attack | original `Math.round` legacy LOS | Unchanged |
| Maneuver v2 | 2 distinct moves, 1 attack | original `Math.round` legacy LOS | Unchanged |
| **Clear sight (Maneuver v3)** | 2 distinct moves, 1 attack | **cube-symmetric-v1** | **New** |

The only new rules dimension is the vision projection; command/AP,
terrain classes, movement and damage remain exactly as in v2.

The v3 match ID contains `maneuver-v3-vision`, and the rulesVersion is
`hexawars-frontier127-maneuver-v3-vision`. New games select this
option by default, but archived v2 and original profiles remain
explicitly selectable. `balanced61` and `legacy81` refuse v3.
The old `visibleCells`, old `runRound`, and old `runFrontierRound`
implementation code paths are untouched.

## Corrected line-of-sight contract

- `cubeLineSymmetric` rounds all three coordinates with sign-symmetric
  midpoint rounding, then corrects the coordinate with the largest
  rounding error until `q+r+s===0`. Axis tie order is deterministic and
  invariant under a 180-degree rotation.
- Radius 3 stays the same. Plains and water are transparent; forests
  and mountains block vision into and through them. Cells outside the
  real 127-hex board are never projected. Dead units cannot reveal cells.
- `projectSeatObservation(state,side)` uses legacy visibility by default.
  Only `projectSeatObservation(state,side,"cube-symmetric-v1")`
  uses new sight. This means existing server, agent, demo and replay
  callers have identical two-argument behavior.
- Bot target knowledge and human legal command previews use the same
  opt-in seat observation. No sealed enemy plan, HP or unit position
  is disclosed beyond the corrected radius/terrain mask.

## Required regression coverage

1. Native test enumerates every radius-3 ray within radius-6 actual
   topology, checks valid cube coordinates and exact rotational
   equivariance, including midpoint ties.
2. Native + compiled-browser regression: a distant two-hex enemy on
   all plains is visible only in the new profile, and a forest on the
   ray continues to block it.
3. Archived v1 and v2 rule IDs and full starting states match their
   old releases; the new ID is distinct.
4. Sixteen seeded v3 house-bot full matches with strict A/B validation,
   legal maximum two moves and one attack per side and live bids.
5. Real Chrome desktop/mobile 2D and Verdant 3D start, squad selection,
   movement/attack, zoom, rematch and historical arena fallback.

**Not yet delivered:** five original combat roles, role-specific Scout
extended reveal, true territory-control scoring, AP-priced extra
abilities, internet human PvP or ranked balancing. Existing 48-/64-seed
economy cohorts use old sight and are not directly comparable without
a clearly recorded vision profile.
