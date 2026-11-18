# Frontier: Five Tactical Roles, One Game

**Canonical human game**, 2026-11-18.
**Status:** Unranked development profile; actual ability balance requires human
playtesting and adversarial large-seed qualification.

## Single player-facing product contract

There is one Frontier127 hexagonal battlefield with **one mirrored 5v5
army per player**. Both commanders have identical unit selection,
initiative AP (base 3, carry one, cap four), two distinct unit moves
and one attack per round, sealed simultaneous command planning, and the
same vision and combat rules. Both move waves complete before either
attack. No selectable legacy maps or economy modes. The browser currently
plays locally against bid-aware Red AI, not a human online opponent.

## The five unique units

| Role | Speed (hexes) | HP | Strength rating | Range | Special tactical ability |
| --- | ---: | ---: | ---: | ---: | --- |
| Scout | 2 | 5 | 5 | 1 | Sees unobstructed hexes to radius 4, others radius 3 |
| Raider | 2 | 5 | 5 | 1 | +1 damage on its **first successful hit per match** |
| Interceptor | 1 | 6 | 6 | 1 | +1 **melee counterattack** damage when defending |
| Siege | 1 | 6 | 6 | 2 | Ranged attack at distance 2; **cannot move and attack in the same round** |
| Captain | 1 | 7 | 7 | 1 | Adjacent friendly units (not itself) receive -1 incoming damage while the Captain lives |

Each army gets **exactly one** of each class, not five tokens of three
classes. Both initial deployments are paired under 180-degree rotation,
with identical stats and traversable starting positions. The shared
unit class identifiers are also reflected in both the 2D silhouettes
and Verdant 3D models. The short ability description is accessible in
the human squad command interface.

### Combat interpretation and explicit damage scale

The historical design specified role HP/STR but did not define a new
five-role damage-conversion rule for this larger command economy. Direct
5–7 HP damage per 5–7 HP squad would eliminate nearly every target
on the first hit, destroying opportunities for positioning and
reaction. The new isolated profile therefore uses an explicit
**strength-rating** mapping:

- Successful attack: `max(1, ceil(strength / 2))` base damage.
- Raider first successful strike: +1 outgoing damage.
- Forest tile on the defender: -1 incoming damage.
- Living allied Captain adjacent to defender: -1 incoming damage.
- Adjacent defending squad: `max(1, ceil(strength / 3))` simultaneous
  counterattack; Interceptor adds +1.
- An attack from range 2 has **no melee retaliation**.
- If both sides would be destroyed simultaneously, the defender remains
  alive at 1 HP, preserving the original defender-favored tie doctrine.
- Aim penalties on a retargeted/rushed shot are applied before flat
  bonuses. The damage floor is 1 for a legal, resolved hit.

Raider's first-hit state is per-unit and recorded in the authoritative
match state. Failed or canceled attacks do not consume this trait.
The Captain's own defense is not boosted by its aura, and dead Captains
cannot protect allies. Unit abilities do not consume extra AP and
grant no additional attacks or moves.

## Version/replay boundary

The backend retains archived one-move and two-move match formats for
deterministic replay. These are **not player-selectable game modes**.
Their old unit types, LOS rays, damage math and deterministic match IDs
are unchanged.

The new match rules identity is
`hexawars-frontier127-five-roles-v1`; its match ID includes
`frontier-five-roles-v1`. Only those new matches use the role
damage, Scout sight, Siege move/fire rule and Raider first-hit ledger.
Every START in the public practice Worker selects this identity
without trusting client-provided map/rules fields.

## Promotion gates and remaining gameplay gaps

Tests must establish one-of-each class per seat and mirror symmetry
across many map seeds, legal movement/range/counterattack constraints,
each special actually changing a result, correct fog (without private
enemy data), native source and built browser rules parity, and
desktop/mobile 2D/3D human round tasks. AI-vs-AI seeded cohorts are
diagnostic only.

**Next lane (superseded by [FRONTIER_OBJECTIVES.md](FRONTIER_OBJECTIVES.md)):**
AP-priced
extras and guards, more diverse bot policy challenges, high-sample
paired seat swaps, and actual human PvP transport. Do not infer game
balance from green CI or confuse five role models with finished PvP.
