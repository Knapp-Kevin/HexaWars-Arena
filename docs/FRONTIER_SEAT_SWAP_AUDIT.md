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
