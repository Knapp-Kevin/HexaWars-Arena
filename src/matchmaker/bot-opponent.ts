import type { Database } from "bun:sqlite";

const BOT_HANDLE = "hexawars-bot";
const BOT_TOKEN_ID = "bot-seed-001";
const BOT_AGENT_NAME = "Heuristic Alpha";
const BOT_MODEL_ID = "builtin-heuristic-v1";
const BOT_BRACKET = "sentinel";
const SEED_TS = 1_713_400_000;

export interface BotOpponent {
  operatorId: number;
  agentId: number;
}

export function ensureBotOpponent(db: Database): BotOpponent {
  let opRow = db
    .prepare("SELECT id FROM operators WHERE handle = ?")
    .get(BOT_HANDLE) as { id: number } | undefined;

  if (!opRow) {
    const salt = Buffer.alloc(16, 0);
    const hash = Buffer.alloc(32, 0);
    opRow = db
      .prepare(
        `INSERT INTO operators
           (handle, handle_normalized, token_id, token_salt, token_hash, created_at, elo)
         VALUES (?, ?, ?, ?, ?, ?, 1500)
         RETURNING id`,
      )
      .get(BOT_HANDLE, BOT_HANDLE, BOT_TOKEN_ID, salt, hash, SEED_TS) as { id: number };
  }

  let agentRow = db
    .prepare(
      "SELECT id FROM agent_versions WHERE operator_id = ? AND name = ?",
    )
    .get(opRow.id, BOT_AGENT_NAME) as { id: number } | undefined;

  if (!agentRow) {
    agentRow = db
      .prepare(
        `INSERT INTO agent_versions
           (operator_id, name, fingerprint, model_id, bracket, verification, queue_eligible, similarity_flags_json, created_at)
         VALUES (?, ?, 'fp-bot-heuristic', ?, ?, 'active', 1, NULL, ?)
         RETURNING id`,
      )
      .get(opRow.id, BOT_AGENT_NAME, BOT_MODEL_ID, BOT_BRACKET, SEED_TS) as { id: number };
  }

  return { operatorId: opRow.id, agentId: agentRow.id };
}
