import test from "node:test";
import assert from "node:assert/strict";
import { buildDemoFrames } from "../dist/pages/demo-replay.js";
import { axialDisk, axialToWorld, boardBounds, buildBattlefieldMesh } from "../src/browser/battlefield-geometry.mjs";

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
    assert(m.col.every(c=>Number.isFinite(c)&&c>=0&&c<=1),"Invalid material color");
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
