# Bid-aware local opponent v1 (unranked)

**Status:** qualification candidate. Complements RFC 0002 and issue #38.

The public Frontier127 human-vs-AI interface previously let Blue bid 0–3
initiative AP while Red's house bot **always** submitted `bid:0`. The
policy also contained a special near-enemy hold rule only for Red. These
two AI behaviors were not mirror-fair, despite equal armies and terrain.

This feature adds an **explicitly versioned opponent policy**, not a new
combat ruleset:

- `newPractice(seed,"frontier127")` keeps its prior ID, game state and
  legacy scripted bot choices exactly; 61/81 legacy profiles stay
  untouched.
- `newPractice(seed,"frontier127","bid-aware-v1")` uses the same current
  `hexawars-frontier127-v1` engine rules and same initial 127 cells,
  but gets a different match ID:
  `practice:hexawars-frontier127-v1:bot-bid-aware-v1:<seed>`.
  A declared `opponentPolicy` distinguishes it from historical runs.
- The bid-aware policy is applied identically to A and B for automated
  fairness comparisons. It removes the B-only defensive hold branch.
- It considers only visible enemy positions and current owned squad
  positions. When a legal attack exists, it bids up to 2 AP for a
  contested exchange, otherwise 1 AP; when enemies are nearby and it
  is maneuvering, it bids 1; with no engagement it bids 0.
- Both sides remain limited to **one free move and one free attack**
  each round. A higher bid changes initiative ordering only. The policy
  does not give the AI extra squad activations or reveal hidden plans.
- The human UI selects bid-aware-v1 only on the default Frontier board.
  The legacy board menu still selects legacy-v1. After each round, the
  *revealed* Blue and Red bids are displayed so the player understands
  how priority was contested, not beforehand.
- This is **not** human PvP, online matchmaking, ranked anti-cheat,
  unit-class parity or a repair of the frozen Plan D free-slot refund.

## Evidence expected before promotion

Test canonical validation on both seats, two contact situations where
the legacy Red bot passes, identical A/B tactical bids for symmetric
opportunities, AP affordability, match identity isolation and the
32-seed bid-aware comparison cohort. Preserve all historical source,
Pages QA and real Chrome desktop/mobile flows.

Track win rates, draw/cap rates, action utilization and bid spend
separately. A 32-match cohort is **exploratory** and cannot establish
competitive fairness; run paired side swaps with the *same* policy and
500+ seeds to qualify a new ranked economy.

The actual five-role restoration and 2-move competitive economy remain
separate versioned changes proposed in RFC 0002 and issue #38.
