# Frontier 1v1 fairness audit: command seat versus physical deployment

**Status:** source/compiled-browser reproducible measurement, **not** competitive certification.
Companion to `docs/FRONTIER_ECONOMY_PAIRED_BASELINE.md` and #38.

The first 48-seed economy comparison found a significant Blue/A skew,
especially in Classic v1. Its two economy variants have separate match
identities, which changes the FNV-1a deterministic initiative tie-break.
A balance diagnosis must not silently treat that as a controlled variable.

## Method

For each of 32 identical Frontier map seeds and **each** of the two
command economies (`classic-v1` and `maneuver-v2`), execute two full
unranked AI-vs-AI matches:

1. Normal seating: A commands the physical left deployment; B commands right.
2. Seat swap: exchange ownership and unit IDs **without moving any squad or
   changing any terrain, board cell, HP, budget, tactical unit type, match
   ID or seeded initiative coin**. A now commands the right deployment.
   Rebuild the visible unit projections from the authoritative unit list;
   both sides continue receiving normal per-seat fog observations.

The seat-swap state is a **test-only ephemeral simulation**, never a
real replay or matchmaker registration. It deliberately reuses a match
ID to keep the initiative tie sequence controlled inside the comparison;
it must **never** be persisted as a second real match with the same ID.

Both seats use exactly the same `bid-aware-v1` observation-limited
opponent policy. The loop validates both legal round plans through the
canonical contract and calls the same production practice resolver.

For each profile measure: command-seat victories A/B/draws, physical
left/right victories, normal versus swapped results, tied-bid counts,
A/B tie priorities, higher-bid priorities, aggregate AP bid spend,
orders issued per seat and completed rounds. Report the fraction of
pairs whose command-seat winner stays the same after the physical
deployment is exchanged.

## Interpretation and release boundary

- If A continues to win disproportionately after swapping, suspect
  **command-seat priority or policy / engine asymmetry**, rather than
  left-biased map tiles.
- If the physical-left army wins in both orientations, investigate the
  **physical board, deployment, fog geometry or tactical unit placement**.
- If the result flips by seat without consistent advantage, inspect
  interaction between initiative tie order, mirrored tactics, target
  selection and limited move budget.
- A deterministic FNV tie-break need not alternate per turn; count the
  *actual* tied bid priorities, not theoretical 50/50 expectations.
- Outcome samples are small (64 matches per economy) and pairwise
  dependent. This identifies engineering hypotheses, not a ranked
  fairness PASS. Use additional 500+ seed, role-matched agent styles,
  side swaps and human trials before adopting a locked balance rule.

The frozen `resolveBids`, historical match IDs, v1 and v2 combat
economies and public UI are untouched by this audit. Any remedial
tie-break / side-bias rule must be **versioned** after source evidence.


## Observed 32-seed × two-seat results

The complete compiled-browser and real-Chrome qualification on PR #42
([run 44331324316](https://github.com/Knapp-Kevin/HexaWars-Arena/actions/runs/44331324316))
recorded **64 completed games per economy**, same starting map seed and
the same deterministic initiative coin within each normal/swapped pair:

| Metric | Classic v1 | Maneuver v2 |
| --- | ---: | ---: |
| A wins / B wins | 36 / 28 | 32 / 32 |
| Normal A / B | 19 / 13 | 18 / 14 |
| Swapped A / B | 17 / 15 | 14 / 18 |
| Physical left / right | 34 / 30 | 36 / 28 |
| Tied bid rounds | 744 | 841 |
| Tied initiative first A / B | **377 / 367** | **420 / 421** |
| Higher-bid initiative first A / B | 168 / 173 | 231 / 184 |
| Total AP bid A / B | 799 / 804 | 1012 / 954 |
| Orders issued A / B | 1410 / 1404 | 2377 / 2411 |
| Average match rounds | 16.95 | 19.63 |
| Same command-seat winner in pair | 12 | 8 |
| Opposite command-seat winner in pair | 20 | 24 |

These samples do **not** reproduce a severe deterministic tie-priority bias.
Both economy profiles exhibited close-to-even A/B tie priority, while v2
wins were exactly even. The earlier Classic 48-seed result (A 38 / B 9 /
draw 1) is **not representative enough to be a diagnosis**: different
seeds produce different observed matchup outcomes. The controlled
experiment identifies no justification for silently rewriting the
frozen tie-break.

Physical-left results still vary (34/30 and 36/28). With only 32 paired
seeds per profile and shared bot heuristics, this is **not** proof of
a physical-map advantage either. The next high-value work is exact
five-role mechanics, working objectives, faithful LOS, and larger
multi-policy, genuinely human-played qualification. Keep the economics
prototype unranked.
