/**
 * Single authoritative construction for NEW Frontier five-role matches.
 *
 * Pure and byte-identical in Bun runner and built browser practice. Historical
 * createMatch(seed) and original 81-cell replay constructor remain untouched.
 * No Node crypto or browser globals: the same source is compiled for both.
 */
import type { MatchState } from "../shared/types.ts";
import { initFrontierBoard } from "./board.ts";
import { placeFrontierRoleUnits,getAllUnits } from "./units.ts";
import { ROUND_CAP } from "./constants.ts";

export const ACTIVE_FRONTIER_RULES_VERSION = "hexawars-frontier127-five-roles-v1";
export const ACTIVE_FRONTIER_TOPOLOGY = "frontier127";

/** FNV-1a seed hashing exactly as the existing match/practice v1 codec. */
export function numericFrontierSeed(seed:string):number{
  if(typeof seed!=="string"||seed.length===0)throw new Error("Match seed required");
  let h=2166136261>>>0;
  for(let i=0;i<seed.length;i++){
    h^=seed.charCodeAt(i);
    h=Math.imul(h,16777619)>>>0;
  }
  return h>>>0;
}

/**
 * Every new 5v5 match begins with the same 127 terrain cells, mirrored
 * one-of-each role deployments, budget-independent match state and first-hit
 * ledger. Deadline is relative per round, not a wall clock to leak in seeds.
 */
export function createFrontierRoleMatch(seed:string):MatchState{
  const board=initFrontierBoard(numericFrontierSeed(seed));
  placeFrontierRoleUnits(board);
  return {
    turn:0,
    visible:board.flat(),
    units:getAllUnits(board),
    score:{a:0,b:0},
    deadline:120000,
    roundCap:ROUND_CAP,
    frontierRaiderStrikes:[],
  };
}
