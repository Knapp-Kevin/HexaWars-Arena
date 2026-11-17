/**
 * Pure interpolation between sequential, sanitized public replay snapshots.
 * These are visual transitions only. They do not reconstruct authoritative
 * movement paths, fogged actions, attacks, or hit timing.
 */
import { axialToWorld } from "./battlefield-geometry.mjs";

export const REPLAY_TWEEN_MS = 720;
export function createReplayTransition(from, to) {
  const previous=new Map((from?.board?.units??[]).map(unit=>[unit.id,unit]));
  const moves=[];
  const hits=[];
  for(const unit of to?.board?.units??[]){
    const before=previous.get(unit.id);
    if(!before||before.side!==unit.side)continue;
    if(before.q!==unit.q||before.r!==unit.r){
      const [x0,z0]=axialToWorld(before),[x1,z1]=axialToWorld(unit);
      moves.push({id:unit.id,x0,z0,x1,z1});
    }
    if(Number.isFinite(before.hp)&&Number.isFinite(unit.hp)&&unit.hp<before.hp){
      hits.push({id:unit.id,damage:before.hp-unit.hp});
    }
  }
  return {moves,hits, duration:REPLAY_TWEEN_MS};
}
export function tweenReplay(transition, fraction) {
  const t=Math.max(0,Math.min(1,Number(fraction)||0));
  const ease=t*t*(3-2*t);
  const poses=Object.create(null);
  for(const move of transition.moves){
    poses[move.id]={
      x:move.x0+(move.x1-move.x0)*ease,
      z:move.z0+(move.z1-move.z0)*ease,
      lift:.13*Math.sin(Math.PI*t),
    };
  }
  for(const hit of transition.hits){
    const pose=poses[hit.id]??{};
    pose.hit=Math.sin(Math.PI*t)*Math.min(1,hit.damage*.6);
    poses[hit.id]=pose;
  }
  return poses;
}
