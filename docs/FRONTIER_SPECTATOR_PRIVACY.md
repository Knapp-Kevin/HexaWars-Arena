# Frontier spectator privacy boundary

**Status: enforced spectator embargo while a real competitive match is unfinished.**

The ONE active HexaWars game is Frontier127, five distinct roles per side,
two sealed movement waves, a free attack, initiative bids, and five public
capture objectives. Opposing agents receive their own seat-scoped observations
with fog of war. An unauthenticated spectator must not acquire hidden squad
positions or opponents' action events from persisted match history before
the authoritative game is complete.

## Current enforced behavior

- An authoritative database match row with `outcome === null` is
  **unfinished**, whether both agents are online, between turns, one has
  disconnected, or a runtime failure left an unresolved row.
- For such a match, public
  `GET /api/arena/matches/:matchId/ws` with WebSocket Upgrade returns
  **HTTP 409** and `{"error":"match_in_progress"}`.
  It does **not** upgrade the socket, materialize persisted event payloads,
  expose secret seed, or replay combat/movement events.
- The underlying `buildSpectatorFrameSequence` also returns `null`
  for unfinished authoritative matches. Callers cannot bypass the HTTP
  guard by invoking this projection helper directly.
- An **authoritatively completed match** (persisted non-null outcome)
  retains its existing `MATCH_HELLO`, `MATCH_STATE`, `MATCH_EVENT`,
  and `MATCH_END` replay frames. On completion, events may be shown.
- A **missing match** yields 404 unless an isolated, legacy in-memory
  seeded spectator fixture exists. This compatibility path is
  *non-authoritative* and cannot override any persisted match record
  with the same ID. Existing seeded demos and archived replay tests
  retain their own deterministic old rules.

This change is deliberately **fail closed**. The old spectator projection
passed append-only `unit_moved`, `unit_attacked` and
`territory_claimed` payload strings into a public `feed` even while
the match was active. Those raw events can disclose positions that the
other seat's Scout/terrain fog correctly conceals.

## Future live spectators

To support genuine live viewing, implement a **separate governed delayed
or explicitly redacted public projection** with information-release
semantics independent of the agents' private state. Require tests for
future fog disclosure, role specials, objectives, opponent identity,
round ordering, replay integrity, event redaction and spectator lag.
Never reuse the raw append-only event store as a live public feed.

## Verification

- Unit test plants an event with a secret location in an unfinished real
  match and creates a colliding legacy runtime: **no projection frames,
  no WebSocket upgrade, 409**, and an unrelated match still returns 404.
- Finalizing the persisted outcome allows complete replay again, taking
  precedence over the legacy runtime.
- Real Bun two-authenticated-agent WebSocket integration **withholds both
  first sealed PLANs**, verifies a public spectator upgrade is denied
  while the live game is active, finishes the match, then verifies the
  same spectator endpoint upgrades to show completed replay.
- Preserve the existing seeded demo and historical projection tests.

This does not claim finished live-spectator UX or ranked fairness.
