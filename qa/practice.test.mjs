import test from "node:test";
import assert from "node:assert/strict";
import { createMatch } from "../src/engine/match.ts";
import { resolveCombat } from "../src/engine/combat.ts";
import { checkVictory } from "../src/engine/victory.ts";
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

test("zero-HP units never win or extend a match (canonical source regression)",()=>{
  const state=newPractice("practice-alpha-01").state;
  const dead=state.units.map(u=>({...u,hp:0}));
  assert.deepEqual(checkVictory({...state,units:dead}),
    {winner:"draw",reason:"mutual_elimination"});
  assert.deepEqual(checkVictory({...state,units:[
    {...dead[0],hp:1},...dead.slice(1)
  ]}),{winner:dead[0].owner,reason:"elimination"});
});
test("mutual-lethal defender wins with positive health and is not a zombie",()=>{
  const combat=resolveCombat(
    {id:"a",hp:5,strength:5},{id:"b",hp:5,strength:5},"plain");
  assert.deepEqual(combat.destroyed,["a"]);
  assert.equal(combat.attackerHp,0);
  assert.equal(combat.defenderHp,1);
});
test("canonical zero-HP elimination fixture terminates before the 50-round cap",()=>{
  // The original practice-alpha-01 fixture now exposes a separate bot loop;
  // test-seed-02 specifically exercises the zero-HP victory correction.
  const game=newPractice("test-seed-02");
  while(!game.finished&&game.round<50){
    advancePractice(game,chooseBotAction(game,"A"));
  }
  assert(game.finished,"Expected a concluded match");
  assert(game.round<50,`Dead units extended match to round ${game.round}`);
  const living=game.state.units.filter(u=>u.hp>0);
  if(game.finished.winner==="draw")assert.equal(living.length,0);
  else assert(living.some(u=>u.owner===game.finished.winner),
    "Winning side has no surviving combatants");
  console.log("ZERO HP FIX seed",game.seed,"completed after",game.round,
    "rounds",game.finished);
});

test("80-seed bot quality gate: low turn-cap rate, fast outcomes, no two-hex loops",()=>{
  const tally={A:0,B:0,draw:0},turns=[],stuck=[];
  let maxAlternation=0;
  for(let index=0;index<80;index++){
    const game=newPractice("cohort-"+index);
    while(!game.finished && game.round<50){
      const action=chooseBotAction(game,"A");
      advancePractice(game,action);
    }
    assert(game.finished,"Bot game never finalized");
    assert.equal(game.history.length,game.round);
    tally[game.finished.winner]++;
    turns.push(game.round);
    if(game.round===50)stuck.push(game.seed);
    for(const side of ["playerMove","botMove"]){
      const unitIds=new Set(game.history.map(row=>row[side]?.unitId).filter(Boolean));
      for(const unitId of unitIds){
        const seen=game.history.map(row=>row[side])
          .filter(move=>move?.unitId===unitId).map(move=>move.to.q+","+move.to.r);
        for(let j=0;j+5<seen.length;j++){
          const isLoop=seen[j]===seen[j+2]&&seen[j+2]===seen[j+4]&&
            seen[j+1]===seen[j+3]&&seen[j+3]===seen[j+5]&&
            seen[j]!==seen[j+1];
          if(isLoop)maxAlternation=Math.max(maxAlternation,6);
        }
      }
    }
  }
  const mean=turns.reduce((sum,round)=>sum+round,0)/turns.length;
  console.log("80-SEED BOT COHORT",{tally,averageRounds:mean,
    turnCaps:stuck,maxAlternation});
  assert(mean<20,"Average match pacing deteriorated");
  assert(tally.draw<=6,"Bot remains trapped in too many turn-cap draws");
  assert(stuck.length<=8,"Bot pursuit reaches turn cap too frequently");
  assert.equal(maxAlternation,0,"A unit oscillated between two hexes for six moves");
});

test("bot policy is pure, bounded, seat-valid and does not attack unseen units",()=>{
  const game=newPractice("cohort-047");
  const before=structuredClone(game);
  for(const side of ["A","B"]){
    const action=chooseBotAction(game,side);
    assert.deepEqual(game,before,"Bot decision mutated the match");
    if(action.kind==="pass")continue;
    const allowed=legalCommands(game,side,action.unitId);
    assert(allowed.some(cmd=>cmd.kind===action.kind &&
      cmd.to.q===action.to.q && cmd.to.r===action.to.r),
      "Bot selected an illegal move or attack");
    if(action.kind==="attack"){
      const seen=practiceView(game,side).units.filter(u=>u.side!==side);
      assert(seen.some(u=>u.q===action.to.q && u.r===action.to.r),
        "Bot attacked a concealed enemy");
    }
  }
});
test("200-seed deterministic bot cohort avoids reverse-movement deadlocks",()=>{
  const stats={matches:200,cap:0,reversals:0,rounds:0,attacks:0,moves:0,passPairs:0};
  const worst=[];
  for(let i=0;i<200;i++){
    const seed="cohort-"+String(i).padStart(3,"0");
    const game=newPractice(seed);
    const last={A:null,B:null};
    while(!game.finished&&game.round<game.state.roundCap){
      const nextA=chooseBotAction(game,"A"),nextB=chooseBotAction(game,"B");
      const before=new Map(game.state.units.map(u=>[u.id,{
        owner:u.owner,q:u.position.q,r:u.position.r,
      }]));
      const result=advancePractice(game,nextA);
      stats.attacks+=result.events.filter(e=>e==="unit_attacked").length;
      stats.moves+=result.events.filter(e=>e==="unit_moved").length;
      if(nextA.kind==="pass"&&nextB.kind==="pass")stats.passPairs++;
      for(const [side,action] of [["A",nextA],["B",nextB]]){
        if(action.kind!=="move"){
          last[side]=null;
          continue;
        }
        const old=before.get(action.unitId);
        const after=game.state.units.find(u=>u.id===action.unitId);
        if(!old||!after)continue;
        const from=old.q+","+old.r;
        const to=after.position.q+","+after.position.r;
        if(last[side]&&last[side].unitId===action.unitId &&
          last[side].from===to&&last[side].to===from){
          stats.reversals++;
        }
        last[side]={unitId:action.unitId,from,to};
      }
      for(const side of ["A","B"]){
        assert(game.navigation[side].length<=16,"Bot navigation memory unbounded");
      }
    }
    assert(game.finished,"Match never reached a legal conclusion");
    if(game.round>=game.state.roundCap){
      stats.cap++;
      worst.push(seed);
    }
    stats.rounds+=game.round;
  }
  assert.equal(stats.reversals,0,"An immediate two-hex reversal recurred");
  assert(stats.cap<=20,`Too many full-length stalemates: ${stats.cap}`);
  assert(stats.moves>0&&stats.attacks>0,"Bot cohort never exercised gameplay");
  assert(stats.passPairs<=10,"Both sides repeatedly passed instead of fighting");
  console.log("BOT COHORT",JSON.stringify({
    ...stats,averageRounds:Number((stats.rounds/stats.matches).toFixed(2)),
    cappedSeeds:worst,
  }));
});
