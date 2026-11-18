# Frontier Control: One Objective Economy

**Current intended rule for new matches:** Frontier127 with five
symmetrically authored control sites, the five tactical roles per army,
two separate movement waves and one attack per round. There are no
map or rules selectors. This is a new **internal v2 replay identity**
because it changes victory, scoring and the match's initial state;
archived original five-role v1 outcomes are not rewritten.

## Winning

- Eliminate the opposing army, **or**
- Capture and hold **3 of the 5 control sites** (60%) for **3
  consecutive completed rounds**.
- At round 50, if neither condition is met, the side owning more control
  sites wins; equal control is a draw.

The current game deliberately uses **five authored strategic sites**, not
the older impossible threshold of 77 out of 127 temporary territorial
tiles. A five-unit side can control at most 12 transient tiles with the
original >3-neighbor rule; the earlier 60% map-win was unreachable.

## Control sites

Coordinates in cube notation (q,r,s):

- Left lane: (-3, 0, 3)
- Upper-left covered flank: (-2, 2, 0)
- Center: (0, 0, 0)
- Lower-right covered flank: (2, -2, 0)
- Right lane: (3, 0, -3)

Five fixed sites within the **same existing** 127-cell map. The layout
is exactly symmetric under 180° rotation, the center is neutral, and
all five are guaranteed passable in all supported seeds. There are no
extra control tiles randomly appearing on another battlefield.

A site changes owner when a living squad occupies it or when four of
its six adjacent cells contain living squads of the same side and the
site itself is unoccupied. When neither condition holds, the prior
owner retains it, including after squads depart. An enemy can flip an
owned site directly through occupation or surrounding. Direct living
occupancy defeats surrounding control.

The engine captures only after both global movement waves and both
attack phases. Dead units never capture. Captures use the current
authoritative unit list, not embedded cell snapshots. No capture event
is fabricated when ownership is unchanged. Score and hold streaks
update atomically with the authoritative board. The same calculation
is shared by browser practice and live agent-versus-agent matches.

## Human and agent presentation

The two-dimensional map uses outlined objective hexes and color-coded
owner pips. Verdant 3D uses raised objective rings with the same team
ownership colors. A compact HUD shows both sides' counts out of five,
the current majority hold streak and the three-site requirement.
Public objective positions and control scores are available to both
seats; concealed enemy squad locations, actions and the private board
seed are **not** disclosed by the live seat observation. Live HELLO
declares all five public coordinates and the required hold conditions.
Each seat's STATE also publishes the five owners (A, B or neutral),
even if the site is outside current squad sight. This matches the
human practice map's public control rings; it does **not** publish
enemy units, their health, private actions or other unseen hexes.

## Compatibility and release qualification

- Internal active identity:
  `hexawars-frontier127-objectives-v2`.
- Archived five-role v1 identity:
  `hexawars-frontier127-five-roles-v1` (old map state, original
  resolution and scoring still readable).
- Historical 81-cell, 61-cell, earlier 127-cell and older maneuver
  IDs also remain unchanged, available only as offline replay/test
  adapters. No alternate user-facing rule choice.

Release gates: symmetric 64-seed map checks, direct capture/flip and
dead-unit controls, actual three-round non-elimination victory using
the full resolver, cap and equal-score behavior, server/client
byte-parity, 2D/3D desktop/mobile usability and real-agent two-seat
transport tests. Longer multi-policy balance audits and actual human
playtesting still must precede competitive balance certification.
