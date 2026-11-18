/**
 * Unranked, local practice match adapter. Authoritative mechanics are imported
 * from the SAME TypeScript engine modules as the existing Bun match runner.
 * The Pages builder strips types, pins a strict import allowlist, and does not
 * include the Bun server, Node hashing, accounts, secrets, or persistence.
 *
 * Caution: in-browser state is inspectable. Never accept local practice as a
 * competitive/ranked result. Terrain is publicly visible; enemy tokens use
 * the existing seat-specific observation projection.
 */
import { initBoard, initHexDiskBoard, initFrontierBoard } from "./rules/engine/board.js";
import { placeStartingUnits, placeFrontierUnits, getAllUnits } from "./rules/engine/units.js";
import { newBudget, applyCarryover } from "./rules/engine/round-state.js";
import { runRound } from "./rules/engine/roundDriver.js";
import { checkVictory } from "./rules/engine/victory.js";
import { validateRoundPlan } from "./rules/gateway/validator.js";
import { projectSeatObservation } from "./rules/gateway/observation.js";
import { MOVE_POINTS, RANGE, ROUND_CAP } from "./rules/engine/constants.js";
import { distance } from "./rules/engine/coords.js";

const PASS = Object.freeze({ bid: 0, extras: [] });
const SIDES = new Set(["A","B"]);
function key(p){return `${p.q},${p.r}`;}
function clonePos(p){return {q:p.q,r:p.r,s:p.s};}
function exactlySame(a,b){return a.q===b.q&&a.r===b.r&&a.s===b.s;}

/** FNV-1a seed derivation byte-for-byte matching src/engine/match.ts. */
export function numericSeed(seed){
  let h=2166136261>>>0;
  for(let i=0;i<seed.length;i++){
    h ^= seed.charCodeAt(i);
    h=Math.imul(h,16777619)>>>0;
  }
  return h>>>0;
}
/** Exact, immutable topology IDs. Do not silently reinterpret old matches. */
export const PRACTICE_TOPOLOGIES=Object.freeze({
  legacy81:"hexawars-legacy81-v1",
  balanced61:"hexawars-balanced61-v1",
  frontier127:"hexawars-frontier127-v1",
});
export function newPractice(seed="practice-alpha-01",topology="legacy81"){
  if(typeof seed!=="string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(seed)){
    throw new Error("Seed must be 1–48 letters, digits, underscores or dashes");
  }
  if(!Object.hasOwn(PRACTICE_TOPOLOGIES,topology)){
    throw new Error("Unsupported board topology");
  }
  const encodedSeed=numericSeed(seed);
  const board=topology==="frontier127"
    ?initFrontierBoard(encodedSeed)
    :topology==="balanced61"
      ?initHexDiskBoard(4,encodedSeed)
      :initBoard(9,encodedSeed);
  if(topology==="frontier127")placeFrontierUnits(board);
  else placeStartingUnits(board,encodedSeed);
  const visible=board.flat();
  return {
    // Preserve exact legacy match IDs so seeded historical practice traces
    // remain replayable under their original rules, without reinterpretation.
    matchId:topology==="legacy81"
      ?`practice:${seed}`
      :`practice:${PRACTICE_TOPOLOGIES[topology]}:${seed}`,
    seed,
    topology,
    rulesVersion:PRACTICE_TOPOLOGIES[topology],
    round:0,
    state:{
      turn:0,visible,units:getAllUnits(board),score:{a:0,b:0},
      deadline:120000,roundCap:ROUND_CAP,
    },
    budgetA:newBudget(),
    budgetB:newBudget(),
    history:[],
    // Bounded memory of each side’s own orders and actual move destinations.
    navigation:{A:[],B:[]},
    finished:null,
  };
}

