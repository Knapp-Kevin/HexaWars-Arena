import {describe,expect,test} from "bun:test";
import {initFrontierBoard} from "../../src/engine/board.ts";
import {createUnit,createFrontierRoleUnit,getAllUnits,placeFrontierRoleUnits,FRONTIER_ROLES} from "../../src/engine/units.ts";
import {RANGE,MOVE_POINTS} from "../../src/engine/constants.ts";
import {resolveFrontierRoleCombat,FRONTIER_ROLE_SPECIALS} from "../../src/engine/frontier-role-combat.ts";
import {visibleCellsSymmetric} from "../../src/engine/fog-corrected.ts";
import {validateFrontierRoundPlan} from "../../src/gateway/frontier-round-validator.ts";
import {runFrontierRoleRound,runFrontierRound} from "../../src/engine/roundDriver.ts";
import {newBudget} from "../../src/engine/round-state.ts";
import type {CubeCoord,HexCell,MatchState,Unit,FrontierRoundPlan} from "../../src/shared/types.ts";

const p=(q:number,r:number):CubeCoord=>({q:q||0,r:r||0,s:-(q+r)||0});
const same=(a:CubeCoord,b:CubeCoord)=>a.q===b.q&&a.r===b.r;
const troop=(owner:"A"|"B",role:Unit["type"],q:number,r:number):Unit=>({
  ...(FRONTIER_ROLES.some(r=>r===role)
    ?createFrontierRoleUnit(owner,p(q,r),role as typeof FRONTIER_ROLES[number])
    :createUnit(owner,p(q,r),role)),
  id:owner+role+q+":"+r,
});
function arena(units:Unit[]):MatchState{
  const board=initFrontierBoard(12).flat().map(c=>({...c,terrain:"plain" as const,
    unit:units.find(u=>same(c.position,u.position))}));
  return {turn:0,visible:board,units,score:{a:0,b:0},
    deadline:123456,roundCap:50,frontierRaiderStrikes:[]};
}
const coordKey=(c:CubeCoord)=>c.q+","+c.r;

