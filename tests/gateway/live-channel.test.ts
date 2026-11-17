import { describe, expect, test } from "bun:test";
import { createMatch } from "../../src/engine/match.ts";
import { newBudget } from "../../src/engine/round-state.ts";
import { projectSeatObservation } from "../../src/gateway/observation.ts";
import { LiveAgentChannel } from "../../src/gateway/live-channel.ts";
import { LiveConnections } from "../../src/gateway/live-connections.ts";
import { PresenceTracker } from "../../src/matchmaker/presence.ts";

const matchId = "match-v3-1";
const pass = { bid: 0, extras: [] };
const frame = () => ({
  state: projectSeatObservation(createMatch("private-not-public"), "A"),
  budget: newBudget(),
});

function socket() {
  const messages: Record<string, unknown>[] = [];
  return {
    messages,
    send(raw: string) { messages.push(JSON.parse(raw)); },
  };
}

describe("live agent channel", () => {
  test("requires exact match and turn before accepting one plan", async () => {
    const s = socket();
    const channel = new LiveAgentChannel(matchId, s);
    channel.send(frame());
    expect(s.messages[0].type).toBe("STATE");
    expect(s.messages[0].matchId).toBe(matchId);
    expect(JSON.stringify(s.messages[0])).not.toContain("private-not-public");

    const pending = channel.receivePlan();
    const incorrect = JSON.stringify({ type: "PLAN", matchId, turn: 8, plan: pass });
    expect(channel.acceptMessage(incorrect)).toBe(false);
    expect(s.messages.at(-1)?.code).toBe("wrong_turn");
    const correct = JSON.stringify({ type: "PLAN", matchId, turn: 0, plan: pass });
    expect(channel.acceptMessage(correct)).toBe(true);
    expect(await pending).toEqual(pass);
    expect(channel.acceptMessage(correct)).toBe(false);
  });

  test("buffers a quick legitimate reply before receivePlan is awaited", async () => {
    const s = socket();
    const channel = new LiveAgentChannel(matchId, s);
    channel.send(frame());
    expect(channel.acceptMessage(JSON.stringify({ type: "PLAN", matchId, turn: 0, plan: pass })))
      .toBe(true);
    expect(await channel.receivePlan()).toEqual(pass);
  });

  test("rejects malformed input, forged match ID and invalid coordinates", async () => {
    const s = socket();
    const channel = new LiveAgentChannel(matchId, s);
    channel.send(frame());
    expect(channel.acceptMessage("{")).toBe(false);
    expect(channel.acceptMessage(JSON.stringify({ type: "PLAN", matchId: "another", turn: 0, plan: pass }))).toBe(false);
    expect(channel.acceptMessage(JSON.stringify({
      type: "PLAN", matchId, turn: 0,
      plan: { bid: 0, extras: [], freeMove: { unitId: "x", from: { q: 0, r: 0, s: 0 }, to: { q: 1, r: 1, s: 0 } } },
    }))).toBe(false);
    expect(channel.acceptMessage(JSON.stringify({ type: "PLAN", matchId, turn: 0, plan: pass }))).toBe(true);
    expect(await channel.receivePlan()).toEqual(pass);
  });

  test("disconnect immediately refuses a pending turn", async () => {
    const channel = new LiveAgentChannel(matchId, socket());
    channel.send(frame());
    const pending = channel.receivePlan();
    channel.disconnect();
    await expect(pending).rejects.toThrow("socket disconnected");
    expect(channel.closed).toBe(true);
  });

  test("binds only two distinct idle operators and cleans up after match", () => {
    const presence = new PresenceTracker();
    const live = new LiveConnections(presence);
    const a = socket(), b = socket();
    expect(live.open(10, a)).toBe(true);
    expect(live.open(20, b)).toBe(true);
    expect(live.open(10, a)).toBe(false);
    expect(presence.size()).toBe(2);
    const channels = live.bind(10, 20, matchId);
    expect(channels).not.toBeNull();
    expect(a.messages[0].type).toBe("HELLO");
    expect(JSON.stringify(a.messages[0])).not.toContain("seed");
    expect(live.bind(10, 20, "another")).toBeNull();
    live.complete(10, 20, matchId, { winnerOperatorId: 10, reason: "decisive" });
    expect(a.messages.at(-1)?.type).toBe("END");
    expect(live.available(10)).toBe(true);
    live.close(10, a);
    expect(presence.size()).toBe(1);
  });
});
