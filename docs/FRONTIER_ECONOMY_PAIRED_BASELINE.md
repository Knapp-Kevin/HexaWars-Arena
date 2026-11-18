# Frontier127 command-economy paired matchup baseline (48 seeds)

**Evidence:** `qa/practice.test.mjs`, PR #41, [workflow run
44250713771](https://github.com/Knapp-Kevin/HexaWars-Arena/actions/runs/44250713771).
Run against the shared source/compiled-browser rules after #40 (Maneuver v2).

**Status:** Exploratory, **not** a ranked balance approval.
Both seats use the same versioned `bid-aware-v1` deterministic bot.
For each seed, the 127 hex cells, initial unit positions, roles, HP,
strength, and opening AP are byte-identical between economies. Each
profile has its own historical-correct `matchId`; tie-break order can
therefore differ even when terrain is identical. Do not attribute the
entire difference to two additional opportunities alone.

| Metric | Classic v1: 1 move + 1 attack | Maneuver v2: 2 moves + 1 attack |
| --- | ---: | ---: |
| Matches | 48 | 48 |
| Blue wins | 38 | 28 |
| Red wins | 9 | 20 |
| Draws | 1 | 0 |
| Round-cap finishes | 1 | 0 |
| Total rounds | 802 | 869 |
| Mean rounds | 16.71 | 18.10 |
| Mean round of first resolved attack | 6.54 | 4.10 |
| Resolved unit moves | 1,412 | 2,450 |
| Resolved unit attacks | 467 | 499 |
| Declared Move 1 orders | 1,490 | 1,605 |
| Declared Move 2 orders | 0 | 1,063 |
| Declared attack orders | 598 | 637 |
| Initiative AP bid by Blue | 576 | 738 |
| Initiative AP bid by Red | 630 | 689 |
| Starting squads issuing at least one order | 480/480 | 480/480 |

## Evidence-backed interpretation

- The expanded move budget is actually exercised by both bot seats.
  Resolved moves increased, and combat happens earlier on average.
- Match duration **increased**, so it is not established that this
  version is faster or more engaging for humans.
- In this 48-seed cohort Blue wins substantially more often in the old
  economy (38 vs 9, plus one draw) and less unevenly in Maneuver (28 vs
  20). These are **single-policy self-play samples**, not player-strength
  matched or statistically qualified PvP. The A/B imbalance deserves
  a first-seat/initiative and heuristic investigation.
- All 10 squads **eventually issued an order** in both profiles. The
  problem with 1+1 on a five-squad map is per-round command opportunity
  and consequential choice, **not** a claim that the old bot never
  touches certain units. Future analysis should report first activation,
  the distribution of orders per unit, and whether the player can respond
  to threats before a unit is destroyed.
- Neither profile has authentic five-role special abilities, live
  territory-control scoring, AP-priced extras or verified human PvP.
  Positive self-play numbers do not fill those gaps.

## Governance recommendation

**Continue offering Maneuver v2 only as an explicit, unranked prototype.**
Do not replace the frozen Classic v1 rules or backfill historical replays.

Before a ranked rules lock:

1. Benchmark **500+ seed/seat swaps** with action cap, tie-break parity,
   first-player advantage, AP-spend and actual per-unit activity.
2. Test at least two distinct opponent policies, including conservative
   and aggressive bots, rather than one heuristic against itself.
3. Run direct human task and preference tests on 2D/3D desktop/mobile:
   speed to issue first legal order, ability to understand both moves
   and initiative, situational awareness, time to finish a match.
4. Restore the five distinct original units and their combat/ability
   rules (#36); confirm Siege immobility-on-fire.
5. Implement explicit, authoritative control objectives and AP ability
   options under a further versioned rule profile (#38).

There is no numeric fairness PASS/FAIL threshold here; one cannot
establish it from 48 deterministic self-play games.
