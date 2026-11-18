# Initiative AP burn correction (Plan D v2)

Status: 2026-11-18. Parent gameplay-fidelity #25, AP-cost defect #28.

## Defect
The round driver deducted a bid and then called `applyCarryover`, which
reinitialized `apPool` to base AP plus carry. Every initiative bid was
effectively **free**, contrary to frozen Plan D v2.

The correct order is:
1. Refresh available current-round AP to `BASE_AP + previous carry`, capped
   at `AP_CAP` (3 or 4).
2. Validate the entire plan against available AP.
3. Deduct sealed bid from refreshed available AP, burning that cost regardless
   of initiative outcome.
4. Resolve free move, free attack and currently supported AP extras (none).
5. Refund unused free-action slots and carry at most 1 AP into the next round.

Negative, non-integer and nonfinite bid amounts are rejected. Existing AP
costs and 50-round cap remain unchanged. This fix does NOT enable unimplemented
second attacks, stances, reserves or boosted abilities; they remain explicitly
refused by `extras-disallowed.ts`.

## Examples
- Opening with 3 AP, bid 0, no free slots used: remaining pool 4 after up to
  2 refunds, carry 1.
- Opening with 3 AP, bid 3, no free slots used: pool 2 after refunds, carry 1.
- Second round with previous carry 1: refresh pool 4, bid 3 leaves 1 before
  slots, and 3 after two refunds.

These examples are asserted in source round-driver tests.

## Compatibility and release gate
Previously stored bid-containing matches can have different round budget
outcomes under the corrected implementation. Do not rewrite append-only
histories or claim historical replay byte-equivalence. Future ranked matches
must bind the precise validator/resolver contract and pricing version.

Require source Bun gate, TypeScript ratchet, browser compiled game parity,
both seeded 200-bot cohorts, browser 2D/3D complete-match acceptance, Socket
checks and published main release. Human bidding UI is a separate slice.
