# Plan D free-move/free-action global phase correction

Status: candidate undergoing qualification, 2026-11-18. Follows gameplay fidelity #25 and attack-origin fix #31.

## Canonical rule

Frozen Plan D v2 resolves each round as reserve triggers, then **both sides'
free moves**, then **both sides' free actions**, then AP extras. Initiative bids
choose which side acts first **within** the move phase and **within** the
action phase. They do not entitle a side to both move and attack while the
other side has yet to move.

The former `runRound` called `runAgent(first)` (move and attack) followed
by `runAgent(second)` (move and attack), violating that order.

This patch separates the execution into four ordered operations:

1. Initiative winner's free move.
2. Initiative loser's free move.
3. Initiative winner's free action.
4. Initiative loser's free action.

Reserve events still precede free moves; AP extras still follow both free
actions. Spent bids, carryover, free-slot accounting, dead-unit wastes and
deterministic event history remain under the original shared engine.

## Tactical effect

A lower-initiative unit can escape its starting hex during the move phase
before the opponent attacks it. If the enemy can still be legally retargeted,
the attack uses that unit's live range and existing deterministic retarget
rules; otherwise the attack is wasted. A single unit's move-then-attack
remains possible since both move phases precede both action phases.

Regression: a higher-bid infantry attack cannot deal damage to an enemy
heavy which legally moves just out of range. Both move events are ordered
ahead of the winning attack or its no-target waste event.

## Historical qualification

This changes semantic outcomes compared with older sequential-agent rounds.
Do not rewrite old match results, claim byte-for-byte replay parity, or
change the ranked protocol without immutable engine rules-version binding.

Required before merge: full source CI, type ratchet, source/compiled Pages
parity, seed cohorts on 61/81 boards, Chrome desktop/mobile acceptance, and
independent published Pages verification. This patch does not enable AP
extras or territory victory and does not alter the map or mesh assets.
