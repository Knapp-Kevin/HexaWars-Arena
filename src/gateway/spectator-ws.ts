import type { Database } from "bun:sqlite";
import {
  buildSpectatorFrames,
  projectPublicMatch,
  projectLiveSpectatorMatch,
} from "../projection/public-match.ts";
import { adaptSpectatorSnapshot } from "../projection/live-match.ts";
import { getActiveRuntime } from "../orchestrator/match-runner.ts";
import { getMatch, streamEvents } from "../persistence/match-store";

type UpgradeServer = {
  upgrade(req: Request, opts: { data: SpectatorSocketData }): boolean;
};

export interface SpectatorSocketData {
  kind: "spectator";
  matchId: string;
  frames: string[];
}

export interface SpectatorDeps {
  db: Database;
}

const SPECTATOR_PATH = /^\/api\/arena\/matches\/([^/]+)\/ws$/;

export function matchSpectatorPath(pathname: string): string | null {
  const match = SPECTATOR_PATH.exec(pathname);
  if (!match) return null;
  return decodeURIComponent(match[1]);
}

function getOperatorHandles(db: Database, matchId: string): { operatorA: string; operatorB: string } {
  const row = db
    .prepare(
      `SELECT oa.handle AS operatorA, ob.handle AS operatorB
       FROM matches m
       JOIN operators oa ON m.operator_a_id = oa.id
       JOIN operators ob ON m.operator_b_id = ob.id
       WHERE m.id = ?`,
    )
    .get(matchId) as { operatorA: string; operatorB: string } | undefined;
  return row ?? { operatorA: "Blue Horizon", operatorB: "Red Morrow" };
}

export function buildSpectatorFrameSequence(
  deps: SpectatorDeps,
  matchId: string,
): string[] | null {
  // Authoritative, persisted PvP matches take precedence over the legacy
  // spectator-only MatchRuntime. Intermediate event payloads include raw
  // unit movement/attacks and can reveal positions hidden by seat fog.
  // No delayed/redacted spectator projection exists yet: fail closed until
  // the match outcome is durably final. Never infer a finished game merely
  // from the presence of a match record.
  const match = getMatch(deps.db, matchId);
  if (match) {
    if (match.outcome === null) return null;
    const events = Array.from(streamEvents(deps.db, matchId));
    const handles = getOperatorHandles(deps.db, matchId);
    const projection = projectLiveSpectatorMatch({
      match, operatorA: handles.operatorA, operatorB: handles.operatorB, events,
    });
    return buildSpectatorFrames(projection).map((frame) => JSON.stringify(frame));
  }

  // Historical in-memory seeded-demo fixtures are not authoritative live
  // operator matches. Preserve their existing spectator projection until
  // the legacy simulator can be retired from the replay/test surface.
  const runtime = getActiveRuntime(matchId);
  if (!runtime) return null;
  const snapshot = runtime.getSpectatorSnapshot();
  const input = adaptSpectatorSnapshot(snapshot);
  const projection = projectPublicMatch(input);
  return buildSpectatorFrames(projection).map((frame) => JSON.stringify(frame));
}

export function handleSpectatorWs(
  req: Request,
  server: unknown,
  matchId: string,
  deps: SpectatorDeps,
): Response | undefined {
  if (!req.headers.get("upgrade")?.toLowerCase().includes("websocket")) {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  // Do not even attempt an upgrade (or materialize append-only events)
  // while a real 5v5 match is unfinalized. Distinguish this from a missing
  // match without revealing any sealed plan, hidden position or seed.
  const authoritative=getMatch(deps.db,matchId);
  if(authoritative && authoritative.outcome===null){
    return new Response(JSON.stringify({error:"match_in_progress"}),{
      status:409,
      headers:{"content-type":"application/json"},
    });
  }

  const frames = buildSpectatorFrameSequence(deps, matchId);
  if (!frames) {
    return new Response("Not Found", { status: 404 });
  }

  const upgraded = (server as UpgradeServer).upgrade(req, {
    data: { kind: "spectator", matchId, frames },
  });

  if (!upgraded) {
    return new Response("Upgrade failed", { status: 500 });
  }

  // Bun owns the WebSocket 101 response after a successful upgrade.
  return undefined;
}

export const spectatorWebSocket = {
  open(ws: WebSocket) {
    const data = (ws as WebSocket & { data?: SpectatorSocketData }).data;
    for (const frame of data?.frames ?? []) {
      ws.send(frame);
    }
    ws.close();
  },
};
