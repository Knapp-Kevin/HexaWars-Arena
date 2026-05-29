import type { Database } from "bun:sqlite";
import type { Hono } from "hono";
import {
  createOperator,
  HandleCollisionError,
  EmptyHandleError,
} from "../identity/operator";

export function mountRegisterRoutes(app: Hono, db: Database): void {
  app.post("/api/arena/register", async (c) => {
    let body: { handle?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const handle = typeof body.handle === "string" ? body.handle : "";
    if (!handle || handle.length < 3 || handle.length > 32) {
      return c.json({ error: "handle must be 3–32 characters" }, 400);
    }
    if (!/^[a-zA-Z0-9\-]+$/.test(handle)) {
      return c.json({ error: "handle must be alphanumeric + hyphens only" }, 400);
    }
    try {
      const result = createOperator(db, handle);
      return c.json({
        operator: { id: result.operator.id, handle: result.operator.handle },
        apiKey: result.token,
      }, 201);
    } catch (err: any) {
      if (err instanceof HandleCollisionError) {
        return c.json({ error: "handle already taken" }, 409);
      }
      if (err instanceof EmptyHandleError) {
        return c.json({ error: "handle empty after normalization" }, 400);
      }
      return c.json({ error: "Internal error" }, 500);
    }
  });
}
