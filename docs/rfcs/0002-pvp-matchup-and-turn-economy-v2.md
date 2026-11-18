# RFC 0002 — Fair 1v1 Matchups and Turn Economy v2

**Status:** Proposal + executable baseline. **NOT authorized to replace frozen Plan D v2.**
**Audience:** HexaWars competitive gameplay, human UX, deterministic rules, external-agent matches.
**2026-11-18.** Links: #25 (gameplay), #36 (five original roles), #34/#35 (human map and UI).

## Verified current state (no interpretation)

| Surface | Board | Actual roster | Players | Round actions | AP usage |
| --- | --- | --- | --- | --- | --- |
| Source `createMatch` / external-agent v1 | legacy 81-cell | 3 vs 3 | agents A/B | 1 free move + 1 free action each | 3 base; bid supported; extras validator rejects |
| Human unranked default `frontier127-v1` | 127-cell | 5 vs 5, mirrored classes | human Blue / deterministic AI Red | 1 free move + 1 free attack each | human may bid 0–3/4; house bot ALWAYS bids 0 |
| Historical unranked balanced/legacy | 61/81 | 3 vs 3 | human/AI | same contract | preserve exact seeds/identities |

The initial frontier deployment is not 3v1: five units on each team, and
the board has rotationally paired terrain and equivalent HP/strength
totals. This does NOT prove fair tactical contact, turn opportunity, fog
parity or win rates.

The playable AI has a **side-specific policy branch**: when side B has an
observed enemy within four cells on even rounds, it may pass rather than
pursue; there is no matching A-only rule. Bot bids are hard-coded to zero.
Those are NOT valid evidence of symmetric competitive policy.

`RoundPlan` has exactly one `freeMove` and one `freeAction` field per
side. Thus only up to two squad orders per round, although five squads
are deployed. Movement and attacks from different friendly units are
legal. **AP extras are currently refused** by
`validateExtrasDisallowed`; three base AP are effectively initiative
currency, with one carry cap. Existing free-slot refund logic adds a
point per unused free slot before computing carry, so a completely
unused free order can change carry outcome at high bid. This is a
design/contract discrepancy to test, not silently rewrite.

`src/engine/territory.ts` defines ownership by occupation or 4-of-6
neighbor majority. The active `roundDriver` doesn't invoke it to
recompute `state.visible[*].controlledBy`. `checkVictory` checks
territory %, but current playable matches usually end through elimination
or the round cap. The original "60% of all map cells" rule cannot be
assumed meaningful after enlarging the battlefield to 127 cells.

## Competitive target: 1v1 with equal military and command opportunity

A matchup is **one player/agent vs one player/agent**, each controlling
an equivalent army; *not* an uneven alliance/free-for-all. "5v5" refers
to deployed **units**, not five separate human players. Both players
submit privately sealed plans for the same round. Neither sees the
opponent's orders before locking their own. The engine resolves reserve
triggers, all movement, all free actions, then any validated AP extras
in shared, deterministic order. The bid affects *priority within a phase*,
never grants extra actions to one side.

Ranked and human/AI practice must not claim parity unless they run
the SAME versioned ruleset, opening formations, victory logic and budget
accounting. Browser local hot-seat may be useful for testing but is
inherently inspectable, so it is NOT anti-cheat, networked PvP, or ranked.

## Proposed v2 round economy (candidate, *not shipped*)

