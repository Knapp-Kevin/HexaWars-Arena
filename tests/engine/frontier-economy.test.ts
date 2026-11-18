import { describe, expect, test } from "bun:test";
import { initFrontierBoard } from "../../src/engine/board.ts";
import { getAllUnits, placeFrontierUnits } from "../../src/engine/units.ts";
import { runRound, runFrontierRound } from "../../src/engine/roundDriver.ts";
import { newBudget, applyFrontierEndOfRound } from "../../src/engine/round-state.ts";
import { validateRoundPlan } from "../../src/gateway/validator.ts";
import { validateFrontierRoundPlan } from "../../src/gateway/frontier-round-validator.ts";
import type {
  CubeCoord, FreeMovePlan, FrontierRoundPlan, MatchState,
} from "../../src/shared/types.ts";

const coord=(q:number,r:number):CubeCoord=>({q,r,s:-q-r});
const same=(a:CubeCoord,b:CubeCoord)=>a.q===b.q&&a.r===b.r&&a.s===b.s;
function opening(seed:number):MatchState {
  const board=initFrontierBoard(seed);
  placeFrontierUnits(board);
  return {turn:0,visible:board.flat(),units:getAllUnits(board),score:{a:0,b:0},
    deadline:120000,roundCap:50};
}
function legalMoves(state:MatchState,side:"A"|"B"):FreeMovePlan[]{
  return state.units.filter(u=>u.owner===side).flatMap(u=>
    state.visible.map(c=>({
      unitId:u.id,from:u.position,to:c.position,
    })).filter(m=>validateRoundPlan({bid:0,freeMove:m,extras:[]},side,
      state,newBudget()).ok));
}
function twoMoves(state:MatchState,side:"A"|"B"):FrontierRoundPlan{
  const moves=legalMoves(state,side);
  for(const first of moves) for(const second of moves){
    if(first.unitId===second.unitId||same(first.to,second.to))continue;
    const plan={bid:0,freeMove:first,secondMove:second,extras:[]};
    if(validateFrontierRoundPlan(plan,side,state,newBudget()).ok)return plan;
  }
  throw new Error("No two independent traversable moves");
}

