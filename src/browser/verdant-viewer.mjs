/**
 * HexaWars projection -> real Verdant Engine WebGL2 renderer.
 * No standalone rule simulation: consumes only public replay projections.
 * Renderer source is vendored from a pinned Verdant revision; see THIRD_PARTY_NOTICES.
 */
import { buildDemoFrames } from "../public/demo-replay.js";
import {
  createBestRenderer,
  mat4Perspective,
  mat4LookAt,
  mat4Mul,
} from "../vendor/verdant/scene-renderer.mjs";

const canvas = document.getElementById("verdant-stage");
const status = document.getElementById("backend-label");
const backend = document.getElementById("backend-kind");
const fall = document.getElementById("fallback");
const fallbackText = document.getElementById("fallback-text");
const headline = document.getElementById("headline");
const roundText = document.getElementById("round");
const slider = document.getElementById("round-slider");
const blue = document.getElementById("blue-count");
const red = document.getElementById("red-count");
const play = document.getElementById("play");
const stepPrevious = document.getElementById("prev");
const stepNext = document.getElementById("next");

const frames = buildDemoFrames()
  .filter(frame => frame.type === "MATCH_HELLO" || frame.type === "MATCH_STATE")
  .map(frame => frame.projection);
if (!frames.length || !frames.every(frame => Array.isArray(frame?.board?.cells))) {
  throw new Error("HexaWars demo contains no usable public board projections");
}
let step = 0;
let renderer = null;
let yaw = 0.68, elevation = 0.83, distance = 27;
let playback = null;
let meshEpoch = 0;
let dragging = false, pointerX = 0, pointerY = 0;
let fatal = false;

slider.max = String(frames.length);
slider.value = "1";

const terrainStyle = {
  plain: { height: .18, color: [0.22, 0.45, 0.40] },
  plains: { height: .18, color: [0.22, 0.45, 0.40] },
  forest: { height: .42, color: [0.14, 0.33, 0.23] },
  hills: { height: .60, color: [0.45, 0.41, 0.31] },
  mountain: { height: .96, color: [0.53, 0.58, 0.61] },
  water: { height: .06, color: [0.12, 0.31, 0.45] },
};
const normalizeTerrain = value => terrainStyle[String(value ?? "plain").toLowerCase()] ?? terrainStyle.plain;
const radius = .74, SQRT3 = Math.sqrt(3);

function worldPos(cell) {
  return [cell.q * (1.5 * radius), (cell.r + cell.q / 2) * (SQRT3 * radius)];
}

function tint(c, multiplier) {
  return c.map(value => Math.max(0, Math.min(.96, value * multiplier)));
}

/** Non-shared triangle vertices keep each hex face normal correct. */
function meshBuilder() {
  const pos = [], norm = [], col = [], idx = [];
  function tri(a, b, c, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const n = Math.hypot(nx, ny, nz) || 1;
    nx /= n; ny /= n; nz /= n;
    for (const vertex of [a, b, c]) {
      pos.push(...vertex);
      norm.push(nx, ny, nz);
      col.push(...color);
      idx.push(idx.length);
    }
  }
  function hex(q, r, altitude, color, size = radius, depth = .20) {
    const [x,z] = worldPos({q,r});
    const corners = Array.from({length:6},(_,k)=>{
      const a = k*Math.PI/3;
      return [x+Math.cos(a)*size, altitude, z+Math.sin(a)*size];
    });
    const centre = [x,altitude,z], base = altitude-depth;
    for(let k=0;k<6;k++){
      const now=corners[k], next=corners[(k+1)%6];
      tri(centre,next,now,color);
      const b1=[now[0],base,now[2]],b2=[next[0],base,next[2]];
      tri(now,next,b1,tint(color,.68));
      tri(b1,next,b2,tint(color,.68));
    }
  }
  function unit(unitData, cell) {
    const [x,z]=worldPos(cell);
    const ground=normalizeTerrain(cell.terrain).height;
    const heavy=["heavy","siege","captain"].includes(String(unitData.type).toLowerCase());
    const baseRadius=heavy?.30:.22;
    const height=heavy?.92:.66;
    const color=unitData.side==="A" ? [0.16,0.49,0.91] : [0.86,0.22,0.25];
    const top=[x,ground+height+.10,z];
    const rim=Array.from({length:6},(_,k)=>{
      const a=k*Math.PI/3;
      return [x+Math.cos(a)*baseRadius,ground+.08,z+Math.sin(a)*baseRadius];
    });
    const base=[x,ground+.08,z];
    for(let k=0;k<6;k++) {
      const a=rim[k],b=rim[(k+1)%6];
      tri(top,b,a,color);
      tri(base,a,b,tint(color,.56));
    }
    // Outer base bevel: visibly different heights by role without implying
    // any change to unit type, health, movement or combat properties.
  }

  return {
    tri,hex,unit,
    result:()=>({
      pos:new Float32Array(pos), norm:new Float32Array(norm),
      col:new Float32Array(col), idx:new Uint32Array(idx),
    }),
  };
}

