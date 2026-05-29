import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_DB_PATH = ".arena/state.db";

export function openDb(path: string = DEFAULT_DB_PATH): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  return db;
}

function hasColumn(db: Database, table: string, col: string): boolean {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === col);
}

export function initDb(db: Database): void {
  const sql = loadSchemaSql();
  db.transaction(() => {
    db.exec(sql);
    if (!hasColumn(db, "operators", "elo")) { try { db.exec("ALTER TABLE operators ADD COLUMN elo INTEGER NOT NULL DEFAULT 1500"); } catch {} }
    if (!hasColumn(db, "operators", "zo_user_id")) { try { db.exec("ALTER TABLE operators ADD COLUMN zo_user_id TEXT"); } catch {} }
    if (!hasColumn(db, "agent_versions", "name")) { try { db.exec("ALTER TABLE agent_versions ADD COLUMN name TEXT NOT NULL DEFAULT ''"); } catch {} }
    if (!hasColumn(db, "agent_versions", "queue_eligible")) { try { db.exec("ALTER TABLE agent_versions ADD COLUMN queue_eligible INTEGER NOT NULL DEFAULT 0"); } catch {} }
    if (!hasColumn(db, "agent_versions", "api_key")) { try { db.exec("ALTER TABLE agent_versions ADD COLUMN api_key TEXT NOT NULL DEFAULT ''"); } catch {} }
    if (!hasColumn(db, "agent_versions", "bracket")) { try { db.exec("ALTER TABLE agent_versions ADD COLUMN bracket TEXT NOT NULL DEFAULT 'apex'"); } catch {} }
    if (!hasColumn(db, "agent_versions", "similarity_flags_json")) { try { db.exec("ALTER TABLE agent_versions ADD COLUMN similarity_flags_json TEXT"); } catch {} }
    if (!hasColumn(db, "agent_versions", "verification")) { try { db.exec("ALTER TABLE agent_versions ADD COLUMN verification TEXT NOT NULL DEFAULT 'unverified'"); } catch {} }
    if (!hasColumn(db, "matches", "operator_a_id")) { try { db.exec("ALTER TABLE matches ADD COLUMN operator_a_id INTEGER NOT NULL DEFAULT 0"); } catch {} }
    if (!hasColumn(db, "matches", "operator_b_id")) { try { db.exec("ALTER TABLE matches ADD COLUMN operator_b_id INTEGER NOT NULL DEFAULT 0"); } catch {} }
    if (!hasColumn(db, "matches", "bracket")) { try { db.exec("ALTER TABLE matches ADD COLUMN bracket TEXT NOT NULL DEFAULT 'apex'"); } catch {} }
    try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_name_per_operator ON agent_versions(name, operator_id) WHERE name IS NOT NULL AND name != ''"); } catch {}
    try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_zo_user ON operators(zo_user_id) WHERE zo_user_id IS NOT NULL"); } catch {}
    try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_token_id ON operators(token_id) WHERE token_id IS NOT NULL"); } catch {}
  })();
}

function loadSchemaSql(): string {
  const schemaPath = join(import.meta.dir, "schema.sql");
  return readFileSync(schemaPath, "utf8");
}
