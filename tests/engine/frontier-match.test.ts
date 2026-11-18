import {describe,it,expect} from "bun:test";
import {createFrontierRoleMatch,numericFrontierSeed,ACTIVE_FRONTIER_RULES_VERSION} from "../../src/engine/frontier-match.ts";
import {createMatch} from "../../src/engine/match.ts";
import {projectSeatObservation} from "../../src/gateway/observation.ts";
import {FRONTIER_ROLES} from "../../src/engine/units.ts";

const key=(p:{q:number;r:number})=>p.q+","+p.r;
describe("one authoritative Frontier match source for every live surface",()=>{
  it("preserves existing seed codec, old 81-hex engine, and new five-role identity",()=>{
    const seed="frontier-parity-41";
    expect(numericFrontierSeed(seed)).toBeGreaterThan(0);
    expect(numericFrontierSeed(seed)).toBe(numericFrontierSeed(seed));
    expect(ACTIVE_FRONTIER_RULES_VERSION).toBe("hexawars-frontier127-five-roles-v1");
    expect(createMatch(seed).visible.length).toBe(81);
    expect(createMatch(seed).units.length).toBe(6);
    expect(createFrontierRoleMatch(seed).visible.length).toBe(127);
    expect(createFrontierRoleMatch(seed).units.length).toBe(10);
    expect(()=>createFrontierRoleMatch("")).toThrow("Match seed required");
  });
  it("generates equal 127-cell five-role armies in 64 seeded deployments",()=>{
    for(let i=0;i<64;i++){
      const seed="role-ctor-"+i;
      const a=createFrontierRoleMatch(seed);
      const b=createFrontierRoleMatch(seed);
      expect(a).toEqual(b);
      expect(a.visible.length).toBe(127);
      expect(a.frontierRaiderStrikes).toEqual([]);
      expect(a.units.length).toBe(10);
      expect(a.units.every(u=>u.hp>0)).toBe(true);
      for(const side of ["A","B"] as const){
        const army=a.units.filter(u=>u.owner===side);
        expect(army.length).toBe(5);
        expect(army.map(u=>u.type).sort()).toEqual([...FRONTIER_ROLES].sort());
        for(const u of army){
          const rival=a.units.find(e=>e.owner!==side&&e.type===u.type);
          expect(rival).toBeDefined();
          expect(rival!.position.q).toBe(-u.position.q);
          expect(rival!.position.r).toBe(-u.position.r);
          expect(rival!.hp).toBe(u.hp);
          expect(rival!.strength).toBe(u.strength);
        }
      }
      expect(new Set(a.visible.map(c=>key(c.position))).size).toBe(127);
      expect(new Set(a.units.map(u=>u.id)).size).toBe(10);
      const fromA=projectSeatObservation(a,"A","frontier-five-roles-v1");
      const fromB=projectSeatObservation(a,"B","frontier-five-roles-v1");
      for(const [side,seat] of [["A",fromA],["B",fromB]] as const){
        expect(seat.units.length).toBe(5);
        expect(seat.units.every(u=>u.owner===side)).toBe(true);
        const live=new Set(seat.visible.map(c=>key(c.position)));
        expect(seat.visible.every(c=>a.visible.some(x=>key(x.position)===key(c.position)))).toBe(true);
        expect(seat.visible.every(c=>!c.unit||c.unit.owner===side||
          live.has(key(c.unit.position)))).toBe(true);
        expect(seat.frontierRaiderStrikes).toBeUndefined();
      }
    }
  });
});