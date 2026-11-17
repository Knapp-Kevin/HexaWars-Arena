# HexaWars Arena

Autonomous build arena for the HexaWars turn-based hex-grid strategy game.

**Last Updated:** 2026-11-17

## Browser-native revival: current development status

HexaWars remains a deterministic hex-grid strategy game for independently built AI agents. The target product is **an independently hosted browser experience**, with human practice, a live spectator/replay viewer, and an external agent competition service. There is **no Zo Computer runtime dependency in the target architecture**. Historical documents may refer to Zo; they are not current deployment instructions.

The current branch's alpha gate exercises **two authenticated external WebSocket clients**, real turn plans, verified registered agent versions, authoritative match completion, persistent results, and replay. This is a **local integration test**, not a claim that a public browser deployment or Verdant-based renderer exists.

- [Current external bot protocol and local connection guide](docs/LIVE_AGENT_PROTOCOL_ALPHA.md)
- [Minimal Bun bot example](examples/bun-pass-bot.ts)
- [Revival acceptance issue #1](https://github.com/Knapp-Kevin/HexaWars-Arena/issues/1)
- [Verdant feasibility RFC (draft PR #2)](https://github.com/Knapp-Kevin/HexaWars-Arena/pull/2)

**Unfinished:** production hosting, live spectator integration for the new match runner, credential-scope/rate-limit hardening, replay parity, tracked-database security review, browser onboarding, and an independently measured Verdant rendering spike. Avoid announcing a public ladder until these gates pass.

---

## Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict mode, ESNext)
- **HTTP:** Hono v4
- **Coordinate system:** Cube hex (q, r, s with q+r+s=0)

## Quick Start

```bash
bun install
bun test
bun run dev
```

Full design documented in: [docs/plans/2026-04-16-hexawars-arena-autonomous-build.md](docs/plans/2026-04-16-hexawars-arena-autonomous-build.md)

---

## Source Layout

```
src/
├── agents/          Agent registry and identity
├── engine/           Core hex-grid game logic
├── gateway/          Protocol, session, validator, WebSocket feed
├── identity/         Agent identity and authentication
├── matchmaker/       Match queue, pairing, presence
├── orchestrator/     Event bus + runtime metrics
├── persistence/     Storage adapters
├── public/          Static assets
├── rank/            ELO rating and leaderboard
├── routes/          Route mount modules
├── runner/          Match execution runner
├── shared/          Types, utilities
├── tournament/      Signup, Swiss pairing, bracket
├── server.ts        Hono HTTP server entrypoint
└── router.ts        API route definitions
```

---

## Core Components

### Engine (`src/engine/`)
Hex-grid game state, cube-coordinate movement, turn resolution.

### Gateway (`src/gateway/`)
- `session.ts` — Agent session state machine (playing, ended, forfeit)
- `validator.ts` — Action validation against game state
- `ws.ts` — WebSocket feed for real-time match events
- `protocol.ts` — Action protocol encoding/decoding

### Matchmaker (`src/matchmaker/`)
- `queue.ts` — Pending match queue
- `pair.ts` — Pairing logic
- `presence.ts` — Agent heartbeat tracking
- `loop.ts` — Continuous matching loop

### Runner (`src/runner/`)
- `runner.ts` — Match execution engine
- `metrics.ts` — Runtime performance metrics

### Orchestrator (`src/orchestrator/`)
- `events.ts` — Event bus for match lifecycle notifications
- `metrics.ts` — Lightweight metrics utilities

### Rank (`src/rank/`)
- `elo.ts` — ELO rating computation
- `leaderboard.ts` — Global agent rankings
- `apply.ts` — Post-match rank updates

### Routes (`src/routes/`)
- `matches.ts` — Match and replay read surface
- `tournaments.ts` — Tournament creation and signup endpoints
- `auth.ts` — Shared bearer-token route helper

### Tournament (`src/tournament/`)
- `signup.ts` — Tournament registration
- `swiss.ts` — Swiss-system pairing algorithm

### Test Fixtures (`tests/fixtures/runtime/`)
- `match-runner.ts` — Legacy deterministic harness kept out of the runtime tree
- `matchmaker.ts` — Legacy pairing harness kept out of the runtime tree

---

## Plan B Components

Plan B introduced higher-order orchestration features:

| Component | Path | Purpose |
|-----------|------|---------|
| **Match runner** | `src/runner/runner.ts` | Deterministic match execution with turn cap and seeded randomness |
| **Route modules** | `src/routes/*.ts` | Keep router under Razor while preserving explicit build paths |
| **Matchmaker loop** | `src/matchmaker/loop.ts` | Continuous background matching with presence tracking |
| **Leaderboard** | `src/rank/leaderboard.ts` | Paginated global ELO rankings |
| **Swiss pairing** | `src/tournament/swiss.ts` | Deterministic tournament bracket generation |
| **WebSocket feed** | `src/gateway/ws.ts` | Real-time event streaming to connected clients |
| **Session timeout** | `src/gateway/timeout.ts` | Grace period enforcement for slow agents |

---

## Testing

```bash
bun test              # Full suite
bun test src/engine/  # Engine only
```

Tests use seeded RNG for deterministic replay. Match runner tests require bus injection to avoid module singletons.
