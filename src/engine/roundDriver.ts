import { resolveBids } from "./bidResolver";
import { findRetarget } from "./retarget";
import { resolveCombat } from "./combat";
import { resolveFrontierRoleCombat } from "./frontier-role-combat.ts";
import { applyCarryover, applyEndOfRound, applyFrontierEndOfRound, deductBid } from "./round-state";
import { resolveExtras } from "./round-resolver/extras.ts";
import { resolveReserveTriggers } from "./round-resolver/triggers.ts";
import { RANGE } from "./constants";
import { distance } from "./coords";
import { checkVictory } from "./victory";
import { updateFrontierObjectives } from "./frontier-objectives.ts";
import type {
  RunRoundInput,
  RunRoundResult,
  FrontierRoundPlan,
  FrontierRunRoundInput,
  EngineEvent,
  MatchState,
  AgentRoundBudget,
  RoundPlan,
  Unit,
  CubeCoord,
  HexCell,
} from "../shared/types.ts";

interface AgentOutcome {
  state: MatchState;
  budget: AgentRoundBudget;
  events: EngineEvent[];
}

export function runRound(input: RunRoundInput): RunRoundResult {
  return runRoundInternal(input, false);
}

/**
 * New opt-in 5v5 command economy. Alternates two global movement waves
 * between the seats (priority by bid in each wave), then BOTH free actions.
 * Legacy runRound, action shape and archived replay behavior remain unchanged.
 *
 * Caller must validate each submitted plan with validateFrontierRoundPlan.
 */
export function runFrontierRound(input: FrontierRunRoundInput): RunRoundResult {
  return runRoundInternal(input, true);
}

/** The ONE new 5v5 game. All five distinct tactical specials are live here,
 * never in archived versions of runRound or runFrontierRound.
 * Caller must validate with validateFrontierRoundPlan(...,true).
 */
export function runFrontierRoleRound(input:FrontierRunRoundInput):RunRoundResult {
  return runRoundInternal(input,true,true);
}

/**
 * Current, sole playable Frontier rule. The existing five-role v1 resolver
 * remains frozen for archived games; objective capture is a new internal
 * rules version, not a player-facing option.
 */
export function runFrontierObjectiveRound(input:FrontierRunRoundInput):RunRoundResult{
  if(!input.state.frontierObjectiveHold)
    throw new Error("Objective round requires the v2 Frontier match");
  return runRoundInternal(input,true,true,true);
}

