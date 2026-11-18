import test from "node:test";
import assert from "node:assert/strict";
import { createMatch } from "../src/engine/match.ts";
import { validateRoundPlan } from "../dist/pages/rules/gateway/validator.js";
import { runRound } from "../dist/pages/rules/engine/roundDriver.js";
import { newBudget } from "../dist/pages/rules/engine/round-state.js";
import {
  newPractice,practiceView,legalCommands,chooseBotAction,
  advancePractice,numericSeed,
} from "../dist/pages/practice-core.mjs";

test("practice opening state matches authoritative createMatch exactly",()=>{
  for(const seed of ["practice-alpha-01","local-test-42","a1b2c3"]){
    const game=newPractice(seed);
    assert.deepEqual(game.state,createMatch(seed));
    assert.equal(game.state.visible.length,81);
    assert.equal(game.state.units.length,6);
    assert.equal(game.round,0);
    assert(Number.isSafeInteger(numericSeed(seed)));
    const view=practiceView(game);
    assert.equal(view.mode,"unranked-local");
    assert.equal(view.board.length,81);
    assert(view.units.every(u=>u.side==="A"||u.side==="B"));
  }
});
test("legal choices are checked against the canonical validator",()=>{
  const game=newPractice("practice-alpha-01");
  let tested=0;
  for(const unit of game.state.units){
    const actions=legalCommands(game,unit.owner,unit.id);
    for(const choice of actions){
      const plan={bid:0,extras:[]};
      if(choice.kind==="move")plan.freeMove={
        unitId:unit.id,from:unit.position,to:choice.to};
      if(choice.kind==="attack")plan.freeAction={
        unitId:unit.id,from:unit.position,to:choice.to,type:"attack"};
      assert(validateRoundPlan(plan,unit.owner,game.state,newBudget()).ok);
      const cell=game.state.visible.find(c=>c.position.q===choice.to.q&&
        c.position.r===choice.to.r);
      assert(cell,"Off-board command offered");
      if(choice.kind==="move"){
        assert(!["mountain","water"].includes(cell.terrain));
        assert(!game.state.units.some(u=>u.position.q===choice.to.q&&
          u.position.r===choice.to.r));
      }
      tested++;
    }
  }
  assert(tested>0,"No legal moves from opening deployment");
});
test("single round result matches the shared runRound implementation",()=>{
  const seed="practice-alpha-01";
  const game=newPractice(seed),ref=newPractice(seed);
  const act=legalCommands(game,"A",game.state.units.find(u=>u.owner==="A").id)[0];
  assert(act,"No human action");
  const unit=game.state.units.find(u=>u.id===act.unitId);
  const planA=act.kind==="move"?{
    bid:0,extras:[],freeMove:{unitId:unit.id,from:unit.position,to:act.to}
  }:{
    bid:0,extras:[],freeAction:{unitId:unit.id,type:"attack",from:unit.position,to:act.to}
  };
  const botAction=chooseBotAction(game,"B");
  const bot=game.state.units.find(u=>u.id===botAction.unitId);
  const planB=botAction.kind==="move"?{
    bid:0,extras:[],freeMove:{unitId:bot.id,from:bot.position,to:botAction.to}
  }:botAction.kind==="attack"?{
    bid:0,extras:[],freeAction:{unitId:bot.id,type:"attack",from:bot.position,to:botAction.to}
  }:{bid:0,extras:[]};
  const expected=runRound({matchId:ref.matchId,round:0,state:ref.state,
    planA,planB,budgetA:ref.budgetA,budgetB:ref.budgetB});
  const applied=advancePractice(game,act);
  assert.equal(applied.round,1);
  assert.deepEqual(game.state,expected.nextState);
  assert.deepEqual(game.budgetA,expected.nextBudgetA);
  assert.deepEqual(game.budgetB,expected.nextBudgetB);
  assert.deepEqual(applied.events,expected.events.map(x=>x.type));
});
test("bad commands are refused without modifying the match or consuming turns",()=>{
  const game=newPractice("practice-alpha-01");
  const initial=structuredClone(game);
  assert.throws(()=>advancePractice(game,{kind:"teleport"}),/Select a unit/);
  assert.throws(()=>advancePractice(game,{kind:"move",unitId:"missing",
    to:{q:0,r:0,s:0}}),/Not one of your units/);
  assert.throws(()=>advancePractice(game,{kind:"move",unitId:game.state.units[0].id,
    to:{q:100,r:0,s:-100}}),/not legal/);
  assert.deepEqual(game,initial);
});
test("bot-versus-bot practice runs every turn and resolves at or before the round cap",()=>{
  for(const seed of ["practice-alpha-01","test-seed-02","test-seed-03"]){
    const game=newPractice(seed);
    let attacked=0,moved=0;
    while(!game.finished&&game.round<game.state.roundCap){
      const action=chooseBotAction(game,"A");
      const resolved=advancePractice(game,action);
      attacked+=resolved.events.filter(e=>e==="unit_attacked").length;
      moved+=resolved.events.filter(e=>e==="unit_moved").length;
      assert.equal(game.round,resolved.round);
      assert(game.state.units.every(u=>u.hp>=0&&u.position.q+u.position.r+u.position.s===0));
      assert.equal(game.state.visible.length,81);
    }
    assert(game.finished,"No completed game at cap");
    assert(game.round<=50);
    assert(moved>0,"AI never moved");
    assert(["A","B","draw"].includes(game.finished.winner));
    console.log("BOT GAME",seed,"rounds",game.round,"attacks",attacked,
      "moves",moved,"outcome",game.finished.winner);
  }
});
