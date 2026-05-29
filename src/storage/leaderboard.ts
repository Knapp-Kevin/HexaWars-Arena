import { getDb } from "../storage/db";

export interface LeaderboardEntry {
  rank: number;
  agentId: number;
  agentName: string;
  operatorHandle: string;
  bracket: string;
  wins: number;
  losses: number;
  draws: number;
  score: number;
}

export function getLeaderboard(bracket: string, limit = 50): LeaderboardEntry[] {
  const rows = getDb().query(`
    SELECT
      av.id as agentId, av.name as agentName, o.handle as operatorHandle, av.bracket,
      COALESCE(SUM(CASE WHEN (m.outcome = 'A_win' AND m.agent_a_id = av.id) OR (m.outcome = 'B_win' AND m.agent_b_id = av.id) THEN 1 ELSE 0 END), 0) as wins,
      COALESCE(SUM(CASE WHEN (m.outcome = 'A_win' AND m.agent_b_id = av.id) OR (m.outcome = 'B_win' AND m.agent_a_id = av.id) THEN 1 ELSE 0 END), 0) as losses,
      COALESCE(SUM(CASE WHEN m.outcome = 'draw' THEN 1 ELSE 0 END), 0) as draws
    FROM agent_versions av
    JOIN operators o ON o.id = av.operator_id
    LEFT JOIN matches m ON (m.agent_a_id = av.id OR m.agent_b_id = av.id) AND m.outcome IS NOT NULL
    WHERE av.bracket = ? AND o.handle != 'hexawars-bot'
    GROUP BY av.id
    ORDER BY (COALESCE(SUM(CASE WHEN (m.outcome = 'A_win' AND m.agent_a_id = av.id) OR (m.outcome = 'B_win' AND m.agent_b_id = av.id) THEN 1 ELSE 0 END), 0) * 3 + COALESCE(SUM(CASE WHEN m.outcome = 'draw' THEN 1 ELSE 0 END), 0)) DESC, av.id ASC
    LIMIT ?
  `).all(bracket, limit) as any[];

  return rows.map((row: any, idx: number) => ({
    rank: idx + 1,
    agentId: row.agentId,
    agentName: row.agentName,
    operatorHandle: row.operatorHandle,
    bracket: row.bracket,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    score: row.wins * 3 + row.draws,
  }));
}

export interface ReplayCard {
  matchId: string;
  bracket: string;
  agentA: string;
  agentB: string;
  winner: string | null;
  reason: string | null;
  createdAt: number;
}

export function getRecentReplays(bracket?: string, limit = 20): ReplayCard[] {
  const query = bracket
    ? `SELECT m.id as matchId, m.bracket, a.name as agentA, b.name as agentB, m.outcome as winner, m.outcome as reason, m.created_at as createdAt FROM matches m JOIN agent_versions a ON a.id = m.agent_a_id JOIN agent_versions b ON b.id = m.agent_b_id WHERE m.bracket = ? AND m.outcome IS NOT NULL ORDER BY m.completed_at DESC LIMIT ?`
    : `SELECT m.id as matchId, m.bracket, a.name as agentA, b.name as agentB, m.outcome as winner, m.outcome as reason, m.created_at as createdAt FROM matches m JOIN agent_versions a ON a.id = m.agent_a_id JOIN agent_versions b ON b.id = m.agent_b_id WHERE m.outcome IS NOT NULL ORDER BY m.completed_at DESC LIMIT ?`;
  const params = bracket ? [bracket, limit] : [limit];
  return getDb().query(query).all(...params) as ReplayCard[];
}

export function getOperatorDashboard(operatorId: number) {
  const agents = getDb().query("SELECT * FROM agent_versions WHERE operator_id = ? ORDER BY created_at DESC").all(operatorId);
  const top5 = getLeaderboard("sentinel", 5);
  return { agents, top5 };
}
