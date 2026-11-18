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
import { initBoard, initHexDiskBoard } from "./rules/engine/board.js";
import { placeStartingUnits, getAllUnits } from "./rules/engine/units.js";
import { newBudget } from "./rules/engine/round-state.js";
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
});
export function newPractice(seed="practice-alpha-01",topology="legacy81"){
  if(typeof seed!=="string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(seed)){
    throw new Error("Seed must be 1–48 letters, digits, underscores or dashes");
  }
  if(!Object.hasOwn(PRACTICE_TOPOLOGIES,topology)){
    throw new Error("Unsupported board topology");
  }
  const encodedSeed=numericSeed(seed);
  const board=topology==="balanced61"
    ?initHexDiskBoard(4,encodedSeed)
    :initBoard(9,encodedSeed);
  placeStartingUnits(board,encodedSeed);
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
    board:game.state.visible.map(c=>({
      q:c.position.q,r:c.position.r,terrain:c.terrain,
      controlledBy:c.controlledBy??null,
    })),
    units:[...own,...opponents].map(u=>({
      id:u.id,side:u.owner,q:u.position.q,r:u.position.r,
      hp:u.hp,strength:u.strength,type:u.type,
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
export function legalCommands(game,side,unitId){
  if(game.finished||!SIDES.has(side))return [];
  const unit=ownUnits(game,side).find(u=>u.id===unitId);
  if(!unit)return [];
  const occupied=new Set(game.state.units.map(u=>key(u.position)));
  const options=[];
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
    if(distance(unit.position,enemy.position) <= (RANGE[unit.type]??1)){
      const cmd={kind:"attack",unitId,to:clonePos(enemy.position)};
      if(validateRoundPlan(planForAction(unit,cmd),side,game.state,
        side==="A"?game.budgetA:game.budgetB).ok)options.push(cmd);
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
  moves.sort((a,b)=>evaluate(b)-evaluate(a)||
    a.unitId.localeCompare(b.unitId)||a.to.q-b.to.q||a.to.r-b.to.r);
  return moves[0];
}
function checkedPlan(game,side,action){
  if(!action||action.kind==="pass")return PASS;
  if(!["move","attack"].includes(action.kind)||typeof action.unitId!=="string"){
    throw new Error("Select a unit and a move or attack");
  }
  if(!action.to||!Number.isInteger(action.to.q)||!Number.isInteger(action.to.r)||
    !Number.isInteger(action.to.s)||action.to.q+action.to.r+action.to.s!==0){
    throw new Error("Invalid hex coordinates");
  }
  const unit=ownUnits(game,side).find(u=>u.id===action.unitId);
  if(!unit)throw new Error("Not one of your units");
  const allowed=legalCommands(game,side,unit.id);
  const chosen=allowed.find(x=>x.kind===action.kind&&exactlySame(x.to,action.to));
  if(!chosen)throw new Error("That action is not legal this round");
  const plan=planForAction(unit,chosen);
  const valid=validateRoundPlan(plan,side,game.state,
    side==="A"?game.budgetA:game.budgetB);
  if(!valid.ok)throw new Error(`Plan rejected: ${valid.reason}`);
  return plan;
}
export function advancePractice(game,action){
  if(game.finished)throw new Error("Match ended; start a new battle");
  if(game.round>=ROUND_CAP)throw new Error("Round limit reached");
  const planA=checkedPlan(game,"A",action);
  const aiAction=chooseBotAction(game,"B");
  const planB=checkedPlan(game,"B",aiAction);
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
  for(const [side,command] of [["A",action],["B",aiAction]]){
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
  game.history.push({round:game.round,player:action?.kind??"pass",
    bot:aiAction.kind,events,
    playerMove:action?.kind==="move"?structuredClone(action):null,
    botMove:aiAction.kind==="move"?structuredClone(aiAction):null});
  return {
    round:game.round,playerAction:action?.kind??"pass",
    botAction:aiAction.kind,events,ended:game.finished,
    state:practiceView(game,"A"),
  };
}
