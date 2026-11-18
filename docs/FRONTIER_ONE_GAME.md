# Single playable Frontier rules: product contract

**Owner decision, 2026-11-18.** The player gets **one** HexaWars game, not a configuration matrix.

## Single current game

- Map: **Frontier127** 127-hex disk, mirrored 5v5 deployment.
- Commands: 2 different friendly squads may move, 1 may attack, both seats
  submit sealed plans; 3 starting initiative AP, carry at most one, max four.
- Fog: corrected cube-symmetric line of sight with terrain obstructions.
- One primary action: **Start battle**, and on completion **Play again**.
  No map, rule-version, or economy radio buttons are exposed to players.
- Current local opponent: bid-aware AI on Red. This is **unranked practice**,
  not online human-versus-human PvP yet.

## Diversity is in squads, not selectable rulesets

Five distinct tactical classes are the next gameplay implementation priority:
Scout, Raider, Interceptor, Siege, Captain. All five must use the **same**
Frontier board and round economy and be deployed one of each per side.
Role-specific abilities and counterplay are canonical gameplay, not user
profile toggles or alternative variants. The older three-class roster is
not presented as a completed five-role game.

Historical legacy81/balanced61/frontier-v1/v2 replay logic and regression
fixtures stay **internal only**, to avoid silently rewriting prior
outcomes. They are not shipped as alternate playable modes. Future
changes can advance the canonical rules version internally for
reproducibility while retaining one player-facing game.

**Explicit non-goals:** new map styles, separate balance profiles, old/new
rule selection, ranked status inferred from bot-vs-bot test success.
