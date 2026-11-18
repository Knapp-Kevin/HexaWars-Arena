import type { Database } from "bun:sqlite";
import type { MatchRecord, MatchState, AgentRoundBudget, RoundPlan } from "../shared/types.ts";
import { createMatch } from "../engine/match.ts";
import { runRound } from "../engine/roundDriver.ts";
import { newBudget, PASS_PLAN, applyCarryover } from "../engine/round-state.ts";
import { ROUND_CAP } from "../engine/constants.ts";
import { validateRoundPlan } from "../gateway/validator.ts";
import { checkVictory } from "../engine/victory.ts";
import { projectSeatObservation } from "../gateway/observation.ts";
import {
  saveMatch,
  appendEvents,
  updateForfeit,
  updateMatchOutcome,
} from "../persistence/match-store.ts";
import type {
  RunnerContext,
  AgentChannel,
  RunnerResult,
  MatchConclusionReason,
} from "./types.ts";

const DEFAULT_TURN_TIMEOUT_MS = 5000;

function withTimeout<T>(
  promise: Promise<T>, ms: number, signal: AbortSignal,
): Promise<{ ok: true; value: T } | { ok: false }> {
  return new Promise((resolve) => {
    let done = false;
    const settle = (result: { ok: true; value: T } | { ok: false }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      resolve(result);
    };
    const cancel = () => settle({ ok: false });
    const timer = setTimeout(cancel, ms);
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
    promise.then((value) => settle({ ok: true, value }), cancel);
  });
}

function isRoundPlanMessage(message: unknown): message is { plan: RoundPlan } {
  return Boolean(
    message &&
    typeof message === "object" &&
    "plan" in message &&
    (message as { plan?: unknown }).plan &&
    typeof (message as { plan?: RoundPlan }).plan?.bid === "number",
  );
}

function isLegacyActionMessage(message: unknown): message is { action: { type: string } } {
  return Boolean(
    message &&
    typeof message === "object" &&
    "action" in message &&
    typeof (message as { action?: { type?: unknown } }).action?.type === "string",
  );
}

function actionToRoundPlan(message: { action: { type: string } }): RoundPlan {
  const action = message.action;
  if (action.type === "pass") return PASS_PLAN;
  return PASS_PLAN;
}

function receivePlanFromChannel(channel: AgentChannel): Promise<RoundPlan> {
  if (channel.receivePlan) {
    return channel.receivePlan();
  }
  if (channel.onMessage) {
    return new Promise<RoundPlan>((resolve) => {
      channel.onMessage?.((message) => {
        if (isRoundPlanMessage(message)) {
          resolve(message.plan);
          return;
        }
        if (isLegacyActionMessage(message)) {
          resolve(actionToRoundPlan(message));
          return;
        }
        resolve(PASS_PLAN);
      });
    });
  }
  return Promise.resolve(PASS_PLAN);
}

function sendRoundFrame(
  channel: AgentChannel,
  state: MatchState,
  budget: AgentRoundBudget,
): void {
  channel.send({ state, budget });
}

export class MatchRunner {
  constructor(private db: Database) {}

