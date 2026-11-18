import type { MatchState, RoundPlan, CubeCoord } from "../../shared/types";
import { RANGE } from "../../engine/constants.ts";

export type AttackRangeResult = { ok: true } | { ok: false; reason: string };

type AttackState = Pick<MatchState, "units" | "visible">;

function validCube(value: unknown): value is CubeCoord {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<CubeCoord>;
  return Number.isSafeInteger(p.q) && Number.isSafeInteger(p.r) &&
    Number.isSafeInteger(p.s) && p.q! + p.r! + p.s! === 0;
}

function same(a: CubeCoord, b: CubeCoord): boolean {
  return a.q === b.q && a.r === b.r && a.s === b.s;
}

function hexDistance(a: CubeCoord, b: CubeCoord): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
}

function boardHas(state: AttackState, coord: CubeCoord): boolean {
  return state.visible.some(cell => same(cell.position, coord));
}

/**
 * Verify an attack against the actual versioned board and live unit origin.
 * A free move resolves before the free action, so a same-unit attack must be
 * reachable from the declared move destination, not an invented origin.
 *
 * The submitted freeAction.from remains the unit's round-start coordinate:
 * this is what the agent and local-practice round composer both submit.
 * If a competing move later blocks the planned move, the resolver must also
 * enforce live attack reachability as a dynamic collision condition.
 */
export function validateAttackRange(
  plan: RoundPlan,
  _agent: "A" | "B",
  state: AttackState,
): AttackRangeResult {
  const action = plan.freeAction;
  if (action?.type === "attack") {
    if (!validCube(action.from)) return { ok: false, reason: "attack_from_malformed" };
    if (!validCube(action.to) || !boardHas(state, action.to)) {
      return { ok: false, reason: "attack_to_off_board" };
    }
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return { ok: false, reason: `unit_not_found:${action.unitId}` };
    if (unit.hp <= 0) return { ok: false, reason: "attack_unit_destroyed" };
    if (!same(action.from, unit.position)) {
      return { ok: false, reason: "attack_from_mismatch" };
    }
    const projectedOrigin = plan.freeMove?.unitId === unit.id
      ? plan.freeMove.to
      : unit.position;
    const dist = hexDistance(projectedOrigin, action.to);
    if (dist > RANGE[unit.type]) {
      return { ok: false, reason: `attack_out_of_range:dist${dist}max${RANGE[unit.type]}` };
    }
  }

  // AP extras are currently disabled by the aggregator. Keep their existing
  // defensive range checks for any future governed activation.
  for (const extra of plan.extras) {
    if (extra.kind !== "second_attack" && extra.kind !== "boosted_ability") continue;
    if (!extra.to) continue;
    if (!validCube(extra.to) || !boardHas(state, extra.to)) {
      return { ok: false, reason: "extra_attack_to_off_board" };
    }
    const unit = state.units.find(u => u.id === extra.unitId);
    if (!unit) return { ok: false, reason: `unit_not_found:${extra.unitId}` };
    const dist = hexDistance(unit.position, extra.to);
    if (dist > RANGE[unit.type]) {
      return { ok: false, reason: `extra_attack_out_of_range:${extra.unitId}dist${dist}` };
    }
  }
  return { ok: true };
}
