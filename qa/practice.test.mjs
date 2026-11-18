import test from "node:test";
import assert from "node:assert/strict";
import { createMatch } from "../src/engine/match.ts";
import {findTraversablePath} from "../src/gateway/validator/move-path.ts";
import { initHexDiskBoard, initFrontierBoard, FRONTIER_STARTS_A } from "../src/engine/board.ts";
import { placeStartingUnits,placeFrontierUnits,getAllUnits } from "../src/engine/units.ts";
import { practiceScene, projectWorldToScreen } from "../src/browser/practice-3d.mjs";
import { resolveCombat } from "../src/engine/combat.ts";
import { checkVictory } from "../src/engine/victory.ts";
import { validateRoundPlan } from "../dist/pages/rules/gateway/validator.js";
import { runRound } from "../dist/pages/rules/engine/roundDriver.js";
import { newBudget } from "../dist/pages/rules/engine/round-state.js";
import {
  newPractice,practiceView,legalCommands,chooseBotAction,
  chooseBotRoundOrders,validatePracticeOrders,
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
  const botOrders=chooseBotRoundOrders(game,"B");
  const planB={bid:botOrders.bid,extras:[]};
  if(botOrders.move){
    const u=game.state.units.find(x=>x.id===botOrders.move.unitId);
    planB.freeMove={unitId:u.id,from:u.position,to:botOrders.move.to};
  }
  if(botOrders.attack){
    const u=game.state.units.find(x=>x.id===botOrders.attack.unitId);
    planB.freeAction={unitId:u.id,type:"attack",from:u.position,to:botOrders.attack.to};
  }
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
      const action=chooseBotRoundOrders(game,"A");
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
  const worst=[],reversalEvidence=[];
  for(let i=0;i<200;i++){
    const seed="cohort-"+String(i).padStart(3,"0");
    const game=newPractice(seed);
    const last={A:null,B:null};
    while(!game.finished&&game.round<game.state.roundCap){
      const nextA=chooseBotRoundOrders(game,"A"),nextB=chooseBotRoundOrders(game,"B");
      const before=new Map(game.state.units.map(u=>[u.id,{
        owner:u.owner,q:u.position.q,r:u.position.r,
      }]));
      const result=advancePractice(game,nextA);
      stats.attacks+=result.events.filter(e=>e==="unit_attacked").length;
      stats.moves+=result.events.filter(e=>e==="unit_moved").length;
      if(!nextA.move&&!nextA.attack&&!nextB.move&&!nextB.attack)stats.passPairs++;
      for(const [side,roundOrders] of [["A",nextA],["B",nextB]]){
        const action=roundOrders.move;
        if(!action){
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
          if(reversalEvidence.length<8)reversalEvidence.push({
            seed,round:game.round,side,unitId:action.unitId,
            previous:last[side],from,to,
          });
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
  assert.equal(stats.reversals,0,
    "An immediate two-hex reversal recurred: "+JSON.stringify(reversalEvidence));
  assert(stats.cap<=20,`Too many full-length stalemates: ${stats.cap}`);
  assert(stats.moves>0&&stats.attacks>0,"Bot cohort never exercised gameplay");
  assert(stats.passPairs<=10,"Both sides repeatedly passed instead of fighting");
  console.log("BOT COHORT",JSON.stringify({
    ...stats,averageRounds:Number((stats.rounds/stats.matches).toFixed(2)),
    cappedSeeds:worst,
  }));
});

test("3D practice view preserves the exact public unit projection and hex map",()=>{
  const game=newPractice("cohort-013");
  const publicView=practiceView(game,"A");
  const scene=practiceScene(publicView);
  assert.equal(scene.board.cells.length,81);
  assert.equal(scene.board.units.length,publicView.units.length);
  assert.deepEqual(scene.board.cells,publicView.board);
  assert.deepEqual(scene.board.units,publicView.units);
  assert.throws(()=>practiceScene({board:null,units:[]}),/Invalid public/);
  assert.throws(()=>practiceScene({board:[],units:null}),/Invalid public/);
});
test("3D picking projection is finite and screen-space consistent",()=>{
  const identity=new Float32Array([
    1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1,
  ]);
  assert.deepEqual(projectWorldToScreen(identity,[0,0,0],100,80),
    {x:50,y:40,visible:true});
  assert.deepEqual(projectWorldToScreen(identity,[.5,-.5,0],100,80),
    {x:75,y:60,visible:true});
  assert.equal(projectWorldToScreen(identity,[2,0,0],100,80)?.visible,false);
  const behind=new Float32Array(identity);
  behind[15]=-1;
  assert.equal(projectWorldToScreen(behind,[0,0,0],100,80),null);
});

test("balanced61 is separately versioned, symmetric and uses the same engine components",()=>{
  for(const seed of ["practice-alpha-01","balanced-foo","local-test-42"]){
    const game=newPractice(seed,"balanced61");
    const board=initHexDiskBoard(4,numericSeed(seed));
    placeStartingUnits(board,numericSeed(seed));
    assert.equal(game.rulesVersion,"hexawars-balanced61-v1");
    assert.equal(game.topology,"balanced61");
    assert.equal(game.state.visible.length,61);
    assert.deepEqual(game.state.visible,board.flat());
    assert.deepEqual(game.state.units,getAllUnits(board));
    assert.equal(practiceView(game).rulesVersion,"hexawars-balanced61-v1");
    assert.equal(practiceView(game).board.length,61);
    assert(legalCommands(game,"A",game.state.units.find(u=>u.owner==="A").id).length>0);
    // Historical sessions remain unchanged and explicitly distinguishable.
    const classic=newPractice(seed,"legacy81");
    assert.equal(classic.state.visible.length,81);
    assert.equal(classic.rulesVersion,"hexawars-legacy81-v1");
    assert.equal(classic.matchId,`practice:${seed}`,
      "Legacy match ID must remain byte-for-byte compatible");
    assert.notEqual(game.matchId,classic.matchId,
      "Versioned balanced rules cannot reuse legacy replay identity");
    assert.deepEqual(classic.state,createMatch(seed));
  }
  assert.throws(()=>newPractice("seed","other"),/Unsupported board topology/);
});
test("balanced61 200-seed real rules engine bot cohort completes without infinite moves",()=>{
  const result={matches:200,turnCaps:0,rounds:0,attacks:0,moves:0,passes:0};
  for(let i=0;i<200;i++){
    const game=newPractice("balanced-"+String(i).padStart(3,"0"),"balanced61");
    while(!game.finished&&game.round<game.state.roundCap){
      const action=chooseBotRoundOrders(game,"A");
      const output=advancePractice(game,action);
      result.attacks+=output.events.filter(e=>e==="unit_attacked").length;
      result.moves+=output.events.filter(e=>e==="unit_moved").length;
      if(output.playerAction==="pass"&&output.botAction==="pass")result.passes++;
      assert.equal(practiceView(game).board.length,61);
      assert(game.navigation.A.length<=16&&game.navigation.B.length<=16);
    }
    assert(game.finished,"Balanced board did not finish");
    result.rounds+=game.round;
    if(game.round>=game.state.roundCap)result.turnCaps++;
  }
  assert(result.turnCaps<=20,"Balanced hex map produces too many 50-round stalemates");
  assert(result.passes<=10,"Balanced hex map produced repeating mutual pass rounds");
  assert(result.attacks>0&&result.moves>0,"Balanced map has no meaningful combat");
  console.log("BALANCED61 BOT COHORT",JSON.stringify({
    ...result,averageRounds:Number((result.rounds/result.matches).toFixed(2)),
  }));
});

test("live rule validator rejects forged local-practice origin on BOTH versioned boards",()=>{
  for(const topology of ["legacy81","balanced61"]){
    const game=newPractice("move-forgery-"+topology,topology);
    const actor=game.state.units.find(u=>u.owner==="A"&&u.type==="scout")||
      game.state.units.find(u=>u.owner==="A");
    assert(actor);
    const possibilities=legalCommands(game,"A",actor.id).filter(x=>x.kind==="move");
    assert(possibilities.length,"No legal movement route to test");
    const legal=possibilities[0];
    const spoofedFrom={q:actor.position.q+1,r:actor.position.r,s:actor.position.s-1};
    const spoof={
      bid:0,extras:[],freeMove:{
        unitId:actor.id,from:spoofedFrom,to:legal.to,
      },
    };
    const valid=validateRoundPlan(spoof,"A",game.state,game.budgetA);
    assert.deepEqual(valid,{ok:false,reason:"move_from_mismatch"});
    const route=findTraversablePath(game.state,actor.position,legal.to,actor.id);
    assert(route && route.length>0 && route.length<=3);
    assert.deepEqual(route.at(-1),legal.to);
    const sourcePlan={bid:0,extras:[],freeMove:{
      unitId:actor.id,from:actor.position,to:legal.to,path:route,
    }};
    assert(validateRoundPlan(sourcePlan,"A",game.state,game.budgetA).ok,
      "Canonical legal path failed strict validator");
  }
});

test("browser-published round engine burns sealed bid AP and refuses malformed bids",()=>{
  const game=newPractice("bid-browser-regression","legacy81");
  const plain={bid:0,extras:[]};
  const outcome=runRound({
    matchId:game.matchId,round:0,state:game.state,
    planA:{bid:3,extras:[]},planB:plain,
    budgetA:game.budgetA,budgetB:game.budgetB,
  });
  assert.equal(outcome.nextBudgetA.apPool,2,
    "Browser rules improperly refunded the sealed three-AP bid");
  assert.equal(outcome.nextBudgetB.apPool,4);
  for(const bid of [-1,.5,Number.NaN,Infinity]){
    assert.deepEqual(validateRoundPlan({bid,extras:[]},"A",game.state,game.budgetA),
      {ok:false,reason:"bid_invalid"});
  }
});

test("two-slot human round validates, prices bid and retains other slot when added",()=>{
  let game=null,move=null,attack=null;
  for(let i=0;i<150;i++){
    const candidate=newPractice("dual-"+String(i).padStart(3,"0"),"balanced61");
    const all=candidate.state.units.filter(u=>u.owner==="A")
      .flatMap(u=>legalCommands(candidate,"A",u.id));
    const a=all.find(x=>x.kind==="attack");
    const m=all.find(x=>x.kind==="move"&&x.unitId!==a?.unitId);
    if(m&&a){game=candidate;move=m;attack=a;break;}
  }
  assert(game && move && attack,"No scenario with different-squad free move + attack");
  const before=structuredClone(game);
  const roundOrders={move,attack,bid:1};
  assert.deepEqual(validatePracticeOrders(game,"A",roundOrders),
    {valid:true,availableAp:3});
  assert.deepEqual(game,before,"Preview mutated an authoritative match");
  const result=advancePractice(game,roundOrders);
  assert.equal(result.playerAction,"move+attack");
  assert.equal(result.bidA,1);
  assert.equal(game.history[0].playerMove?.unitId,move.unitId);
  assert.equal(game.history[0].playerAttack?.unitId,attack.unitId);
  assert.equal(game.round,1);
  assert([3,4].includes(practiceView(game).availableAp));
});
test("free round plan preview rejects malformed second slot without advancing state",()=>{
  const game=newPractice("invalid-dual","legacy81");
  const start=structuredClone(game);
  const unit=game.state.units.find(u=>u.owner==="A");
  const attack={kind:"attack",unitId:unit.id,to:{q:99,r:0,s:-99}};
  assert.throws(()=>validatePracticeOrders(game,"A",{attack,bid:0}),/not legal/);
  assert.throws(()=>validatePracticeOrders(game,"A",{bid:-1}),/Initiative bid/);
  assert.throws(()=>validatePracticeOrders(game,"A",{bid:4}),/Initiative bid/);
  assert.deepEqual(game,start);
});

test("human can queue a canonically legal attack newly reachable AFTER its free move, without revealing fog",()=>{
  const game=newPractice("staged-preview-evidence","balanced61");
  const at=(q,r)=>({q,r,s:-q-r});
  const actor={id:"stage-a",owner:"A",type:"scout",weight:1,
    position:at(0,0),hp:3,strength:2};
  const spotter={id:"stage-spotter",owner:"A",type:"infantry",weight:2,
    position:at(4,-1),hp:5,strength:3};
  const target={id:"stage-b",owner:"B",type:"infantry",weight:2,
    position:at(4,0),hp:5,strength:3};
  game.state.units=[actor,spotter,target];
  game.state.visible=game.state.visible.map(c=>({
    ...c,terrain:"plain",controlledBy:undefined,
    unit:game.state.units.find(u=>u.position.q===c.position.q &&
      u.position.r===c.position.r),
  }));
  const move={kind:"move",unitId:actor.id,to:at(3,0)};
  const attack={kind:"attack",unitId:actor.id,to:at(4,0)};
  const before=structuredClone(game);
  assert(legalCommands(game,"A",actor.id).some(c=>c.kind==="move"&&
    c.to.q===3&&c.to.r===0),"The scout should have a three-step move");
  assert(!legalCommands(game,"A",actor.id).some(c=>c.kind==="attack"&&
    c.to.q===4&&c.to.r===0),"Enemy must be outside initial attack range");
  const projected=legalCommands(game,"A",actor.id,move);
  assert(projected.some(c=>c.kind==="attack"&&c.to.q===4&&c.to.r===0),
    "Known enemy should become attackable from staged destination");
  assert.equal(validatePracticeOrders(game,"A",{move,attack,bid:1}).valid,true);
  assert.throws(()=>validatePracticeOrders(game,"A",{move:null,attack,bid:0}),
    /not legal/,"Attack without the queued move is illegal");
  assert.deepEqual(game,before,"Plan previews must never mutate a live match");

  // Without the allied spotter, the enemy is beyond existing fog sight.
  // The speculative move must NOT expose an enemy hidden at round start.
  game.state.units=game.state.units.filter(u=>u.id!=="stage-spotter");
  assert(!legalCommands(game,"A",actor.id,move).some(c=>c.kind==="attack"&&
    c.to.q===4&&c.to.r===0),"Staged preview cannot reveal a hidden enemy");
  assert.throws(()=>validatePracticeOrders(game,"A",{move,attack,bid:0}),
    /not legal/,"Hidden targets must not be accepted in human practice");
});

test("Frontier127 has mirrored tactical terrain, five fair deployments and an immutable rules identity",()=>{
  const position=p=>p.q+","+p.r+","+p.s;
  for(const seed of ["frontier-check-001","frontier-check-002","frontier-check-003"]){
    const game=newPractice(seed,"frontier127");
    const board=initFrontierBoard(numericSeed(seed));
    placeFrontierUnits(board);
    assert.equal(game.rulesVersion,"hexawars-frontier127-v1");
    assert.equal(game.state.visible.length,127);
    assert.deepEqual(game.state.visible,board.flat());
    assert.deepEqual(game.state.units,getAllUnits(board));
    assert.equal(game.state.units.filter(u=>u.owner==="A").length,5);
    assert.equal(game.state.units.filter(u=>u.owner==="B").length,5);
    const byCoord=new Map(game.state.visible.map(cell=>[position(cell.position),cell]));
    for(const cell of game.state.visible){
      assert(Math.max(Math.abs(cell.position.q),Math.abs(cell.position.r),
        Math.abs(cell.position.s))<=6);
      const opposite=byCoord.get(position({
        q:-cell.position.q,r:-cell.position.r,s:-cell.position.s,
      }));
      assert(opposite,"Frontier disk has unmatched opposite cell");
      assert.equal(opposite.terrain,cell.terrain,
        "Starting terrain should be symmetric across both armies");
    }
    const a=game.state.units.filter(u=>u.owner==="A");
    const b=game.state.units.filter(u=>u.owner==="B");
    assert.deepEqual(a.map(u=>u.type).sort(),b.map(u=>u.type).sort());
    for(const unit of a){
      assert(b.some(other=>other.type===unit.type &&
        other.position.q===-unit.position.q &&
        other.position.r===-unit.position.r &&
        other.position.s===-unit.position.s));
      assert(legalCommands(game,"A",unit.id).some(command=>command.kind==="move"),
        "Each opening squad needs a legal, traversable route");
    }
    assert.equal(new Set(game.state.units.map(u=>u.id)).size,10,
      "Every squad needs a stable unique identifier");
    assert.equal(practiceView(game).board.length,127);
    assert.equal(practiceScene(practiceView(game)).board.cells.length,127);
    const historic=newPractice(seed,"balanced61");
    const legacy=newPractice(seed,"legacy81");
    assert.equal(historic.state.visible.length,61);
    assert.equal(legacy.state.visible.length,81);
    assert.equal(legacy.matchId,"practice:"+seed);
    assert.notEqual(game.matchId,historic.matchId);
  }
  assert.equal(FRONTIER_STARTS_A.length,5);
});

test("Frontier127 bot matches stay bounded and complete with real movement and attacks",()=>{
  const results={matches:40,rounds:0,turnCaps:0,moves:0,attacks:0};
  for(let i=0;i<results.matches;i++){
    const game=newPractice("frontier-cohort-"+String(i).padStart(3,"0"),"frontier127");
    while(!game.finished&&game.round<game.state.roundCap){
      const plan=chooseBotRoundOrders(game,"A");
      const outcome=advancePractice(game,plan);
      results.moves+=outcome.events.filter(e=>e==="unit_moved").length;
      results.attacks+=outcome.events.filter(e=>e==="unit_attacked").length;
      assert.equal(game.state.visible.length,127);
      assert(game.navigation.A.length<=16&&game.navigation.B.length<=16);
    }
    assert(game.finished,"New battlefield must conclude no later than its round cap");
    results.rounds+=game.round;
    if(game.round===game.state.roundCap)results.turnCaps++;
  }
  assert(results.moves>0&&results.attacks>0,"Large battlefield generated no combat");
  console.log("FRONTIER127 BOT COHORT",JSON.stringify({
    ...results,meanRounds:Number((results.rounds/results.matches).toFixed(2)),
  }));
});

test("PVP matchup baseline: both seats receive matched five-squad armies, legal commands and equal starting AP",()=>{
  const signature=units=>units.map(u=>({
    type:u.type,hp:u.hp,strength:u.strength,weight:u.weight,
  })).sort((a,b)=>a.type.localeCompare(b.type)||a.hp-b.hp||a.strength-b.strength);
  for(let i=0;i<64;i++){
    const game=newPractice("fair-start-"+String(i).padStart(3,"0"),"frontier127");
    const a=game.state.units.filter(u=>u.owner==="A");
    const b=game.state.units.filter(u=>u.owner==="B");
    assert.equal(a.length,5,"Blue opening army must have five squads");
    assert.equal(b.length,5,"Red opening army must have five squads");
    assert.deepEqual(signature(a),signature(b),
      "Teams must have the same number, roles, health, strength and weight");
    assert.deepEqual(game.budgetA,game.budgetB,"Opening resources are not symmetric");
    assert.deepEqual(game.budgetA,
      {freeMove:1,freeAction:1,apPool:3,apCarry:0},
      "Current *legacy* round economy must not be changed without a new rulesVersion");
    for(const side of ["A","B"]){
      const orders=chooseBotRoundOrders(game,side);
      assert.deepEqual(validatePracticeOrders(game,side,orders).valid,true,
        "Both seats must use the same canonical validator");
      assert(orders.move||orders.attack,"Entire squad at a starting position has no legal opening order");
      assert.equal(orders.bid,0,"Current scripted house bot bid baseline changed unexpectedly");
    }
    // A live sight projection can display fewer RED units; it must never
    // alter the actual army, available commands or scoreboard total.
    const aView=practiceView(game,"A");
    const bView=practiceView(game,"B");
    assert.equal(aView.blue,5);
    assert.equal(aView.red,5);
    assert.equal(bView.blue,5);
    assert.equal(bView.red,5);
    assert.equal(aView.availableAp,bView.availableAp);
  }
});

test("PVP economy observability: paired 5v5 house-bot baseline logs seat actions and outcomes",()=>{
  const stats={
    matches:32,winnerA:0,winnerB:0,draws:0,roundCap:0,rounds:0,
    declaredMoves:{A:0,B:0},declaredAttacks:{A:0,B:0},
    holds:{A:0,B:0},bids:{A:0,B:0},
    unitActivation:{A:new Set(),B:new Set()},
  };
  for(let i=0;i<stats.matches;i++){
    const game=newPractice("matchup-audit-"+String(i).padStart(3,"0"),"frontier127");
    while(!game.finished&&game.round<game.state.roundCap){
      const a=chooseBotRoundOrders(game,"A");
      const b=chooseBotRoundOrders(game,"B");
      // Both plans derive only from their side's permitted public observation
      // and are evaluated by the SAME round validator.
      assert(validatePracticeOrders(game,"A",a).valid);
      assert(validatePracticeOrders(game,"B",b).valid);
      for(const [side,orders] of [["A",a],["B",b]]){
        if(orders.move){
          stats.declaredMoves[side]++;
          stats.unitActivation[side].add(orders.move.unitId);
        }
        if(orders.attack){
          stats.declaredAttacks[side]++;
          stats.unitActivation[side].add(orders.attack.unitId);
        }
        if(!orders.move&&!orders.attack)stats.holds[side]++;
        stats.bids[side]+=orders.bid;
      }
      const out=advancePractice(game,a);
      assert.equal(out.bidA,a.bid);
      assert.equal(out.bidB,b.bid);
      assert(game.budgetA.apCarry>=0&&game.budgetA.apCarry<=1);
      assert(game.budgetB.apCarry>=0&&game.budgetB.apCarry<=1);
      assert(game.state.units.every(u=>u.hp>=0));
    }
    assert(game.finished,"No matchup result was recorded");
    if(game.finished.winner==="A")stats.winnerA++;
    else if(game.finished.winner==="B")stats.winnerB++;
    else stats.draws++;
    stats.rounds+=game.round;
    if(game.round===game.state.roundCap)stats.roundCap++;
  }
  assert(stats.declaredMoves.A>0&&stats.declaredMoves.B>0);
  assert(stats.declaredAttacks.A>0&&stats.declaredAttacks.B>0);
  // This is a measurement, NOT a certification of seat balance. In
  // particular chooseBotAction has a Red-only defensive hold branch.
  // Report the bias so v2 owners cannot claim 1v1 fairness from a green CI.
  console.log("MATCHUP_ECONOMY_BASELINE",JSON.stringify({
    matches:stats.matches,A:stats.winnerA,B:stats.winnerB,draw:stats.draws,
    roundCap:stats.roundCap,meanRounds:Number((stats.rounds/stats.matches).toFixed(2)),
    declaredMoves:stats.declaredMoves,declaredAttacks:stats.declaredAttacks,
    holds:stats.holds,bids:stats.bids,
    activatedSquadIds:{A:stats.unitActivation.A.size,B:stats.unitActivation.B.size},
  }));
});
