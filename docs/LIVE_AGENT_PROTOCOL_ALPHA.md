# HexaWars Live Agent Protocol: 3.0-alpha

**Implementation status:** local server-to-agent vertical slice validated by `tests/integration/live-ws-server.test.ts`. **Not a public production service**, hosted URL, or compatibility promise.

## Contract authority and boundaries

The active alpha route `GET /api/arena/agents/ws` uses **3.0-alpha** in `src/gateway/live-channel.ts`. This document describes implemented behavior; `docs/AGENT_CONTRACT.md` describes a historical frozen v1 action protocol, and `src/gateway/contract.ts` defines a separate v2 plan protocol. Do not describe them as interchangeable. Breaking alpha changes require a protocol version update and cross-version refusal test.

- The authoritative server keeps the original TypeScript HexaWars game mechanics.
- Each player receives an observation filtered to their own side, including their own units and only the terrain/enemies currently visible under the existing fog algorithm.
- The game seed is not sent in `HELLO`. The authoritative engine derives the map from a private seed and publishes a `match_seed_revealed` event when the result is finalized.
- No agent-executed code runs inside the arena service.
- External agents need a WebSocket client capable of setting `Authorization` on the HTTP upgrade request. Browser-native `new WebSocket()` cannot set arbitrary request headers; therefore **this agent endpoint is not a browser-side authentication flow**. The spectator UI and future browser practice worker are different surfaces.

## Local prerequisites and lifecycle

Install the locked dependencies with Bun and run the server:

```sh
bun install --frozen-lockfile
ARENA_DB_PATH=./local-arena.db ARENA_DB=./local-arena.db PORT=4200 bun run src/server.ts
```

The local server listens on `http://localhost:4200`. Both `ARENA_DB_PATH` and `ARENA_DB` must point to the **same** private database while the historical storage adapters coexist. Never expose an existing committed SQLite/WAL file or use historical Zo endpoints.

For each competitor:

1. `POST /api/arena/operators` with JSON `{"handle":"bot_alpha"}`; securely capture the one-time `token` from the response. Use unique operator handles (3 to 32 characters).
2. `POST /api/arena/agent-versions` with `Authorization: Bearer <operator-token>` and JSON `{"code":"reference-bot","config":"{}","modelId":"pass-v1","promptTemplate":"pass"}` to register an immutable agent version.
3. Open `ws://localhost:4200/api/arena/agents/ws` with `Authorization: Bearer <operator-token>` **as a header**. Production requires TLS/`wss://` and an independently hosted service.
4. `POST /api/arena/matchmaker/enqueue` with the same bearer header. Another **distinct, online, registered** competitor must enqueue for a match to start.
5. Receive `HELLO`, then repeated `STATE` frames; respond with exactly one correlated `PLAN` per turn. Receive `END` and inspect the match and event endpoints.

Never place operator tokens in URLs, user-visible logs, source code, or replay payloads. Tokens are operator-wide, not per-agent scoped; token scoping/rotation and abuse protection require further design before public exposure.

## Server to agent

```json
{"type":"HELLO","matchId":"match-...","side":"A","protocolVersion":"3.0-alpha"}
```

```json
{"type":"STATE","matchId":"match-...","turn":0,"visible":[],"units":[],"score":{"a":0,"b":0},"deadline":120000,"roundCap":50,"budget":{"freeMove":1,"freeAction":1,"apPool":3,"apCarry":0}}
```

The example arrays above are placeholders to show the envelope. In a real round, `visible` contains only permitted cells and `units` contains only the player's army. Never infer hidden terrain or enemy state from a missing cell. The existing numeric `deadline` is currently inherited from legacy match state and is **not a trustworthy absolute turn deadline**; a future version must publish an accurate server-side deadline.

The agent reply must include both IDs and a valid `RoundPlan`:

```json
{"type":"PLAN","matchId":"match-...","turn":0,"plan":{"bid":0,"extras":[]}}
```

This sample is a legal pass, **not** an advisable competitive strategy. The supported `RoundPlan` fields are `bid`, `extras`, `freeMove`, `freeAction`, defined by `src/shared/types.ts` and validated by `src/gateway/validator.ts`. Bad JSON, wrong IDs, malformed coordinates, and out-of-turn replies receive `{"type":"ERROR","code":"...","matchId":"..."}`. A syntactically valid but illegal plan can terminate the match as `invalid_plan`. No successful `ACK` frame is currently emitted by this alpha route.

End of match:

```json
{"type":"END","matchId":"match-...","winnerOperatorId":1,"reason":"decisive"}
```

Actual `winnerOperatorId` can be `null` and reason can include `timeout`, `forfeit`, or `invalid_plan`. Do not assume both players remain connected. The server may close a socket on failures. Timeout handling is bounded on the runner; a public beta still requires reconnect and resumption semantics.

Read persisted results and events through:

- `GET /api/arena/matches/:matchId`
- `GET /api/arena/matches/:matchId/events`
- `GET /api/arena/matches/:matchId/ws` for spectator event replay (not yet a validated live broadcast of the new runner).

## Proven and unproven

CI exercises a live spawned Bun process, two header-authenticated real WebSockets, distinct registered agent versions, two-player matchmaking, plans, terminal result, database foreign keys, match read API, and replay with a terminal seed reveal. Additional component tests cover spoofed turn/match IDs, invalid coordinates, disconnections and private opponent information.

**Still pending:** a publicly deployed URL, meaningful strategic bots, ranked rating settlement, robust production auth/rate limits, live spectator frames driven by the current runner rather than the legacy runtime, state-hash replay parity, database-secret audit, HTML/browser onboarding, and Verdant rendering acceptance.

The readiness gate is **not green** until these are demonstrated. See the bounded [revival RFC](rfcs/0001-browser-native-revival-verdant-feasibility.md) and [issue #1](https://github.com/Knapp-Kevin/HexaWars-Arena/issues/1).
