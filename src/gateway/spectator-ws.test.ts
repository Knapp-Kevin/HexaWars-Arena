import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { buildSpectatorFrameSequence, SpectatorDeps } from "./spectator-ws.ts";
import { MatchRuntime, getActiveRuntime } from "../orchestrator/match-runner.ts";
import { openDb, initDb } from "../persistence/db.ts";
import {
  saveMatch,appendEvents,updateMatchOutcome,
} from "../persistence/match-store.ts";
import {handleSpectatorWs} from "./spectator-ws.ts";
import type { Database } from "bun:sqlite";
import type { MatchRecord } from "../shared/types";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
  initDb(db);
  // Seed required FK rows for DB-path tests
  db.prepare(`INSERT INTO operators (id, handle, handle_normalized, token_id, token_salt, token_hash, created_at, elo)
              VALUES (1, 'opA', 'opa', 'tok1', 'salt1', 'hash1', ${Date.now()}, 1500)`).run();
  db.prepare(`INSERT INTO operators (id, handle, handle_normalized, token_id, token_salt, token_hash, created_at, elo)
              VALUES (2, 'opB', 'opb', 'tok2', 'salt2', 'hash2', ${Date.now()}, 1500)`).run();
  db.prepare(`INSERT INTO agent_versions (id, operator_id, fingerprint, model_id, created_at)
              VALUES (1, 1, 'fing1', 'model-a', ${Date.now()})`).run();
  db.prepare(`INSERT INTO agent_versions (id, operator_id, fingerprint, model_id, created_at)
              VALUES (2, 2, 'fing2', 'model-b', ${Date.now()})`).run();
});

afterEach(() => {
  for (const id of ["active-match-1", "active-match-2", "status-active-match", "completed-match-1", "auth-live-fog-guard"]) {
    getActiveRuntime(id)?.finish();
  }
  db.close();
});

describe("buildSpectatorFrameSequence", () => {
  test("uses runtime path when active runtime exists", () => {
    new MatchRuntime("active-match-1", "seed-active-1", "playerA", "playerB");
    const deps: SpectatorDeps = { db };

    const frames = buildSpectatorFrameSequence(deps, "active-match-1");

    expect(frames).not.toBeNull();
    expect(frames!.length).toBeGreaterThan(0);

    const firstFrame = JSON.parse(frames![0]);
    expect(firstFrame.type).toBe("MATCH_HELLO");
    expect(firstFrame.mode).toBe("live");
  });

  test("returns null for nonexistent matchId with no runtime", () => {
    const deps: SpectatorDeps = { db };
    const frames = buildSpectatorFrameSequence(deps, "does-not-exist");
    expect(frames).toBeNull();
  });

  test("runtime frames contain non-empty board and units", () => {
    new MatchRuntime("active-match-2", "seed-active-2", "playerC", "playerD");
    const deps: SpectatorDeps = { db };

    const frames = buildSpectatorFrameSequence(deps, "active-match-2");

    expect(frames).not.toBeNull();
    const stateFrameRaw = frames!.find((f) => JSON.parse(f).type === "MATCH_STATE");
    expect(stateFrameRaw).toBeDefined();
    const stateFrame = JSON.parse(stateFrameRaw);
    expect(stateFrame.projection.board.cells.length).toBeGreaterThan(0);
    expect(stateFrame.projection.board.units.length).toBeGreaterThan(0);
  });

  test("MATCH_HELLO and MATCH_STATE frames present in runtime path", () => {
    new MatchRuntime("active-match-3", "seed-active-3", "playerE", "playerF");
    const deps: SpectatorDeps = { db };

    const frames = buildSpectatorFrameSequence(deps, "active-match-3");

    expect(frames).not.toBeNull();
    const types = frames!.map((f) => JSON.parse(f).type);
    expect(types).toContain("MATCH_HELLO");
    expect(types).toContain("MATCH_STATE");
  });

  test("unfinished authoritative PvP is private even when legacy runtime and raw events exist",async()=>{
    const id="auth-live-fog-guard";
    const rec:MatchRecord={
      id,operatorAId:1,operatorBId:2,agentAId:1,agentBId:2,
      originTag:"ladder",outcome:null,createdAt:Date.now(),
    };
    saveMatch(db,rec);
    // An append-only match event may contain a location concealed from
    // the opposing seat. The public spectator endpoint must not publish
    // such entries before the authoritative outcome is finalized.
    const secret="HIDDEN-UNIT-POSITION:5,-3,-2";
    appendEvents(db,id,[{
      seq:0,eventType:"unit_moved",
      payload:JSON.stringify({unitId:"private-scout",agent:"A",
        hidden:secret,from:{q:5,r:-3,s:-2}}),
      ts:Date.now(),
    }]);
    new MatchRuntime(id,"archived-rules-do-not-override-real-match",
      "playerA","playerB");
    expect(buildSpectatorFrameSequence({db},id)).toBeNull();
    let upgrades=0;
    const server={upgrade:()=>{upgrades++;return true;}};
    const req=new Request(`http://arena.test/api/arena/matches/${id}/ws`,{
      headers:{Upgrade:"websocket"},
    });
    const blocked=await handleSpectatorWs(req,server,id,{db});
    expect(blocked?.status).toBe(409);
    expect(await blocked!.json()).toEqual({error:"match_in_progress"});
    expect(upgrades).toBe(0);
    expect((await handleSpectatorWs(req,server,"unknown-pvp",{db}))?.status)
      .toBe(404);
    expect(upgrades).toBe(0);
    // Outcome is a durable state change: only now is archived/replay
    // projection authorized, and it must take precedence over a legacy
    // in-memory runtime whose board and rules were entirely different.
    updateMatchOutcome(db,id,"A_win",1,"ladder");
    const frames=buildSpectatorFrameSequence({db},id);
    expect(frames).not.toBeNull();
    const decoded=frames!.map(f=>JSON.parse(f));
    expect(decoded[0].type).toBe("MATCH_HELLO");
    expect(decoded.at(-1)?.type).toBe("MATCH_END");
    expect(JSON.stringify(decoded)).toContain(secret);
    expect(decoded[0].projection.board.cells).toEqual([]);
    const accepted=await handleSpectatorWs(req,server,id,{db});
    expect(accepted).toBeUndefined();
    expect(upgrades).toBe(1);
  });

  test("falls back to DB path for completed match with no active runtime", () => {
    const rec: MatchRecord = {
      id: "completed-match-1",
      operatorAId: 1,
      operatorBId: 2,
      agentAId: 1,
      agentBId: 2,
      originTag: "demo",
      outcome: "A_win",
      createdAt: Date.now(),
    };
    saveMatch(db, rec);
    const deps: SpectatorDeps = { db };

    const frames = buildSpectatorFrameSequence(deps, "completed-match-1");

    expect(frames).not.toBeNull();
    expect(frames!.length).toBeGreaterThan(0);
    const types = frames!.map((f) => JSON.parse(f).type);
    expect(types).toContain("MATCH_HELLO");
    expect(types).toContain("MATCH_STATE");
  });
});