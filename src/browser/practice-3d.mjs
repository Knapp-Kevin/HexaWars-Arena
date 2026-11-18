/**
 * Real Verdant WebGL2 view of the SAME unranked human-versus-AI match.
 * Receives only seat-safe practiceView projections from the game Worker.
 * Selection and actions return through the existing Worker validator; this
 * view never calls the rules engine, invents legal moves or trusts local wins.
 */
import {
  createBestRenderer, mat4Perspective, mat4LookAt, mat4Mul,
} from "../vendor/verdant/scene-renderer.mjs";
import {
  axialToWorld, boardBounds, buildBattlefieldLayers, buildUnitsMesh,
} from "./battlefield-geometry.mjs";
import { createReplayTransition, tweenReplay } from "./replay-motion.mjs";

const TERRAIN_HEIGHT={plain:.20,forest:.31,hills:.48,mountain:.72,water:.075};
const FOV=Math.PI/3.4;
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
function terrainY(cell){return TERRAIN_HEIGHT[cell.terrain]??.20;}

/** Public, deterministic screen projection for picking and marker placement. */
export function projectWorldToScreen(m,point,w,h) {
  const [x,y,z]=point;
  const clipW=m[3]*x+m[7]*y+m[11]*z+m[15];
  if(!Number.isFinite(clipW)||clipW<=0)return null;
  const nx=(m[0]*x+m[4]*y+m[8]*z+m[12])/clipW;
  const ny=(m[1]*x+m[5]*y+m[9]*z+m[13])/clipW;
  if(!Number.isFinite(nx)||!Number.isFinite(ny))return null;
  return {x:(nx+1)*w/2,y:(1-ny)*h/2,visible:Math.abs(nx)<1.08&&Math.abs(ny)<1.08};
}
export function practiceScene(view){
  if(!Array.isArray(view?.board)||!Array.isArray(view?.units))
    throw new Error("Invalid public practice projection");
  // The only units available here are explicitly supplied by practiceView.
  return {board:{cells:view.board,units:view.units}};
}
export async function createPractice3D(canvas,overlay,{onHex,onUnavailable}){
  const renderer=await createBestRenderer(canvas);
  if(!renderer||renderer.backend!=="webgl2")
    throw new Error("WebGL2 unavailable. The 2D tactical map remains playable.");
  canvas.dataset.renderer=renderer.backend;
  const state={
    active:false,view:null,options:[],selectedId:null,queued:null,
    bounds:null,rulesVersion:null,terrain:null,epoch:0,animation:null,lastUpload:0,
    distance:25,home:25,yaw:.71,elevation:1.04,target:[0,.25,0],
    markers:[],mvp:null,drag:new Map(),pinch:0,
  };
  const reducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)");
  const resize=()=>{
    const rect=canvas.getBoundingClientRect();
    const dpr=Math.min(2,window.devicePixelRatio||1);
    const w=Math.max(2,Math.round(rect.width*dpr));
    const h=Math.max(2,Math.round(rect.height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  };
  function distanceToHome(){
    const rect=canvas.getBoundingClientRect();
    const aspect=rect.width/Math.max(1,rect.height);
    // The previous technical preview left the board occupying only ~40%
    // of a phone viewport. Fit a playable overview while reserving the
    // top command ribbon and bottom camera controls for touch.
    const baseline=Math.max(18,state.bounds.halfExtent*2.45)*
      Math.max(1,.95/Math.max(.53,aspect));
    // The full-board view occupied less than half of a phone's viewport,
    // making otherwise legal targets unreadable. Use a nearer default while
    // retaining the same bounded camera controls and reset behavior.
    const narrow=rect.width<=860;
    return baseline*(narrow?.72:.88);
  }
  function setZoom(value){
    state.distance=clamp(value,state.home*.46,state.home*2.6);
    canvas.dataset.cameraDistance=state.distance.toFixed(2);
  }
  function reset(){
    state.yaw=.71;state.elevation=1.04;
    state.target=[...state.bounds.center];
    setZoom(state.home);
  }
  function focusHex(q,r){
    if(!state.bounds||!state.view)return;
    const cell=state.view.board.find(c=>c.q===q&&c.r===r);
    if(!cell)return;
    const [x,z]=axialToWorld(cell),lim=state.bounds.halfExtent*.8;
    state.target[0]=clamp(x,state.bounds.center[0]-lim,state.bounds.center[0]+lim);
    state.target[2]=clamp(z,state.bounds.center[2]-lim,state.bounds.center[2]+lim);
  }
  function markerTarget(cell,kind){
    const button=document.createElement("button");
    button.type="button";
    button.className="three-d-target "+kind+
      (state.queued?.to?.q===cell.q&&state.queued?.to?.r===cell.r?" queued":"");
    // Projected badges are visual; the independently laid-out command ribbon
    // is the accessible interactive control. The canvas itself still picks
    // nearest scene hexes on deliberate taps/clicks.
    button.tabIndex=-1;
    button.setAttribute("aria-hidden","true");
    button.dataset.q=String(cell.q);
    button.dataset.r=String(cell.r);
    const unit=state.view.units.find(u=>u.q===cell.q&&u.r===cell.r);
    const role=unit?.type==="siege"?"G":
      (unit?.type?.slice(0,1).toUpperCase()??"");
    button.textContent=kind==="select"?(role||"●"):kind==="attack"?"!":"•";
    button.setAttribute("aria-label",kind==="select"
      ?`Select Blue ${unit?.type??"squad"} at ${cell.q},${cell.r}`
      :`${kind==="attack"?"Attack":"Move to"} hex ${cell.q},${cell.r}`);

    overlay.append(button);
    state.markers.push({button,cell,kind});
  }
  function rebuildMarkers(){
    overlay.replaceChildren();state.markers=[];
    if(!state.view || state.view.ended)return;
    for(const unit of state.view.units.filter(u=>u.side==="A")){
      const cell=state.view.board.find(c=>c.q===unit.q&&c.r===unit.r);
      if(cell)markerTarget(cell,"select");
    }
    if(state.selectedId){
      for(const action of state.options){
        const cell=state.view.board.find(c=>c.q===action.to.q&&c.r===action.to.r);
        if(cell)markerTarget(cell,action.kind);
      }
    }
    // On narrow touch screens, perspective compression makes several adjacent
    // projected hex buttons overlap. Keep the board readable and provide a
    // proper horizontal command ribbon with full-size, accessible tap targets.
    const tray=document.createElement("div");
    tray.className="three-d-tray";
    tray.setAttribute("role","group");
    tray.setAttribute("aria-label","Squad selection and legal orders");
    for(const {cell,kind} of state.markers){
      const b=document.createElement("button");
      b.type="button";
      b.className="three-d-tray-choice "+kind+
        (state.queued?.to?.q===cell.q&&state.queued?.to?.r===cell.r?" queued":"");
      b.dataset.kind=kind;
      b.dataset.q=String(cell.q);
      b.dataset.r=String(cell.r);
      const unit=state.view.units.find(u=>u.q===cell.q&&u.r===cell.r);
      b.textContent=kind==="select"
        ?(unit?.type??"Squad").toUpperCase()
        :(kind==="attack"?"Attack ":"Move ")+cell.q+","+cell.r;
      b.setAttribute("aria-label",kind==="select"
        ?`Select Blue ${unit?.type??"squad"}`
        :`${kind==="attack"?"Attack":"Move to"} hex ${cell.q},${cell.r}`);
      b.addEventListener("click",event=>{
        event.stopPropagation();
        onHex(cell.q,cell.r);
      });
      tray.append(b);
    }
    overlay.append(tray);
  }
  function update(view,selection={}){
    const prev=state.view;
    state.view=view;
    state.options=selection.options??[];
    state.selectedId=selection.selectedId??null;
    state.queued=selection.queued??null;
    if(!state.bounds || state.rulesVersion!==view.rulesVersion){
      state.bounds=boardBounds(view.board);
      state.rulesVersion=view.rulesVersion;
      state.home=distanceToHome();
      reset();
    }
    const projection=practiceScene(view);
    const geometry=buildBattlefieldLayers(projection);
    state.terrain={...geometry.terrain,epoch:++state.epoch};
    renderer.uploadSplitBuffers(state.terrain,geometry.units);
    const sameMatch=prev&&prev.seed===view.seed&&
      prev.rulesVersion===view.rulesVersion;
    const motion=sameMatch&&prev.round!==view.round
      ?createReplayTransition(practiceScene(prev),projection)
      :null;
    state.animation=motion&&!reducedMotion.matches&&
      (motion.moves.length||motion.hits.length)
      ?{motion,start:performance.now()}:null;
    canvas.dataset.animationState=state.animation?"playing":"idle";
    canvas.dataset.boardCells=String(view.board.length);
    rebuildMarkers();
  }
  function refreshMarkers(rect,mvp){
    for(const {button,cell,kind} of state.markers){
      const y=terrainY(cell)+(kind==="select"?.90:.22);
      const [x,z]=axialToWorld(cell);
      const projected=projectWorldToScreen(mvp,[x,y,z],rect.width,rect.height);
      button.hidden=!projected?.visible;
      if(projected){
        button.style.left=projected.x.toFixed(1)+"px";
        button.style.top=projected.y.toFixed(1)+"px";
      }
    }
  }
  function draw(now){
    if(!state.active)return;
    resize();
    if(state.animation&&now-state.lastUpload>=35){
      const t=clamp((now-state.animation.start)/state.animation.motion.duration,0,1);
      const units=buildUnitsMesh(practiceScene(state.view),
        tweenReplay(state.animation.motion,t));
      renderer.uploadSplitBuffers(state.terrain,units);
      state.lastUpload=now;
      if(t===1){state.animation=null;canvas.dataset.animationState="idle";}
    }
    const aspect=Math.max(.3,canvas.width/Math.max(1,canvas.height));
    const eye=[
      state.target[0]+Math.sin(state.yaw)*Math.cos(state.elevation)*state.distance,
      state.target[1]+Math.sin(state.elevation)*state.distance,
      state.target[2]+Math.cos(state.yaw)*Math.cos(state.elevation)*state.distance,
    ];
    const mvp=mat4Mul(mat4Perspective(FOV,aspect,.1,180),
      mat4LookAt(eye,state.target,[0,1,0]));
    state.mvp=mvp;
    renderer.render(mvp,eye,{rank:2,sky:[.048,.10,.16],fog:[.1,.17,.24]},
      now/1000,state.target,FOV);
    refreshMarkers(canvas.getBoundingClientRect(),mvp);
    requestAnimationFrame(draw);
  }
  function activate(){
    if(state.active)return;
    state.active=true;
    requestAnimationFrame(draw);
  }
  function deactivate(){
    state.active=false;
    state.drag.clear();
    overlay.replaceChildren();
    state.markers=[];
  }
  function onPick(clientX,clientY){
    if(!state.view||!state.mvp)return;
    const rect=canvas.getBoundingClientRect();
    const atX=clientX-rect.left,atY=clientY-rect.top;
    // Allow switching friendly squads directly on the 3D board, even when
    // another squad is selected. Legal target highlights remain canonical.
    const own=state.view.units.filter(u=>u.side==="A");
    const candidates=state.selectedId
      ?[...state.options.map(a=>a.to),...own]
      :own;
    let best=null,proximity=Infinity;
    for(const c of candidates){
      const cell=state.view.board.find(x=>x.q===c.q&&x.r===c.r);
      if(!cell)continue;
      const [x,z]=axialToWorld(cell);
      const p=projectWorldToScreen(state.mvp,[x,terrainY(cell)+.30,z],
        rect.width,rect.height);
      if(!p?.visible)continue;
      const d=Math.hypot(p.x-atX,p.y-atY);
      if(d<proximity){proximity=d;best=cell;}
    }
    if(best&&proximity<36)onHex(best.q,best.r);
  }
  canvas.addEventListener("pointerdown",event=>{
    if(!state.active)return;
    state.drag.set(event.pointerId,{
      x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,
    });
    canvas.setPointerCapture(event.pointerId);
    if(state.drag.size===2){
      const [a,b]=[...state.drag.values()];
      state.pinch=Math.hypot(a.x-b.x,a.y-b.y);
    }
  });
  canvas.addEventListener("pointermove",event=>{
    const prev=state.drag.get(event.pointerId);
    if(!prev||!state.active)return;
    state.drag.set(event.pointerId,{...prev,x:event.clientX,y:event.clientY});
    if(state.drag.size===2){
      const [a,b]=[...state.drag.values()];
      const next=Math.hypot(a.x-b.x,a.y-b.y);
      if(state.pinch>8&&next>8)setZoom(state.distance*state.pinch/next);
      state.pinch=next;return;
    }
    const dx=event.clientX-prev.x,dy=event.clientY-prev.y;
    if(event.shiftKey){
      const pan=state.distance*.0016;
      state.target[0]=clamp(state.target[0]-dx*pan,
        state.bounds.center[0]-state.bounds.halfExtent*.75,
        state.bounds.center[0]+state.bounds.halfExtent*.75);
      state.target[2]=clamp(state.target[2]+dy*pan,
        state.bounds.center[2]-state.bounds.halfExtent*.75,
        state.bounds.center[2]+state.bounds.halfExtent*.75);
    }else{
      state.yaw+=dx*.009;
      state.elevation=clamp(state.elevation-dy*.008,.30,1.43);
    }
  });
  canvas.addEventListener("pointerup",event=>{
    const origin=state.drag.get(event.pointerId);
    state.drag.delete(event.pointerId);state.pinch=0;
    if(origin&&Math.hypot(event.clientX-origin.startX,event.clientY-origin.startY)<6)
      onPick(event.clientX,event.clientY);
  });
  canvas.addEventListener("pointercancel",event=>{state.drag.delete(event.pointerId);state.pinch=0;});
  canvas.addEventListener("wheel",event=>{
    if(!state.active)return;
    event.preventDefault();
    setZoom(state.distance*Math.exp(Math.sign(event.deltaY)*.14));
  },{passive:false});
  canvas.addEventListener("webglcontextlost",event=>{
    event.preventDefault();deactivate();onUnavailable?.("3D renderer lost its GPU context. Switched to the tactical map.");
  });
  canvas.addEventListener("keydown",event=>{
    if(event.key==="+"||event.key==="="){event.preventDefault();setZoom(state.distance/1.2);}
    if(event.key==="-"){event.preventDefault();setZoom(state.distance*1.2);}
    if(event.key==="0"){event.preventDefault();reset();}
    if(event.key==="ArrowLeft"){event.preventDefault();state.yaw-=.11;}
    if(event.key==="ArrowRight"){event.preventDefault();state.yaw+=.11;}
  });
  return {backend:renderer.backend,activate,deactivate,update,focusHex,
    zoomIn:()=>setZoom(state.distance/1.25),
    zoomOut:()=>setZoom(state.distance*1.25),reset};
}
