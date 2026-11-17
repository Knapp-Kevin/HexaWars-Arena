/**
 * HexaWars projection -> real Verdant Engine WebGL2 renderer.
 * No standalone rule simulation: consumes only public replay projections.
 * Renderer source is vendored from a pinned Verdant revision; see THIRD_PARTY_NOTICES.
 */
import { buildDemoFrames } from "../public/demo-replay.js";
import { boardBounds, buildBattlefieldLayers, buildUnitsMesh } from "./battlefield-geometry.mjs";
import { createReplayTransition, tweenReplay } from "./replay-motion.mjs";
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
const zoomIn = document.getElementById("camera-zoom-in");
const zoomOut = document.getElementById("camera-zoom-out");
const resetCamera = document.getElementById("camera-reset");
const zoomReadout = document.getElementById("zoom-readout");
const tileCount = document.getElementById("tile-count");
const mobilePrevious=document.getElementById("mobile-prev");
const mobileNext=document.getElementById("mobile-next");
const mobilePlay=document.getElementById("mobile-play");
const compactRound=document.getElementById("compact-round");
const mobileBlueCount=document.getElementById("mobile-blue-count");
const mobileRedCount=document.getElementById("mobile-red-count");

const frames = buildDemoFrames()
  .filter(frame => frame.type === "MATCH_HELLO" || frame.type === "MATCH_STATE")
  .map(frame => frame.projection);
if (!frames.length || !frames.every(frame => Array.isArray(frame?.board?.cells))) {
  throw new Error("HexaWars demo contains no usable public board projections");
}
const bounds = boardBounds(frames[0].board.cells);
// Narrow screens need a longer overview distance or a valid symmetric board
// is clipped by the horizontal field of view before the user zooms in.
const canvasBox = canvas.getBoundingClientRect();
const screenAspect = canvasBox.width / Math.max(1,canvasBox.height);
const HOME_DISTANCE = Math.max(12.8,bounds.halfExtent*2.55) *
  Math.max(1,1.10/Math.max(.5,screenAspect));
const MIN_DISTANCE = Math.max(6.7, HOME_DISTANCE * 0.49);
const MAX_DISTANCE = HOME_DISTANCE * 2.7;
const HOME_YAW = 0.72, HOME_ELEVATION = 0.97;
let step = 0;
let renderer = null;
let yaw = HOME_YAW, elevation = HOME_ELEVATION, distance = HOME_DISTANCE;
const target = [...bounds.center];
let playback = null;
let fatal = false;
const pointers = new Map();
let pinchSeparation = 0;
let terrainEpoch=0, terrainGpu=null, animation=null, lastAnimationUpload=0;
const reducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)");
tileCount.textContent = String(bounds.cells);

slider.max = String(frames.length);
slider.value = "1";

/**
 * Static terrain and moving units use Verdant's split-buffer uploader.
 * The replay snapshots remain the only authoritative data displayed.
 */
function displayFrame(next) {
  if (!renderer)return;
  const previous=frames[step],previousStep=step;
  step=(next+frames.length)%frames.length;
  const projection=frames[step];
  const layers=buildBattlefieldLayers(projection);
  terrainGpu={...layers.terrain,epoch:++terrainEpoch};
  renderer.uploadSplitBuffers(terrainGpu,layers.units);
  const motion=previousStep!==step
    ? createReplayTransition(previous,projection)
    : {moves:[],hits:[],duration:0};
  animation=(!reducedMotion.matches && (motion.moves.length||motion.hits.length))
    ? {motion,start:performance.now()}:null;
  canvas.dataset.animationState=animation?"playing":"idle";
  canvas.dataset.movingUnits=String(motion.moves.length);
  slider.value=String(step+1);
  roundText.textContent=`${step+1} / ${frames.length}`;
  compactRound.textContent=`${step+1} / ${frames.length}`;
  headline.textContent=projection.featured?.headline ?? "Tactical deployment";
  const blueUnits=String(projection.board.units.filter(u=>u.side==="A").length);
  const redUnits=String(projection.board.units.filter(u=>u.side==="B").length);
  blue.textContent=blueUnits;
  red.textContent=redUnits;
  mobileBlueCount.textContent=blueUnits;
  mobileRedCount.textContent=redUnits;
}
function updateAnimatedUnits(now) {
  if(!animation)return;
  if(now-lastAnimationUpload<33)return;  // cap dynamic buffer uploads ~30 Hz
  const {motion,start}=animation;
  const fraction=Math.min(1,(now-start)/motion.duration);
  const unitMesh=buildUnitsMesh(frames[step],tweenReplay(motion,fraction));
  renderer.uploadSplitBuffers(terrainGpu,unitMesh);
  lastAnimationUpload=now;
  if(fraction>=1){
    animation=null;
    canvas.dataset.animationState="idle";
  }
}

