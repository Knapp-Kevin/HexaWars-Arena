import type { MatchState, RoundPlan, CubeCoord } from "../../shared/types";
import { MOVE_POINTS } from "../../engine/constants.ts";

/**
 * Round-plan move validation.
 *
 * The resolver intentionally trusts accepted plans (R4). Therefore it is
 * essential that the submitted origin is the CURRENT owned unit coordinate,
 * that the destination is on the actual selected board, and that a real
 * traversable path exists. A radius-8 cube envelope is not a board.
 */
export type MovePathResult = { ok: true } | { ok: false; reason: string };
type MoveState = Pick<MatchState, "units" | "visible">;
const DIRECTIONS: readonly CubeCoord[] = [
  { q: 1, r: -1, s: 0 }, { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 }, { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 }, { q: 0, r: -1, s: 1 },
];
function validCube(value: unknown): value is CubeCoord {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Partial<CubeCoord>;
  return Number.isSafeInteger(p.q) && Number.isSafeInteger(p.r) &&
    Number.isSafeInteger(p.s) && p.q! + p.r! + p.s! === 0;
}
function key(p: CubeCoord): string { return `${p.q},${p.r}`; }
function same(a: CubeCoord,b: CubeCoord): boolean {
  return a.q === b.q && a.r === b.r && a.s === b.s;
}
function distance(a: CubeCoord,b: CubeCoord): number {
  return Math.max(Math.abs(a.q-b.q),Math.abs(a.r-b.r),Math.abs(a.s-b.s));
}
function broadEnvelope(p: CubeCoord): boolean {
  return Math.max(Math.abs(p.q),Math.abs(p.r),Math.abs(p.s)) <= 8;
}

/**
 * Deterministic shortest traversable route, excluding the starting position.
 * Returns null when terrain, units or the actual 61/81 cell footprint blocks
 * the route. This is bounded by board size, not raw user-supplied coordinates.
 */
export function findTraversablePath(
  state: MoveState, from: CubeCoord, to: CubeCoord, unitId: string,
): CubeCoord[] | null {
  if (!validCube(from) || !validCube(to) || !state.visible?.length) return null;
  const cells = new Map(state.visible.map(c=>[key(c.position),c]));
  const destination = cells.get(key(to));
  if (!destination || destination.terrain==="water" || destination.terrain==="mountain") return null;
  const occupied = new Set(state.units.filter(u=>u.id!==unitId).map(u=>key(u.position)));
  if (occupied.has(key(to))) return null;
  if (!cells.has(key(from))) return null;
  const seen=new Set([key(from)]);
  const queue: Array<{at:CubeCoord;path:CubeCoord[]}>=[{at:from,path:[]}];
  let head=0;
  while(head<queue.length){
    const {at,path}=queue[head++];
    if(same(at,to)) return path;
    for(const dir of DIRECTIONS){
      const next={q:at.q+dir.q,r:at.r+dir.r,s:at.s+dir.s};
      const k=key(next),cell=cells.get(k);
      if(seen.has(k)||!cell||cell.terrain==="water"||cell.terrain==="mountain"||occupied.has(k))
        continue;
      seen.add(k);
      queue.push({at:next,path:[...path,next]});
    }
  }
  return null;
}

export function validateMovePath(
  plan: RoundPlan, _agent: "A" | "B", state: MoveState,
): MovePathResult {
  const move=plan.freeMove;
  if (!move) return {ok:true};
  if (!validCube(move.from)||!broadEnvelope(move.from))
    return {ok:false,reason:"move_from_off_board"};
  if (!validCube(move.to)||!broadEnvelope(move.to))
    return {ok:false,reason:"move_to_off_board"};
  if (same(move.from,move.to))
    return {ok:false,reason:"move_from_equals_to"};

  const unit=state.units.find(u=>u.id===move.unitId);
  if (!unit) return {ok:false,reason:`unit_not_found:${move.unitId}`};
  if(unit.hp<=0)return {ok:false,reason:"move_unit_destroyed"};
  if(!same(move.from,unit.position))
    return {ok:false,reason:"move_from_mismatch"};

  const range=MOVE_POINTS[unit.type];
  const dist=distance(move.from,move.to);
  if(dist!==range)return {ok:false,reason:`move_distance_wrong:got${dist}want${range}`};

  const cells=new Map((state.visible??[]).map(c=>[key(c.position),c]));
  if(!cells.size)return {ok:false,reason:"move_board_unavailable"};
  const target=cells.get(key(move.to));
  if(!target)return {ok:false,reason:"move_destination_off_board"};
  if(target.terrain==="water"||target.terrain==="mountain")
    return {ok:false,reason:"move_destination_blocked"};
  const occupied=new Set(state.units.filter(u=>u.id!==unit.id).map(u=>key(u.position)));
  if(occupied.has(key(move.to)))
    return {ok:false,reason:"move_destination_occupied"};

  if(move.path!==undefined){
    if(!Array.isArray(move.path))return {ok:false,reason:"move_path_malformed"};
    const steps=move.path.length>0&&validCube(move.path[0])&&same(move.path[0],move.from)
      ?move.path.slice(1):move.path;
    if(steps.length!==range)return {ok:false,reason:"move_path_wrong_length"};
    let cursor=move.from;
    for(const step of steps){
      if(!validCube(step)||distance(cursor,step)!==1)
        return {ok:false,reason:"move_path_nonadjacent"};
      const cell=cells.get(key(step));
      if(!cell||cell.terrain==="water"||cell.terrain==="mountain"||occupied.has(key(step)))
        return {ok:false,reason:"move_path_step_blocked"};
      cursor=step;
    }
    if(!same(cursor,move.to))return {ok:false,reason:"move_path_target_mismatch"};
  }else{
    const path=findTraversablePath(state,unit.position,move.to,unit.id);
    if(!path||path.length!==range)return {ok:false,reason:"move_path_blocked"};
  }
  return {ok:true};
}