function ownUnits(game,side){
  return game.state.units.filter(u=>u.owner===side&&u.hp>0);
}
function knownEnemyUnits(game,side){
  const seen=projectSeatObservation(game.state,side);
  const enemy=new Map();
  for(const c of seen.visible){
    if(c.unit && c.unit.owner!==side&&c.unit.hp>0)enemy.set(c.unit.id,c.unit);
  }
  return [...enemy.values()];
}
/** Display only seat-approved enemy units, never raw state.units. */
export function practiceView(game,side="A"){
  if(!SIDES.has(side))throw new Error("Unknown practice side");
  const own=ownUnits(game,side);
  const opponents=knownEnemyUnits(game,side);
  const victory=game.finished;
  return {
    mode:"unranked-local",seed:game.seed,round:game.round,
    topology:game.topology,rulesVersion:game.rulesVersion,
    roundCap:game.state.roundCap,
    availableAp:applyCarryover(side==="A"?game.budgetA:game.budgetB).apPool,
    board:game.state.visible.map(c=>({
      q:c.position.q,r:c.position.r,terrain:c.terrain,
      controlledBy:c.controlledBy??null,
    })),
    units:[...own,...opponents].map(u=>({
      id:u.id,side:u.owner,q:u.position.q,r:u.position.r,
      hp:u.hp,strength:u.strength,type:u.type,
      moveRange:MOVE_POINTS[u.type],attackRange:RANGE[u.type],
    })),
    // Public scoreboard totals reveal counts, not concealed positions/HP.
    blue:game.state.units.filter(u=>u.owner==="A"&&u.hp>0).length,
    red:game.state.units.filter(u=>u.owner==="B"&&u.hp>0).length,
    ended:victory?{...victory}:null,
  };
}
function planForAction(unit,action){
  if(action.kind==="move"){
    return {bid:0,extras:[],freeMove:{
      unitId:unit.id,from:clonePos(unit.position),to:clonePos(action.to),
    }};
  }
  if(action.kind==="attack"){
    return {bid:0,extras:[],freeAction:{
      unitId:unit.id,type:"attack",from:clonePos(unit.position),
      to:clonePos(action.to),
    }};
  }
  return {bid:0,extras:[]};
}
export function legalCommands(game,side,unitId,stagedMove=null){
  if(game.finished||!SIDES.has(side))return [];
  const unit=ownUnits(game,side).find(u=>u.id===unitId);
  if(!unit)return [];
  const budget=side==="A"?game.budgetA:game.budgetB;
  const occupied=new Set(game.state.units.map(u=>key(u.position)));
  const options=[];
  // A queued free move changes the selected squad's firing origin, but
  // does NOT change what enemies are currently visible through fog.
  // Reject unverified projected positions rather than previewing attacks
  // from a fictional hex.
  let stagedOrigin=unit.position,stagedFragment=null;
  if(stagedMove?.kind==="move" && stagedMove.unitId===unit.id){
    if(!stagedMove.to||!Number.isSafeInteger(stagedMove.to.q)||
      !Number.isSafeInteger(stagedMove.to.r)||!Number.isSafeInteger(stagedMove.to.s)||
      stagedMove.to.q+stagedMove.to.r+stagedMove.to.s!==0)return [];
    const trial=planForAction(unit,stagedMove);
    if(!validateRoundPlan(trial,side,game.state,budget).ok)return [];
    stagedOrigin=stagedMove.to;
    stagedFragment=trial.freeMove;
  }
  for(const cell of game.state.visible){
    const to=cell.position;
    if((cell.terrain!=="mountain"&&cell.terrain!=="water") &&
      !occupied.has(key(to)) && distance(unit.position,to)===(MOVE_POINTS[unit.type]??1)){
      const cmd={kind:"move",unitId,to:clonePos(to)};
      if(validateRoundPlan(planForAction(unit,cmd),side,game.state,
        side==="A"?game.budgetA:game.budgetB).ok)options.push(cmd);
    }
  }
  for(const enemy of knownEnemyUnits(game,side)){
    if(distance(stagedOrigin,enemy.position) <= (RANGE[unit.type]??1)){
      const cmd={kind:"attack",unitId,to:clonePos(enemy.position)};
      const trial=planForAction(unit,cmd);
      if(stagedFragment)trial.freeMove=stagedFragment;
      if(validateRoundPlan(trial,side,game.state,budget).ok)options.push(cmd);
    }
  }
  return options;
}
export function chooseBotAction(game,side="B"){
  if(game.finished)return {kind:"pass"};
  const own=ownUnits(game,side);
  const opponents=knownEnemyUnits(game,side);
  const actions=own.flatMap(u=>legalCommands(game,side,u.id));
  const attacks=actions.filter(a=>a.kind==="attack");
  if(attacks.length){
    attacks.sort((a,b)=>{
      const ua=own.find(u=>u.id===a.unitId), ub=own.find(u=>u.id===b.unitId);
      const ea=opponents.find(u=>exactlySame(u.position,a.to));
      const eb=opponents.find(u=>exactlySame(u.position,b.to));
      return (ea.hp-ua.strength)-(eb.hp-ub.strength)||
        (ea.hp-eb.hp)||a.unitId.localeCompare(b.unitId);
    });
    return attacks[0];
  }
  // The defensive bot sometimes holds a close contact instead of blindly
  // mirroring an opponent's movement. This breaks symmetric scout chases,
  // preserves attack opportunities and uses only seat-observed positions.
  if(side==="B" && opponents.length){
    const nearest=Math.min(...own.flatMap(u=>
      opponents.map(e=>distance(u.position,e.position))));
    if(nearest<=4 && game.round%2===0)return {kind:"pass"};
  }
  const moves=actions.filter(a=>a.kind==="move");
  if(!moves.length)return {kind:"pass"};
  const trail=(game.navigation?.[side]??[]).slice(-16);
  // A large scoring penalty still let the primary bot choose an immediate
  // reversal when other priorities dominated. The complementary move slot
  // already treats reversals as ineligible; apply that same deterministic
  // rule to the primary move. Holding is preferable to direction thrashing.
  const nonReversals=moves.filter(action=>{
    const unit=own.find(u=>u.id===action.unitId);
    const previous=trail.filter(t=>t.unitId===action.unitId).at(-1);
    return !previous || !unit ||
      previous.from!==key(action.to) ||
      previous.to!==key(unit.position);
  });
  if(!nonReversals.length)return {kind:"pass"};
  // The board's terrain and control markers are public in local practice.
  // Enemy positions are only those provided by the seat observation above.
  const terrainByCoord=new Map(game.state.visible.map(c=>[key(c.position),c]));
  const center={q:0,r:0,s:0};
  const targets=game.state.visible.filter(c=>
    c.controlledBy!==side && c.terrain!=="mountain" && c.terrain!=="water");
  function nearest(pos,points){
    if(!points.length)return 0;
    return Math.min(...points.map(x=>distance(pos,x.position??x)));
  }
  function evaluate(action){
    const unit=own.find(x=>x.id===action.unitId);
    const destination=terrainByCoord.get(key(action.to));
    const unitTrail=trail.filter(x=>x.unitId===unit.id);
    const visitCount=unitTrail.filter(x=>x.to===key(action.to)).length;
    const reversal=unitTrail.length>0 &&
      unitTrail.at(-1).from===key(action.to) &&
      unitTrail.at(-1).to===key(unit.position);
    const pursuit=opponents.length
      ? nearest(unit.position,opponents)-nearest(action.to,opponents)
      : distance(unit.position,center)-distance(action.to,center);
    const territoryProgress=
      nearest(unit.position,targets)-nearest(action.to,targets);
    let score=pursuit*9+territoryProgress*2;
    if(destination?.controlledBy!==side)score+=12;
    if(destination?.controlledBy===side)score-=3;
    score-=visitCount*14;
    if(reversal)score-=50;
    // Spread advances among squads rather than repeatedly moving one scout.
    score-=unitTrail.length*1.5;
    score-=nearest(action.to,opponents.length?opponents:[center])*.2;
    return score;
  }
  nonReversals.sort((a,b)=>evaluate(b)-evaluate(a)||
    a.unitId.localeCompare(b.unitId)||a.to.q-b.to.q||a.to.r-b.to.r);
  return nonReversals[0];
}
/**
 * Browser practice accepts old one-action calls for historical contract parity
 * but the playable UI now submits two independent free round slots.
 */
