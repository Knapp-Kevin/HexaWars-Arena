import { getDb } from "../storage/db";
import { getAgentById } from "../storage/agents";
import { randomBytes } from "node:crypto";

export interface ChallengeRow {
  id: string;
  challenger_agent_id: number;
  target_agent_id: number;
  bracket: Bracket;
  status: "pending" | "accepted" | "declined" | "expired";
  created_at: number;
  expires_at: number;
}

const CHALLENGE_TTL_MS = 15 * 60 * 1000;

export function createChallenge(challengerAgentId: number, targetAgentId: number): ChallengeRow {
  const challenger = getAgentById(challengerAgentId);
  const target = getAgentById(targetAgentId);
  if (!challenger || !target) throw new Error("Agent not found");
  if (challenger.operator_id === target.operator_id) throw new Error("Cannot challenge own agent");
  if (challenger.bracket !== target.bracket) throw new Error("Cross-bracket challenges not allowed");

  const id = `ch_${randomBytes(12).toString("hex")}`;
  const now = Date.now();
  getDb().run(
    "INSERT INTO challenges (id, challenger_agent_id, target_agent_id, bracket, status, created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
    [id, challengerAgentId, targetAgentId, challenger.bracket, now, now + CHALLENGE_TTL_MS],
  );
  return {
    id,
    challenger_agent_id: challengerAgentId,
    target_agent_id: targetAgentId,
    bracket: challenger.bracket,
    status: "pending",
    created_at: now,
    expires_at: now + CHALLENGE_TTL_MS,
  };
}

export function respondToChallenge(challengeId: string, accept: boolean): ChallengeRow | null {
  const row = getDb().query("SELECT * FROM challenges WHERE id = ? AND status = 'pending'").get(challengeId) as ChallengeRow | null;
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    getDb().run("UPDATE challenges SET status = 'expired' WHERE id = ?", [challengeId]);
    return { ...row, status: "expired" };
  }
  const status = accept ? "accepted" : "declined";
  getDb().run("UPDATE challenges SET status = ? WHERE id = ?", [status, challengeId]);
  return { ...row, status };
}

export function getPendingChallengesForAgent(agentId: number): ChallengeRow[] {
  const now = Date.now();
  getDb().run("UPDATE challenges SET status = 'expired' WHERE target_agent_id = ? AND status = 'pending' AND expires_at < ?", [agentId, now]);
  return getDb().query("SELECT * FROM challenges WHERE target_agent_id = ? AND status = 'pending'").all(agentId) as ChallengeRow[];
}

export function getChallengesForOperator(operatorId: number): ChallengeRow[] {
  const agents = getDb().query("SELECT id FROM agent_versions WHERE operator_id = ?").all(operatorId) as { id: number }[];
  const ids = agents.map((a) => a.id);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .query(`SELECT c.* FROM challenges c WHERE (c.challenger_agent_id IN (${placeholders}) OR c.target_agent_id IN (${placeholders})) AND c.status = 'pending' ORDER BY c.created_at DESC`)
    .all(...ids, ...ids) as ChallengeRow[];
  return rows;
}
