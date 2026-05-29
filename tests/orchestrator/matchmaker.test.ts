process.env.ARENA_DB = ":memory:";
import { describe, it, expect, beforeEach } from "bun:test";
import { queueAgent, findOpponent, launchMatch, getQueueStatus, resetMatchmakerState } from "../../src/orchestrator/matchmaker.ts";
import { createOperator } from "../../src/identity/operator.ts";
import { registerAgent } from "../../src/storage/agents.ts";
import { getDb, resetDb, initSchema } from "../../src/storage/db.ts";

describe("Matchmaker (Phase 2)", () => {
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

  it("enqueues a single agent without creating a match", () => {
    const db = getDb();
    const { operator } = createOperator(db, "op-enqueue-single");
    const { agent } = registerAgent(operator.id, "SingleAgent", "qwen2.5-14b", "apex", { systemPrompt: undefined, params: undefined });

    queueAgent(agent.id, "apex");
    const opponent = findOpponent(agent.id, "apex");

    expect(opponent).toBeNull();
  });

  it("creates a match when two agents are enqueued in the same bracket", () => {
    const db = getDb();
    const { operator: op1 } = createOperator(db, "op-match-two-1");
    const { operator: op2 } = createOperator(db, "op-match-two-2");
    const { agent: ag1 } = registerAgent(op1.id, "AgentA", "gpt-4o-mini", "apex", { systemPrompt: undefined, params: undefined });
    const { agent: ag2 } = registerAgent(op2.id, "AgentB", "qwen2.5-14b", "apex", { systemPrompt: undefined, params: undefined });

    queueAgent(ag1.id, "apex");
    queueAgent(ag2.id, "apex");

    const match = launchMatch(ag1.id, ag2.id, "apex");

    expect(match).toBeDefined();
    expect(match.id).toMatch(/^match-/);
    expect(match.agent_a_id).toBe(ag1.id);
    expect(match.agent_b_id).toBe(ag2.id);
  });

  it("creates a unique match ID for each match", () => {
    const db = getDb();
    const { operator: op1 } = createOperator(db, "op-unique-id-1");
    const { operator: op2 } = createOperator(db, "op-unique-id-2");
    const { operator: op3 } = createOperator(db, "op-unique-id-3");
    const { operator: op4 } = createOperator(db, "op-unique-id-4");
    const { agent: ag1 } = registerAgent(op1.id, "UniqueA1", "qwen2.5-14b", "sentinel", { systemPrompt: undefined, params: undefined });
    const { agent: ag2 } = registerAgent(op2.id, "UniqueA2", "qwen2.5-7b", "sentinel", { systemPrompt: undefined, params: undefined });
    const { agent: ag3 } = registerAgent(op3.id, "UniqueA3", "gpt-4o-mini", "vanguard", { systemPrompt: undefined, params: undefined });
    const { agent: ag4 } = registerAgent(op4.id, "UniqueA4", "llama-70b", "vanguard", { systemPrompt: undefined, params: undefined });

    queueAgent(ag1.id, "sentinel");
    queueAgent(ag2.id, "sentinel");
    const match1 = launchMatch(ag1.id, ag2.id, "sentinel");

    queueAgent(ag3.id, "vanguard");
    queueAgent(ag4.id, "vanguard");
    const match2 = launchMatch(ag3.id, ag4.id, "vanguard");

    expect(match1.id).not.toBe(match2.id);
  });

  it("does not create more matches when fewer than 2 agents are pending", () => {
    const db = getDb();
    const { operator } = createOperator(db, "op-fewer-than-two");
    const { agent } = registerAgent(operator.id, "LoneAgent", "qwen2.5-14b", "apex", { systemPrompt: undefined, params: undefined });

    queueAgent(agent.id, "apex");
    const opponent = findOpponent(agent.id, "apex");

    expect(opponent).toBeNull();
  });

  it("getQueueStatus returns the match state for all brackets", () => {
    const status = getQueueStatus();

    expect(status).toBeDefined();
    expect(status.length).toBeGreaterThan(0);
    expect(status[0].bracket).toBeDefined();
    expect(typeof status[0].queued).toBe("number");
  });
});
