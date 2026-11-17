import type { AgentChannel, RoundFrame } from "../runner/types.ts";
import type { CubeCoord, RoundPlan } from "../shared/types.ts";

export const LIVE_PROTOCOL_VERSION = "3.0-alpha";
export interface LiveSocket {
  send(data: string): number | void;
}

function obj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function coord(value: unknown): value is CubeCoord {
  return obj(value) &&
    Number.isSafeInteger(value.q) &&
    Number.isSafeInteger(value.r) &&
    Number.isSafeInteger(value.s) &&
    Number(value.q) + Number(value.r) + Number(value.s) === 0;
}

function planShape(value: unknown): value is RoundPlan {
  if (!obj(value) ||
      !Number.isSafeInteger(value.bid) ||
      !Array.isArray(value.extras) ||
      value.extras.length > 8) return false;
  if (!Object.keys(value).every(k => ["bid", "extras", "freeMove", "freeAction"].includes(k))) return false;
  if (value.freeMove !== undefined) {
    const m = value.freeMove;
    if (!obj(m) || typeof m.unitId !== "string" || !coord(m.from) || !coord(m.to) ||
        (m.path !== undefined && (!Array.isArray(m.path) || m.path.length > 64 || !m.path.every(coord)))) return false;
  }
  if (value.freeAction !== undefined) {
    const a = value.freeAction;
    if (!obj(a) || typeof a.unitId !== "string" || !["attack", "ability"].includes(String(a.type)) ||
        !coord(a.from) || !coord(a.to) ||
        (a.abilityId !== undefined && typeof a.abilityId !== "string")) return false;
  }
  for (const e of value.extras) {
    if (!obj(e) || typeof e.unitId !== "string" ||
        !["boosted_ability", "second_attack", "defensive_stance", "reserve_overwatch"].includes(String(e.kind)) ||
        (e.to !== undefined && !coord(e.to)) ||
        (e.mode !== undefined && !["range", "damage"].includes(String(e.mode)))) return false;
  }
  return true;
}

/** One bound competitor for one match; never accepts unsolicited or stale plans. */
export class LiveAgentChannel implements AgentChannel {
  closed = false;
  private turn: number | null = null;
  private buffered: RoundPlan | null = null;
  private pending: { resolve: (plan: RoundPlan) => void; reject: (err: Error) => void } | null = null;
  private closedCallback: (() => void) | undefined;

  constructor(readonly matchId: string, private readonly socket: LiveSocket) {}

  send(frame: RoundFrame): void {
    if (this.closed) throw new Error("socket disconnected");
    if (this.turn !== null) throw new Error("previous turn still unresolved");
    this.turn = frame.state.turn;
    const { state, budget } = frame;
    this.socket.send(JSON.stringify({
      type: "STATE", matchId: this.matchId, turn: state.turn,
      visible: state.visible, units: state.units, score: state.score,
      deadline: state.deadline, roundCap: state.roundCap, budget,
      stances: state.stances, reserves: state.reserves,
    }));
  }

  receivePlan(): Promise<RoundPlan> {
    if (this.closed) return Promise.reject(new Error("socket disconnected"));
    if (this.turn === null) return Promise.reject(new Error("no turn requested"));
    if (this.buffered) {
      const plan = this.buffered;
      this.buffered = null;
      this.turn = null;
      return Promise.resolve(plan);
    }
    return new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
  }

  /** Called by the actual Bun WebSocket message handler. */
  acceptMessage(raw: string): boolean {
    if (this.closed) return false;
    let message: unknown;
    try { message = JSON.parse(raw); } catch { return this.refuse("invalid_json"); }
    if (!obj(message) || message.type !== "PLAN") return this.refuse("expected_plan");
    if (message.matchId !== this.matchId) return this.refuse("wrong_match");
    if (!Number.isSafeInteger(message.turn) || message.turn !== this.turn) {
      return this.refuse("wrong_turn");
    }
    if (!planShape(message.plan)) return this.refuse("invalid_plan_shape");
    if (this.buffered || (this.turn === null)) return this.refuse("duplicate_plan");

    const plan = message.plan;
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      this.turn = null;
      pending.resolve(plan);
    } else {
      this.buffered = plan;
    }
    return true;
  }

  onClose(cb: () => void): void { this.closedCallback = cb; }

  disconnect(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending?.reject(new Error("socket disconnected"));
    this.pending = null;
    this.buffered = null;
    this.turn = null;
    this.closedCallback?.();
  }

  dispose(): void {
    this.pending?.reject(new Error("match finished"));
    this.pending = null;
    this.buffered = null;
    this.turn = null;
    this.closedCallback = undefined;
  }

  private refuse(reason: string): false {
    this.socket.send(JSON.stringify({ type: "ERROR", code: reason, matchId: this.matchId }));
    return false;
  }
}
