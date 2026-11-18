# One authoritative Frontier match constructor

This is the first governed cross-system part of issue #47, not a new
user-facing mode. The only active player-facing game is the Frontier127
five-role 5v5 match on one command and combat ruleset.

`src/engine/frontier-match.ts` provides a **pure** authoritative
`createFrontierRoleMatch(seed)` function, with deterministic FNV-1a seed
derivation, `initFrontierBoard` terrain, `placeFrontierRoleUnits`
symmetric one-of-each armies, `roundCap=50`, and the Raider strike
ledger initialized to an empty list.

Both the production browser practice Worker and future live competitive
match runners must call this function, not recreate its seed, topology,
spawns and state in separate code. The static Pages artifact explicitly
allowlists the pure source; no Node crypto, Bun SQLite, gateway secrets,
or persistence code is included.

Historical `createMatch`, legacy Board81/61, three-role roster and
replay IDs remain unchanged for reading archived matches. They are not
player-selectable.

The second stage of issue #47 must still migrate the external-agent
runner, version negotiation, valid two-move plan acceptance and complete
bid/round lifecycle, and prove a live two-channel PvP match. **This PR
does not claim that protocol migration is complete.**

Promotion gates include 64 native seed invariants, 40 byte-identical
compiled-browser state comparisons, each side's private observation
projection, no source/Pages allowlist leak, full browser mobile/desktop
tasks and post-merge public Pages verification.