function projectMesh(projection) {
  const b = meshBuilder();
  const cells = projection.board.cells;
  const byCell = new Map();
  for (const cell of cells) {
    if (!Number.isFinite(cell.q) || !Number.isFinite(cell.r)) continue;
    const [x,z] = worldPos(cell);
    void x; void z;
    const style=normalizeTerrain(cell.terrain);
    let color=style.color;
    if(cell.controlledBy==="A")color=[color[0]*.75,color[1]*.92,Math.min(1,color[2]*1.6)];
    if(cell.controlledBy==="B")color=[Math.min(1,color[0]*1.6),color[1]*.78,color[2]*.72];
    b.hex(cell.q,cell.r,style.height,color);
    byCell.set(`${cell.q},${cell.r}`,cell);
  }
  for (const unit of projection.board.units) {
    const cell=byCell.get(`${unit.q},${unit.r}`);
    if(cell)b.unit(unit,cell);
  }
  return b.result();
}

function displayFrame(next) {
  if (!renderer) return;
  step=(next+frames.length)%frames.length;
  const projection=frames[step];
  const mesh=projectMesh(projection);
  renderer.uploadPackedBuffers(mesh.pos,mesh.norm,mesh.col,mesh.idx);
  meshEpoch++;
  slider.value=String(step+1);
  roundText.textContent=`${step+1} / ${frames.length}`;
  headline.textContent=projection.featured?.headline ?? "Tactical deployment";
  blue.textContent=String(projection.board.units.filter(u=>u.side==="A").length);
  red.textContent=String(projection.board.units.filter(u=>u.side==="B").length);
}

function resizeCanvas() {
  const box=canvas.getBoundingClientRect();
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const w=Math.max(2,Math.round(box.width*dpr));
  const h=Math.max(2,Math.round(box.height*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
}

function draw(now) {
  if(fatal)return;
  resizeCanvas();
  const aspect=Math.max(.25,canvas.width/Math.max(1,canvas.height));
  const eye=[
    Math.sin(yaw)*Math.cos(elevation)*distance,
    Math.sin(elevation)*distance,
    Math.cos(yaw)*Math.cos(elevation)*distance,
  ];
  const target=[0,0,0];
  const fov=Math.PI/3.4;
  const projection=mat4Perspective(fov,aspect,.1,120);
  const view=mat4LookAt(eye,target,[0,1,0]);
  renderer.render(mat4Mul(projection,view),eye,{
    rank:2,sky:[.075,.14,.22],fog:[.14,.21,.30],
  },now/1000,target,fov);
  requestAnimationFrame(draw);
}

function stopReplay(){
  if(playback!==null)clearInterval(playback);
  playback=null;
  play.textContent="Play replay";
  play.setAttribute("aria-pressed","false");
}
function toggleReplay(){
  if(playback!==null){stopReplay();return;}
  play.textContent="Pause replay";
  play.setAttribute("aria-pressed","true");
  playback=setInterval(()=>displayFrame(step+1),1250);
}

slider.addEventListener("input",()=>{stopReplay();displayFrame(Number(slider.value)-1);});
stepPrevious.addEventListener("click",()=>{stopReplay();displayFrame(step-1);});
stepNext.addEventListener("click",()=>{stopReplay();displayFrame(step+1);});
play.addEventListener("click",toggleReplay);
canvas.addEventListener("pointerdown",event=>{
  dragging=true;pointerX=event.clientX;pointerY=event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove",event=>{
  if(!dragging)return;
  yaw+=(event.clientX-pointerX)*.009;
  elevation=Math.max(.28,Math.min(1.35,elevation+(pointerY-event.clientY)*.008));
  pointerX=event.clientX;pointerY=event.clientY;
});
const release=()=>{dragging=false;};
canvas.addEventListener("pointerup",release);
canvas.addEventListener("pointercancel",release);
canvas.addEventListener("wheel",event=>{
  event.preventDefault();
  distance=Math.max(14,Math.min(46,distance+Math.sign(event.deltaY)*2));
},{passive:false});
window.addEventListener("visibilitychange",()=>{if(document.hidden)stopReplay();});

try{
  renderer=await createBestRenderer(canvas);
  if(!renderer||renderer.backend!=="webgl2"){
    throw new Error("WebGL2 is unavailable. The classic SVG replay remains accessible.");
  }
  status.textContent="Verdant WebGL2 scene renderer · pinned revision";
  backend.textContent=renderer.backend;
  displayFrame(0);
  requestAnimationFrame(draw);
}catch(err){
  fatal=true;
  fall.hidden=false;
  fallbackText.textContent=String(err?.message||err);
  status.textContent="No WebGL2 renderer; SVG replay available";
  backend.textContent="Unavailable";
  stopReplay();
}
