# Frontier127 Maneuver v2: governed experimental 5v5 command economy

**Status: unranked prototype.** This is the first executable candidate for
RFC 0002 (#38), NOT a validated competitive game, network PvP protocol or
completed restoration of the five historical classes.

## Rule identity and replay isolation

- Topology: the existing 127-cell Frontier tactical map and five deployed
  units per side; same deterministic terrain and unit placement.
- Historical `hexawars-frontier127-v1`, `balanced61-v1` and
  `legacy81-v1` matches retain the same command types, bot choices and
  unique match IDs. Existing `runRound` and `validateRoundPlan` unchanged.
- **NEW** combat economy `hexawars-frontier127-maneuver-v2`, selected
  explicitly on the Frontier startup screen. Match IDs include
  `maneuver-v2` plus opponent-policy version to prevent replay collisions.
  The unchanged Frontier topology and unit classes do not acquire new
  abilities by renaming a version.
- The new v2 command adapter is unranked, local-only and openly inspectable.
  No online sealed-human PvP or ranked anticheat is claimed.

## Exact currently executable v2 economy

| Resource | Per seat per round | Notes |
| --- | --- | --- |
| Free team moves | **2** | Two **different** owned squads, one ordered move each |
| Free attack | **1** | May use one of those moving squads or a different squad |
| Base AP | **3** | Spend on sealed initiative bids only in this slice |
| AP carry | 0–1 | Only **actually unspent** AP carries; no unused-slot minting |
| Maximum AP | 4 | Base 3 + at most 1 saved |
| AP extras | Rejected | Second attack, stance, boost, overwatch **not yet qualified** |
| Initiative | Bid AP | Burn regardless of bid outcome; priority within each wave |

The deterministic global order is: existing reserve triggers (inactive in
this profile) → **first movement wave: higher bidder, then lower bidder** →
**second movement wave: higher bidder, then lower bidder** → **free attack
wave: higher bidder, then lower bidder** → AP extras (disallowed) → AP
carryover → victory evaluation. A loser of a contested same-destination
move does not teleport or gain an extra free action. Attacks check the
unit's actual live position after both movement waves; impossible
post-move attacks cannot hit distant enemies.

V2 validator checks the second move via the exact canonical origin,
connected traversable path, allowed destination, living unit identity and
ownership validator. It rejects the same unit moving twice, duplicate
destinations, unknown/off-board targets, over-budget bids and all
unsupported extras. An attack staged from the SECOND moving unit is
validated against that second destination, not its stale origin. Fog
previews never reveal enemies from future movement.

The human interface shows Move 1, Move 2 and Attack as separate, reversible
slots. The second move defaults to the next squad selected; it never
silently reuses an already-moving squad. Players can pick Original
(one-move) economy on Frontier, or Balanced/Legacy historical modes.
The opponent gets the same two move slots and bid budget, with its
explicit bid-aware policy; old AI opponent policies remain immutable.

## Explicit limitations / next gates

1. Restore Scout, Raider, Interceptor, Siege, Captain class mechanics under
   another versioned, independently tested ruleset. Current 5v5 are still
   Scouts, Infantry and Heavies. Siege cannot move and fire in a round.
2. Introduce AP spend options with full validator and resolver parity,
   including security for reserve and damage evaluation, under v2 only.
3. Wire authoritative territory objectives and capture to the resolver.
   The old 60% of 127 map cell victory rule isn't currently a working
   strategic control loop.
4. Run 100+ paired/seat-swapped seed cohorts for exploration, then 500+
   for qualification. Compare v1 one-move vs v2 two-move with identical
   seeded board and roster, plus per-squad activation distribution, damage,
   length, time budget, first-seat advantage and retreats.
5. Actual human playtesting, mobile ergonomics, click/drag interactions,
   2D/3D selection parity, opponent intent clarity, and transparent AP
   ledger after plan reveal remain necessary. Browser CI does not substitute
   for player comprehension.

**No-go:** silently modifying the historical protocol, treating a
32/24-seed deterministic policy cohort as PvP equilibrium, activating
incomplete AP extras or calling the new game ranked.
