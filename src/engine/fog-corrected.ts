/**
 * Versioned, rotation-equivariant line-of-sight for experimental Frontier v3.
 *
 * FROZEN: src/engine/fog.ts remains the replay-compatible legacy algorithm.
 * Its Math.round-per-coordinate ray creates non-cube midpoints and falsely
 * blocks unobstructed lines. This module fixes that only for opted-in v3.
 */
import type { CubeCoord, HexCell } from "../shared/types.ts";
import { distance } from "./coords.ts";

function key(p:CubeCoord):string {return `${p.q},${p.r},${p.s}`;}
function oppositeSafeRound(n:number):number {
  // Math.round is NOT odd around zero: round(-0.5) === -0.
  // Sign-symmetric rounding keeps a rotated ray exactly mirrored.
  return n<0?-Math.floor(-n+0.5):Math.floor(n+0.5);
}
function cubeRoundSymmetric(
  q:number,r:number,s:number,
):CubeCoord {
  let qi=oppositeSafeRound(q),ri=oppositeSafeRound(r),si=oppositeSafeRound(s);
  const dq=Math.abs(qi-q),dr=Math.abs(ri-r),ds=Math.abs(si-s);
  // Fix the coordinate with greatest rounding error. Fixed axis tie-order
  // is independent of the sign, so rotating 180 degrees commutes with
  // rounding even for exactly half-hex intersections.
  if(dq>=dr&&dq>=ds) qi=-ri-si;
  else if(dr>=ds)ri=-qi-si;
  else si=-qi-ri;
  // Keep canonical JS +0 in all cube coordinates, including exact midpoint
  // corrections: Object.is(-0,0) differs, and replay serialization should not.
  return {q:qi===0?0:qi,r:ri===0?0:ri,s:si===0?0:si};
}

/** All ray points are real cube cells and commute with 180° rotation. */
export function cubeLineSymmetric(
  from:CubeCoord,to:CubeCoord,
):CubeCoord[]{
  const steps=distance(from,to);
  if(!Number.isSafeInteger(steps)||steps<0)throw new Error("Non-cube ray endpoints");
  if(steps===0)return [{...from}];
  return Array.from({length:steps+1},(_,i)=>{
    const t=i/steps;
    return cubeRoundSymmetric(
      from.q+(to.q-from.q)*t,
      from.r+(to.r-from.r)*t,
      from.s+(to.s-from.s)*t,
    );
  });
}

function transparent(cell:HexCell|undefined):boolean {
  return cell!==undefined&&cell.terrain!=="forest"&&cell.terrain!=="mountain";
}

/**
 * New fog projection. Keep the original radius-3 and blocking rules; alter
 * only invalid cube-ray rounding and reject already-dead observer units.
 * The output never contains cells beyond the actual authoritative board.
 */
export function visibleCellsSymmetric(
  board:HexCell[][],side:"A"|"B",extendedScoutVision=false,
):CubeCoord[]{
  const cells=board.flat();
  const indexed=new Map(cells.map(c=>[key(c.position),c]));
  const friendly=cells.filter(c=>c.unit?.owner===side&&c.unit.hp>0);
  const known=new Map<string,CubeCoord>();
  for(const originCell of friendly){
    const origin=originCell.position;
    const visionRadius=extendedScoutVision&&originCell.unit?.type==="scout"?4:3;
    for(const targetCell of cells){
      const target=targetCell.position;
      if(distance(origin,target)>visionRadius)continue;
      if(key(origin)!==key(target)){
        if(!transparent(targetCell))continue;
        const line=cubeLineSymmetric(origin,target);
        if(line.slice(1).some(p=>!transparent(indexed.get(key(p)))))continue;
      }
      known.set(key(target),{...target});
    }
  }
  return [...known.values()];
}
