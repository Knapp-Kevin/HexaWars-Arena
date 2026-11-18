/**
 * The one Frontier five-role combat profile. The published role attributes
 * (HP, strength, speed, range) are retained, while damage is deliberately
 * scaled for multi-exchange tactics instead of instant mutual eliminations.
 *
 * FROZEN: legacy resolveCombat remains untouched for archived replays.
 */
import type {HexCell,Unit} from "../shared/types.ts";
import {distance} from "./coords.ts";

export const FRONTIER_ROLE_SPECIALS={
  scout:"Reveals clear hexes up to four tiles away",
  raider:"First successful hit deals one extra damage",
  interceptor:"Counterattack deals one extra damage in melee",
  siege:"Attack at range two; cannot move and fire in one round",
  captain:"Adjacent friendly squads take one less damage",
} as const;

export type FrontierCombatDetails={
  attackerHp:number;
  defenderHp:number;
  damageDealt:number;
  counterDamage:number;
  destroyed:string[];
  raiderFirstStrike:boolean;
  captainProtection:boolean;
  interceptorCounter:boolean;
};

export function resolveFrontierRoleCombat(
  attacker:Unit,
  defender:Unit,
  terrain:HexCell["terrain"],
  units:readonly Unit[],
  raiderPreviouslyStruck:boolean,
  aimPenalty:number=0,
):FrontierCombatDetails{
  const adjacent=distance(attacker.position,defender.position)<=1;
  const raiderFirstStrike=attacker.type==="raider"&&!raiderPreviouslyStruck;
  const captainProtection=units.some(u=>
    u.type==="captain"&&u.owner===defender.owner&&
    u.id!==defender.id&&u.hp>0&&
    distance(u.position,defender.position)===1);
  const forestProtection=terrain==="forest"?1:0;
  // Strength is a combat rating, not direct hit-point damage. These are
  // explicit new role-profile mechanics, never applied to old replays.
  const rated=Math.max(1,Math.ceil(attacker.strength/2));
  const accurate=Math.max(1,Math.round(rated*(1-aimPenalty)));
  const damageDealt=Math.max(1,accurate+(raiderFirstStrike?1:0)-
    forestProtection-(captainProtection?1:0));
  const interceptorCounter=adjacent&&defender.type==="interceptor";
  const counterDamage=adjacent
    ?Math.max(1,Math.ceil(defender.strength/3)+(interceptorCounter?1:0))
    :0;
  let defenderHp=Math.max(0,defender.hp-damageDealt);
  const attackerHp=Math.max(0,attacker.hp-counterDamage);
  const destroyed:string[]=[];
  if(defenderHp===0&&attackerHp===0){
    // Preserve defender-favored mutual-lethal doctrine, but do it with a
    // living 1-HP survivor, not a zero-HP ghost.
    defenderHp=1;
    destroyed.push(attacker.id);
  }else{
    if(defenderHp===0)destroyed.push(defender.id);
    if(attackerHp===0)destroyed.push(attacker.id);
  }
  return {attackerHp,defenderHp,damageDealt,counterDamage,destroyed,
    raiderFirstStrike,captainProtection,interceptorCounter};
}
