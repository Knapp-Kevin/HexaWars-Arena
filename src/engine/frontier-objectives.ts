/**
 * The ONE current Frontier battlefield has five authored, rotation-balanced
 * control sites. Ownership is persistent after a squad leaves, and changes
 * only through living occupancy or the original 4-of-6 surround condition.
 *
 * Unlike the archived 60%-of-127 transient-cell implementation, three of
 * five authored sites (60%) is attainable with five squads and two moves
 * per turn. Capturing/holding has real costs: the enemy can reclaim sites.
 *
 * Historical constructors/round resolvers are deliberately untouched.
 */
import type { CubeCoord, EngineEvent, HexCell, MatchState, Unit } from "../shared/types.ts";
import { distance } from "./coords.ts";

export const FRONTIER_OBJECTIVES = [
  {q:-3,r:0,s:3}, {q:-2,r:2,s:0},
  {q:0,r:0,s:0},
  {q:2,r:-2,s:0}, {q:3,r:0,s:-3},
] as const satisfies readonly CubeCoord[];
export const FRONTIER_OBJECTIVE_MAJORITY = 3;
export const FRONTIER_OBJECTIVE_HOLD_ROUNDS = 3;

const key=(pos:CubeCoord)=>pos.q+","+pos.r+","+pos.s;
const objectiveKeys=new Set(FRONTIER_OBJECTIVES.map(key));

export function markFrontierObjectives(cells:HexCell[]):HexCell[]{
  if(cells.length!==127)throw new Error("Frontier objective model requires 127 hexes");
  const byKey=new Map(cells.map(cell=>[key(cell.position),cell]));
  if(byKey.size!==cells.length)throw new Error("Duplicate Frontier hex coordinates");
  for(const pos of FRONTIER_OBJECTIVES){
    const cell=byKey.get(key(pos));
    if(!cell||cell.terrain==="water"||cell.terrain==="mountain"||
      cell.unit!==undefined){
      throw new Error("Frontier objective site not neutral and traversable");
    }
  }
  return cells.map(cell=>objectiveKeys.has(key(cell.position))
    ?{...cell,frontierObjective:true as const}:cell);
}

export function updateFrontierObjectives(state:MatchState):{
  state:MatchState;events:EngineEvent[];
}{
  if(!state.frontierObjectiveHold)
    throw new Error("Objective resolver requires explicit versioned state");
  const sites=state.visible.filter(c=>c.frontierObjective===true);
  if(sites.length!==FRONTIER_OBJECTIVES.length||
      sites.some(c=>!objectiveKeys.has(key(c.position))))
    throw new Error("Invalid authored Frontier objective footprint");

  // Use LIVE authoritative units, never embedded cell.unit snapshots. Moves,
  // retaliation and reserve triggers may already have killed or moved units.
  const living=state.units.filter(u=>u.hp>0);
  const byPos=new Map(living.map(u=>[key(u.position),u]));
  const events:EngineEvent[]=[];
  const visible=state.visible.map(cell=>{
    if(!cell.frontierObjective)return cell;
    const unit=byPos.get(key(cell.position));
    let owner:"A"|"B"|undefined=unit?.owner;
    if(!owner){
      const a=living.filter(u=>u.owner==="A"&&distance(u.position,cell.position)===1).length;
      const b=living.filter(u=>u.owner==="B"&&distance(u.position,cell.position)===1).length;
      if(a>=4&&b<4)owner="A";
      if(b>=4&&a<4)owner="B";
    }
    // Unoccupied, uncontested sites retain previous ownership. Capturing
    // a site changes its public owner, even if an older owner moved away.
    owner??=cell.controlledBy;
    if(owner===cell.controlledBy)return cell;
    events.push({
      type:"territory_claimed",
      payload:{position:{...cell.position},owner,previousOwner:cell.controlledBy??null,
        kind:"frontier_objective"},
      timestamp:0,
    });
    return {...cell,controlledBy:owner};
  });
  const claimed=visible.filter(c=>c.frontierObjective);
  const a=claimed.filter(c=>c.controlledBy==="A").length;
  const b=claimed.filter(c=>c.controlledBy==="B").length;
  const hold={
    a:a>=FRONTIER_OBJECTIVE_MAJORITY?state.frontierObjectiveHold.a+1:0,
    b:b>=FRONTIER_OBJECTIVE_MAJORITY?state.frontierObjectiveHold.b+1:0,
  };
  return {
    state:{...state,visible,score:{a,b},frontierObjectiveHold:hold},
    events,
  };
}
