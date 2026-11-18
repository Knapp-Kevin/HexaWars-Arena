import {describe,it,expect} from "bun:test";
import {createFrontierRoleMatch,createFrontierObjectiveMatch,
  ARCHIVED_FRONTIER_ROLES_VERSION,ACTIVE_FRONTIER_RULES_VERSION}
  from "../../src/engine/frontier-match.ts";
import {FRONTIER_OBJECTIVES,markFrontierObjectives,updateFrontierObjectives,
  FRONTIER_OBJECTIVE_MAJORITY,FRONTIER_OBJECTIVE_HOLD_ROUNDS}
  from "../../src/engine/frontier-objectives.ts";
import {runFrontierRoleRound,runFrontierObjectiveRound}
  from "../../src/engine/roundDriver.ts";
import {checkVictory} from "../../src/engine/victory.ts";
import {newBudget} from "../../src/engine/round-state.ts";
import {projectSeatObservation} from "../../src/gateway/observation.ts";
import type {CubeCoord,MatchState,Unit,FrontierRoundPlan} from "../../src/shared/types.ts";

const key=(pos:CubeCoord)=>pos.q+","+pos.r+","+pos.s;
const same=(a:CubeCoord,b:CubeCoord)=>key(a)===key(b);
const pass:FrontierRoundPlan={bid:0,extras:[]};
function placeOnObjectives(seed:string,amount=3):MatchState{
  const state=createFrontierObjectiveMatch(seed);
  const a=state.units.filter(u=>u.owner==="A");
  // True engine state units drive objective capture. Embedded cell.unit
  // deliberately remains stale to prove it is never trusted for claims.
  const relocated=state.units.map(u=>{
    const i=a.findIndex(v=>v.id===u.id);
    return i>=0&&i<amount?
      {...u,position:{...FRONTIER_OBJECTIVES[i]}}:u;
  });
  return {...state,units:relocated};
}
describe("single Frontier five-site strategic control",()=>{
  it("creates the exact same 127 hex terrain and armies as v1 with 5 authored valid sites",()=>{
    expect(ACTIVE_FRONTIER_RULES_VERSION).toBe("hexawars-frontier127-objectives-v2");
    expect(ARCHIVED_FRONTIER_ROLES_VERSION).toBe("hexawars-frontier127-five-roles-v1");
    expect(FRONTIER_OBJECTIVE_MAJORITY).toBe(3);
    expect(FRONTIER_OBJECTIVE_HOLD_ROUNDS).toBe(3);
    const pairs=new Set(FRONTIER_OBJECTIVES.map(p=>key({
      q:-p.q,r:-p.r,s:-p.s,
    })));
    expect(pairs).toEqual(new Set(FRONTIER_OBJECTIVES.map(key)));
    for(let i=0;i<64;i++){
      const seed="objective-mirror-"+i;
      const old=createFrontierRoleMatch(seed);
      const game=createFrontierObjectiveMatch(seed);
      expect(game.visible.length).toBe(127);
      expect(game.units).toEqual(old.units);
      expect(game.visible.map(c=>[c.position,c.terrain,c.unit]))
        .toEqual(old.visible.map(c=>[c.position,c.terrain,c.unit]));
      expect(game.visible.filter(c=>c.frontierObjective).length).toBe(5);
      expect(game.visible.filter(c=>c.frontierObjective).every(c=>
        c.terrain!=="mountain"&&c.terrain!=="water"&&!c.unit)).toBe(true);
      expect(game.score).toEqual({a:0,b:0});
      expect(game.frontierObjectiveHold).toEqual({a:0,b:0});
      expect(old.frontierObjectiveHold).toBeUndefined();
      expect(old.visible.some(c=>c.frontierObjective)).toBe(false);
      const a=projectSeatObservation(game,"A","frontier-five-roles-v1");
      const b=projectSeatObservation(game,"B","frontier-five-roles-v1");
      expect(a.frontierObjectiveHold).toEqual({a:0,b:0});
      expect(b.frontierObjectiveHold).toEqual({a:0,b:0});
      expect(a.units.every(u=>u.owner==="A")).toBe(true);
      expect(b.units.every(u=>u.owner==="B")).toBe(true);
    }
  });
  it("refuses forged footprints, duplicate cells and non-objective state",()=>{
    const g=createFrontierObjectiveMatch("objective-validation");
    expect(()=>markFrontierObjectives(g.visible.slice(0,126))).toThrow();
    expect(()=>markFrontierObjectives(g.visible.map((c,i)=>i===1?
      {...c,position:{...g.visible[0].position}}:c))).toThrow();
    const old=createFrontierRoleMatch("objective-validation");
    expect(()=>updateFrontierObjectives(old)).toThrow("requires explicit versioned state");
    expect(()=>runFrontierObjectiveRound({matchId:"old",round:0,state:old,
      planA:pass,planB:pass,budgetA:newBudget(),budgetB:newBudget()}))
      .toThrow("requires the v2 Frontier match");
  });
  it("actually captures 3/5, emits only genuine transitions, wins on third completed round",()=>{
    let state=placeOnObjectives("three-round-objective-winner");
    let budgetA=newBudget(),budgetB=newBudget();
    for(let turn=0;turn<3;turn++){
      const result=runFrontierObjectiveRound({
        matchId:"objective-three",round:turn,state,planA:pass,planB:pass,
        budgetA,budgetB,
      });
      state=result.nextState;budgetA=result.nextBudgetA;budgetB=result.nextBudgetB;
      expect(state.score).toEqual({a:3,b:0});
      expect(state.frontierObjectiveHold).toEqual({a:turn+1,b:0});
      const claims=result.events.filter(e=>e.type==="territory_claimed");
      expect(claims.length).toBe(turn===0?3:0);
      expect(claims.every(e=>e.payload.owner==="A")).toBe(true);
      expect(result.ended).toBe(turn===2);
    }
    expect(checkVictory(state)).toEqual({winner:"A",reason:"territory_control"});
    const original=createFrontierRoleMatch("three-round-objective-winner");
    expect(original.visible.some(c=>c.controlledBy)).toBe(false);
    expect(original.score).toEqual({a:0,b:0});
  });
  it("owner persists when unit moves away; opponent capture flips and resets hold",()=>{
    const state=placeOnObjectives("persistent-control");
    const first=updateFrontierObjectives(state).state;
    const home=createFrontierObjectiveMatch("persistent-control");
    // Redeploy each A squad to its own genuine legal starting location, no
    // doubled positions or unit-occupancy inventions in the test fixture.
    const vacated={...first,units:first.units.map(u=>u.owner==="A"
      ?{...u,position:{...home.units.find(x=>x.id===u.id)!.position}}:u)};
    // An abandoned objective should NOT spontaneously revert to neutral.
    const after=updateFrontierObjectives(vacated).state;
    expect(after.score.a).toBe(3);
    const old=first.visible.find(c=>same(c.position,FRONTIER_OBJECTIVES[0]))!;
    const defender=after.units.find(u=>u.owner==="B")!;
    const flipped=updateFrontierObjectives({...after,
      units:after.units.map(u=>u.id===defender.id
        ?{...u,position:{...FRONTIER_OBJECTIVES[0]}}:u)}).state;
    expect(old.controlledBy).toBe("A");
    expect(flipped.visible.find(c=>same(c.position,FRONTIER_OBJECTIVES[0]))?.controlledBy)
      .toBe("B");
    expect(flipped.score).toEqual({a:2,b:1});
    expect(flipped.frontierObjectiveHold?.a).toBe(0);
  });
  it("dead units do not capture and forged embedded cell.unit does not control",()=>{
    const state=placeOnObjectives("dead-control");
    const killed={...state,units:state.units.map(u=>u.owner==="A"?{...u,hp:0}:u)};
    const claimed=updateFrontierObjectives(killed);
    expect(claimed.state.score.a).toBe(0);
    expect(claimed.events.filter(e=>e.type==="territory_claimed")).toEqual([]);
    const fake={...state,units:state.units.map(u=>u.owner==="A"?{...u,hp:0}:u),
      visible:state.visible.map(c=>c.frontierObjective
        ?{...c,unit:state.units.find(u=>u.owner==="A")}:c)};
    expect(updateFrontierObjectives(fake).state.score.a).toBe(0);
  });
  it("half-controlled objectives cannot trigger a phantom win, and the round cap scores real sites",()=>{
    const base=createFrontierObjectiveMatch("objective-cap");
    const state:MatchState={...base,turn:49,
      visible:base.visible.map((c,i)=>({...c,controlledBy:c.frontierObjective
        ?(c.position.q<0?"A":c.position.q>0?"B":undefined):undefined})),
      frontierObjectiveHold:{a:2,b:2}};
    const checked=updateFrontierObjectives(state).state;
    expect(checked.score).toEqual({a:2,b:2});
    expect(checkVictory(checked)).toEqual({winner:null,reason:null});
    expect(checkVictory({...checked,turn:50})).toEqual({winner:"draw",reason:"turn_cap"});
    const decisive={...checked,turn:50,
      visible:checked.visible.map(c=>c.frontierObjective&&c.position.q===0
        ?{...c,controlledBy:"A" as const}:c)};
    expect(checkVictory(decisive)).toEqual({winner:"A",reason:"turn_cap"});
  });
  it("the frozen v1 5-role resolver has no objective semantics",()=>{
    const old=createFrontierRoleMatch("archived-five-roles");
    const v1=runFrontierRoleRound({
      matchId:"historical-v1",round:0,state:old,planA:pass,planB:pass,
      budgetA:newBudget(),budgetB:newBudget(),
    });
    expect(v1.nextState.frontierObjectiveHold).toBeUndefined();
    expect(v1.nextState.visible.some(c=>c.frontierObjective)).toBe(false);
    expect(v1.events.some(e=>e.type==="territory_claimed")).toBe(false);
  });
});
