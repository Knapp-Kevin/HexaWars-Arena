import { describe,expect,test } from "bun:test";
import { createFrontierObjectiveMatch,ACTIVE_FRONTIER_RULES_VERSION } from "../../src/engine/frontier-match.ts";
import { newBudget } from "../../src/engine/round-state.ts";
import { projectSeatObservation } from "../../src/gateway/observation.ts";
import { LiveAgentChannel,LIVE_PROTOCOL_VERSION } from "../../src/gateway/live-channel.ts";
import { LiveConnections } from "../../src/gateway/live-connections.ts";
import { PresenceTracker } from "../../src/matchmaker/presence.ts";

const matchId="match-frontier-live-1";
const pass={bid:0,extras:[]};
const frame=()=>({
  state:projectSeatObservation(createFrontierObjectiveMatch("private-not-public"),
    "A","frontier-five-roles-v1"),
  budget:newBudget(),
});
const wire=(plan:unknown,turn=0,id=matchId,protocol=LIVE_PROTOCOL_VERSION,
  rules=ACTIVE_FRONTIER_RULES_VERSION)=>JSON.stringify({
    type:"PLAN",matchId:id,turn,protocolVersion:protocol,rulesVersion:rules,plan,
  });
function socket(){
  const messages:Record<string,unknown>[]=[];
  return {messages,send(raw:string){messages.push(JSON.parse(raw));}};
}