function normalizeOrders(input){
  if(!input||input.kind==="pass")return {move:null,attack:null,bid:0};
  if(input.kind){
    if(!["move","attack"].includes(input.kind))
      throw new Error("Select a unit and a move or attack");
    return {move:input.kind==="move"?input:null,
      attack:input.kind==="attack"?input:null,bid:0};
  }
  if(typeof input!=="object"||Array.isArray(input))
    throw new Error("Invalid round order");
  return {move:input.move??null,attack:input.attack??null,bid:input.bid??0};
}
function describeOrders(input){
  const orders=normalizeOrders(input);
  const kinds=[];
  if(orders.move)kinds.push("move");
  if(orders.attack)kinds.push("attack");
  return kinds.join("+")||"pass";
}
function checkedPlan(game,side,input){
  const orders=normalizeOrders(input);
  const budget=applyCarryover(side==="A"?game.budgetA:game.budgetB);
  if(!Number.isSafeInteger(orders.bid)||orders.bid<0||orders.bid>budget.apPool)
    throw new Error("Initiative bid exceeds available AP");
  const plan={bid:orders.bid,extras:[]};
  for(const [kind,choice] of [["move",orders.move],["attack",orders.attack]]){
    if(!choice)continue;
    if(choice.kind!==kind||typeof choice.unitId!=="string")
      throw new Error("Invalid "+kind+" slot");
    const to=choice.to;
    if(!to||!Number.isSafeInteger(to.q)||!Number.isSafeInteger(to.r)||
      !Number.isSafeInteger(to.s)||to.q+to.r+to.s!==0)
      throw new Error("Invalid hex coordinates");
    const unit=ownUnits(game,side).find(u=>u.id===choice.unitId);
    if(!unit)throw new Error("Not one of your units");
    const valid=legalCommands(game,side,unit.id,orders.move).find(x=>
      x.kind===kind&&exactlySame(x.to,to));
    if(!valid)throw new Error("That "+kind+" is not legal this round");
    const fragment=planForAction(unit,valid);
    if(kind==="move")plan.freeMove=fragment.freeMove;
    else plan.freeAction=fragment.freeAction;
  }
  const result=validateRoundPlan(plan,side,game.state,budget);
  if(!result.ok)throw new Error("Plan rejected: "+result.reason);
  return plan;
}
export function validatePracticeOrders(game,side,orders){
  if(game.finished)throw new Error("Match already finished");
  checkedPlan(game,side,orders);
  return {valid:true,availableAp:applyCarryover(
    side==="A"?game.budgetA:game.budgetB).apPool};
}
/**
 * Equal round-slot access for the house bot. Preserve its existing primary
 * deterministic observed-state heuristic, then fill a complementary slot
 * on a different friendly squad when legally available.
 */
