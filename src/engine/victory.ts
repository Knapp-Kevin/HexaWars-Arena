import type { MatchState } from "../shared/types.ts";
import { FRONTIER_OBJECTIVE_HOLD_ROUNDS,FRONTIER_OBJECTIVE_MAJORITY,
  FRONTIER_OBJECTIVES } from "./frontier-objectives.ts";

interface VictoryResult {
  winner: "A" | "B" | "draw" | null;
  reason: string | null;
}

const TERRITORY_THRESHOLD = 0.6;
const TERRITORY_TURNS = 3;

export function checkVictory(state: MatchState): VictoryResult {
  const units = state.units;
  const visible = state.visible;

  // Some interrupt/reserve branches retain zero-HP records for event history.
  // They are NOT living units: counting them permits zombie victories and
  // indefinite pass rounds after every remaining squad has been defeated.
  const unitCountA = units.filter((u) => u.owner === "A" && u.hp > 0).length;
  const unitCountB = units.filter((u) => u.owner === "B" && u.hp > 0).length;

  if (unitCountA === 0 && unitCountB === 0) {
    return { winner: "draw", reason: "mutual_elimination" };
  }
  if (unitCountA === 0) {
    return { winner: "B", reason: "elimination" };
  }
  if (unitCountB === 0) {
    return { winner: "A", reason: "elimination" };
  }

  // One CURRENT Frontier product ruleset: own >=3/5 authored sites for
  // 3 consecutive completed rounds. Never confuse this with archived
  // transient 60%-of-all-cells rule; version flag is mandatory.
  if(state.frontierObjectiveHold){
    const sites=visible.filter(c=>c.frontierObjective===true);
    if(sites.length!==FRONTIER_OBJECTIVES.length)
      throw new Error("Invalid objective board in canonical victory check");
    const a=sites.filter(c=>c.controlledBy==="A").length;
    const b=sites.filter(c=>c.controlledBy==="B").length;
    if(a>=FRONTIER_OBJECTIVE_MAJORITY &&
        state.frontierObjectiveHold.a>=FRONTIER_OBJECTIVE_HOLD_ROUNDS)
      return {winner:"A",reason:"territory_control"};
    if(b>=FRONTIER_OBJECTIVE_MAJORITY &&
        state.frontierObjectiveHold.b>=FRONTIER_OBJECTIVE_HOLD_ROUNDS)
      return {winner:"B",reason:"territory_control"};
    if(state.turn>=state.roundCap){
      if(a>b)return {winner:"A",reason:"turn_cap"};
      if(b>a)return {winner:"B",reason:"turn_cap"};
      return {winner:"draw",reason:"turn_cap"};
    }
    return {winner:null,reason:null};
  }

  const controlledByA = visible.filter((c) => c.controlledBy === "A").length;
  const controlledByB = visible.filter((c) => c.controlledBy === "B").length;
  const total = visible.length;

  if (total === 0) {
    return { winner: null, reason: null };
  }

  const pctA = controlledByA / total;
  const pctB = controlledByB / total;

  if (pctA >= TERRITORY_THRESHOLD) {
    return { winner: "A", reason: "territory_control" };
  }
  if (pctB >= TERRITORY_THRESHOLD) {
    return { winner: "B", reason: "territory_control" };
  }

  if (state.turn >= 50) {
    if (pctA > pctB) {
      return { winner: "A", reason: "turn_cap" };
    }
    if (pctB > pctA) {
      return { winner: "B", reason: "turn_cap" };
    }
    return { winner: "draw", reason: "turn_cap" };
  }

  return { winner: null, reason: null };
}
