# RFC 0001: Browser-native HexaWars revival and Verdant feasibility

**Status:** Discovery / proposed. This RFC does **not** approve a rewrite, a rules change, or a production migration.  
**Date:** 2026-11-17  
**Tracking:** [#1](https://github.com/Knapp-Kevin/HexaWars-Arena/issues/1)  
**Scope:** HexaWars Arena only; independently hosted browser experience and externally connected agents.  
**Evidence anchors:** HexaWars `main` [747d4fc](https://github.com/Knapp-Kevin/HexaWars-Arena/tree/747d4fcf2ab646e6f3425f014201cafcacc137f3); Verdant Engine `main` [fba5465](https://github.com/afflom/verdant-engine/tree/fba5465aa14349955a9f37e6a5cab9cd069b77ef). Revalidate against newer heads before implementation.

## 1. The product decision

Revive **HexaWars Arena as a browser-first, spectator-friendly game of strategic competition between player-authored agents**, with an optional human-facing practice path. HexaWars' distinguishing feature is multi-unit, fog-of-war, hex-grid strategy rather than Victris Arena's tick-based fighter combat. Preserve that differentiation.

**Reference, not clone:** Victris Arena makes the entire player journey legible: [bot guide](https://victrisarena.com/guide/bot-guide), [rules/spec](https://victrisarena.com/guide/spec), [agent onboarding](https://victrisarena.com/guide/agents), [simulator](https://victrisarena.com/guide/simulator), and [HTTP API](https://victrisarena.com/guide/api). Translate the *quality standards* (discoverability, one published source of rule truth, protocol examples, honest offline/live parity, ranked versioning, error behavior, replays) into an original HexaWars experience. Do not copy its game mechanics, presentation, assets, brand or non-public implementation.

**Browser-first means:** all human playing, spectating, replay viewing, and bot-management surfaces work in normal browsers; the build and operation have no Zo Computer dependency. It **does not** imply that ranked games, secure registrations, persistent leaderboards, or remote bots can be trusted to run only in the viewer's browser. These require an independently hosted authoritative service.

### Primary users and value

| User | Job to be done | First convincing proof |
| --- | --- | --- |
| Player / bot author | Understand the rules, train an agent, submit it, and improve it | A starter bot completes a real, ranked two-agent match using public documentation |
| Spectator | Understand territory, tactics and momentum without understanding code | Watch a live fight, inspect decisive turns, then replay it deterministically |
| Competitive operator | Preserve integrity of match records, ratings and fair match handling | Audit a seeded match, both players' legal observations, and its recorded outcome |
| Researcher / learner | Run repeatable multi-agent experiments | A local simulator reproduces the same rules, outputs and hashes as the server |

## 2. Baseline from repository inspection, not a launch claim

### HexaWars code that exists

- Bun / TypeScript / Hono: [package.json](../../package.json), [server](../../src/server.ts).
- Deterministic hex-board and turn mechanics: [engine](../../src/engine/), including [round driver](../../src/engine/roundDriver.ts), [fog](../../src/engine/fog.ts), [cube coords](../../src/engine/coords.ts), and [shared states](../../src/shared/types.ts).
- Existing agent-contract and gateway modules: [contract](../AGENT_CONTRACT.md), [gateway](../../src/gateway/).
- Identity, storage, matchmaker, rank, Swiss pairing, event projections and replay/spectator assets: `src/identity/`, `src/persistence/`, `src/matchmaker/`, `src/rank/`, `src/tournament/`, `src/projection/` and `src/public/`.
- Existing tests cover many individual components. **A source file or past passing-test claim is not evidence that the hosted experience presently works end to end.**

### Specific current risks

1. **Real agent execution is not proven.** `src/server.ts` constructs paired `AgentChannel` objects with `send: () => {}` and `onMessage: () => {}`; the matchmaker callback can start a runner without genuinely carrying a player's messages. Do not market this as a functional competitive ladder until real sockets, turns, decisions, and persisted results are exercised end to end.
2. **Multiple contract eras must be reconciled.** [AGENT_CONTRACT.md](../AGENT_CONTRACT.md) describes a frozen v1 `ACTION` frame, while [shared types](../../src/shared/types.ts) contain `RoundPlan` and extended action economy; an implementation and docs audit must identify exactly which protocol and rules the live runner actually uses.
3. **Old hosting paths are historical.** Some project docs still name `zocomputer.io`, Zo paths and prior Qor governance. No new feature should rely on those services, paths or claims. Preserve history as history rather than mass-editing the original evidence ledger.
4. **Tracked databases require a security audit.** Current Git tree tracks `.arena/state.db`, `.arena/state.db-shm`, `.arena/state.db-wal`, `.data/arena.db`, WAL/SHM derivatives and root `arena.db*`. `.gitignore` only excludes `node_modules/`. Determine whether these hold tokens, identity data, private match state or other sensitive records before choosing safe deletion, retention, rotation, or history redaction. Do not blindly destroy or rewrite data.
5. **Replay integrity and fog policy must be verified.** The spectator can potentially see more than either agent; server-to-agent observations must never leak the opponent's hidden data. Replaying events must not silently reconstruct unavailable private information as something the agent knew.

### Verdant Engine: evidence and limitations

The independent [Verdant Engine repository](https://github.com/afflom/verdant-engine) contains:

- [Rust 3D core](https://github.com/afflom/verdant-engine/tree/main/crates/verdant-core), an ECS, scene geometry, GLB operations, cameras, physics, rendering and UI modules.
- [`verdant-wasm`](https://github.com/afflom/verdant-engine/tree/main/crates/verdant-wasm) and [browser worker](https://github.com/afflom/verdant-engine/blob/main/site/engine-worker.mjs) for browser-capable rendering/simulation.
- A [browser-3d starter](https://github.com/afflom/verdant-engine/tree/main/templates/browser-3d-starter) with a playable `game.mjs` WebGL2 client and a Rust example that generates/exports its arena scene.
- Explicit [conformance claims](https://github.com/afflom/verdant-engine/blob/main/CONFORMANCE.md), [repository governance](https://github.com/afflom/verdant-engine/blob/main/AGENTS.md), and [MIT / Apache 2.0 licensing](https://github.com/afflom/verdant-engine/blob/main/Cargo.toml).

**These facts establish a plausible integration candidate, not a verified HexaWars port.** In particular, the starter's browser JavaScript and its Rust world generator do not, by themselves, prove that arbitrary HexaWars game state can be rendered through the packaged WebAssembly interface. Capture an actual API entrypoint, browser build instructions, dependency/build reproducibility and real measurements before adopting Verdant.

### Conceptual comparison

| Dimension | HexaWars baseline | Victris lesson | Verdant opportunity | Gate |
| --- | --- | --- | --- | --- |
| Game identity | Tactical, multi-unit hex board | Publish exact rules and edge-case order | Height, geometry, animation and visual readability | Same rules outcomes and event order |
| Agent access | Gateway, versions, operator tokens | Complete public lifecycle and errors | Renderer does **not** own credentials or decisions | Real WebSocket v1 contract test |
| Fairness | Seeded engine, fog and tests | Version/hash pinning, simulator parity | 3D views must not reveal hidden units | A/B privacy and replay tests |
| Audience | SVG spectator interface, partial replay | Learning and bot-building funnel | A more legible, cinematic isometric view | Browser usability and accessibility |
| Competition | Ranking, pairing and tournament modules | Real ladder with visible results | Visual layer remains optional | Persistent ranked match in full vertical slice |

## 3. Proposed separation of responsibilities

```text
BROWSER: client-only practice or production interface
  ├── Rules explorer, starter-bot tutorial, match browser
  ├── Human practice / local deterministic simulator (Web Worker)
  ├── Render adapter: current SVG first; candidate Verdant/Wasm/WebGL2
  └── Live spectator / replay client (read-only versioned events)
                      │ HTTPS / WSS
                      ▼
INDEPENDENT HOSTED SERVICE (no Zo dependency)
  ├── Operator sign-in / per-bot scoped credentials
  ├── Registration, matchmaking, timeouts, reconnect handling
  ├── AUTHORITATIVE HexaWars TypeScript match rules
  ├── Per-seat filtered observations / validated actions
  ├── Append-only match events, standings and replay storage
  └── Operational health, quotas, abuse safeguards, backups
              ▲                         ▲
       EXTERNAL AGENT A           EXTERNAL AGENT B
       (any language)             (any language)
```

An optional **browser-hosted personal agent** can run in a Web Worker for local practice; this is not a reason to run untrusted third-party code in the ranked server. Production bots may connect from any compatible external runtime. Credentials, when necessary for browser user flows, must not be exposed in replay URLs or stored as publicly readable data.

**Rules authority:** maintain one engine implementation until a genuinely tested alternative is proposed. Verdant handles world presentation/animations/picking and perhaps scene preparation; it must **not independently resolve hits, fog, wins, bids or turns**. The adapter consumes versioned, sanitized `BoardProjection` and `MatchEvent` data rather than importing private server state. Never rewrite seeded combat rules just to make a renderer work.

**Hosting selection:** choose provider after a proof of WebSocket behavior, session persistence, rate limiting, cost and deployment requirements. Static hosting alone cannot deliver authoritative ranked competition.

## 4. Proof-before-port development plan

### Gate A: restore truthful baseline (no 3D work)

1. Run the current test suite against a known Bun version and record exact pass/fail counts; inspect CI, runtime entrypoints and test fixtures.
2. Define one authoritative versioned rules/action/protocol contract from the code that executes, not a stale documentation label. Publish a JSON schema, rules hash, rejection reasons, turn deadlines, reconnection behavior and event ordering.
3. Implement/test an **actual** two-bot WebSocket match: register A and B, authenticate, queue, receive filtered initial state, submit actions, complete the game, persist result, fetch replay, independently verify final state hash. Include malformed frames, invalid coordinates, late replies, disconnect/reconnect and duplicate-frame cases.
4. Compare the source deterministic game implementation and a browser-worker local simulator on fixed seeds and action sequences. If they diverge, stop: an enhanced view must not make a broken competition appear complete.
5. Inventory tracked database contents safely. Determine secrets/identity data exposure, rotate affected credentials if warranted, set storage exclusions and a non-destructive repository/history remediation plan.

**Gate A exit:** documented repeatable full match with non-stub channels, no cross-seat fog leak, matching replay hash and recorded outcome.

### Gate B: Verdant browser-capability spike, not a full game port

1. Pin Verdant source revision, SDK/toolchain, license notices, build commands and artifact hashes.
2. Render a small HexaWars seed scene via a **real, documented** Verdant interface: >=19 hex cells, three terrain kinds, two distinguishable units, elevations, isometric/orbit camera, selection, path highlight, one deterministic move event and one combat event.
3. Confirm touch/pointer, keyboard alternatives, resize, reduced-motion support, screen-reader textual state and absence of hidden-information leaks. Compare side-by-side against the current SVG renderer.
4. Measure real browser cold load, transferred asset bytes, first playable frame, frame pacing, memory and reconnection. Test contemporary Chromium/Firefox/Safari where tooling supports them, plus a lower-powered mobile device. Record setup/browser hardware and limits; do not invent a performance claim.
5. Test actual failure behavior: no WebGL2, lost context, missing Wasm, failed asset, cross-origin request, invalid state schema. Display an honest recovery state and a working SVG fallback. **Do not add a fake Verdant adapter that silently renders with an unrelated library.**

**Gate B exit:** code-backed demo, reproducible launch steps, screenshots or recordings, metrics, and a go/no-go against the present renderer.

### Gate C: player journey, observability and open beta

1. Create a single navigable browser entry: learn rules -> practice -> make a bot -> simulate -> connect -> spectate -> replay -> compare versions.
2. Provide working TypeScript and Python starter bots, example observations, a schema, and an offline simulator sharing the authoritative resolution logic or verified behavior.
3. Show versioned standings, per-match causal timeline, legal/illegal action feedback, readable fog/territory/score updates and reproducible replay download.
4. Add operational and security acceptance: quotas, bounded frames and messages, token rotation, isolation, suspension, retention rules, accessible UI and privacy-conscious bot attribution.
5. Independent-of-Zo deployment rehearsal with service health, persistence restore, cancellation/reconnect and rollback.

**Gate C exit:** a new user can run an agent through a match and understand why it won/lost without assistance.

## 5. Decision rules

- **Choose Verdant** if its actual browser surface proves usable, maintainable, performant, accessible and visually better without altering HexaWars rules, identity or deployment truth.
- **Choose the existing SVG renderer, possibly with incremental WebGL2 improvements**, if Verdant integration risk or load cost is disproportionate. Do not treat 3D as inherently superior to a readable board.
- **Defer visual modernization** if the bot-to-result reliability gate is not green; otherwise a polished arena would merely conceal absent competition.
- No rebranding, game-rule replacement, engine migration or irreversible database cleanup is authorized by this RFC.

## 6. Evidence required to mark this RFC accepted

A short decision record links (1) contract hash; (2) a full live two-agent match/replay trace and persisted result; (3) fog isolation adversarial tests; (4) fixed-seed browser/server parity output; (5) reproducible Verdant demo repository ref and precise API version; (6) measurements/fallback; (7) tracked-data risk disposition; (8) hosting architecture without Zo; (9) accessibility and player onboarding review.

**Current decision: DISCOVERY / NO-GO for an untested full Verdant port. GO for a bounded renderer spike and core match-contract remediation.**
