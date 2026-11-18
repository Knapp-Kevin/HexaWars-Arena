/**
 * Opt-in Frontier127 "maneuver-v2" plan validation.
 *
 * Delegates each movement and the single attack to the FROZEN canonical
 * RoundPlan validator. V2 does not weaken origin, traversable-path, fog,
 * range, bid, ownership or extras-disallowed checks. It adds exactly one
 * move slot for a DIFFERENT friendly unit, not an unchecked second order.
 */
import type {
  FrontierRoundPlan, MatchState, RoundPlan,
} from "../shared/types.ts";
import { validateRoundPlan } from "./validator.ts";

export type FrontierPlanValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateFrontierRoundPlan(
  plan: FrontierRoundPlan,
  side: "A" | "B",
  state: MatchState,
  budget: { apPool: number },
  fiveRoles=false,
): FrontierPlanValidationResult {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.extras)) {
    return {ok:false,reason:"frontier_plan_malformed"};
  }
  // The v2 preview exposes exactly one executable free ATTACK. A typed
  // ability is legal in the frozen Plan D schema but the shared round
  // driver does not resolve it yet. Reject rather than silently consuming
  // a human/agent's action to no effect.
  if (plan.freeAction && plan.freeAction.type!=="attack") {
    return {ok:false,reason:"frontier_ability_not_implemented"};
  }
  if ("secondMove" in plan && !plan.secondMove) {
    return {ok:false,reason:"frontier_second_move_malformed"};
  }
  if(fiveRoles && plan.freeAction?.type==="attack"){
    const attacker=state.units.find(u=>u.id===plan.freeAction!.unitId);
    if(attacker?.type==="siege" && (
      plan.freeMove?.unitId===attacker.id ||
      plan.secondMove?.unitId===attacker.id
    )){
      return {ok:false,reason:"frontier_siege_cannot_move_and_attack"};
    }
  }
  const second = plan.secondMove;
  if (second) {
    if (typeof second.unitId !== "string" || !second.from || !second.to) {
      return {ok:false,reason:"frontier_second_move_malformed"};
    }
    if (plan.freeMove?.unitId===second.unitId) {
      return {ok:false,reason:"frontier_duplicate_move_unit"};
    }
    if (plan.freeMove?.to &&
        plan.freeMove.to.q===second.to.q &&
        plan.freeMove.to.r===second.to.r &&
        plan.freeMove.to.s===second.to.s) {
      return {ok:false,reason:"frontier_duplicate_move_destination"};
    }
  }

  // The current frozen validator projects attack position from freeMove.
  // Only when attacking the SECOND moving unit may the first-pass attack
  // field be deferred to the second canonical validation pass.
  const attackFromSecond=Boolean(second && plan.freeAction?.unitId===second.unitId);
  const firstPlan: RoundPlan={
    bid:plan.bid,
    extras:plan.extras,
    ...(plan.freeMove?{freeMove:plan.freeMove}:{}),
    ...(!attackFromSecond&&plan.freeAction?{freeAction:plan.freeAction}:{}),
  };
  const first=validateRoundPlan(firstPlan,side,state,budget);
  if (!first.ok) return first;
  if (second) {
    const secondPlan: RoundPlan={
      bid:0,
      extras:[],
      freeMove:second,
      ...(attackFromSecond&&plan.freeAction?{freeAction:plan.freeAction}:{}),
    };
    const result=validateRoundPlan(secondPlan,side,state,budget);
    if (!result.ok) return result;
  }
  return {ok:true};
}