function runRoundInternal(
  input: RunRoundInput | FrontierRunRoundInput,
  maneuverV2: boolean,
  fiveRoles=false,
  objectives=false,
): RunRoundResult {
  const order = resolveBids({
    matchId: input.matchId,
    round: input.round,
    agentA: { bid: input.planA.bid, plan: input.planA },
    agentB: { bid: input.planB.bid, plan: input.planB },
  });

  // Phase 5: resolve reserve triggers BEFORE free moves/actions fire.
  // Fires on input.state (original state, not yet mutated by bids).
  // Returns reserve_fired + wasted_action events.
  const reserveEvents = resolveReserveTriggers(
    input.state,
    input.planA,
    input.planB,
    order.first,
    input.round,
  );

  // After reserve resolution, some units may have hp <= 0. Filter them out
  // so subsequent phase functions don't act with dead units.
  const liveUnits = input.state.units.map((u) => {
    // If reserve killed this unit, mark hp=0 and exclude from live set
    const killedByReserve = reserveEvents.some(
      (e) => e.type === "reserve_fired" && (e.payload as Record<string, unknown>).target === u.id,
    );
    if (killedByReserve) return { ...u, hp: 0 };
    return u;
  });
  const stateAfterReserve: MatchState = {
    ...input.state,
    units: liveUnits,
  };

  // Replenish this round's available AP BEFORE burning sealed initiative
  // bids. The old order reset apPool after the deduction and quietly made
  // every bid free. Both human and external-agent matches share this engine.
  const startA = deductBid(applyCarryover(input.budgetA), input.planA.bid);
  const startB = deductBid(applyCarryover(input.budgetB), input.planB.bid);

  const firstAgent = order.first;
  const firstPlan = firstAgent === "A" ? input.planA : input.planB;
  const firstStart = firstAgent === "A" ? startA : startB;
  const secondAgent: "A" | "B" = firstAgent === "A" ? "B" : "A";
  const secondPlan = firstAgent === "A" ? input.planB : input.planA;
  const secondStart = firstAgent === "A" ? startB : startA;

  // Plan D round phases are global. Initiative establishes the order INSIDE
  // each phase, not permission to attack before the opponent's free move.
  // Resolve both moves first, then both free actions, then AP extras.
  const firstMove = runAgentPhase(firstAgent, firstPlan, stateAfterReserve, firstStart, "move");
  const secondMove = runAgentPhase(secondAgent, secondPlan, firstMove.state, secondStart, "move");

  // In maneuver-v2 both teams receive a SECOND movement opportunity. Resolve
  // this as a new global wave, never let one side execute both moves while
  // the opponent has not moved. Distinct-unit enforcement occurs at the
  // boundary validator and contested destinations are checked live here.
  const waveTwoFirst: AgentOutcome = maneuverV2
    ? runAgentPhase(firstAgent, {
        ...firstPlan,
        freeMove:(firstPlan as FrontierRoundPlan).secondMove,
      },secondMove.state,firstMove.budget,"move")
    : {state:secondMove.state,budget:firstMove.budget,events:[]};
  const waveTwoSecond: AgentOutcome = maneuverV2
    ? runAgentPhase(secondAgent,{
        ...secondPlan,
        freeMove:(secondPlan as FrontierRoundPlan).secondMove,
      },waveTwoFirst.state,secondMove.budget,"move")
    : {state:waveTwoFirst.state,budget:secondMove.budget,events:[]};

  const firstAction = runAgentPhase(
    firstAgent,firstPlan,waveTwoSecond.state,waveTwoFirst.budget,"action",fiveRoles);
  const secondAction = runAgentPhase(
    secondAgent,secondPlan,firstAction.state,waveTwoSecond.budget,"action",fiveRoles);

  // Phase 4 AP extras: winner's extras first, then loser, preserving declared order.
  const boostFlag: Record<string, { mode: "range" | "damage" } | undefined> = {};
  const extrasCtx: import("./round-resolver/extras.ts").ExtrasContext = {
    state: secondAction.state,
    round: input.round,
    bidWinner: order.first,
    boostFlag,
    events: [],
    planA: input.planA,
    planB: input.planB,
  };
  resolveExtras(extrasCtx);

  const budgetAPre = firstAgent === "A" ? firstAction.budget : secondAction.budget;
  const budgetBPre = firstAgent === "A" ? secondAction.budget : firstAction.budget;
  const closeout=maneuverV2?applyFrontierEndOfRound:applyEndOfRound;
  const budgetA = closeout(budgetAPre);
  const budgetB = closeout(budgetBPre);

  // The legacy refund event describes its frozen free-slot accounting. V2
  // never refunds unused free opportunities into AP, so do not fabricate one.
  const refundEvents = maneuverV2 ? [] :
    buildRefundEvents(input.budgetA, budgetA, input.budgetB, budgetB, input.round);
  const events = [
    ...reserveEvents,
    ...firstMove.events,
    ...secondMove.events,
    ...waveTwoFirst.events,
    ...waveTwoSecond.events,
    ...firstAction.events,
    ...secondAction.events,
    ...extrasCtx.events,
    ...refundEvents,
  ];

  const resolvedState: MatchState = { ...secondAction.state, turn: input.round + 1 };
  // Ownership changes only after BOTH global moves, attacks and deaths.
  // The same 5v5 objective update is shared by browser and live PvP.
  const captured=objectives?updateFrontierObjectives(resolvedState):null;
  if(captured)events.push(...captured.events);
  const nextState=captured?.state??resolvedState;
  const victory=checkVictory(nextState);
  return {
    events,
    nextState,
    nextBudgetA: budgetA,
    nextBudgetB: budgetB,
    ended: victory.winner !== null,
  };
}

