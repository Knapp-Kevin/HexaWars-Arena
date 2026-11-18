# HexaWars combat health invariant correction

Status: **Rules bug fix, pending PR validation**, 2026-11-17. Tracks #17.

## Invariant

A combatant with `hp <= 0` is **not alive**, whether retained as an event
record or omitted from `MatchState.units`. A winning side must have at least one
combatant with `hp > 0`; if neither has one, the result is
`mutual_elimination`. Remaining non-zero survivors are counted as normal.

The existing Plan D tie-break states that **the defender wins a mutually lethal
exchange**. The previous implementation retained the defender record at 0 HP,
which contradicted that rule. The correction makes the defender survive the
tie with 1 HP, destroys the attacker and therefore gives the defender the
documented win. No battle may be won by a zero-HP corpse.

## Regression evidence

`practice-alpha-01` was reproduced from the published browser rules on
2026-11-17: all remaining units reached 0 HP by round 6 but victory checking
still treated both armies as alive. Rounds 7–50 were all passes, giving an
incorrect turn-cap draw. Other seeds could declare a 0-HP side the winner.

`tests/engine/combat.test.ts` and `tests/engine/victory.test.ts` now codify
both invariants. The Pages `qa/practice.test.mjs` also executes the actual
canonical source implementation and the browser-transpiled implementation
under Node 24, with golden first-round parity and representative complete
matches. The live match Bun gate is triggered for engine changes and executes
the full repository test suite.

## Scope and historical data

This change is **semantic** for old matches whose results depend on mutually
lethal ties or 0-HP elimination. It must not be described as bit-for-bit
resimulation-compatible with older seeds. Previously recorded, append-only
match events and outcomes **are not rewritten**. New server and browser matches
share the corrected engine implementation after merge.

Before a future ranked production season, add explicit immutable rules-version
metadata to match records and preserve replay/verifier versions so historical
matches can be interpreted under the rules in force when recorded. This is
part of #15's production qualification, not silently solved by this fix.

## Not changed here

Board topology (#12), fog projection, action costs, free move distance, the
scripted 61-cell public replay, model assets, ranking protocol and persistence
schemas are unchanged. The client-side practice mode remains unranked.
