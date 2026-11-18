import { afterEach, describe, expect, test } from "bun:test";
import { openDb, initDb } from "../../src/persistence/db.ts";
import { createOperator } from "../../src/identity/operator.ts";
import { registerAgentVersion } from "../../src/identity/agent-version.ts";
import { MatchRunner } from "../../src/runner/runner.ts";
import { LiveAgentChannel,LIVE_PROTOCOL_VERSION } from "../../src/gateway/live-channel.ts";
import { ACTIVE_FRONTIER_RULES_VERSION } from "../../src/engine/frontier-match.ts";
import { countEvents, getMatch, streamEvents } from "../../src/persistence/match-store.ts";
import type { Database } from "bun:sqlite";

describe("live agent channel -> authoritative runner -> SQLite replay", () => {
  const databases: Database[] = [];
  afterEach(() => { for (const db of databases.splice(0)) db.close(); });

  test("two bound channels submit real PLAN frames and produce FK-valid result and seed-reveal trail", async () => {
    const db = openDb(":memory:");
    databases.push(db);
    initDb(db);
    const opA = createOperator(db, "integration_alpha").operator;
    const opB = createOperator(db, "integration_bravo").operator;
    function agent(operatorId: number, modelId: string): number {
      return registerAgentVersion(db, {
        operatorId, modelId, code: "sample", config: "{}", promptTemplate: "pass",
      }).agentVersion.id;
    }
    const av = agent(opA.id, "bot-A");
    const bv = agent(opB.id, "bot-B");
    const matchId = "live-integration-1";
    const seed = "only-revealed-after-completion";
    const receivedA: Record<string, unknown>[] = [];
    const receivedB: Record<string, unknown>[] = [];

    function makeChannel(frames: Record<string, unknown>[]): LiveAgentChannel {
      let channel: LiveAgentChannel;
      const sock = {
        send(raw: string) {
          const data = JSON.parse(raw) as Record<string, unknown>;
          frames.push(data);
          if (data.type === "STATE") {
            channel.acceptMessage(JSON.stringify({
              type: "PLAN", matchId, turn: data.turn,
              protocolVersion:LIVE_PROTOCOL_VERSION,
              rulesVersion:ACTIVE_FRONTIER_RULES_VERSION,
              plan: { bid: 0, extras: [] },
            }));
          }
        },
      };
      channel = new LiveAgentChannel(matchId, sock);
      return channel;
    }

    const a = makeChannel(receivedA);
    const b = makeChannel(receivedB);
    const runner = new MatchRunner(db);
    const result = await runner.start({
      matchId, seed,
      a: { id: opA.id, agentVersionId: av },
      b: { id: opB.id, agentVersionId: bv },
    }, { a, b }, 250);

    expect(["decisive", "timeout"]).toContain(result.reason);
    const match = getMatch(db, matchId);
    expect(match?.outcome).not.toBeNull();
    expect(match?.agentAId).toBe(av);
    expect(match?.agentBId).toBe(bv);
    expect(countEvents(db, matchId)).toBeGreaterThan(0);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(receivedA.length).toBeGreaterThan(0);
    expect(receivedB.length).toBeGreaterThan(0);
    expect(receivedA[0].type).toBe("STATE");
    expect(receivedA[0].rulesVersion).toBe(ACTIVE_FRONTIER_RULES_VERSION);
    expect(receivedA[0].protocolVersion).toBe(LIVE_PROTOCOL_VERSION);
    expect(receivedA[0].maxMoveSlots).toBe(2);
    expect(receivedB[0].maxMoveSlots).toBe(2);
    for(const [side,frames] of [["A",receivedA],["B",receivedB]] as const){
      const first=frames.find(x=>x.type==="STATE")!;
      const units=first.units as Array<{owner:"A"|"B";type:string}>;
      expect(units.length).toBe(5);
      expect(units.every(u=>u.owner===side)).toBe(true);
      expect(units.map(u=>u.type).sort()).toEqual(
        ["captain","interceptor","raider","scout","siege"]);
      expect((first.visible as unknown[]).length).toBeLessThan(127);
    }

    expect(receivedA[0].matchId).toBe(matchId);
    expect(JSON.stringify(receivedA)).not.toContain(seed);
    expect(JSON.stringify(receivedB)).not.toContain(seed);
    const events = Array.from(streamEvents(db, matchId));
    const last = events[events.length - 1];
    expect(last.eventType).toBe("match_seed_revealed");
    expect(JSON.parse(last.payload)).toEqual({ seed });
    expect(events.slice(0, -1).every(e => e.eventType !== "match_seed_revealed")).toBe(true);
  });
});