function runAgentPhase(
  agent: "A" | "B",
  plan: RoundPlan,
  state: MatchState,
  budget: AgentRoundBudget,
  phase: "move" | "action",
  fiveRoles=false,
): AgentOutcome {
  const events: EngineEvent[] = [];
  let nextState = state;
  let nextBudget = budget;

  // Skip dead units in plan references (they were killed by reserve trigger).
  // Per R4, AP was burned at validate time — no refund.
  const skipDead = (unitId: string) =>
    nextState.units.find((u) => u.id === unitId && u.hp <= 0) !== undefined;

  if (phase === "move" && plan.freeMove && !skipDead(plan.freeMove.unitId)) {
    const moveOut = doMove(agent, plan.freeMove.unitId, plan.freeMove.to, nextState);
    if (moveOut) {
      nextState = moveOut.state;
      events.push(moveOut.event);
      nextBudget = { ...nextBudget, freeMove: Math.max(0, nextBudget.freeMove - 1) };
    }
  } else if (phase === "move" && plan.freeMove && skipDead(plan.freeMove.unitId)) {
    events.push({
      type: "wasted_action",
      payload: { agent, kind: "freeMove", originalUnitId: plan.freeMove.unitId, reason: "trigger_killed_unit" },
      timestamp: 0,
    });
  }

  if (phase === "action" && plan.freeAction && !skipDead(plan.freeAction.unitId) && plan.freeAction.type === "attack") {
    const atkOut = doAttack(agent, plan.freeAction.unitId, plan.freeAction.to, nextState, fiveRoles);
    if (atkOut) {
      nextState = atkOut.state;
      events.push(...atkOut.events);
      nextBudget = { ...nextBudget, freeAction: Math.max(0, nextBudget.freeAction - 1) };
    }
  } else if (phase === "action" && plan.freeAction && skipDead(plan.freeAction.unitId)) {
    events.push({
      type: "wasted_action",
      payload: { agent, kind: "freeAction", originalUnitId: plan.freeAction.unitId, reason: "trigger_killed_unit" },
      timestamp: 0,
    });
  }

  return { state: nextState, budget: nextBudget, events };
}

function doMove(
  agent: "A" | "B",
  unitId: string,
  to: CubeCoord,
  state: MatchState,
): { state: MatchState; event: EngineEvent } | null {
  const unit = state.units.find((u) => u.id === unitId && u.owner === agent);
  if (!unit) return null;
  const destOccupied = state.units.some((u) => samePos(u.position, to));
  if (destOccupied) return null;
  const destCell = state.visible.find((c) => samePos(c.position, to));
  if (!destCell) return null;
  if (destCell.terrain === "mountain" || destCell.terrain === "water") return null;

  const newPos: CubeCoord = { q: to.q, r: to.r, s: to.s };
  const movedUnit: Unit = { ...unit, position: newPos };
  const units = state.units.map((u) => (u.id === unitId ? movedUnit : u));
  const visible = state.visible.map((c) => {
    if (samePos(c.position, unit.position)) return { ...c, unit: undefined };
    if (samePos(c.position, to)) return { ...c, unit: movedUnit };
    return c;
  });
  const event: EngineEvent = {
    type: "unit_moved",
    payload: { agent, unitId, from: unit.position, to: newPos },
    timestamp: 0,
  };
  return { state: { ...state, units, visible }, event };
}