describe("Frontier maneuver-v2: separate competitive round contract",()=>{
  test("symmetric 127-cell board has two independent legal squad orders for both sides",()=>{
    for(let i=1;i<=10;i++){
      const state=opening(i);
      expect(state.visible.length).toBe(127);
      expect(state.units.filter(u=>u.owner==="A").length).toBe(5);
      expect(state.units.filter(u=>u.owner==="B").length).toBe(5);
      const a=twoMoves(state,"A"),b=twoMoves(state,"B");
      expect(a.freeMove?.unitId).not.toBe(a.secondMove?.unitId);
      expect(b.freeMove?.unitId).not.toBe(b.secondMove?.unitId);
      expect(validateFrontierRoundPlan(a,"A",state,newBudget())).toEqual({ok:true});
      expect(validateFrontierRoundPlan(b,"B",state,newBudget())).toEqual({ok:true});
    }
  });

  test("both sides move in two alternating global waves before any attack",()=>{
    const state=opening(11234);
    const a={...twoMoves(state,"A"),bid:2};
    const b={...twoMoves(state,"B"),bid:0};
    const result=runFrontierRound({
      matchId:"frontier-2move-waves",round:0,state,
      planA:a,planB:b,budgetA:newBudget(),budgetB:newBudget(),
    });
    const movement=result.events.filter(e=>e.type==="unit_moved");
    expect(movement.length).toBe(4);
    expect(movement.map(e=>(e.payload as {agent:string}).agent)).toEqual(["A","B","A","B"]);
    const aUnits=new Set(movement.filter(e=>e.payload.agent==="A").map(e=>e.payload.unitId));
    const bUnits=new Set(movement.filter(e=>e.payload.agent==="B").map(e=>e.payload.unitId));
    expect(aUnits.size).toBe(2);
    expect(bUnits.size).toBe(2);
    expect(result.nextState.turn).toBe(1);
    expect(result.nextBudgetA.apCarry).toBe(1);
    expect(result.nextBudgetB.apCarry).toBe(1);
  });

  test("old runRound never executes the extra move from an untrusted v2-shaped payload",()=>{
    const state=opening(928);
    const a=twoMoves(state,"A");
    const result=runRound({matchId:"old-unchanged",round:0,state,
      planA:a,planB:{bid:0,extras:[]},budgetA:newBudget(),budgetB:newBudget()});
    expect(result.events.filter(e=>e.type==="unit_moved").length).toBe(1);
  });

  test("rejects double-activated unit, claimed destination, forged source, off-board and blocked path",()=>{
    const state=opening(42);
    const a=twoMoves(state,"A");
    expect(validateFrontierRoundPlan({
      ...a,secondMove:{...a.secondMove!,unitId:a.freeMove!.unitId},
    },"A",state,newBudget())).toEqual({ok:false,reason:"frontier_duplicate_move_unit"});
    expect(validateFrontierRoundPlan({
      ...a,secondMove:{...a.secondMove!,to:a.freeMove!.to},
    },"A",state,newBudget())).toEqual({ok:false,reason:"frontier_duplicate_move_destination"});
    expect(validateFrontierRoundPlan({
      ...a,secondMove:{...a.secondMove!,from:coord(99,-99)},
    },"A",state,newBudget()).ok).toBe(false);
    expect(validateFrontierRoundPlan({
      ...a,secondMove:{...a.secondMove!,to:coord(90,0)},
    },"A",state,newBudget()).ok).toBe(false);
    const bUnit=state.units.find(u=>u.owner==="B")!;
    expect(validateFrontierRoundPlan({
      ...a,secondMove:{...a.secondMove!,unitId:bUnit.id,from:bUnit.position},
    },"A",state,newBudget()).ok).toBe(false);
    expect(validateFrontierRoundPlan({
      ...a,extras:[{kind:"second_attack",unitId:a.freeMove!.unitId,to:coord(0,0)}],
    },"A",state,newBudget()).ok).toBe(false);
    expect(validateFrontierRoundPlan({
      ...a,bid:4,
    },"A",state,newBudget()).ok).toBe(false);
  });

  test("a staged second moving squad can fire from its actual projected destination",()=>{
    const state=opening(451);
    state.units=[
      {id:"A1",owner:"A",type:"heavy",weight:3,hp:8,strength:5,position:coord(-2,2)},
      {id:"A2",owner:"A",type:"scout",weight:1,hp:3,strength:2,position:coord(0,0)},
      {id:"B1",owner:"B",type:"infantry",weight:2,hp:5,strength:3,position:coord(4,0)},
    ];
    state.visible=state.visible.map(c=>({...c,terrain:"plain",
      unit:state.units.find(u=>same(u.position,c.position))}));
    const plan:FrontierRoundPlan={bid:1,extras:[],
      freeMove:{unitId:"A1",from:coord(-2,2),to:coord(-1,2)},
      secondMove:{unitId:"A2",from:coord(0,0),to:coord(3,0)},
      freeAction:{type:"attack",unitId:"A2",from:coord(0,0),to:coord(4,0)}};
    expect(validateRoundPlan(plan,"A",state,newBudget()).ok).toBe(false);
    expect(validateFrontierRoundPlan(plan,"A",state,newBudget())).toEqual({ok:true});
    const result=runFrontierRound({matchId:"stage-v2",round:0,state,
      planA:plan,planB:{bid:0,extras:[]},budgetA:newBudget(),budgetB:newBudget()});
    expect(result.events.filter(e=>e.type==="unit_moved").length).toBe(2);
    expect(result.events.some(e=>e.type==="unit_attacked" &&
      e.payload.attackerUnitId==="A2")).toBe(true);
  });

  test("refuses unimplemented abilities rather than accepting a no-op free action",()=>{
    const state=opening(104);
    const unit=state.units.find(u=>u.owner==="A")!;
    const bogus:FrontierRoundPlan={bid:0,extras:[],
      freeAction:{type:"ability",unitId:unit.id,
        from:unit.position,to:unit.position,abilityId:"not-implemented"}};
    expect(validateFrontierRoundPlan(bogus,"A",state,newBudget())).toEqual({
      ok:false,reason:"frontier_ability_not_implemented",
    });
  });

  test("AP is not minted by unused free slots, but bid is consumed",()=>{
    const state=opening(12);
    const pass={bid:0,extras:[]},allIn={bid:3,extras:[]};
    const v2=runFrontierRound({matchId:"v2-ap-no-mint",round:0,state,
      planA:allIn,planB:pass,budgetA:newBudget(),budgetB:newBudget()});
    expect(v2.nextBudgetA.apPool).toBe(0);
    expect(v2.nextBudgetA.apCarry).toBe(0);
    expect(v2.nextBudgetB.apPool).toBe(3);
    expect(v2.nextBudgetB.apCarry).toBe(1);
    expect(v2.events.some(e=>e.type==="slots_refunded")).toBe(false);
    const historical=runRound({matchId:"v1-ap-retain",round:0,state,
      planA:allIn,planB:pass,budgetA:newBudget(),budgetB:newBudget()});
    expect(historical.nextBudgetA.apPool).toBe(2);
    expect(historical.nextBudgetA.apCarry).toBe(1);
    expect(applyFrontierEndOfRound({
      freeMove:1,freeAction:1,apPool:0,apCarry:0,
    }).apCarry).toBe(0);
  });
});
