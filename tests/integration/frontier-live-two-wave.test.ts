import {afterEach,describe,expect,test} from "bun:test";
import type {Database} from "bun:sqlite";
import {openDb,initDb} from "../../src/persistence/db.ts";
import {createOperator} from "../../src/identity/operator.ts";
import {registerAgentVersion} from "../../src/identity/agent-version.ts";
import {MatchRunner} from "../../src/runner/runner.ts";
import {LiveAgentChannel,LIVE_PROTOCOL_VERSION} from "../../src/gateway/live-channel.ts";
import {createFrontierObjectiveMatch,ACTIVE_FRONTIER_RULES_VERSION} from "../../src/engine/frontier-match.ts";
import {validateFrontierRoundPlan} from "../../src/gateway/frontier-round-validator.ts";
import {newBudget} from "../../src/engine/round-state.ts";
import {streamEvents,getMatch} from "../../src/persistence/match-store.ts";
import type {MatchState,FrontierRoundPlan,CubeCoord} from "../../src/shared/types.ts";

const pass:FrontierRoundPlan={bid:0,extras:[]};
const pos=(coord:CubeCoord)=>({...coord});
function legalTwoMoves(state:MatchState):FrontierRoundPlan{
  const own=state.units.filter(u=>u.owner==="A");
  for(const u of own){
    for(const c of state.visible){
      const first={unitId:u.id,from:pos(u.position),to:pos(c.position)};
      const candidate:FrontierRoundPlan={...pass,freeMove:first};
      if(!validateFrontierRoundPlan(candidate,"A",state,newBudget(),true).ok)continue;
      for(const v of own.filter(x=>x.id!==u.id)){
        for(const other of state.visible){
          const second={unitId:v.id,from:pos(v.position),to:pos(other.position)};
          const plan:FrontierRoundPlan={...candidate,secondMove:second};
          if(validateFrontierRoundPlan(plan,"A",state,newBudget(),true).ok)return plan;
        }
      }
    }
  }
  throw new Error("Expected two distinct legal Frontier movement opportunities");
}
function dbAndIdentities(){
  const db=openDb(":memory:");
  initDb(db);
  const a=createOperator(db,"frontier_live_a").operator;
  const b=createOperator(db,"frontier_live_b").operator;
  const register=(operatorId:number,label:string)=>registerAgentVersion(db,{
    operatorId,modelId:"five-role-"+label,code:"sample",config:"{}",
    promptTemplate:"pass",
  }).agentVersion.id;
  return {db,a,b,av:register(a.id,"a"),bv:register(b.id,"b")};
}
function responder(matchId:string,side:"A"|"B",plan:FrontierRoundPlan,
  frames:Record<string,unknown>[],sendBad=false){
  let channel:LiveAgentChannel;
  const socket={
    send(raw:string){
      const data=JSON.parse(raw) as Record<string,unknown>;
      frames.push(data);
      if(data.type!=="STATE")return;
      channel.acceptMessage(JSON.stringify({
        type:"PLAN",matchId,turn:data.turn,
        protocolVersion:LIVE_PROTOCOL_VERSION,
        rulesVersion:ACTIVE_FRONTIER_RULES_VERSION,
        plan:sendBad?{...plan,secondMove:plan.freeMove}:
          data.turn===0?plan:pass,
      }));
    },
  };
  channel=new LiveAgentChannel(matchId,socket);
  return channel;
}

describe("real Frontier match runner executes identical 5v5 two-wave plans as browser",()=>{
  const dbs:Database[]=[];
  afterEach(()=>{for(const db of dbs.splice(0))db.close();});
  test("two separate auth-bound live agents get private Scout vision; second wave persists to replay",async()=>{
    const auth=dbAndIdentities();dbs.push(auth.db);
    const seed="frontier-live-two-waves",matchId="live-frontier-two-wave";
    const planA=legalTwoMoves(createFrontierObjectiveMatch(seed));
    const receivedA:Record<string,unknown>[]=[],receivedB:Record<string,unknown>[]=[];
    const a=responder(matchId,"A",planA,receivedA);
    const b=responder(matchId,"B",pass,receivedB);
    const result=await new MatchRunner(auth.db).start({
      matchId,seed,a:{id:auth.a.id,agentVersionId:auth.av},
      b:{id:auth.b.id,agentVersionId:auth.bv},
    },{a,b},250);
    expect(["decisive","timeout"]).toContain(result.reason);
    for(const [side,frames] of [["A",receivedA],["B",receivedB]] as const){
      const first=frames.find(x=>x.type==="STATE")!;
      const roster=first.units as Array<{id:string;owner:string;type:string}>;
      expect(roster.length).toBe(5);
      expect(roster.every(x=>x.owner===side)).toBe(true);
      expect(roster.map(x=>x.type).sort()).toEqual([
        "captain","interceptor","raider","scout","siege"]);
      expect((first.visible as unknown[]).length).toBeLessThan(127);
      expect(first.protocolVersion).toBe(LIVE_PROTOCOL_VERSION);
      expect(first.rulesVersion).toBe(ACTIVE_FRONTIER_RULES_VERSION);
      expect((first.frontierObjectiveHold as {a:number;b:number})).toEqual({a:0,b:0});
      expect(JSON.stringify(frames)).not.toContain(seed);
      expect(JSON.stringify(frames)).not.toContain("frontierRaiderStrikes");
    }
    const events=Array.from(streamEvents(auth.db,matchId));
    const moves=events.filter(e=>e.eventType==="unit_moved");
    expect(moves.length).toBeGreaterThanOrEqual(2);
    const moved=new Set(moves.map(e=>
      (JSON.parse(e.payload) as {unitId:string}).unitId));
    expect(moved.has(planA.freeMove!.unitId)).toBe(true);
    expect(moved.has(planA.secondMove!.unitId)).toBe(true);
    expect(getMatch(auth.db,matchId)?.outcome).not.toBeNull();
    expect(events.at(-1)?.eventType).toBe("match_seed_revealed");
    expect(JSON.parse(events.at(-1)!.payload)).toEqual({seed});
  },10000);

  test("malicious duplicate unit in second wave causes canonical invalid-plan loss, never executes",async()=>{
    const auth=dbAndIdentities();dbs.push(auth.db);
    const seed="frontier-live-forged-wave",matchId="live-frontier-invalid";
    const planA=legalTwoMoves(createFrontierRoleMatch(seed));
    const aFrames:Record<string,unknown>[]=[];
    const a=responder(matchId,"A",planA,aFrames,true);
    const b=responder(matchId,"B",pass,[]);
    const result=await new MatchRunner(auth.db).start({
      matchId,seed,a:{id:auth.a.id,agentVersionId:auth.av},
      b:{id:auth.b.id,agentVersionId:auth.bv},
    },{a,b},250);
    expect(result.reason).toBe("invalid_plan");
    expect(result.winnerOperatorId).toBe(auth.b.id);
    const events=Array.from(streamEvents(auth.db,matchId));
    expect(events.some(e=>e.eventType==="unit_moved")).toBe(false);
    expect(events.at(-1)?.eventType).toBe("match_seed_revealed");
  },10000);
});