Keep the existing 5v5 roster as the initial balanced test bed, then add
the original five distinct classes (#36) under an explicit version.
For a five-unit team, benchmark three alternatives using actual
matchup cohorts and structured human play tests:

| Profile | Free moves/team/round | Free attacks/team/round | AP options | Concern |
| --- | ---: | ---: | --- | --- |
| Plan D legacy baseline | 1 | 1 | bid only in practice | 80% of squads cannot move each round |
| **Candidate B: maneuver** | **2** | **1** | bid, 1 AP reposition/guard, 2 AP second attack | encourage flanking without five simultaneous shots |
| Candidate C: unit activations | 1 activation per living squad | action alternative | 1 AP reaction/defense budget | highest input/time cost, more complex simultaneous collisions |

Recommendation to prototype *Candidate B*, behind a new
`rulesVersion`, **after** validating the AP spend/resolver security and
unit caps. Do not add a second `freeMove` through an ad hoc field in the
frozen `RoundPlan`: create a versioned action contract, validate unique
unit activations, preserve legitimate same-unit move+attack under its
role rules, and reject duplicate/forged orders. Never assign multiple
attack orders to one unit accidentally. The original Siege cannot move
and fire in the same round.

### AP decisions to resolve in v2

- Base 3 AP, max 4 available with at most 1 genuinely unused point
  carried into the following round, on **both** sides.
- A free slot is an opportunity, **not a spendable AP token**. Passing
  on a free move/attack must not mint AP.
- Bid AP is consumed regardless of win/loss; define explicit handling
  for rejected/late plans and show a ledger after reveal.
- AP extras must be end-to-end validated for target, source, range, fog,
  live position and double-spend; existing disabled handlers cannot be
  treated as working abilities until repaired and qualified.
- Choose whether some AP spend can grant another move or counterattack,
  and how much. Run balance cohorts before locking prices.
- In 5-unit matches, the number of command opportunities per team must
  be visible to both players: `Moves 0/2 • Actions 0/1 • AP 3`.
- Enemy fog remains seat-private. An observed local 3-on-1 cluster is a
  tactical concentration, not a third player's extra deployment.

### Match scoring / pressure

- Do not leave control markers cosmetic. Specify capture persistence,
  claim/recapture and objective holding rules for 127 actual hexes.
- 60% of 127 means **at least 77 cells**, which is not equivalent to
  a fixed five-unit tactical objective. Consider three symmetric command
  zones scored each round, with a consecutive-hold victory threshold,
  or a bounded territorial share with persistent claims.
- Validate elimination, objectives, round cap and simultaneous lethal
  outcomes without a side or first-mover priority bias.
- Show why a player won and the counterplay that was available.

## Executable baseline gate (this PR)

1. Seeded 127-cell formation and board rotation parity: five alive per
   side, identical role histogram, total HP, STR, weight and legal spawn.
2. Both seats get the same budget: 1 free move, 1 free action, base 3 AP,
   max 4 at carry and no more than one available attack.
3. Each side's legal commands are independently validated by the
   canonical engine. No forced B-only shortcut in the shared validator.
4. Same-round bid priority swaps based only on actual bids; a bid affects
   **order**, not simultaneous action counts; bid costs are accounted.
5. A real bot-vs-bot evaluation must use symmetric policy for both
   seats (or an explicitly paired seat-swap comparison). Report Blue/Red
   win %, draws, caps, rounds, damage exchanges, move/attack usage,
   contested positions and participation by squad.
6. Evaluate at least 100 mirrored seeds per profile, then 500+ for a
   competitive promotion. Suggested alert thresholds are **provisional**:
   seat win difference >10 percentage points on non-draw matches,
   >10% round caps or >20% squads never acting without being destroyed.
   Define acceptable thresholds from benchmarks, not taste.
7. Chrome desktop/mobile human task checks: choose any of five squads,
   submit legal paired free orders, understand AP/bids, preview initiative,
   observe a clearly explained outcome; never hide movement conflicts.

## Release boundaries

No automatic migration of old replays, no rewrite of
`hexawars-frontier127-v1`, `balanced61-v1`, `legacy81-v1`, no claim
that five original roles are live, and no promotion to ranked PvP by
passing browser CI alone. A green seed cohort proves deterministic
behavior, **not fairness**. Solo-owner adversarial review is sufficient
for governance, but exact-head native tests and the published browser
acceptance remain required. A public rules-version selection must
identify the elected economics honestly.