function doAttack(
  agent: "A" | "B",
  attackerUnitId: string,
  originalTarget: CubeCoord,
  state: MatchState,
  fiveRoles=false,
): { state: MatchState; events: EngineEvent[] } | null {
  const attacker = state.units.find((u) => u.id === attackerUnitId && u.owner === agent);
  if (!attacker) return null;

  // A previously valid same-unit move may be blocked by the other side's
  // higher-priority move. Resolve against the attacker's LIVE position rather
  // than letting a planned post-move target become an impossible ranged hit.
  // This is a dynamic collision/retarget condition, not a second plan validator.
  const range = RANGE[attacker.type] ?? 1;
  const directTarget = state.units.find(
    (u) => u.owner !== agent && samePos(u.position, originalTarget) &&
      distance(attacker.position, u.position) <= range,
  );

  let defender: Unit | null = directTarget ?? null;
  let aimPenalty = 0;
  let retargeted = false;

  if (!defender) {
    const enemies = state.units.filter((u) => u.owner !== agent);
    defender = findRetarget({ attacker, originalTarget, enemyUnits: enemies, range });
    if (!defender) return { state, events: [{
      type: "action_wasted",
      payload: { agent, attackerUnitId, originalTarget, reason: "no_target_in_range" },
      timestamp: 0,
    }] };
    retargeted = true;
    aimPenalty = (attacker.weight ?? 2) * 0.2;
  }

  const defenderCell = state.visible.find((c) => samePos(c.position, defender!.position));
  const terrain: HexCell["terrain"] = defenderCell?.terrain ?? "plain";
  const roleResult=fiveRoles
    ?resolveFrontierRoleCombat(
      attacker,defender,terrain,state.units,
      (state.frontierRaiderStrikes??[]).includes(attacker.id),aimPenalty)
    :null;
  const result=roleResult??resolveCombat(attacker, defender, terrain, aimPenalty);

  const nextUnits: Unit[] = [];
  for (const u of state.units) {
    if (result.destroyed.includes(u.id)) continue;
    if (u.id === attacker.id) nextUnits.push({ ...u, hp: result.attackerHp });
    else if (u.id === defender.id) nextUnits.push({ ...u, hp: result.defenderHp });
    else nextUnits.push(u);
  }
  const nextVisible = state.visible.map((c) => {
    if (!c.unit) return c;
    if (result.destroyed.includes(c.unit.id)) return { ...c, unit: undefined };
    if (c.unit.id === attacker.id) return { ...c, unit: { ...c.unit, hp: result.attackerHp } };
    if (c.unit.id === defender!.id) return { ...c, unit: { ...c.unit, hp: result.defenderHp } };
    return c;
  });

  const events: EngineEvent[] = [];
  events.push({
    type: "unit_attacked",
    payload: {
      agent,
      attackerUnitId,
      targetUnitId: defender.id,
      damage:roleResult?.damageDealt??attacker.strength,
      defenderHp: result.defenderHp,
    },
    timestamp: 0,
  });
  if (roleResult) {
    if (roleResult.raiderFirstStrike)
      events.push({type:"ability_resolved",payload:{
        role:"raider",ability:"first_strike",unitId:attacker.id,
        bonusDamage:1,
      },timestamp:0});
    if (roleResult.interceptorCounter)
      events.push({type:"ability_resolved",payload:{
        role:"interceptor",ability:"counterattack",unitId:defender.id,
        bonusDamage:1,
      },timestamp:0});
    if (roleResult.captainProtection)
      events.push({type:"ability_resolved",payload:{
        role:"captain",ability:"defense_aura",protectedUnitId:defender.id,
        damagePrevented:1,
      },timestamp:0});
  }
  if (retargeted) {
    events.push({
      type: "action_retargeted",
      payload: {
        agent,
        attackerUnitId,
        originalTarget,
        actualTarget: defender.position,
        actualTargetUnitId: defender.id,
        aimPenalty,
        reason: "rushed_shot",
      },
      timestamp: 0,
    });
  }
  for (const id of result.destroyed) {
    events.push({ type: "unit_destroyed", payload: { unitId: id }, timestamp: 0 });
  }

  return { state: {
    ...state, units: nextUnits, visible: nextVisible,
    ...(fiveRoles && attacker.type==="raider"
      ? {frontierRaiderStrikes:[...new Set([
          ...(state.frontierRaiderStrikes??[]),attacker.id,
        ])]}
      : {}),
  }, events };
}

function buildRefundEvents(
  prevA: AgentRoundBudget,
  nextA: AgentRoundBudget,
  prevB: AgentRoundBudget,
  nextB: AgentRoundBudget,
  round: number,
): EngineEvent[] {
  const out: EngineEvent[] = [];
  if (nextA.apPool > prevA.apPool) {
    out.push({
      type: "slots_refunded",
      payload: { agent: "A", round, delta: nextA.apPool - prevA.apPool },
      timestamp: 0,
    });
  }
  if (nextB.apPool > prevB.apPool) {
    out.push({
      type: "slots_refunded",
      payload: { agent: "B", round, delta: nextB.apPool - prevB.apPool },
      timestamp: 0,
    });
  }
  return out;
}

function samePos(a: CubeCoord, b: CubeCoord): boolean {
  return a.q === b.q && a.r === b.r && a.s === b.s;
}
