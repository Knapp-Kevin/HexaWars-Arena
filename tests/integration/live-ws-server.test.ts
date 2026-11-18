import { test, expect } from "bun:test";
import { createServer, connect } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Bot = { socket: WebSocket; ready: Promise<void>; end: Promise<Record<string, unknown>>; frames: Record<string, unknown>[] };

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  return port;
}

async function health(base: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch { /* server starting */ }
    await Bun.sleep(100);
  }
  throw new Error("Bun arena server did not become healthy");
}

async function rawUpgradeStatus(port: number, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let chunk = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("raw upgrade timeout")); }, 3000);
    socket.on("error", err => { clearTimeout(timer); reject(err); });
    socket.on("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write(
        "GET /api/arena/agents/ws HTTP/1.1\r\n" +
        `Host: 127.0.0.1:${port}\r\n` +
        "Connection: Upgrade\r\nUpgrade: websocket\r\n" +
        `Sec-WebSocket-Key: ${key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n" +
        `Authorization: Bearer ${token}\r\n` +
        "Origin: http://localhost\r\n\r\n",
      );
    });
    socket.on("data", buf => {
      chunk += buf.toString();
      if (!chunk.includes("\r\n")) return;
      clearTimeout(timer);
      socket.destroy();
      resolve(chunk.split("\r\n")[0]);
    });
  });
}

function openBot(url: string, token: string): Bot {
  // Bun's header-bearing WebSocket constructor is a runtime extension absent
  // from the standard DOM constructor type. Real acceptance verifies it.
  const BunHeaderWebSocket = WebSocket as unknown as new (
    url: string, options: { headers: Record<string, string> },
  ) => WebSocket;
  const socket = new BunHeaderWebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
  const frames: Record<string, unknown>[] = [];
  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", (event) => reject(new Error(`agent WS upgrade failed: ${String((event as ErrorEvent).message ?? "unknown")}`)), { once: true });
  });
  const end = new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
      frames.push(frame);
      if (frame.type === "STATE") {
        socket.send(JSON.stringify({
          type: "PLAN", matchId: frame.matchId, turn: frame.turn,
          protocolVersion:frame.protocolVersion,
          rulesVersion:frame.rulesVersion,
          plan: { bid: 0, extras: [] },
        }));
      }
      if (frame.type === "END") resolve(frame);
      if (frame.type === "ERROR" && frame.code === "match_runtime_failed") reject(new Error("match runtime failed"));
    });
    socket.addEventListener("close", (event) => reject(new Error(`WS closed before match completed; code=${event.code}, reason=${event.reason}, received=${frames.map(f => String(f.type)).join(",")}`)), { once: true });
  });
  // The runner can reject on close before a caller attaches the match completion await.
  void end.catch(() => {});
  return { socket, ready, end, frames };
}

test("two real authenticated WebSockets finish a match and fetch persisted replay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hexawars-live-"));
  const port = await availablePort();
  const dbPath = join(dir, "arena.db");
  const server = Bun.spawn(["bun", "run", "src/server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), ARENA_DB_PATH: dbPath, ARENA_DB: dbPath, ARENA_SEED_DEMO: "0" },
    stdout: "pipe", stderr: "pipe",
  });
  const bots: Bot[] = [];
  const base = `http://127.0.0.1:${port}`;
  try {
    await health(base);

    async function register(handle: string) {
      const res = await fetch(`${base}/api/arena/operators`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { token: string; operator: { id: number } };
      const agentRes = await fetch(`${base}/api/arena/agent-versions`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${body.token}` },
        body: JSON.stringify({ code: "export const plan = () => ({bid:0,extras:[]})", config: "{}", modelId: `smoke-${handle}`, promptTemplate: "pass" }),
      });
      expect(agentRes.status).toBe(200);
      return body.token;
    }
    const tokenA = await register("live_alpha");
    const tokenB = await register("live_bravo");
    const handshakeStatus = await rawUpgradeStatus(port, tokenA);
    expect(handshakeStatus).toContain("101");
    await Bun.sleep(100);
    const wsUrl = `ws://127.0.0.1:${port}/api/arena/agents/ws`;
    bots.push(openBot(wsUrl, tokenA), openBot(wsUrl, tokenB));
    await Promise.all(bots.map(b => b.ready));

    async function enqueue(token: string) {
      const res = await fetch(`${base}/api/arena/matchmaker/enqueue`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    }
    await enqueue(tokenA);
    await enqueue(tokenB);
    const [endA, endB] = await Promise.race([
      Promise.all(bots.map(bot => bot.end)),
      Bun.sleep(15000).then(() => { throw new Error("match did not complete within 15s"); }),
    ]);

    expect(endA.type).toBe("END");
    expect(endA.matchId).toBe(endB.matchId);
    for (const bot of bots) {
      expect(bot.frames.some(f => f.type === "HELLO")).toBe(true);
      expect(bot.frames.some(f => f.type === "STATE")).toBe(true);
      const hello=bot.frames.find(f=>f.type==="HELLO")!;
      expect(hello.protocolVersion).toBe("4.0");
      expect(hello.rulesVersion).toBe("hexawars-frontier127-five-roles-v1");
      expect(hello.boardCells).toBe(127);
      expect(hello.freeMoves).toBe(2);
      const state=bot.frames.find(f=>f.type==="STATE")!;
      expect(state.protocolVersion).toBe(hello.protocolVersion);
      expect(state.rulesVersion).toBe(hello.rulesVersion);
      const units=state.units as Array<{owner:string;type:string}>;
      expect(units.length).toBe(5);
      expect(units.every(u=>u.owner===hello.side)).toBe(true);
      expect(units.map(u=>u.type).sort()).toEqual(
        ["captain","interceptor","raider","scout","siege"]);
      expect((state.visible as unknown[]).length).toBeLessThan(127);
      expect(JSON.stringify(bot.frames.filter(f => f.type !== "END"))).not.toContain("match_seed_revealed");
    }
    const id = String(endA.matchId);
    const matchRes = await fetch(`${base}/api/arena/matches/${id}`);
    expect(matchRes.status).toBe(200);
    const match = await matchRes.json() as { outcome: string | null; agentAId: number; agentBId: number };
    expect(match.outcome).not.toBeNull();
    expect(match.agentAId).toBeGreaterThan(0);
    expect(match.agentBId).toBeGreaterThan(0);
    const replay = await fetch(`${base}/api/arena/matches/${id}/events`);
    expect(replay.status).toBe(200);
    const data = await replay.json() as { events: Array<{ eventType: string; payload: string }> };
    expect(data.events.length).toBeGreaterThan(0);
    expect(data.events.at(-1)?.eventType).toBe("match_seed_revealed");
  } catch (error) {
    server.kill();
    await server.exited;
    const stderr = server.stderr ? await new Response(server.stderr).text() : "";
    throw new Error(`live network acceptance: ${String(error)}; server stderr: ${stderr.slice(-3500)}`);
  } finally {
    for (const bot of bots) bot.socket.close();
    server.kill();
    await server.exited;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
