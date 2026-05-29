import type { Database } from "bun:sqlite";
import type { Hono } from "hono";
import { getOperatorByToken } from "../identity/operator";
import {
  createChallenge,
  respondToChallenge,
  getPendingChallengesForAgent,
  getChallengesForOperator,
} from "../orchestrator/challenge";

function requireAuth(db: Database, c: { header(name: string): string | undefined }): { operatorId: number; operatorToken: string } | null {
  const auth = c.header("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const operator = getOperatorByToken(db, m[1]);
  if (!operator) return null;
  return { operatorId: operator.id, operatorToken: m[1] };
}

export function mountChallengeRoutes(app: Hono, db: Database): void {
  // POST /api/arena/challenge — create a challenge
  app.post("/api/arena/challenge", async (c) => {
    const authCtx = requireAuth(db, c.req);
    if (!authCtx) return c.json({ error: "unauthorized" }, 401);

    let body: { challengerAgentId?: unknown; targetAgentId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const challengerAgentId = typeof body?.challengerAgentId === "number" ? body.challengerAgentId : 0;
    const targetAgentId = typeof body?.targetAgentId === "number" ? body.targetAgentId : 0;

    if (!challengerAgentId || !targetAgentId) {
      return c.json({ error: "challengerAgentId and targetAgentId are required" }, 400);
    }
    if (challengerAgentId === targetAgentId) {
      return c.json({ error: "cannot challenge yourself" }, 400);
    }

    try {
      const challenge = createChallenge(challengerAgentId, targetAgentId);
      return c.json({ challenge }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  // GET /api/arena/challenges/:agentId — get pending challenges for an agent
  app.get("/api/arena/challenges/:agentId", (c) => {
    const authCtx = requireAuth(db, c.req);
    if (!authCtx) return c.json({ error: "unauthorized" }, 401);

    const agentId = Number(c.req.param("agentId"));
    if (!agentId) return c.json({ error: "invalid agentId" }, 400);

    const pending = getPendingChallengesForAgent(agentId);
    return c.json({ challenges: pending });
  });

  // GET /api/arena/operator/:operatorId/challenges — get challenges for an operator
  app.get("/api/arena/operator/:operatorId/challenges", (c) => {
    const authCtx = requireAuth(db, c.req);
    if (!authCtx) return c.json({ error: "unauthorized" }, 401);

    const operatorId = Number(c.req.param("operatorId"));
    if (!operatorId) return c.json({ error: "invalid operatorId" }, 400);

    // Operators can only view their own challenges
    if (authCtx.operatorId !== operatorId) {
      return c.json({ error: "forbidden" }, 403);
    }

    const challenges = getChallengesForOperator(operatorId);
    return c.json({ challenges });
  });

  // POST /api/arena/challenge/:challengeId/respond — accept or decline a challenge
  app.post("/api/arena/challenge/:challengeId/respond", async (c) => {
    const authCtx = requireAuth(db, c.req);
    if (!authCtx) return c.json({ error: "unauthorized" }, 401);

    const { challengeId } = c.req.param();
    if (!challengeId) return c.json({ error: "challengeId is required" }, 400);

    let body: { accept?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const accept = body?.accept === true;

    const result = respondToChallenge(challengeId, accept);
    if (!result) return c.json({ error: "challenge not found or already resolved" }, 404);

    return c.json({ challenge: result });
  });
}
