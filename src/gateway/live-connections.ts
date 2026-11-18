import type { PresenceTracker } from "../matchmaker/presence.ts";
import type { RunnerResult } from "../runner/types.ts";
import { LiveAgentChannel, LIVE_PROTOCOL_VERSION, type LiveSocket } from "./live-channel.ts";
import { ACTIVE_FRONTIER_RULES_VERSION,ACTIVE_FRONTIER_TOPOLOGY } from "../engine/frontier-match.ts";
import { FRONTIER_OBJECTIVES,FRONTIER_OBJECTIVE_HOLD_ROUNDS,
  FRONTIER_OBJECTIVE_MAJORITY } from "../engine/frontier-objectives.ts";

type Connected = {
  socket: LiveSocket & { close?: (code?: number, reason?: string) => void };
  channel?: LiveAgentChannel;
};

export class LiveConnections {
  private connected = new Map<number, Connected>();

  constructor(private readonly presence: PresenceTracker) {}

  has(operatorId: number): boolean { return this.connected.has(operatorId); }

  available(operatorId: number): boolean {
    const entry = this.connected.get(operatorId);
    return Boolean(entry && !entry.channel);
  }

  open(operatorId: number, socket: Connected["socket"]): boolean {
    if (this.connected.has(operatorId)) return false;
    this.connected.set(operatorId, { socket });
    this.presence.connect(operatorId);
    return true;
  }

  close(operatorId: number, socket: Connected["socket"]): void {
    const entry = this.connected.get(operatorId);
    if (!entry || entry.socket !== socket) return;
    entry.channel?.disconnect();
    this.connected.delete(operatorId);
    this.presence.disconnect(operatorId);
  }

  message(operatorId: number, socket: Connected["socket"], raw: string): void {
    const entry = this.connected.get(operatorId);
    if (!entry || entry.socket !== socket) return;
    if (!entry.channel) {
      socket.send(JSON.stringify({ type: "ERROR", code: "not_in_match" }));
      return;
    }
    entry.channel.acceptMessage(raw);
  }

  bind(aId: number, bId: number, matchId: string): { a: LiveAgentChannel; b: LiveAgentChannel } | null {
    if (aId === bId || !this.available(aId) || !this.available(bId)) return null;
    const a = this.connected.get(aId)!;
    const b = this.connected.get(bId)!;
    const chanA = new LiveAgentChannel(matchId, a.socket);
    const chanB = new LiveAgentChannel(matchId, b.socket);
    a.channel = chanA;
    b.channel = chanB;
    for (const [entry, side] of [[a, "A"], [b, "B"]] as const) {
      entry.socket.send(JSON.stringify({
        type: "HELLO", matchId, side, protocolVersion: LIVE_PROTOCOL_VERSION,
        rulesVersion: ACTIVE_FRONTIER_RULES_VERSION,
        topology:ACTIVE_FRONTIER_TOPOLOGY,boardCells:127,
        roles:["scout","raider","interceptor","siege","captain"],
        freeMoves:2,freeAttacks:1,
        objectiveSites:FRONTIER_OBJECTIVES.map(c=>({...c})),
        objectiveTarget:FRONTIER_OBJECTIVE_MAJORITY,
        objectiveHoldRounds:FRONTIER_OBJECTIVE_HOLD_ROUNDS,
        // No deterministic seed while hidden board information is still private.
      }));
    }
    return { a: chanA, b: chanB };
  }

  complete(aId: number, bId: number, matchId: string, result: RunnerResult): void {
    for (const id of [aId, bId]) {
      const entry = this.connected.get(id);
      if (!entry || entry.channel?.matchId !== matchId) continue;
      entry.channel.dispose();
      entry.channel = undefined;
      entry.socket.send(JSON.stringify({
        type: "END", matchId,
        winnerOperatorId: result.winnerOperatorId,
        reason: result.reason,
      }));
    }
  }

  fail(aId: number, bId: number, matchId: string): void {
    for (const id of [aId, bId]) {
      const entry = this.connected.get(id);
      if (!entry || entry.channel?.matchId !== matchId) continue;
      entry.channel.dispose();
      entry.channel = undefined;
      entry.socket.send(JSON.stringify({ type: "ERROR", matchId, code: "match_runtime_failed" }));
    }
  }
}
