# Move-plan authority hardening

Status: source/Pages regression gate, 2026-11-18.
Issue #26, parent gameplay-fidelity issue #25.

## The exploit corrected
Previously `validateMovePath` checked the distance from a **user-supplied**
`freeMove.from` to `freeMove.to`, but never compared the submitted origin with
the unit's authoritative current position. The trusted `runRound` resolver
moved the unit by its ID, ignoring the forged source. A malicious external
agent could claim a nearby origin and move a distant unit to the desired
destination. The original radius-8 coordinate check also did not correspond to
either the 81-cell rhombus or the 61-cell disk, and no traversable path was
required. That made jumps over mountains, water and units possible.

## Correct boundary
`validateRoundPlan` now rejects moves unless:
- From and to are valid integer cube coordinates and within the coarse envelope
- The `from` coordinate equals the **current live** unit position
- Destination exists on the **actual versioned match board**, is passable
  and is not occupied
- Endpoint distance equals the currently deployed unit-type allowance
  (scout 3, infantry 2, heavy 1). The **exact-distance policy is preserved**
  here, though its suitability for human play is under separate review
- A contiguous, passable and unoccupied route exists in the live match board.
  For explicitly supplied paths, each step must be adjacent and end at `to`

The path search is deterministic, bounded by the board's actual cell set.
The trusted resolver remains single-source and does not duplicate validation.

## Remaining decisions
This is a **behavioral restriction**: previously accepted invalid movements will
now be refused. Historical stored events are never rewritten. Replaying an old
match containing such a movement under the patched validator may not be
bit-for-bit compatible, so the future ranked archive must bind an immutable
rules-validator version to each match.

The frozen Plan D language calls movement a budget, while existing source tests
enforce **exact** 3/2/1-distance moves. Making movement *up to* that allowance
is a usability-sensitive rules change and must be versioned separately.

Likewise, the current browser player's one-choice-per-round UI does not expose
the freeMove+freeAction+bid round economy; territory-control win conditions are
unreachable under current 3-unit/4-neighbor mechanics. These are tracked in
#25, **not** claimed to be fixed by this security patch.

## Gates
Full Bun source/server regression and TypeScript error ratchet, Node-compiled
browser validator regression, 200-match legacy81 and balanced61 bot cohorts,
real desktop/mobile 2D/3D full-match acceptance, and public Pages verification
must pass before merge/release.