  async start(
    ctx: RunnerContext,
    channels: { a: AgentChannel; b: AgentChannel },
    turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
  ): Promise<RunnerResult> {
    // A ranked match must have two real response channels. Previously an empty
    // channel silently played PASS_PLAN every turn and could earn a fake result.
    for (const [side, channel] of [["A", channels.a], ["B", channels.b]] as const) {
      if (!channel.receivePlan && !channel.onMessage) {
        throw new Error(`missing live plan input for side ${side}`);
      }
    }
    if (ctx.a.id === ctx.b.id) throw new Error("self matchmaking is not ranked play");
    for (const participant of [ctx.a, ctx.b]) {
      if (!Number.isSafeInteger(participant.agentVersionId) || participant.agentVersionId <= 0) {
        throw new Error("registered agent version required");
      }
      const row = this.db.prepare(
        "SELECT operator_id AS operatorId FROM agent_versions WHERE id = ?",
      ).get(participant.agentVersionId) as { operatorId: number } | undefined;
      if (!row || row.operatorId !== participant.id) {
        throw new Error("agent version is not owned by queued operator");
      }
    }
    const matchRecord: MatchRecord = {
      id: ctx.matchId,
      operatorAId: ctx.a.id,
      operatorBId: ctx.b.id,
      agentAId: ctx.a.agentVersionId,
      agentBId: ctx.b.agentVersionId,
      originTag: "ladder:pending",
      outcome: null,
      createdAt: Date.now(),
    };
    saveMatch(this.db, { ...matchRecord, originTag: "ladder" });

    let state: MatchState = createMatch(ctx.seed, String(ctx.a.id), String(ctx.b.id));
    let budgetA: AgentRoundBudget = newBudget();
    let budgetB: AgentRoundBudget = newBudget();
    let round = 0;
    let seq = 0;
    // Reveal a per-match seed only after the outcome is recorded, so the
    // public match ID cannot be used to infer hidden terrain during play.
    const complete = (result: RunnerResult): RunnerResult => {
      appendEvents(this.db, ctx.matchId, [{
        seq: seq++,
        eventType: "match_seed_revealed",
        payload: JSON.stringify({ seed: ctx.seed }),
        ts: Date.now(),
      }]);
      return result;
    };

    let forfeitWinnerId: number | null = null;
    const closed = new AbortController();
    channels.a.onClose?.(() => {
      forfeitWinnerId = ctx.b.id;
      closed.abort();
    });
    channels.b.onClose?.(() => {
      forfeitWinnerId = ctx.a.id;
      closed.abort();
    });

    while (true) {
      if (channels.a.closed || channels.b.closed) {
        const winnerId = channels.a.closed ? ctx.b.id : ctx.a.id;
        return complete(this.endForfeit(ctx.matchId, winnerId));
      }
      if (forfeitWinnerId !== null) {
        return complete(this.endForfeit(ctx.matchId, forfeitWinnerId));
      }
      if (round >= ROUND_CAP) {
        return complete(this.endTimeout(ctx.matchId, null));
      }

      // Advertise and validate the SAME spendable current-round AP that
      // runRound will use after refreshing base AP + previous carry.
      const spendableA=applyCarryover(budgetA);
      const spendableB=applyCarryover(budgetB);
      sendRoundFrame(channels.a, projectSeatObservation(state, "A"), spendableA);
      sendRoundFrame(channels.b, projectSeatObservation(state, "B"), spendableB);

      const [resA, resB] = await Promise.all([
        withTimeout(receivePlanFromChannel(channels.a), turnTimeoutMs, closed.signal),
        withTimeout(receivePlanFromChannel(channels.b), turnTimeoutMs, closed.signal),
      ]);

      if (channels.a.closed || channels.b.closed) {
        const winnerId = channels.a.closed && channels.b.closed ? null
          : channels.a.closed ? ctx.b.id : ctx.a.id;
        return complete(this.endForfeit(ctx.matchId, winnerId));
      }
      if (forfeitWinnerId !== null) {
        return complete(this.endForfeit(ctx.matchId, forfeitWinnerId));
      }
      if (!resA.ok || !resB.ok) {
        if (!resA.ok && !resB.ok) return complete(this.endTimeout(ctx.matchId, null));
        if (!resA.ok) return complete(this.endTimeout(ctx.matchId, ctx.b.id));
        return complete(this.endTimeout(ctx.matchId, ctx.a.id));
      }

      const planA = resA.value;
      const planB = resB.value;

      const invalidA = validateRoundPlan(planA, "A", state, spendableA);
      if (!invalidA.ok) {
        return complete(this.endInvalidPlan(ctx.matchId, ctx.b.id, "A", invalidA.reason));
      }
      const invalidB = validateRoundPlan(planB, "B", state, spendableB);
      if (!invalidB.ok) {
        return complete(this.endInvalidPlan(ctx.matchId, ctx.a.id, "B", invalidB.reason));
      }

      const result = runRound({
        matchId: ctx.matchId, round, state,
        planA, planB, budgetA, budgetB,
      });
      state = result.nextState;
      budgetA = result.nextBudgetA;
      budgetB = result.nextBudgetB;

      for (const ev of result.events) {
        appendEvents(this.db, ctx.matchId, [{
          seq, eventType: ev.type,
          payload: JSON.stringify(ev.payload),
          ts: Date.now(),
        }]);
        seq++;
      }
      round++;

      if (result.ended) break;
    }

    return complete(this.endByVictory(ctx.matchId, state, ctx.a.id, ctx.b.id));
  }

  private endForfeit(matchId: string, winnerId: number | null): RunnerResult {
    updateForfeit(this.db, matchId,
      JSON.stringify({ winnerOperatorId: winnerId, reason: "forfeit" }),
      "ladder");
    return { winnerOperatorId: winnerId, reason: "forfeit" };
  }

  private endTimeout(matchId: string, winnerId: number | null): RunnerResult {
    updateMatchOutcome(this.db, matchId,
      JSON.stringify({ winnerOperatorId: winnerId, reason: "timeout" }),
      winnerId, "ladder");
    return { winnerOperatorId: winnerId, reason: "timeout" };
  }

  private endInvalidPlan(matchId: string, winnerId: number, loser: "A" | "B", reason: string): RunnerResult {
    updateMatchOutcome(this.db, matchId,
      JSON.stringify({ winnerOperatorId: winnerId, reason: "invalid_plan", loser, detail: reason }),
      winnerId, "ladder");
    return { winnerOperatorId: winnerId, reason: "invalid_plan" };
  }

  private endByVictory(matchId: string, state: MatchState, aId: number, bId: number): RunnerResult {
    const victory = checkVictory(state);
    let winnerOperatorId: number | null = null;
    let reason: MatchConclusionReason = "timeout";
    if (victory.winner === "A") { winnerOperatorId = aId; reason = "decisive"; }
    else if (victory.winner === "B") { winnerOperatorId = bId; reason = "decisive"; }
    updateMatchOutcome(this.db, matchId,
      JSON.stringify({ winnerOperatorId, reason }),
      winnerOperatorId, "ladder");
    return { winnerOperatorId, reason };
  }
}
