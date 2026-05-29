import type { Database } from "bun:sqlite";
import type { Hono } from "hono";
import { getOperatorByToken } from "../identity/operator";
import { registerAgent, getAgentsByOperator, getAgentById, setQueueEligible } from "../storage/agents";
import { ensureBotOpponent } from "../matchmaker/bot-opponent";
import { createMatch } from "../storage/matches";

function requireAuth(db: Database, c: { header(name: string): string | undefined }): { operatorId: number } | null {
  const auth = c.header("authorization") ?? "";
  const arenaKey = c.header("x-arena-key") ?? "";
  const token = arenaKey || auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const operator = getOperatorByToken(db, token);
  if (!operator) return null;
  return { operatorId: operator.id };
}

export function mountAgentRoutes(app: Hono, db: Database): void {
  app.post("/api/arena/agents", async (c) => {
    const authCtx = requireAuth(db, c.req);
    if (!authCtx) return c.json({ error: "unauthorized" }, 401);

    let body: { name?: unknown; modelId?: unknown; bracket?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const name = typeof body.name === "string" ? body.name : "";
    const modelId = typeof body.modelId === "string" ? body.modelId : "";
    const bracket = typeof body.bracket === "string" ? body.bracket : "apex";

    if (!name || name.length < 2 || name.length > 48) {
      return c.json({ error: "name must be 2–48 characters" }, 400);
    }
    if (!modelId) {
      return c.json({ error: "modelId is required" }, 400);
    }
    try {
      const result = registerAgent(authCtx.operatorId, name, modelId, bracket, { systemPrompt: undefined, params: undefined }, db);
      return c.json({ agent: result.agent }, 201);
    } catch (err: any) {
      if (/UNIQUE constraint failed.*agent_versions/.test(err?.message ?? "")) {
        return c.json({ error: "An agent with this name already exists. Choose a different name." }, 409);
      }
      throw err;
    }
  });

  app.get("/api/arena/agents", (c) => {
    const authCtx = requireAuth(db, c.req);
    if (!authCtx) return c.json({ error: "unauthorized" }, 401);
    const agents = getAgentsByOperator(authCtx.operatorId, db);
    return c.json({ agents });
  });

  app.post("/api/arena/agents/:id/activate", (c) => {
    const authCtx = requireAuth(db, c.req);
    if (!authCtx) return c.json({ error: "unauthorized" }, 401);
    const agentId = Number(c.req.param("id"));
    const agent = getAgentById(agentId, db);
    if (!agent || agent.operator_id !== authCtx.operatorId) return c.json({ error: "not found" }, 404);
    const agents = getAgentsByOperator(authCtx.operatorId, db);
    const activeCount = agents.filter((a) => a.queue_eligible === 1).length;
    if (activeCount >= 2) return c.json({ error: "max 2 queue-eligible agents" }, 400);
    setQueueEligible(agentId, true, db);
    return c.json({ ok: true, agentId });
  });

  app.post("/api/arena/agents/:id/deactivate", (c) => {
    const authCtx = requireAuth(db, c.req);
    if (!authCtx) return c.json({ error: "unauthorized" }, 401);
    const agentId = Number(c.req.param("id"));
    const agent = getAgentById(agentId, db);
    if (!agent || agent.operator_id !== authCtx.operatorId) return c.json({ error: "not found" }, 404);
    setQueueEligible(agentId, false, db);
    return c.json({ ok: true, agentId });
  });

  app.post("/api/arena/agents/:id/find_match", (c) => {
    const authCtx = requireAuth(db, c.req);
    if (!authCtx) return c.json({ error: "unauthorized" }, 401);
    const agentId = Number(c.req.param("id"));
    const agent = getAgentById(agentId, db);
    if (!agent || agent.operator_id !== authCtx.operatorId) return c.json({ error: "not found" }, 404);

    const bot = ensureBotOpponent(db);
    const match = createMatch(agentId, bot.agentId, agent.bracket || "apex");
    return c.json({ success: true, matchId: match.id, opponent: bot.agentId });
  });
}