export function chooseBotRoundOrders(game,side="B"){
  const primary=chooseBotAction(game,side);
  const result={move:null,attack:null,bid:0};
  if(primary.kind==="pass")return result;
  result[primary.kind]=primary;
  const others=ownUnits(game,side).flatMap(u=>legalCommands(game,side,u.id));
  const complement=primary.kind==="attack"?"move":"attack";
  const trail=game.navigation?.[side]??[];
  const own=ownUnits(game,side);
  const candidates=others.filter(c=>c.kind===complement&&
    c.unitId!==primary.unitId &&
    (complement!=="move" || (()=>{
      const unit=own.find(u=>u.id===c.unitId);
      const previous=trail.filter(x=>x.unitId===c.unitId).at(-1);
      // A second free move must not undo the same unit's prior move.
      // If every candidate is a reversal, leave the optional slot unused.
      return unit && !(previous &&
        previous.from===key(c.to) &&
        previous.to===key(unit.position));
    })()));
  if(complement==="move"){
    const center={q:0,r:0,s:0};
    function score(choice){
      const unit=own.find(u=>u.id===choice.unitId);
      const visits=trail.filter(t=>t.unitId===choice.unitId);
      const repeats=visits.filter(t=>t.to===key(choice.to)).length;
      const progress=distance(unit.position,center)-distance(choice.to,center);
      return progress*8-repeats*16-visits.length*.5;
    }
    candidates.sort((a,b)=>score(b)-score(a)||
      a.unitId.localeCompare(b.unitId)||a.to.q-b.to.q||a.to.r-b.to.r);
  }else{
    candidates.sort((a,b)=>a.unitId.localeCompare(b.unitId)||
      a.to.q-b.to.q||a.to.r-b.to.r);
  }
  if(candidates.length)result[complement]=candidates[0];
  return result;
}
export function advancePractice(game,action){
  if(game.finished)throw new Error("Match ended; start a new battle");
  if(game.round>=ROUND_CAP)throw new Error("Round limit reached");
  const playerOrders=normalizeOrders(action);
  const botOrders=chooseBotRoundOrders(game,"B");
  const planA=checkedPlan(game,"A",playerOrders);
  const planB=checkedPlan(game,"B",botOrders);
  const startingPositions=new Map(game.state.units.map(u=>
    [u.id,clonePos(u.position)]));
  const result=runRound({
    matchId:game.matchId,round:game.round,state:game.state,
    planA,planB,budgetA:game.budgetA,budgetB:game.budgetB,
  });
  game.state=result.nextState;
  game.budgetA=result.nextBudgetA;
  game.budgetB=result.nextBudgetB;
  game.round+=1;
  // Record the acting side's own move only. Failed moves also become
  // evidence against repeatedly choosing the same blocked destination.
  for(const [side,command] of [["A",playerOrders.move],["B",botOrders.move]]){
    if(command?.kind!=="move")continue;
    const from=startingPositions.get(command.unitId);
    if(!from)continue;
    const after=game.state.units.find(u=>u.id===command.unitId);
    const to=after?.position??from;
    game.navigation[side].push({
      unitId:command.unitId,from:key(from),to:key(to),round:game.round,
    });
    if(game.navigation[side].length>16)game.navigation[side].shift();
  }
  const outcome=checkVictory(game.state);
  if(outcome.winner!==null)game.finished=outcome;
  const events=result.events.map(ev=>ev.type);
  game.history.push({round:game.round,player:describeOrders(playerOrders),
    bot:describeOrders(botOrders),events,
    playerMove:playerOrders.move?structuredClone(playerOrders.move):null,
    botMove:botOrders.move?structuredClone(botOrders.move):null,
    playerAttack:playerOrders.attack?structuredClone(playerOrders.attack):null,
    botAttack:botOrders.attack?structuredClone(botOrders.attack):null,
    bidA:planA.bid,bidB:planB.bid});
  return {
    round:game.round,playerAction:describeOrders(playerOrders),
    botAction:describeOrders(botOrders),events,ended:game.finished,
    bidA:planA.bid,bidB:planB.bid,
    state:practiceView(game,"A"),
  };
}
