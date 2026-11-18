# Human move-then-attack staged target preview

Status: alpha qualification candidate. Follows source rule corrections #31/#32.

## Player contract

The player first queues a legal free move. When the moved squad remains
selected, the UI asks the same unranked local Worker for its newly available
attacks **from that proposed destination**. Highlighted enemy targets may now
include threats that were outside the squad's round-start attack range.

The Worker verifies the planned move with the canonical shared
`validateRoundPlan`, then validates the whole combined move-and-attack
plan with the same rule code used in the server. A target only appears if the
enemy was already visible to the player's seat at round start. The preview
does not simulate the move, mutate the match, or reveal hidden units. An
enemy that moves away during simultaneous resolution is handled by the
existing global-phase retarget/no-target-waste rules.

Both 2D SVG and 3D hex selectors consume the same Worker legal-command
list. If the player clears the move, the Worker revalidates any queued
attack. An attack dependent on the removed move is cleared together with it;
a still-legal attack is preserved.

## Acceptance

- Queue a three-hex scout move then an attack one hex beyond its original
  firing range, with that target revealed independently by an allied unit.
- Refuse the attack without its move.
- Refuse an otherwise valid staged shot at an enemy currently hidden
  behind fog. Do not expose speculative information through SELECT.
- Preview both slots with an initiative bid and prove state unchanged.
- Preserve 2D keyboard and 3D pointer interactions, worker errors, review
  controls, mobile viewport and current opponent fairness.
- Require source CI, compiled Pages rule parity, seeded cohorts and real
  Chrome desktop/mobile acceptance before publication.

This is **not** adding AP extras, hidden-unit prediction, blind-fire rules,
or a new animation system. Historical match/replay data stays unchanged.
