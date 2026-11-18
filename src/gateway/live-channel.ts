import type { AgentChannel, RoundFrame } from "../runner/types.ts";
import type { CubeCoord, FrontierRoundPlan } from "../shared/types.ts";
import { ACTIVE_FRONTIER_RULES_VERSION } from "../engine/frontier-match.ts";

export const LIVE_PROTOCOL_VERSION = "4.0";
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

function planShape(value: unknown): value is FrontierRoundPlan {
  if (!obj(value) ||
      !Number.isSafeInteger(value.bid) ||
      !Array.isArray(value.extras) ||
      value.extras.length > 8) return false;
  if (!Object.keys(value).every(k =>
    ["bid", "extras", "freeMove", "secondMove", "freeAction"].includes(k))) return false;
  // The second movement wave is exactly the same validated shape as Move 1.
  // Unit/destination uniqueness, board path and Siege move/fire constraints
  // remain the canonical runner validator's responsibility.
  for(const slot of ["freeMove","secondMove"] as const){
    const m=value[slot];
    if(m===undefined)continue;
    if (!obj(m) || typeof m.unitId !== "string" || !coord(m.from) || !coord(m.to) ||
        (m.path !== undefined && (!Array.isArray(m.path) ||
          m.path.length > 64 || !m.path.every(coord)))) return false;
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
  /** Public round index most recently sent to this authenticated competitor.
   * Unlike 'turn', this survives a consumed PLAN until the match ends.
   */
  private lastReportedRound: number | null = null;
  get latestReportedRound(): number | null { return this.lastReportedRound; }
  private buffered: FrontierRoundPlan | null = null;
  private pending: { resolve: (plan: FrontierRoundPlan) => void; reject: (err: Error) => void } | null = null;
  private closedCallback: (() => void) | undefined;

  constructor(readonly matchId: string, private readonly socket: LiveSocket) {}

  send(frame: RoundFrame): void {
    if (this.closed) throw new Error("socket disconnected");
    if (this.turn !== null) throw new Error("previous turn still unresolved");
    if(frame.rulesVersion&&frame.rulesVersion!==ACTIVE_FRONTIER_RULES_VERSION)
      throw new Error("runner_transport_rules_mismatch");
    this.turn = frame.state.turn;
    const { state, budget } = frame;
    this.socket.send(JSON.stringify({
      type: "STATE", matchId: this.matchId, turn: state.turn,
      rulesVersion:ACTIVE_FRONTIER_RULES_VERSION,
      protocolVersion:LIVE_PROTOCOL_VERSION,
      maxMoveSlots:2,maxFreeAttacks:1,
      visible: state.visible, units: state.units, score: state.score,
      deadline: state.deadline, roundCap: state.roundCap, budget,
      ...(state.frontierObjectiveHold?{
        objectiveHold:state.frontierObjectiveHold,objectiveTarget:3,
        objectiveHoldRounds:3,
        objectiveSites:state.frontierObjectiveSites??[],
      }:{}),
      stances: state.stances, reserves: state.reserves,
    }));
    this.lastReportedRound=state.turn;
  }

  receivePlan(): Promise<FrontierRoundPlan> {
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
    if (message.protocolVersion!==LIVE_PROTOCOL_VERSION)
      return this.refuse("incompatible_protocol");
    if (message.rulesVersion!==ACTIVE_FRONTIER_RULES_VERSION)
      return this.refuse("incompatible_rules");
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
