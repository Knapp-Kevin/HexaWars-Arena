import test from "node:test";
import assert from "node:assert/strict";
import { buildDemoFrames } from "../dist/pages/demo-replay.js";
import { axialDisk, axialToWorld, boardBounds, buildBattlefieldMesh, buildBattlefieldLayers, buildUnitsMesh } from "../src/browser/battlefield-geometry.mjs";
import { createReplayTransition, tweenReplay } from "../src/browser/replay-motion.mjs";

const frames=buildDemoFrames().filter(f=>f.type==="MATCH_HELLO"||f.type==="MATCH_STATE");
test("61-cell radius-four footprint is complete, symmetric and unchanged across replay",()=>{
  const expected=axialDisk(4);
  assert.equal(expected.length,61);
  const first=frames[0].projection.board.cells;
  assert.equal(first.length,61);
  const cells=new Set(first.map(c=>`${c.q},${c.r}`));
  assert.equal(cells.size,61);
  for(const [q,r] of expected){
    assert(cells.has(`${q},${r}`),`Missing expected cell ${q},${r}`);
    assert(cells.has(`${-q},${-r}`),`No diametrically opposite cell for ${q},${r}`);
  }
  for(const frame of frames){
    assert.equal(frame.projection.board.cells.length,61);
    for(const unit of frame.projection.board.units){
      assert(cells.has(`${unit.q},${unit.r}`),`Unit ${unit.id} outside balanced map`);
    }
  }
});
test("geometry stays aligned to public axial projection and centered on origin",()=>{
  assert.deepEqual(axialToWorld({q:0,r:0}),[0,0]);
  const map=boardBounds(frames[0].projection.board.cells);
  assert(Math.abs(map.center[0])<1e-6);
  assert(Math.abs(map.center[2])<1e-6);
  assert(map.halfExtent>4);
  assert(map.halfExtent<7);
});
test("all 12 frames produce deterministic, finite and detailed Verdant meshes",()=>{
  assert.equal(frames.length,12);
  const meshes=[];
  for(const frame of frames){
    const m=buildBattlefieldMesh(frame.projection);
    assert(m.pos instanceof Float32Array);
    assert(m.idx instanceof Uint32Array);
    assert.equal(m.pos.length,m.norm.length);
    assert.equal(m.pos.length,m.col.length);
    assert.equal(m.pos.length/3,m.idx.length, "One uint index per three-component vertex");
    assert.equal(m.pos.length%9,0);
    assert(m.pos.length>16000,"Missing detailed geometry");
    assert(m.pos.length<1500000,"Unbounded geometry budget");
    assert(m.pos.every(Number.isFinite),"Nonfinite vertex");
    assert(m.norm.every(Number.isFinite),"Nonfinite normal");
    assert(m.col.every((c,i)=>Number.isFinite(c)&&c>=0&&c<(i%3===0?4:1)),
      "Invalid Verdant material channel");
    const tags=new Set();
    for(let i=0;i<m.col.length;i+=3)tags.add(Math.floor(m.col[i]));
    for(const material of [0,1,2,3]){
      assert(tags.has(material),`Missing Verdant diffuse/water/metal/emissive material ${material}`);
    }
    assert.equal(m.idx.at(-1),m.idx.length-1);
    meshes.push(m);
  }
  const again=buildBattlefieldMesh(frames[0].projection);
  assert.deepEqual(meshes[0].pos,again.pos);
  assert.deepEqual(meshes[0].col,again.col);
});
test("geometry rejects duplicates and does not invent hidden units",()=>{
  const first=frames[0].projection;
  assert.throws(()=>buildBattlefieldMesh({board:{cells:[...first.board.cells,first.board.cells[0]],units:[]}}),/Duplicate/);
  const unoccupied=buildBattlefieldMesh({board:{cells:first.board.cells,units:[]}});
  const occupied=buildBattlefieldMesh(first);
  assert(occupied.pos.length>unoccupied.pos.length,"No visible unit geometry was emitted");
});

test("detailed unit classes have distinct geometry rather than recolored cones",()=>{
  const base=frames[0].projection;
  const kinds=new Map();
  for(const unit of base.board.units){
    if(kinds.has(unit.type))continue;
    const mesh=buildUnitsMesh({board:{cells:base.board.cells,units:[unit]}});
    assert(mesh.idx.length>200,`Weak model detail for ${unit.type}`);
    kinds.set(unit.type,mesh.idx.length);
  }
  assert(kinds.size>=4,"Historical replay requires multiple squad roles");
  assert(new Set(kinds.values()).size>=4,"Role models do not have distinctive geometric complexity");
});

test("split terrain and dynamic units preserve public projections",()=>{
  const first=frames[0].projection;
  const layers=buildBattlefieldLayers(first);
  assert(layers.terrain.idx.length>0&&layers.units.idx.length>0);
  const dynamic=buildUnitsMesh(first);
  assert.deepEqual(layers.units.pos,dynamic.pos);
  assert.deepEqual(layers.units.col,dynamic.col);
  const withoutUnits=buildBattlefieldLayers({board:{cells:first.board.cells,units:[]}});
  assert.deepEqual(layers.terrain.pos,withoutUnits.terrain.pos);
  assert.equal(withoutUnits.units.idx.length,0);
});

test("replay motion interpolates only public unit snapshots, with stable endpoints",()=>{
  let moved=0,hurt=0;
  for(let i=1;i<frames.length;i++){
    const before=frames[i-1].projection,after=frames[i].projection;
    const transition=createReplayTransition(before,after);
    moved+=transition.moves.length;
    hurt+=transition.hits.length;
    const start=tweenReplay(transition,0),mid=tweenReplay(transition,.5),end=tweenReplay(transition,1);
    const known=new Set(after.board.units.map(x=>x.id));
    for(const move of transition.moves){
      assert(known.has(move.id),"Animation invented a hidden or removed unit");
      assert.deepEqual([start[move.id].x,start[move.id].z],[move.x0,move.z0]);
      assert.deepEqual([end[move.id].x,end[move.id].z],[move.x1,move.z1]);
      assert(mid[move.id].lift>0);
    }
    const mesh=buildUnitsMesh(after,mid);
    assert(mesh.pos.every(Number.isFinite),"Animated mesh contains nonfinite coordinates");
  }
  assert(moved>0,"No movement transitions in replay");
  assert(hurt>0,"No damage transitions in replay");
});
