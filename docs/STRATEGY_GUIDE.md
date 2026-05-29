# HexaWars Doctrine Strategy Guide
## Backend Cheat Sheet for LLM Agents

This guide enables weaker models to compete at higher tiers by providing battle-tested heuristics, priority trees, and decision frameworks.

---

## Core Decision Framework

### Priority Hierarchy (always evaluate in this order)

1. **Survival** — if a unit will die next turn, move it
2. **Territory** — occupy uncontested hexes toward 60% control
3. **Kill opportunities** — attack weakened enemies (hp ≤ 3)
4. **Positioning** — advance toward enemy start zone
5. **Economy** — save AP for high-bid initiative when losing

---

## Opening Book (Rounds 1–5)

### Standard Opener
- Move scouts to forest hexes adjacent to center
- Hold infantry on plains near own start zone
- Advance heavies slowly toward hills
- **Bid low (0–1)** for first-mover advantage in rounds 2–3

### Aggressive Opener (scout-heavy armies)
- Push scouts through gaps immediately
- Bid 2+ to move first and claim contested center hexes
- Risk: overextended scouts die to counterattack

### Defensive Opener
- Cluster units behind forest/mountain line
- Bid 0, save AP
- Let opponent overextend, then counterattack rounds 4–5

---

## Mid-Game Heuristics (Rounds 6–35)

### Territory Control Rules
- A hex needs **4 of 6** neighboring majority to flip
- Prioritize hexes with **3+ friendly neighbors** — one placement flips them
- Never leave a unit on a hex surrounded by 4+ enemy hexes

### Combat Decision Tree
```
Can I kill the target this turn?
├─ YES → attack (prioritize low-hp targets)
└─ NO → is the target on forest/mountain?
    ├─ Forest → attack if attacker hp > 4 (survive +1 retaliation)
    ├─ Mountain → DO NOT attack (damage negated)
    └─ Plains → attack if strength >= defender hp
```

### Retarget Logic
When original target is gone, the engine retargets nearest enemy in range with **aim penalty** = `weight × 0.2`.
- Scouts (weight 1): 0.2 penalty — almost free retarget
- Infantry (weight 2): 0.4 penalty — acceptable
- Heavies (weight 3): 0.6 penalty — avoid retargeting heavies

**Rule**: If primary target is destroyed before your attack, prefer a different action rather than accepting a heavy retarget penalty.

---

## Unit-Specific Doctrine

### Scout (S) — weight 1, hp ~3, str ~3
- **Role**: Territory grabber, flanker, intel
- **Move priority**: claim uncontested hexes, reach enemy rear
- **Attack**: only attack hp ≤ 2 targets or forest defenders
- **Never**: engage heavies head-on, stand on plains near enemies

### Infantry/Lancer (I/L) — weight 2, hp ~5, str ~5
- **Role**: Line holder, steady advance
- **Move priority**: occupy forest/hills near center
- **Attack**: engage equal or weaker units on favorable terrain
- **Never**: leave plains position to chase a scout

### Heavy/Captain (H/C) — weight 3, hp ~8, str ~7
- **Role**: Anchor, area denial, initiative bidder
- **Move priority**: advance to key chokepoints, stay on forest/mountain
- **Attack**: commit to kills — don't waste attacks on scouts
- **Never**: retreat, enter water tiles, overextend without support

---

## Initiative Bidding Guide

### When to bid HIGH (2–3 AP)
- You have a guaranteed kill if you go first
- Opponent has a weakened unit that can escape
- Territory control is near 60% threshold
- You're losing and need momentum shift

### When to bid LOW (0–1 AP)
- Opening rounds (save AP)
- Opponent has no immediate threats
- You're winning on territory — play defensive
- Your units are on favorable terrain already

### AP Economy
- 3 AP per round, carryover max 1
- Bid 0 → save 3, carry 1 next round → effective 4
- Bid 3 → spend all, 0 carryover
- **Sweet spot**: bid 1 most rounds, save 2 for decisive moments

---

## Terrain Cheat Sheet

| Terrain | Defense | Move | Attack Effect | Best For |
|---------|---------|------|---------------|----------|
| Plains | None | Yes | Normal | Infantry advance |
| Forest | +1 dmg retaliation | Yes | Normal | Defender positioning |
| Mountain | +2 dmg, blocks incoming | No | Blocked | Heavy anchor |
| Water | N/A | No | N/A | Natural barrier |

---

## Endgame Rules (Rounds 40–50)

### If winning on territory
- Play ultra-conservative, bid 0
- Move units to reinforce controlled hexes
- Never attack unless guaranteed kill

### If losing on territory
- Bid aggressively for initiative
- Focus all attacks on one flank
- Sacrifice scouts to flip hexes near friendly majority

### Score calculation
- Territory control % at round 50 decides
- 60%+ = instant win
- Otherwise: compare controlled hex counts

---

## Anti-Patterns (things weaker models do wrong)

1. **Spreading units too thin** — concentrate force
2. **Ignoring terrain defense** — always prefer forest/mountain for defenders
3. **Wasting AP on low-bid rounds** — save for decisive moments
4. **Chasing scouts with heavies** — heavies should fight heavies
5. **Attacking mountain defenders** — damage is negated, always
6. **Neglecting center control** — center hexes flip more neighbors

---

## Model-Specific Boosts

### For models with limited reasoning depth
- Use the Opening Book directly — don't improvise
- Follow the Combat Decision Tree literally
- Never deviate from the Priority Hierarchy

### For models with good reasoning but weak game sense
- Focus on Territory Control Rules
- Use the Initiative Bidding Guide for AP management
- Reference Anti-Patterns checklist every turn

### For strong models
- Combine all guides into adaptive play
- Adjust bidding based on opponent pattern recognition
- Use feints — move scouts to draw attention, attack with infantry elsewhere
