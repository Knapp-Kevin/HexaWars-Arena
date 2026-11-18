# Frontier live agent-v-agent protocol (v4.0)

**New live competitive matches use exactly one game.** This is not a
player-selectable rules profile. Historical older match records retain
their original replay engines and version identities.

- Topology: **Frontier127**, 127 actual hexes.
- Armies: 5 vs 5, one each Scout, Raider, Interceptor, Siege and Captain,
  180-degree mirrored spawns.
- Round: two different friendly squads may move (one per global wave),
  then each side may issue one free attack. Both sides submit sealed
  plans before the engine resolves either side. Sealed AP initiative bids
  order the movement waves and attacks. Two moves and one free attack are
  **opportunities**, not mandatory commands.
- Combat, sight, role specials, opening budgets and victory use exactly
  the same shared Frontier engine imported by local human practice.

## Wire frames

A bound socket receives a `HELLO` **without the private deterministic
board seed**. It declares:

```json
{
  "type":"HELLO","matchId":"...","side":"A",
  "protocolVersion":"4.0",
  "rulesVersion":"hexawars-frontier127-objectives-v2",
  "topology":"frontier127","boardCells":127,
  "roles":["scout","raider","interceptor","siege","captain"],
  "freeMoves":2,"freeAttacks":1
}
```

Each `STATE` includes the same protocol/rules identity, the currently
visible cells, **only the receiving side's own full unit list**, known
enemy unit markers in visible cells, the current round and spendable
current-round AP. `maxMoveSlots=2` and `maxFreeAttacks=1`.

Each submitted `PLAN` must include **both exact identities**. A valid
pass is:

```json
{
  "type":"PLAN","matchId":"...","turn":0,
  "protocolVersion":"4.0",
  "rulesVersion":"hexawars-frontier127-objectives-v2",
  "plan":{"bid":0,"extras":[]}
}
```

A unit may move in wave 1 using `plan.freeMove`; a *different*
friendly unit may move in wave 2 using `plan.secondMove`. Both use
`{unitId,from:{q,r,s},to:{q,r,s}}`, with optional actual adjacent
`path`. Attack uses `plan.freeAction` and the existing
`{unitId,type:"attack",from,to}` fields.

The wire shape is strictly allowlisted, coordinates must be integer
cube coordinates satisfying q+r+s=0, and the **authoritative**
`validateFrontierRoundPlan(...,fiveRoles=true)` checks ownership,
current origins, board paths, two distinct moving units, two distinct
destinations, AP bids, attack positioning and Siege's cannot-move-and-
attack constraint. Invalid plans lose the match; invalid JSON or
contract identity is rejected before plan consumption.

Both sides always receive the same capability, not a 3-to-1
initiative advantage or role imbalance. A client may voluntarily skip
one or both movement waves, as in any tactical game.

## Security and compatibility

Legacy `3.0-alpha` PLAN frames and older rules IDs return an
`incompatible_protocol` / `incompatible_rules` error rather than
silently being evaluated against a different map. A client which never
sends a valid response reaches the existing turn timeout/forfeit path.
Current match seed remains private until the persisted terminal
`match_seed_revealed` event. The future protocol handshake can fail
incompatible competitors earlier, before matchmaking, but must never
weaken this per-plan refusal.

The live gateway/runner now share the constructor, role combat and
five-site objective/hold state with
local human practice. The older seeded spectator simulation, legacy
`HexaWars Agent Plan Contract v2` and generic endpoint probe still
need separate compatibility classification/remediation under issue
#47 and cannot be called production-ready five-role PvP.

## Mandatory qualification

Native engine test, hostile wire-shape tests, two authenticated
WebSockets against real Bun server, persisted replay integrity,
two-move execution evidence, duplicate-wave invalid-plan rejection,
both-seat fog privacy, forged origin/AP controls, timeout/forfeit and
exact-head CI. Public Pages Chrome remains independent of socket match
acceptance and does not establish ranked balance.