describe("one Frontier battle with five genuine tactical classes",()=>{
  test("all seeded 127-hex matchups have exactly one of each role on both sides",()=>{
    const roster=[...FRONTIER_ROLES].sort();
    for(let i=0;i<64;i++){
      const board=initFrontierBoard(i*97+1);
      placeFrontierRoleUnits(board);
      const units=getAllUnits(board);
      expect(units.length).toBe(10);
      const ids=new Set(units.map(u=>u.id));
      expect(ids.size).toBe(10);
      for(const side of ["A","B"] as const){
        const own=units.filter(u=>u.owner===side);
        expect(own.length).toBe(5);
        expect(own.map(u=>u.type).sort()).toEqual(roster);
        for(const u of own){
          const mirrored=units.find(e=>e.owner!==side&&e.type===u.type);
          expect(mirrored).toBeDefined();
          expect(mirrored!.position.q).toBe(-u.position.q);
          expect(mirrored!.position.r).toBe(-u.position.r);
          expect(mirrored!.hp).toBe(u.hp);
          expect(mirrored!.strength).toBe(u.strength);
          expect(mirrored!.weight).toBe(u.weight);
          expect(["water","mountain"].includes(
            board.flat().find(c=>same(c.position,u.position))?.terrain??"water"))
            .toBe(false);
        }
      }
    }
  });

  test("canonical Scout, Raider, Interceptor, Siege and Captain stats match original role brief",()=>{
    expect([["scout",2,1,5,5],["raider",2,1,5,5],
      ["interceptor",1,1,6,6],["siege",1,2,6,6],
      ["captain",1,1,7,7]]).toEqual([
      ...FRONTIER_ROLES.map(role=>{
        const u=troop("A",role,0,0);
        return [role,MOVE_POINTS[role],RANGE[role],u.hp,u.strength];
      }),
    ]);
    expect(Object.keys(FRONTIER_ROLE_SPECIALS).sort()).toEqual([...FRONTIER_ROLES].sort());
  });

  test("Scout alone sees up to four open hexes; the corrected three-hex role baseline remains intact",()=>{
    const origin=p(0,0),target=p(4,0);
    const build=(type:Unit["type"])=>{
      const unit=troop("A",type,0,0);
      const board:HexCell[][]=[arena([unit]).visible];
      return {unit,board};
    };
    const scout=build("scout"),raider=build("raider");
    const seen=new Set(visibleCellsSymmetric(scout.board,"A",true).map(coordKey));
    expect(seen.has(coordKey(target))).toBe(true);
    const notOpted=new Set(visibleCellsSymmetric(scout.board,"A").map(coordKey));
    expect(notOpted.has(coordKey(target))).toBe(false);
    const other=new Set(visibleCellsSymmetric(raider.board,"A",true).map(coordKey));
    expect(other.has(coordKey(target))).toBe(false);
    const blocked=scout.board[0].find(c=>same(c.position,p(2,0)))!;
    blocked.terrain="forest";
    expect(visibleCellsSymmetric(scout.board,"A",true).some(c=>same(c,target))).toBe(false);
  });

  test("Raider first successful attack deals one bonus damage, then expires",()=>{
    const raider=troop("A","raider",-1,0),enemy=troop("B","captain",0,0);
    const first=resolveFrontierRoleCombat(raider,enemy,"plain",[raider,enemy],false);
    const repeat=resolveFrontierRoleCombat(raider,enemy,"plain",[raider,enemy],true);
    expect(first.raiderFirstStrike).toBe(true);
    expect(first.damageDealt).toBe(repeat.damageDealt+1);
    const game=arena([raider,enemy]);
    const pass={bid:0,extras:[]};
    const attack={bid:0,extras:[],freeAction:{
      type:"attack" as const,unitId:raider.id,
      from:raider.position,to:enemy.position,
    }};
    const firstRound=runFrontierRoleRound({matchId:"five-raider-1",
      round:0,state:game,planA:attack,planB:pass,
      budgetA:newBudget(),budgetB:newBudget()});
    expect(firstRound.nextState.frontierRaiderStrikes).toContain(raider.id);
    expect(firstRound.events.filter(e=>e.type==="ability_resolved"&&
      e.payload.ability==="first_strike").length).toBe(1);
    const raider2=firstRound.nextState.units.find(u=>u.id===raider.id);
    const target2=firstRound.nextState.units.find(u=>u.id===enemy.id);
    expect(raider2).toBeDefined();
    expect(target2).toBeDefined();
    const secondRound=runFrontierRoleRound({matchId:"five-raider-1",
      round:1,state:firstRound.nextState,planA:{
        ...attack,freeAction:{...attack.freeAction,from:raider2!.position,to:target2!.position},
      },planB:pass,
      budgetA:firstRound.nextBudgetA,budgetB:firstRound.nextBudgetB});
    expect(secondRound.events.some(e=>e.type==="ability_resolved"&&
      e.payload.ability==="first_strike")).toBe(false);
  });

  test("Interceptor gets a stronger adjacent counter, never a free long-range counter",()=>{
    const attacker=troop("A","scout",0,0);
    const counter=troop("B","interceptor",1,0);
    const ordinary=troop("B","raider",1,0);
    const result=resolveFrontierRoleCombat(attacker,counter,"plain",[attacker,counter],false);
    const plain=resolveFrontierRoleCombat(attacker,ordinary,"plain",[attacker,ordinary],false);
    expect(result.interceptorCounter).toBe(true);
    expect(result.counterDamage).toBe(plain.counterDamage+1);
    const far=troop("A","siege",-1,0);
    expect(resolveFrontierRoleCombat(far,counter,"plain",[far,counter],false)
      .counterDamage).toBe(0);
  });

  test("Captain aura protects adjacent allies but not distant squads or itself",()=>{
    const atk=troop("A","raider",-1,0);
    const ally=troop("B","scout",0,0);
    const captain=troop("B","captain",0,1);
    const noCaptain=resolveFrontierRoleCombat(atk,ally,"plain",[atk,ally],true);
    const withCaptain=resolveFrontierRoleCombat(atk,ally,"plain",[atk,ally,captain],true);
    expect(withCaptain.captainProtection).toBe(true);
    expect(withCaptain.damageDealt).toBe(noCaptain.damageDealt-1);
    const deadCaptain={...captain,hp:0};
    expect(resolveFrontierRoleCombat(atk,ally,"plain",[atk,ally,deadCaptain],true)
      .captainProtection).toBe(false);
    expect(resolveFrontierRoleCombat(atk,captain,"plain",[atk,captain],true)
      .captainProtection).toBe(false);
  });

  test("Siege cannot move then fire, in either movement wave",()=>{
    const siege=troop("A","siege",-2,0);
    const other=troop("A","scout",-3,2);
    const target=troop("B","captain",0,0);
    const state=arena([siege,other,target]);
    const first={unitId:siege.id,from:siege.position,to:p(-1,0)};
    const otherMove={unitId:other.id,from:other.position,to:p(-3,0)};
    const firing={unitId:siege.id,from:siege.position,to:target.position,type:"attack" as const};
    const plan:FrontierRoundPlan={bid:0,freeMove:first,
      secondMove:otherMove,freeAction:firing,extras:[]};
    expect(validateFrontierRoundPlan(plan,"A",state,newBudget(),true)).toEqual({
      ok:false,reason:"frontier_siege_cannot_move_and_attack",
    });
    expect(validateFrontierRoundPlan({...plan,freeMove:otherMove,
      secondMove:first},"A",state,newBudget(),true)).toEqual({
      ok:false,reason:"frontier_siege_cannot_move_and_attack",
    });
    expect(validateFrontierRoundPlan({bid:0,freeAction:firing,extras:[]},
      "A",state,newBudget(),true)).toEqual({ok:true});
    expect(validateFrontierRoundPlan({bid:0,freeMove:first,extras:[]},
      "A",state,newBudget(),true)).toEqual({ok:true});
  });

  test("role resolution never mutates archived combat or archived round semantics",()=>{
    const ally=troop("A","scout",-1,0),foe=troop("B","raider",0,0);
    const state=arena([ally,foe]);
    const attack={bid:0,extras:[],freeAction:{type:"attack" as const,
      unitId:ally.id,from:ally.position,to:foe.position}};
    const v1=runFrontierRound({matchId:"preserve-v2",round:0,state,
      planA:attack,planB:{bid:0,extras:[]},
      budgetA:newBudget(),budgetB:newBudget()});
    const v4=runFrontierRoleRound({matchId:"new-role-v4",round:0,state,
      planA:attack,planB:{bid:0,extras:[]},
      budgetA:newBudget(),budgetB:newBudget()});
    expect(v1.events.some(e=>e.type==="ability_resolved")).toBe(false);
    expect(v4.nextState.units.find(u=>u.id===foe.id)?.hp)
      .not.toBe(v1.nextState.units.find(u=>u.id===foe.id)?.hp);
    expect(state.frontierRaiderStrikes).toEqual([]);
  });
});
