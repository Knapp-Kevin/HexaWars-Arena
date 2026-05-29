process.env.ARENA_DB = ":memory:";
import { describe, it, beforeEach, expect } from "bun:test";
import { queueAgent, findOpponent, launchMatch, resetMatchmakerState } from "../../src/orchestrator/matchmaker.ts";
import { createOperator } from "../../src/identity/operator.ts";
import { registerAgent } from "../../src/storage/agents.ts";
import { getDb, resetDb, initSchema } from "../../src/storage/db.ts";

describe("matchmaker (Phase 2)", () => {
  beforeEach(() => {
    resetDb();
    initSchema();
    const db = getDb();
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec("DELETE FROM challenges");
    db.exec("DELETE FROM match_events");
    db.exec("DELETE FROM matches");
    db.exec("DELETE FROM agent_versions");
    db.exec("DELETE FROM operators");
    db.exec("PRAGMA foreign_keys=ON");
    resetMatchmakerState();
  });

  it("1 enqueued → no opponent found", () => {
    const db = getDb();
    const { operator } = createOperator(db, "op-1-enqueue");
    const { agent } = registerAgent(operator.id, "AliceAgent", "gpt-4o", "apex", { systemPrompt: undefined, params: undefined });
    queueAgent(agent.id, "apex");
    const opponent = findOpponent(agent.id, "apex");
    expect(opponent).toBeNull();
  });

  it("2 enqueued in same bracket → opponent found", () => {
    const db = getDb();
    const { operator: op1 } = createOperator(db, "op-2-enqueue-1");
    const { operator: op2 } = createOperator(db, "op-2-enqueue-2");
    const { agent: ag1 } = registerAgent(op1.id, "BobAgent", "qwen2.5-14b", "apex", { systemPrompt: undefined, params: undefined });
    const { agent: ag2 } = registerAgent(op2.id, "CarolAgent", "llama-70b", "apex", { systemPrompt: undefined, params: undefined });
    queueAgent(ag1.id, "apex");
    queueAgent(ag2.id, "apex");
    const opponent = findOpponent(ag1.id, "apex");
    expect(opponent).not.toBeNull();
    expect(opponent!.id).toBe(ag2.id);
  });

  it("2 enqueued → match launched and agents dequeued", () => {
    const db = getDb();
    const { operator: op1 } = createOperator(db, "op-2-launch-1");
    const { operator: op2 } = createOperator(db, "op-2-launch-2");
    const { agent: ag1 } = registerAgent(op1.id, "LaunchA", "qwen2.5-14b", "apex", { systemPrompt: undefined, params: undefined });
    const { agent: ag2 } = registerAgent(op2.id, "LaunchB", "llama-70b", "apex", { systemPrompt: undefined, params: undefined });
    queueAgent(ag1.id, "apex");
    queueAgent(ag2.id, "apex");
    const match = launchMatch(ag1.id, ag2.id, "apex");
    expect(match.id).toBeDefined();
    expect(match.agent_a_id).toBe(ag1.id);
    expect(match.agent_b_id).toBe(ag2.id);
    expect(findOpponent(ag1.id, "apex")).toBeNull();
    expect(findOpponent(ag2.id, "apex")).toBeNull();
  });

  it("3 enqueued → first pair found, remaining agent has no opponent", () => {
    const db = getDb();
    const { operator: op1 } = createOperator(db, "op-3-enqueue-1");
    const { operator: op2 } = createOperator(db, "op-3-enqueue-2");
    const { operator: op3 } = createOperator(db, "op-3-enqueue-3");
    const { agent: ag1 } = registerAgent(op1.id, "DaveAgent", "qwen2.5-7b", "sentinel", { systemPrompt: undefined, params: undefined });
    const { agent: ag2 } = registerAgent(op2.id, "EveAgent", "gpt-4o-mini", "sentinel", { systemPrompt: undefined, params: undefined });
    const { agent: ag3 } = registerAgent(op3.id, "FayAgent", "llama-70b", "sentinel", { systemPrompt: undefined, params: undefined });
    queueAgent(ag1.id, "sentinel");
    queueAgent(ag2.id, "sentinel");
    queueAgent(ag3.id, "sentinel");
    const first = findOpponent(ag1.id, "sentinel");
    expect(first).not.toBeNull();
    launchMatch(ag1.id, first!.id, "sentinel");
    const second = findOpponent(ag3.id, "sentinel");
    expect(second).toBeNull();
  });
});