describe("live agent channel: one explicit five-role Frontier contract",()=>{
  test("STATE contains only seat private Frontier observations with exact version",async()=>{
    const s=socket(),channel=new LiveAgentChannel(matchId,s);
    channel.send(frame());
    expect(s.messages[0].type).toBe("STATE");
    expect(s.messages[0].matchId).toBe(matchId);
    expect(s.messages[0].protocolVersion).toBe(LIVE_PROTOCOL_VERSION);
    expect(s.messages[0].rulesVersion).toBe(ACTIVE_FRONTIER_RULES_VERSION);
    expect(s.messages[0].maxMoveSlots).toBe(2);
    expect(s.messages[0].maxFreeAttacks).toBe(1);
    expect(s.messages[0].objectiveHold).toEqual({a:0,b:0});
    const sites=s.messages[0].objectiveSites as Array<{owner:string|null;position:unknown}>;
    expect(sites.length).toBe(5);
    expect(sites.every(s=>s.owner===null&&s.position)).toBe(true);
    expect(sites.every(s=>!Object.hasOwn(s,"unit"))).toBe(true);
    expect(JSON.stringify(s.messages[0])).not.toContain("private-not-public");
    const own=s.messages[0].units as Array<{owner:string;type:string}>;
    expect(own.length).toBe(5);
    expect(own.every(u=>u.owner==="A")).toBe(true);
    expect(own.map(u=>u.type).sort()).toEqual([
      "captain","interceptor","raider","scout","siege",
    ]);
    const pending=channel.receivePlan();
    expect(channel.acceptMessage(wire(pass,8))).toBe(false);
    expect(s.messages.at(-1)?.code).toBe("wrong_turn");
    expect(channel.acceptMessage(wire(pass))).toBe(true);
    expect(await pending).toEqual(pass);
    expect(channel.acceptMessage(wire(pass))).toBe(false);
  });

  test("quick plan is buffered exactly once until runner consumes it",async()=>{
    const s=socket(),channel=new LiveAgentChannel(matchId,s);
    channel.send(frame());
    expect(channel.acceptMessage(wire(pass))).toBe(true);
    expect(await channel.receivePlan()).toEqual(pass);
    expect(channel.acceptMessage(wire(pass))).toBe(false);
  });

  test("rejects stale protocol and rules identities rather than silently playing old economy",async()=>{
    const s=socket(),channel=new LiveAgentChannel(matchId,s);
    channel.send(frame());
    expect(channel.acceptMessage(JSON.stringify({
      type:"PLAN",matchId,turn:0,plan:pass,
    }))).toBe(false);
    expect(s.messages.at(-1)?.code).toBe("incompatible_protocol");
    expect(channel.acceptMessage(wire(pass,0,matchId,"3.0-alpha"))).toBe(false);
    expect(s.messages.at(-1)?.code).toBe("incompatible_protocol");
    expect(channel.acceptMessage(wire(pass,0,matchId,LIVE_PROTOCOL_VERSION,
      "hexawars-frontier127-maneuver-v3-vision"))).toBe(false);
    expect(s.messages.at(-1)?.code).toBe("incompatible_rules");
    expect(channel.acceptMessage(wire(pass))).toBe(true);
    expect(await channel.receivePlan()).toEqual(pass);
  });

  test("wire validates both movement slots, wrong match, malformed coordinates and extra keys",async()=>{
    const s=socket(),channel=new LiveAgentChannel(matchId,s);
    channel.send(frame());
    expect(channel.acceptMessage("{")).toBe(false);
    expect(channel.acceptMessage(wire(pass,0,"another"))).toBe(false);
    expect(s.messages.at(-1)?.code).toBe("wrong_match");
    const pos={q:-5,r:0,s:5};
    const end1={q:-4,r:0,s:4},end2={q:-3,r:0,s:3};
    const legalShape={...pass,
      freeMove:{unitId:"frontier-A-1-scout",from:pos,to:end1},
      secondMove:{unitId:"frontier-A-2-raider",from:pos,to:end2},
    };
    expect(channel.acceptMessage(wire({...legalShape,
      secondMove:{...legalShape.secondMove,to:{q:1,r:1,s:0}}}))).toBe(false);
    expect(s.messages.at(-1)?.code).toBe("invalid_plan_shape");
    expect(channel.acceptMessage(wire({...legalShape,thirdMove:legalShape.freeMove}))).toBe(false);
    expect(channel.acceptMessage(wire(legalShape))).toBe(true);
    expect(await channel.receivePlan()).toEqual(legalShape);
  });

  test("disconnect immediately rejects pending round without creating a phantom pass",async()=>{
    const channel=new LiveAgentChannel(matchId,socket());
    channel.send(frame());
    const pending=channel.receivePlan();
    channel.disconnect();
    await expect(pending).rejects.toThrow("socket disconnected");
    expect(channel.closed).toBe(true);
  });

  test("live rounds come only from bound Frontier channels, not spectator simulator",async()=>{
    const presence=new PresenceTracker(),live=new LiveConnections(presence);
    const a=socket(),b=socket();
    expect(live.activeRound(matchId)).toBeNull();
    expect(live.open(10,a)).toBe(true);
    expect(live.open(20,b)).toBe(true);
    expect(live.activeRound(matchId)).toBeNull();
    const pair=live.bind(10,20,matchId)!;
    expect(live.activeRound("other-match")).toBeNull();
    expect(live.activeRound(matchId)).toBe(0);
    const first=frame();
    pair.a.send(first);
    pair.b.send({...first,state:{...first.state,turn:0}});
    expect(live.activeRound(matchId)).toBe(0);
    expect(pair.a.acceptMessage(wire(pass))).toBe(true);
    expect(await pair.a.receivePlan()).toEqual(pass);
    // A completed round plan must not make the match disappear until END.
    expect(live.activeRound(matchId)).toBe(0);
    const second={...first,state:{...first.state,turn:1}};
    pair.a.send(second);
    pair.b.acceptMessage(wire(pass));
    expect(await pair.b.receivePlan()).toEqual(pass);
    pair.b.send(second);
    expect(live.activeRound(matchId)).toBe(1);
    live.complete(10,20,matchId,{winnerOperatorId:10,reason:"decisive"});
    expect(live.activeRound(matchId)).toBeNull();
    expect(live.available(10)).toBe(true);
    expect(live.available(20)).toBe(true);
    expect(JSON.stringify(a.messages)).not.toContain("private-not-public");
    live.close(10,a);live.close(20,b);
    expect(presence.size()).toBe(0);
  });

  test("HELLO declares one 127-cell 5v5 ruleset, no seed; operator cleanup preserved",()=>{
    const presence=new PresenceTracker(),live=new LiveConnections(presence);
    const a=socket(),b=socket();
    expect(live.open(10,a)).toBe(true);
    expect(live.open(20,b)).toBe(true);
    expect(live.open(10,a)).toBe(false);
    expect(presence.size()).toBe(2);
    const channels=live.bind(10,20,matchId);
    expect(channels).not.toBeNull();
    expect(a.messages[0].type).toBe("HELLO");
    expect(a.messages[0].rulesVersion).toBe(ACTIVE_FRONTIER_RULES_VERSION);
    expect(a.messages[0].protocolVersion).toBe(LIVE_PROTOCOL_VERSION);
    expect(a.messages[0].boardCells).toBe(127);
    expect(a.messages[0].freeMoves).toBe(2);
    expect(a.messages[0].freeAttacks).toBe(1);
    expect(a.messages[0].objectiveTarget).toBe(3);
    expect((a.messages[0].objectiveSites as unknown[]).length).toBe(5);
    expect(JSON.stringify(a.messages[0])).not.toContain("seed");
    expect(live.bind(10,20,"another")).toBeNull();
    live.complete(10,20,matchId,{winnerOperatorId:10,reason:"decisive"});
    expect(a.messages.at(-1)?.type).toBe("END");
    expect(live.available(10)).toBe(true);
    live.close(10,a);
    expect(presence.size()).toBe(1);
  });
});