import {describe,test,expect} from "bun:test";
import {initHexDiskBoard} from "../../src/engine/board.ts";
import {cubeLineSymmetric,visibleCellsSymmetric} from "../../src/engine/fog-corrected.ts";
import {visibleCells} from "../../src/engine/fog.ts";
import {projectSeatObservation} from "../../src/gateway/observation.ts";
import {distance} from "../../src/engine/coords.ts";
import type {CubeCoord,HexCell,Unit} from "../../src/shared/types.ts";

const coord=(q:number,r:number):CubeCoord=>({q,r,s:-q-r});
const key=(p:CubeCoord)=>`${p.q},${p.r},${p.s}`;
const neg=(p:CubeCoord):CubeCoord=>({
  q:p.q===0?0:-p.q,r:p.r===0?0:-p.r,s:p.s===0?0:-p.s,
});
const unit=(owner:"A"|"B",pos:CubeCoord):Unit=>({
  id:"test-"+owner,owner,type:"scout",hp:5,strength:5,weight:1,position:pos,
});
function plainBoard():HexCell[][] {
  return initHexDiskBoard(6,173).map(row=>row.map(c=>({...c,terrain:"plain"})));
}
function put(board:HexCell[][],observer:Unit):void{
  const cell=board.flat().find(c=>key(c.position)===key(observer.position));
  if(!cell)throw Error("Observer off board");
  cell.unit=observer;
}

describe("isolated rotationally symmetric LOS v3 (legacy unchanged)",()=>{
  test("all radius-3 rays are valid cube coordinates with exact 180-degree equivariance",()=>{
    const all=plainBoard().flat().map(c=>c.position);
    let count=0;
    for(const origin of all)for(const target of all){
      const len=distance(origin,target);
      if(len>3)continue;
      const ray=cubeLineSymmetric(origin,target);
      const counterpart=cubeLineSymmetric(neg(origin),neg(target));
      expect(ray.length).toBe(len+1);
      expect(counterpart.length).toBe(ray.length);
      expect(key(ray[0])).toBe(key(origin));
      expect(key(ray.at(-1)!)).toBe(key(target));
      for(let i=0;i<ray.length;i++){
        expect(ray[i].q+ray[i].r+ray[i].s).toBe(0);
        expect(counterpart[i]).toEqual(neg(ray[i]));
      }
      count++;
    }
    expect(count).toBeGreaterThan(3000);
  });

  test("corrected profile reveals reachable enemy through clear two-hex diagonal, unlike frozen legacy",()=>{
    const own=unit("A",coord(0,0));
    const enemy=unit("B",coord(1,1));
    const board=plainBoard();
    put(board,own);
    put(board,enemy);
    const old=new Set(visibleCells(board,"A").map(key));
    const corrected=new Set(visibleCellsSymmetric(board,"A").map(key));
    expect(old.has(key(enemy.position))).toBe(false);
    expect(corrected.has(key(enemy.position))).toBe(true);

    const state={turn:0,visible:board.flat(),units:[own,enemy],
      score:{a:0,b:0},deadline:123456,roundCap:50};
    const archived=projectSeatObservation(state,"A");
    const versioned=projectSeatObservation(state,"A","cube-symmetric-v1");
    expect(archived.visible.some(c=>c.unit?.id===enemy.id)).toBe(false);
    expect(versioned.visible.some(c=>c.unit?.id===enemy.id)).toBe(true);
    expect(versioned.units).toEqual([own]);
    expect(archived.units).toEqual([own]);
    expect(versioned.reserves).toBeUndefined();
  });

  test("forest and mountain still conceal behind and inside cover; no offboard disclosures",()=>{
    const own=unit("A",coord(0,0));
    const enemy=unit("B",coord(1,1));
    const board=plainBoard();put(board,own);put(board,enemy);
    const obstacle=board.flat().find(c=>key(c.position)===key(coord(0,1)));
    expect(obstacle).toBeDefined();
    for(const terrain of ["forest","mountain"] as const){
      obstacle!.terrain=terrain;
      expect(visibleCellsSymmetric(board,"A").some(p=>key(p)===key(enemy.position))).toBe(false);
      expect(visibleCellsSymmetric(board,"A").some(p=>key(p)===key(obstacle!.position))).toBe(false);
    }
    obstacle!.terrain="plain";
    expect(visibleCellsSymmetric(board,"A").some(p=>key(p)===key(enemy.position))).toBe(true);
    const outside=unit("B",coord(5,0));
    const gameState={turn:0,visible:board.flat(),units:[own,outside],
      score:{a:0,b:0},deadline:1234,roundCap:50};
    const projection=projectSeatObservation(gameState,"A","cube-symmetric-v1");
    expect(projection.visible.every(c=>board.flat().some(x=>key(c.position)===key(x.position)))).toBe(true);
    expect(projection.visible.some(c=>c.unit?.id===outside.id)).toBe(false);
  });

  test("symmetric open terrain grants exactly mirrored observer footprints at eight starts",()=>{
    const starts=[coord(1,0),coord(1,1),coord(-3,1),coord(-4,0),
      coord(3,-2),coord(0,2),coord(-2,4),coord(4,-3)];
    for(const start of starts){
      const a=plainBoard(),b=plainBoard();
      put(a,unit("A",start));put(b,unit("B",neg(start)));
      const seenA=new Set(visibleCellsSymmetric(a,"A").map(key));
      const seenB=new Set(visibleCellsSymmetric(b,"B").map(key));
      expect(seenA.size).toBe(seenB.size);
      expect(new Set([...seenA].map(k=>key(neg((()=>{
        const [q,r,s]=k.split(",").map(Number);return{q,r,s};
      })()))))).toEqual(seenB);
    }
  });
});
