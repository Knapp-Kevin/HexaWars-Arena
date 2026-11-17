import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { mount } from "./router.ts";
import { serveStatic } from "./static-routes.js";
import { openDb, initDb, DEFAULT_DB_PATH } from "./persistence/db.js";
import { initSchema } from "./storage/db.js";
import { seedDemoMatch } from "./persistence/seed.js";
import { startMatchmaker } from "./matchmaker/loop.js";
import { MatchQueue } from "./matchmaker/queue.js";
import { PresenceTracker } from "./matchmaker/presence.js";
import { MatchmakerStatus } from "./matchmaker/status.ts";
import { MatchRunner } from "./runner/runner.js";
import type { RunnerContext } from "./runner/types.js";
import { getOperatorByToken } from "./identity/operator.ts";
import { LiveConnections } from "./gateway/live-connections.ts";
import { handleSpectatorWs, matchSpectatorPath, spectatorWebSocket } from "./gateway/spectator-ws.ts";
import type { SpectatorSocketData } from "./gateway/spectator-ws.ts";
import { getMatch } from "./persistence/match-store.ts";
import { getActiveRuntime } from "./orchestrator/match-runner.ts";

const app = new Hono();

const dbPath = process.env.ARENA_DB_PATH ?? DEFAULT_DB_PATH;
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
initDb(db);
initSchema();
if (process.env.ARENA_SEED_DEMO === "1") {
  try {
    seedDemoMatch(db);
  } catch (err) {
    console.error(`[arena] demo seed failed:`, err);
  }
}

const START_TS = Date.now();
const SERVICE_VERSION = "0.1.0";

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "arena",
    version: SERVICE_VERSION,
    uptime_ms: Date.now() - START_TS,
    ts: new Date().toISOString(),
  }),
);

// Boot matchmaker with closure-injected queue + presence.
const matchQueue = new MatchQueue();
const presenceTracker = new PresenceTracker();
const matchmakerStatus = new MatchmakerStatus();

const runner = new MatchRunner(db);
const live = new LiveConnections(presenceTracker);

function selectedVersion(operatorId: number): number | null {
  const row = db.prepare(
    "SELECT id FROM agent_versions WHERE operator_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
  ).get(operatorId) as { id: number } | undefined;
  return row?.id ?? null;
}

startMatchmaker({
  queue: matchQueue,
  presence: presenceTracker,
  onPair(pair) {
    const aId = pair.a.operatorId;
    const bId = pair.b.operatorId;
    if (!live.available(aId) || !live.available(bId)) return false;
    const aAgent = selectedVersion(aId);
    const bAgent = selectedVersion(bId);
    if (!aAgent || !bAgent) return false;

    const matchId = `match-${crypto.randomUUID()}`;
    const channels = live.bind(aId, bId, matchId);
    if (!channels) return false;
    const ctx: RunnerContext = {
      matchId,
      seed: crypto.randomUUID() + crypto.randomUUID(),
      a: { id: aId, name: pair.a.handle, agentVersionId: aAgent },
      b: { id: bId, name: pair.b.handle, agentVersionId: bAgent },
    };
    matchmakerStatus.recordPair();
    void runner.start(ctx, channels)
      .then((result) => live.complete(aId, bId, matchId, result))
      .catch((err) => {
        live.fail(aId, bId, matchId);
        console.error(`[arena] match ${matchId} failed:`, err);
      });
    return true;
  },
  intervalMs: 1000,
});

mount(app, db, { matchQueue, presence: presenceTracker, status: matchmakerStatus });
serveStatic(app);

app.get("/", (c) => c.json({ service: "arena", status: "online", version: "0.1.0" }));

// GET /api/arena/matches/:matchId/status — live vs completed state
app.get("/api/arena/matches/:matchId/status", (c) => {
  const { matchId } = c.req.param();
  const runtime = getActiveRuntime(matchId);
  if (runtime) {
    return c.json({
      state: "active",
      round: runtime.round,
      roundCap: runtime.state.roundCap,
    });
  }
  const match = getMatch(db, matchId);
  if (match) {
    return c.json({
      state: "completed",
      round: 0,
      roundCap: 0,
    });
  }
  return c.json({ error: "not_found" }, 404);
});

type AgentSocketData = { kind: "agent"; operatorId: number };
type ArenaSocketData = AgentSocketData | SpectatorSocketData;
type AgentSocket = WebSocket & { data?: ArenaSocketData };

const port = Number(process.env.PORT ?? 4200);

export default {
  port,
  fetch(req: Request, server: unknown) {
    const path = new URL(req.url).pathname;
    if (path === "/api/arena/agents/ws") {
      if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
      if (!req.headers.get("upgrade")?.toLowerCase().includes("websocket")) {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      // This endpoint never authenticates with cookies or URL tokens.
      // Authorization is mandatory, including for clients that send Origin.
      // Browser JS WebSocket cannot attach this header without a trusted proxy.
      // Do not use Origin as an authentication signal.
      const authorization = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
      if (!authorization) return new Response("Missing bearer credential", { status: 401 });
      const operator = getOperatorByToken(db, authorization[1]);
      if (!operator) return new Response("Invalid bearer credential", { status: 401 });
      if (live.has(operator.id)) return new Response("Agent connection already active", { status: 409 });
      const upgraded = (server as { upgrade(req: Request, opts: { data: AgentSocketData }): boolean })
        .upgrade(req, { data: { kind: "agent", operatorId: operator.id } });
      return upgraded ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    const matchId = matchSpectatorPath(path);
    if (matchId) return handleSpectatorWs(req, server, matchId, { db });
    return app.fetch(req);
  },
  websocket: {
    maxPayloadLength: 64 * 1024,
    open(ws: AgentSocket) {
      const data = ws.data;
      if (data?.kind === "agent") {
        if (!live.open(data.operatorId, ws)) ws.close(1008, "Duplicate operator");
        return;
      }
      spectatorWebSocket.open(ws);
    },
    message(ws: AgentSocket, data: string | Buffer) {
      const context = ws.data;
      if (context?.kind === "agent") live.message(context.operatorId, ws, data.toString());
    },
    close(ws: AgentSocket) {
      const context = ws.data;
      if (context?.kind === "agent") live.close(context.operatorId, ws);
    },
    error(error: Error, ws: AgentSocket) {
      console.error("[arena] websocket error:", error.message);
      ws.close(1011, "Internal error");
    },
  },
};

console.log(`[arena] listening on :${port}`);
