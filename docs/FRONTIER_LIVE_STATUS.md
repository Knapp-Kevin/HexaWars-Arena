# Frontier live match status: authoritative sources

The public `GET /api/arena/matches/:matchId/status` endpoint reports
the one active Frontier match, not the archived 81-cell spectator simulator.

## Response contract

- **Active**: `{"state":"active","round":0,"roundCap":50}`
  (or the most recent actual round index). Evidence: at least one
  presently bound, authenticated Frontier agent channel with this exact
  match ID. The round is updated only after a real STATE frame is sent,
  never inferred from a prior spectator demo.
- **Completed**: `{"state":"completed","round":null,"roundCap":50}`
  only after the authoritative persisted match outcome is non-null.
  Completed-round count is explicitly unknown: the match store has no
  canonical final-round column, so inventing `round:0` is incorrect.
- **Unresolved**: `{"state":"unresolved","round":null,"roundCap":50}`
  when an authoritative match record exists but has no outcome and no
  currently bound real agent channels. For example, a runtime failure.
  Persisted record creation alone does not prove match completion.
- **Unknown**: HTTP 404 with `{"error":"not_found"}`.

All responses deliberately omit deterministic seed, hidden enemy positions,
sealed orders, agent credentials and private round state. A match is never
registered as active solely by creating a seeded `MatchRuntime` from the
older spectator-only implementation.

The previous endpoint looked up `getActiveRuntime` from
`src/orchestrator/match-runner.ts`, while the actual server starts
`src/runner/runner.ts` for live competitive play. Consequently a live
Frontier match could be returned as "completed" as soon as its SQLite
record appeared, even while both agents were awaiting the first move.
The corrected endpoint instead reads bound live channels.

A native test covers binding, turn advancement, consumed plan windows,
completion and cleanup. A real two-authenticated-WebSocket integration
test deliberately withholds both first PLANs, verifies HTTP status
`active`, releases plans, completes the match and verifies
`completed`. No alternate rule profiles are added.
