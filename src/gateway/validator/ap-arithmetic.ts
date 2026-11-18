import type { ExtraEntry } from "../../shared/types";
import { BID_MIN } from "../../engine/constants.ts";

const EXTRA_COST: Record<Exclude<ExtraEntry["kind"], undefined>, number> = {
  boosted_ability: 1,
  second_attack: 2,
  defensive_stance: 1,
  reserve_overwatch: 2,
};

export interface ApArithmeticResult {
  ok: true;
}
export interface ApArithmeticFail {
  ok: false;
  reason: string;
}

export function validateApArithmetic(
  plan: { bid: number; extras: ExtraEntry[] },
  availableAp: number
): ApArithmeticResult | ApArithmeticFail {
  if(!Number.isSafeInteger(plan.bid)||plan.bid<BID_MIN){
    return { ok:false,reason:"bid_invalid" };
  }
  let cost = 0;
  for (const ex of plan.extras) {
    cost += EXTRA_COST[ex.kind] ?? 0;
  }
  if (cost + plan.bid > availableAp) {
    return { ok: false, reason: "ap_exceeds_pool" };
  }
  return { ok: true };
}
