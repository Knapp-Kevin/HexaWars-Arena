/**
 * Minimal external HexaWars 3.0-alpha client, intentionally noncompetitive.
 * Run: ARENA_OPERATOR_TOKEN=<secret> bun run examples/bun-pass-bot.ts
 * Register an operator and an agent version first (see docs/LIVE_AGENT_PROTOCOL_ALPHA.md).
 */
const token = Bun.env.ARENA_OPERATOR_TOKEN;
const url = Bun.env.ARENA_WS_URL ?? "ws://127.0.0.1:4200/api/arena/agents/ws";

if (!token || (!url.startsWith("ws://127.0.0.1:") && !url.startsWith("wss://"))) {
  throw new Error("Set ARENA_OPERATOR_TOKEN and a loopback ws:// or production wss:// endpoint");
}

const socket = new WebSocket(url, {
  headers: { Authorization: `Bearer ${token}` },
});

socket.addEventListener("open", () => {
  console.info("Connected. Enqueue this operator using the documented authenticated HTTP route.");
});

socket.addEventListener("message", (event) => {
  let frame: Record<string, unknown>;
  try { frame = JSON.parse(String(event.data)); }
  catch { console.error("Invalid server JSON frame"); socket.close(); return; }

  if (frame.type === "HELLO") {
    console.info("Paired", { matchId: frame.matchId, side: frame.side, version: frame.protocolVersion });
    return;
  }

  if (frame.type === "STATE") {
    const turn = frame.turn;
    const matchId = frame.matchId;
    if (!Number.isSafeInteger(turn) || typeof matchId !== "string") {
      socket.close(1002, "Invalid state");
      return;
    }
    socket.send(JSON.stringify({
      type: "PLAN", matchId, turn, plan: { bid: 0, extras: [] },
    }));
    return;
  }

  if (frame.type === "END") {
    console.info("Match completed", {
      matchId: frame.matchId, winnerOperatorId: frame.winnerOperatorId, reason: frame.reason,
    });
    return;
  }

  if (frame.type === "ERROR") {
    console.error("Arena rejected message", { code: frame.code, matchId: frame.matchId });
  }
});

socket.addEventListener("error", () => console.error("Connection failed; check server URL and credentials"));
socket.addEventListener("close", (event) => console.info("Disconnected", { code: event.code, reason: event.reason }));
