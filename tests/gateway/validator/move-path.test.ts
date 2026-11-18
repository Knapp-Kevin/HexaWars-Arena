import { test, expect } from "bun:test";
import { validateMovePath } from "../../../src/gateway/validator/move-path";
import type { RoundPlan, MatchState } from "../../../src/shared/types";

function makeState(units: MatchState["units"]): Pick<MatchState, "units" | "visible"> {
  // Real callers validate against the actual versioned board, not an
  // imaginary radius-8 square. Keep the focused legacy test terrain plain.
  const visible: MatchState["visible"]=[];
  for(let r=-4;r<=4;r++)for(let q=-4;q<=4;q++)
    visible.push({position:{q,r,s:-q-r},terrain:"plain"});
  return { units,visible };
}

test("move-path: pass plan is valid", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "infantry" },
  ]);
  expect(validateMovePath({ bid: 0, extras: [] }, "A", state)).toEqual({ ok: true });
});

test("move-path: infantry move distance 2 valid", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "infantry" },
  ]);
  const plan = { bid: 0, freeMove: { unitId: "u1", from: { q: 0, r: 0, s: 0 }, to: { q: 2, r: 0, s: -2 } }, extras: [] };
  expect(validateMovePath(plan as RoundPlan, "A", state)).toEqual({ ok: true });
});

test("move-path: infantry move distance 1 invalid", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "infantry" },
  ]);
  const plan = { bid: 0, freeMove: { unitId: "u1", from: { q: 0, r: 0, s: 0 }, to: { q: 1, r: 0, s: -1 } }, extras: [] };
  expect(validateMovePath(plan as RoundPlan, "A", state)).toEqual({ ok: false, reason: "move_distance_wrong:got1want2" });
});

test("move-path: scout move distance 3 valid", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "scout" },
  ]);
  const plan = { bid: 0, freeMove: { unitId: "u1", from: { q: 0, r: 0, s: 0 }, to: { q: 3, r: 0, s: -3 } }, extras: [] };
  expect(validateMovePath(plan as RoundPlan, "A", state)).toEqual({ ok: true });
});

test("move-path: heavy move distance 1 valid", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "heavy" },
  ]);
  const plan = { bid: 0, freeMove: { unitId: "u1", from: { q: 0, r: 0, s: 0 }, to: { q: 1, r: 0, s: -1 } }, extras: [] };
  expect(validateMovePath(plan as RoundPlan, "A", state)).toEqual({ ok: true });
});

test("move-path: from equals to invalid", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "infantry" },
  ]);
  const plan = { bid: 0, freeMove: { unitId: "u1", from: { q: 0, r: 0, s: 0 }, to: { q: 0, r: 0, s: 0 } }, extras: [] };
  expect(validateMovePath(plan as RoundPlan, "A", state)).toEqual({ ok: false, reason: "move_from_equals_to" });
});

test("move-path: from off board invalid", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "infantry" },
  ]);
  const plan = { bid: 0, freeMove: { unitId: "u1", from: { q: 99, r: 0, s: -99 }, to: { q: 2, r: 0, s: -2 } }, extras: [] };
  expect(validateMovePath(plan as RoundPlan, "A", state)).toEqual({ ok: false, reason: "move_from_off_board" });
});
test("move-path: forged origin inside board is refused even if fake distance matches",()=>{
  const state=makeState([{id:"u1",owner:"A",position:{q:-4,r:0,s:4},
    strength:2,hp:3,type:"scout"}]);
  const forged:RoundPlan={bid:0,extras:[],freeMove:{
    unitId:"u1",from:{q:-1,r:0,s:1},to:{q:2,r:0,s:-2},
  }};
  expect(validateMovePath(forged,"A",state)).toEqual({ok:false,reason:"move_from_mismatch"});
});
test("move-path: endpoint inside radius envelope but not on legacy board is refused",()=>{
  const state=makeState([{id:"u1",owner:"A",position:{q:4,r:0,s:-4},
    strength:2,hp:3,type:"scout"}]);
  const offBoard:RoundPlan={bid:0,extras:[],freeMove:{
    unitId:"u1",from:{q:4,r:0,s:-4},to:{q:7,r:0,s:-7},
  }};
  expect(validateMovePath(offBoard,"A",state)).toEqual(
    {ok:false,reason:"move_destination_off_board"});
});
test("move-path: blocked intermediate terrain disallows distance-three teleport",()=>{
  const state=makeState([{id:"u1",owner:"A",position:{q:0,r:0,s:0},
    strength:2,hp:3,type:"scout"}]);
  for(const cell of state.visible){
    if(cell.position.q!==0||cell.position.r!==0){
      cell.terrain="mountain";
    }
  }
  const target=state.visible.find(c=>c.position.q===3&&c.position.r===0)!;
  target.terrain="plain";
  const move:RoundPlan={bid:0,extras:[],freeMove:{
    unitId:"u1",from:{q:0,r:0,s:0},to:{q:3,r:0,s:-3},
  }};
  expect(validateMovePath(move,"A",state)).toEqual({ok:false,reason:"move_path_blocked"});
  state.visible.find(c=>c.position.q===1&&c.position.r===0)!.terrain="plain";
  state.visible.find(c=>c.position.q===2&&c.position.r===0)!.terrain="plain";
  expect(validateMovePath(move,"A",state)).toEqual({ok:true});
});
test("move-path: rejects occupied and water destination",()=>{
  const state=makeState([
    {id:"u1",owner:"A",position:{q:0,r:0,s:0},strength:2,hp:3,type:"infantry"},
    {id:"u2",owner:"B",position:{q:2,r:0,s:-2},strength:2,hp:3,type:"scout"},
  ]);
  const move:RoundPlan={bid:0,extras:[],freeMove:{
    unitId:"u1",from:{q:0,r:0,s:0},to:{q:2,r:0,s:-2},
  }};
  expect(validateMovePath(move,"A",state)).toEqual({ok:false,reason:"move_destination_occupied"});
  state.units.pop();
  state.visible.find(c=>c.position.q===2&&c.position.r===0)!.terrain="water";
  expect(validateMovePath(move,"A",state)).toEqual({ok:false,reason:"move_destination_blocked"});
});
test("move-path: rejects nonadjacent path and steps through water",()=>{
  const state=makeState([{id:"u1",owner:"A",position:{q:0,r:0,s:0},
    strength:2,hp:3,type:"infantry"}]);
  const plan:RoundPlan={bid:0,extras:[],freeMove:{
    unitId:"u1",from:{q:0,r:0,s:0},to:{q:2,r:0,s:-2},
    path:[{q:2,r:0,s:-2},{q:2,r:0,s:-2}],
  }};
  expect(validateMovePath(plan,"A",state)).toEqual({ok:false,reason:"move_path_nonadjacent"});
  plan.freeMove!.path=[{q:1,r:0,s:-1},{q:2,r:0,s:-2}];
  state.visible.find(c=>c.position.q===1&&c.position.r===0)!.terrain="water";
  expect(validateMovePath(plan,"A",state)).toEqual({ok:false,reason:"move_path_step_blocked"});
});
