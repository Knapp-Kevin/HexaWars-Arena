# Attack-origin and staged-range contract correction

Status: qualification pending. Rules integrity follow-up to gameplay-fidelity #25.
Scope: shared source validator and deterministic round resolver. No renderer
or model changes, no AP extras activation, no territory rule changes.

## Authoritative round-plan semantics

- `freeAction.from` is the **real unit coordinate at the start of the
  submitted round**. Fake, fractional or non-cube origins are refused.
- An attack `to` coordinate must be a well-formed cube hex contained in the
  active match's actual board topology. A radius-eight bounding envelope alone
  is not proof that a hex exists on the 61/81-cell board.
- When `freeMove.unitId === freeAction.unitId`, free movement occurs before
  the free attack. The declared target must be in attack range **from the
  proposed move destination**. The free move is separately checked by
  `validateMovePath` for real origin, exact move distance, terrain, occupancy,
  and connected traversability.
- Attacking with a different unit uses that unit's actual start position.
- An already accepted plan can encounter a legitimate runtime collision if
  the higher-priority opponent moves into its destination. The resolver then
  consults the attacker's **actual live location** when deciding whether an
  enemy at the declared target is reachable. Otherwise it uses the existing
  deterministic retarget path; if nothing is in range, the action is wasted.
  This is a resolution-time conflict, not a duplicate static plan validator.
- Do not change `freeAction.from` to a speculative future coordinate in
  human/agent clients. Both server and unranked practice send round-start
  positions.

## Evidence and release requirements

Regression tests cover forged origin, malformed cube coordinates, targeting
a cell absent from the selected board, legal post-move target, illegal
post-move target, successful same-unit strike, and a competing higher-bid
move that blocks the strike. Source-to-browser compiled parity, full Bun suite,
TypeScript ratchet, deterministic cohorts on both boards, and desktop/mobile
real-browser acceptance remain required before declaring the public game fixed.

This changes validation/resolution semantics versus older matches containing
same-unit move-and-attack orders or invalid target positions. Previously
recorded results and replays are NOT rewritten. Production/ranked re-simulation
still requires immutable rules-version metadata and a version-aware verifier,
tracked separately under #15.

The frozen Plan D v2 still describes AP extras and territory victory that the
published alpha does not yet fully support. Do not market those as playable.