function updateCameraLabels(){
  zoomReadout.textContent = `${Math.round(100*HOME_DISTANCE/distance)}%`;
  canvas.dataset.cameraDistance = distance.toFixed(3);
  canvas.dataset.cameraYaw = yaw.toFixed(3);
  canvas.dataset.cameraElevation = elevation.toFixed(3);
  zoomIn.disabled = distance <= MIN_DISTANCE + .02;
  zoomOut.disabled = distance >= MAX_DISTANCE - .02;
}
function setDistance(value){
  distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, value));
  updateCameraLabels();
}
function resetView(){
  yaw = HOME_YAW;
  elevation = HOME_ELEVATION;
  target.splice(0,target.length,...bounds.center);
  setDistance(HOME_DISTANCE);
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
  updateAnimatedUnits(now);
  const aspect=Math.max(.25,canvas.width/Math.max(1,canvas.height));
  const eye=[
    target[0]+Math.sin(yaw)*Math.cos(elevation)*distance,
    target[1]+Math.sin(elevation)*distance,
    target[2]+Math.cos(yaw)*Math.cos(elevation)*distance,
  ];
  const fov=Math.PI/3.4;
  const projection=mat4Perspective(fov,aspect,.1,140);
  const view=mat4LookAt(eye,target,[0,1,0]);
  renderer.render(mat4Mul(projection,view),eye,{
    rank:2,sky:[.045,.105,.16],fog:[.095,.16,.23],
  },now/1000,target,fov);
  requestAnimationFrame(draw);
}

function stopReplay(){
  if(playback!==null)clearInterval(playback);
  playback=null;
  play.textContent="Play replay";
  mobilePlay.textContent="▶";
  mobilePlay.setAttribute("aria-label","Play replay");
  play.setAttribute("aria-pressed","false");
}
function toggleReplay(){
  if(playback!==null){stopReplay();return;}
  play.textContent="Pause replay";
  mobilePlay.textContent="Ⅱ";
  mobilePlay.setAttribute("aria-label","Pause replay");
  play.setAttribute("aria-pressed","true");
  playback=setInterval(()=>displayFrame(step+1),1250);
}

slider.addEventListener("input",()=>{stopReplay();displayFrame(Number(slider.value)-1);});
stepPrevious.addEventListener("click",()=>{stopReplay();displayFrame(step-1);});
stepNext.addEventListener("click",()=>{stopReplay();displayFrame(step+1);});
play.addEventListener("click",toggleReplay);
mobilePrevious.addEventListener("click",()=>stepPrevious.click());
mobileNext.addEventListener("click",()=>stepNext.click());
mobilePlay.addEventListener("click",()=>play.click());
// Wheel, keyboard, explicit zoom controls and touch pinch share the same
// bounded camera model. Pointer movement orbits; Shift+drag pans.
zoomIn.addEventListener("click",()=>setDistance(distance/1.25));
zoomOut.addEventListener("click",()=>setDistance(distance*1.25));
resetCamera.addEventListener("click",resetView);
canvas.addEventListener("pointerdown",event=>{
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  canvas.setPointerCapture(event.pointerId);
  if(pointers.size===2){
    const [a,b]=[...pointers.values()];
    pinchSeparation=Math.hypot(a.x-b.x,a.y-b.y);
  }
});
canvas.addEventListener("pointermove",event=>{
  if(!pointers.has(event.pointerId))return;
  const prev=pointers.get(event.pointerId);
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(pointers.size===2){
    const [a,b]=[...pointers.values()];
    const separation=Math.hypot(a.x-b.x,a.y-b.y);
    if(pinchSeparation>8&&separation>8){
      setDistance(distance*pinchSeparation/separation);
    }
    pinchSeparation=separation;
    return;
  }
  const dx=event.clientX-prev.x,dy=event.clientY-prev.y;
  if(event.shiftKey){
    const move=distance*.0016;
    target[0]=Math.max(bounds.center[0]-bounds.halfExtent*.7,
      Math.min(bounds.center[0]+bounds.halfExtent*.7,target[0]-dx*move));
    target[2]=Math.max(bounds.center[2]-bounds.halfExtent*.7,
      Math.min(bounds.center[2]+bounds.halfExtent*.7,target[2]+dy*move));
  }else{
    yaw+=dx*.009;
    elevation=Math.max(.30,Math.min(1.43,elevation-dy*.008));
  }
  updateCameraLabels();
});
const release=event=>{
  pointers.delete(event.pointerId);
  pinchSeparation=0;
};
canvas.addEventListener("pointerup",release);
canvas.addEventListener("pointercancel",release);
canvas.addEventListener("lostpointercapture",release);
canvas.addEventListener("wheel",event=>{
  event.preventDefault();
  setDistance(distance*Math.exp(Math.sign(event.deltaY)*.14));
},{passive:false});
canvas.addEventListener("keydown",event=>{
  if(event.key==="+"||event.key==="="){event.preventDefault();setDistance(distance/1.2);}
  if(event.key==="-"){event.preventDefault();setDistance(distance*1.2);}
  if(event.key==="0"){event.preventDefault();resetView();}
  if(event.key==="ArrowLeft"){event.preventDefault();yaw-=.11;updateCameraLabels();}
  if(event.key==="ArrowRight"){event.preventDefault();yaw+=.11;updateCameraLabels();}
});
updateCameraLabels();
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
