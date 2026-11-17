import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb, initDb } from "../../src/persistence/db.ts";
import { createOperator } from "../../src/identity/operator.ts";
import { registerAgentVersion } from "../../src/identity/agent-version.ts";
import {
  appendEvents,
  countEvents,
  getMatch,
  saveMatch,
  streamEvents,
  updateForfeit,
  updateMatchOutcome,
} from "../../src/persistence/match-store.ts";

describe("match outcome integrity", () => {
  let db: Database;

  beforeEach(() => {
    db = openDb(":memory:");
    initDb(db);
    const a = createOperator(db, "finalist_alpha");
    const b = createOperator(db, "finalist_bravo");
    const register = (operatorId: number, modelId: string) =>
      registerAgentVersion(db, {
        operatorId,
        code: "export default () => ({bid:0, extras:[]})",
        config: "{}",
        modelId,
        promptTemplate: "pass",
      }).agentVersion.id;
    const aAgent = register(a.operator.id, "test-alpha");
    const bAgent = register(b.operator.id, "test-bravo");
    saveMatch(db, {
      id: "outcome-integrity",
      operatorAId: a.operator.id,
      operatorBId: b.operator.id,
      agentAId: aAgent,
      agentBId: bAgent,
      originTag: "ladder:pending",
      outcome: null,
      createdAt: 42,
    });
    appendEvents(db, "outcome-integrity", [
      { seq: 0, eventType: "unit_moved", payload: '{"unit":"a"}', ts: 100 },
      { seq: 1, eventType: "turn_ended", payload: '{"turn":1}', ts: 101 },
    ]);
  });

  afterEach(() => db.close());

  test("decisive result updates the row without losing foreign-key-protected events", () => {
    const before = getMatch(db, "outcome-integrity");
    const eventLog = Array.from(streamEvents(db, "outcome-integrity"));
    const outcome = JSON.stringify({ winnerOperatorId: before!.operatorAId, reason: "decisive" });

    updateMatchOutcome(db, "outcome-integrity", outcome, before!.operatorAId, "ladder");

    expect(getMatch(db, "outcome-integrity")).toEqual({ ...before, originTag: "ladder", outcome });
    expect(Array.from(streamEvents(db, "outcome-integrity"))).toEqual(eventLog);
    expect(countEvents(db, "outcome-integrity")).toBe(2);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("forfeit and idempotent follow-up cannot destroy prior replay events", () => {
    const payload = JSON.stringify({ winnerOperatorId: null, reason: "forfeit" });
    updateForfeit(db, "outcome-integrity", payload, "ladder");
    updateForfeit(db, "outcome-integrity", payload, "ladder");

    expect(getMatch(db, "outcome-integrity")?.outcome).toBe(payload);
    expect(Array.from(streamEvents(db, "outcome-integrity")).map(e => e.seq)).toEqual([0, 1]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("unknown match outcome is refused without fabricating a new match", () => {
    expect(() => updateMatchOutcome(db, "missing", "A", 1)).toThrow("cannot finalize missing match");
    expect(() => updateForfeit(db, "missing", "B", "ladder")).toThrow("cannot finalize missing match");
    expect(getMatch(db, "missing")).toBeNull();
    expect(countEvents(db, "outcome-integrity")).toBe(2);
  });
});
