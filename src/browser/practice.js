/**
 * Unranked practice screen. All actual matches, plans and bot actions are
 * executed in a Worker with the original HexaWars validator and resolver.
 */
const $=id=>document.getElementById(id);
const el={
  map:$("battle-map"),ready:$("ready-screen"),start:$("start-battle"),
  round:$("round-label"),blue:$("score-blue"),red:$("score-red"),
  selected:$("selected-name"),command:$("command-label"),instruction:$("instruction"),
  notice:$("notice"),event:$("event-label"),commit:$("commit-round"),
  pass:$("skip-round"),victory:$("victory"),result:$("result"),newBattle:$("new-battle"),
  threeD:$("game-3d"),threeDMarkers:$("game-3d-markers"),
  toggle3D:$("toggle-3d"),threeDTools:$("game-3d-tools"),
  zoomIn:$("game-3d-in"),zoomOut:$("game-3d-out"),resetView:$("game-3d-reset"),
};
const SVG="http://www.w3.org/2000/svg",RADIUS=33,HEIGHT=Math.sqrt(3)*RADIUS;
const colors={plain:"#4e7e58",forest:"#275541",mountain:"#71818d",water:"#246078"};
const letters={scout:"S",infantry:"I",heavy:"H"};
let sequence=0,current=null,selectedId=null,options=[],queued=null,busy=false;
let scene3D=null,using3D=false,threeDLoading=false,threeDFailed=false;
const requests=new Map();
const worker=new Worker("./practice-worker.mjs",{type:"module"});
/**
 * 3D is a view over the very same public Worker projection and legal commands.
 * If WebGL2 fails, the original keyboard-accessible SVG view remains playable.
 */
function sync3D(){
  if(using3D&&scene3D&&current){
    scene3D.update(current,{selectedId,options,queued});
  }
}
function on3DHex(q,r){
  if(!current||busy||current.ended)return;
  const cell=current.board.find(c=>c.q===q&&c.r===r);
  if(!cell)return;
  const piece=current.units.find(u=>u.q===q&&u.r===r);
  const choice=options.find(a=>a.to.q===q&&a.to.r===r);
  clickCell(cell,piece,choice);
}
function show2D(reason){
  using3D=false;
  document.body.classList.remove("is-3d");
  scene3D?.deactivate();
  // SVGElement does not consistently implement HTMLElement.hidden in Chrome.
  el.map.removeAttribute("hidden");
  el.threeD.hidden=true;
  el.threeDMarkers.hidden=true;
  el.threeDTools.hidden=true;
  el.toggle3D.textContent=threeDFailed?"2D map":"3D view";
  el.toggle3D.setAttribute("aria-pressed","false");
  if(reason)status(reason);
  updateBusy(busy);
}
async function toggleView(){
  if(busy||threeDLoading||!current)return;
  if(using3D){show2D();return;}
  threeDLoading=true;
  el.toggle3D.disabled=true;
  el.map.setAttribute("hidden","");
  el.threeD.hidden=false;
  el.threeDMarkers.hidden=false;
  el.threeDTools.hidden=false;
  try{
    if(!scene3D){
      const {createPractice3D}=await import("./practice-3d.mjs");
      scene3D=await createPractice3D(el.threeD,el.threeDMarkers,{
        onHex:on3DHex,
        onUnavailable:message=>{
          threeDFailed=true;
          show2D(message);
        },
      });
    }
    using3D=true;
    document.body.classList.add("is-3d");
    el.toggle3D.textContent="2D map";
    el.toggle3D.setAttribute("aria-pressed","true");
    sync3D();
    scene3D.activate();
  }catch(error){
    threeDFailed=true;
    show2D("3D unavailable. "+String(error?.message??error)+
      " The 2D map remains playable.");
  }finally{
    threeDLoading=false;
    updateBusy(busy);
  }
}

function status(text){el.notice.textContent=text;}
function updateBusy(value){
  busy=value;
  el.commit.disabled=busy||!queued||!!current?.ended;
  el.pass.disabled=busy||!current||!!current.ended;
  el.start.disabled=busy;
  el.toggle3D.disabled=busy||!current||threeDLoading||threeDFailed;
}
worker.addEventListener("message",event=>{
  const reply=event.data,call=requests.get(reply.id);
  if(!call)return;
  requests.delete(reply.id);clearTimeout(call.timer);
  if(reply.ok)call.resolve(reply);else call.reject(new Error(reply.error||"Unknown Worker error"));
});
worker.addEventListener("error",()=>{
  for(const call of requests.values()){
    clearTimeout(call.timer);call.reject(new Error("Game Worker failed to initialize"));
  }
  requests.clear();status("The game engine could not start. Reload this page.");
  updateBusy(true);
});
function request(type,fields={}){
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      requests.delete(id);reject(new Error("The local game engine did not respond"));
    },12000);
    requests.set(id,{resolve,reject,timer});
    worker.postMessage({id,type,...fields});
  });
}
const xy=coord=>[coord.q*RADIUS*1.5,(coord.r+coord.q*.5)*HEIGHT];
function create(tag,attrs={}){
  const node=document.createElementNS(SVG,tag);
  for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));
  return node;
}
function draw(){
  if(!current)return;
  el.map.replaceChildren();
  const points=current.board.map(c=>({cell:c,center:xy(c)}));
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const point of points){
    const [x,y]=point.center;
    minX=Math.min(minX,x-RADIUS);maxX=Math.max(maxX,x+RADIUS);
    minY=Math.min(minY,y-HEIGHT/2);maxY=Math.max(maxY,y+HEIGHT/2);
  }
  const padding=RADIUS*1.45;
  el.map.setAttribute("viewBox",
    [minX-padding,minY-padding,maxX-minX+2*padding,maxY-minY+2*padding].join(" "));
  const pieces=new Map(current.units.map(u=>[u.q+","+u.r,u]));
  for(const {cell,center:[cx,cy]} of points){
    const piece=pieces.get(cell.q+","+cell.r);
    const choice=options.find(o=>o.to.q===cell.q&&o.to.r===cell.r);
    const pending=queued&&queued.to.q===cell.q&&queued.to.r===cell.r;
    const selected=piece?.id===selectedId;
    const role=choice?.kind==="attack"?"attack":choice?"available":"";
    const label="Hex "+cell.q+","+cell.r+": "+(piece?
      (piece.side==="A"?"Blue ":"Red ")+piece.type+", "+piece.hp+" health":
      cell.terrain)+(choice?", "+choice.kind+" available":"");
    const node=create("g",{
      class:"cell "+role+" "+(pending?"queued ":"")+(selected?"selected":""),
      tabindex:0,role:"button","aria-label":label,
      "data-q":cell.q,"data-r":cell.r,
    });
    const corners=Array.from({length:6},(_,i)=>{
      const a=i*Math.PI/3;
      return (cx+RADIUS*.96*Math.cos(a)).toFixed(2)+","+
        (cy+RADIUS*.96*Math.sin(a)).toFixed(2);
    }).join(" ");
    node.append(create("polygon",{class:"hex",points:corners,fill:colors[cell.terrain]??colors.plain}));
    if(cell.terrain==="forest"){
      node.append(create("path",{d:"M "+(cx-11)+" "+(cy+5)+" l 11 -20 11 20 z",
        fill:"#194337","pointer-events":"none"}));
    }else if(cell.terrain==="mountain"){
      node.append(create("path",{d:"M "+(cx-15)+" "+(cy+10)+" l 15 -28 15 28 z",
        fill:"#b6c1c9","pointer-events":"none"}));
    }
    if(piece){
      node.append(create("circle",{class:"unit unit-"+(piece.side==="A"?"blue":"red"),
        cx,cy,r:RADIUS*.53}));
      const title=create("text",{class:"unit-label",x:cx,y:cy-2});
      title.textContent=letters[piece.type]??"?";node.append(title);
      const hp=create("text",{class:"unit-hp",x:cx,y:cy+RADIUS*.70});
      hp.textContent=piece.hp+" HP";node.append(hp);
    }
    node.addEventListener("click",()=>clickCell(cell,piece,choice));
    node.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){
        event.preventDefault();clickCell(cell,piece,choice);
      }
    });
    el.map.append(node);
  }
}
function render(){
  if(!current)return;
  el.round.textContent="ROUND "+(current.round+1)+" / "+current.roundCap;
  el.blue.textContent=String(current.blue);
  el.red.textContent=String(current.red);
  if(current.ended){
    const names={A:"Blue victory",B:"Red victory",draw:"Draw"};
    el.victory.hidden=false;
    el.result.textContent=(names[current.ended.winner]??"Battle complete")+
      " · "+(current.ended.reason??"completed");
    el.command.textContent="Battle complete";
    status("Resolved locally. No ranked result was recorded.");
  }
  updateBusy(busy);draw();sync3D();
}
async function startBattle(){
  updateBusy(true);status("Deploying squads…");
  try{
    const topology=document.querySelector('input[name="arena-topology"]:checked')?.value??"balanced61";
    const reply=await request("START",{
      seed:"local-"+crypto.randomUUID().slice(0,12),topology,
    });
    current=reply.state;selectedId=null;queued=null;options=[];
    el.ready.hidden=true;el.victory.hidden=true;
    el.selected.textContent="Choose a blue unit";
    el.command.textContent="Select a squad";
    el.instruction.textContent="Choose a unit, then a white movement or red attack hex.";
    el.event.textContent=(current.topology==="balanced61"?"Balanced Hex":"Classic Arena")+
      " · Blue command vs Red AI · Unranked practice.";
    status("Your move. Select a blue squad.");
    render();
  }catch(e){status(String(e?.message||e));}
  finally{updateBusy(false);}
}
async function selectUnit(unit){
  if(busy||current?.ended)return;
  updateBusy(true);status("");
  try{
    const reply=await request("SELECT",{unitId:unit.id});
    selectedId=unit.id;queued=null;options=reply.legal??[];
    el.selected.textContent=unit.type.toUpperCase()+" · "+unit.hp+" HP";
    el.command.textContent=options.length?"Choose a highlighted hex":"No legal orders";
    el.instruction.textContent=options.length?
      "White hex: move. Red hex: attack. Lock in to resolve both armies.":
      "No valid move or visible attack. Select another squad.";
    draw();sync3D();
  }catch(e){status(String(e?.message||e));}
  finally{updateBusy(false);}
}
function clickCell(cell,piece,choice){
  if(!current||busy||current.ended)return;
  if(piece?.side==="A"){void selectUnit(piece);return;}
  if(choice){
    queued={kind:choice.kind,unitId:selectedId,
      to:{q:cell.q,r:cell.r,s:-cell.q-cell.r}};
    el.command.textContent=(choice.kind==="attack"?"Attack ":"Move to ")+cell.q+", "+cell.r;
    status("Order ready. Lock in to resolve the round.");
    updateBusy(false);draw();sync3D();
  }else if(!selectedId)status("Select a blue squad first.");
  else status("That hex is not a legal target.");
}
async function advance(action){
  if(!current||current.ended||busy)return;
  updateBusy(true);status("Resolving both armies…");
  try{
    const reply=await request("ACTION",{action});
    current=reply.state;selectedId=null;options=[];queued=null;
    el.selected.textContent="Choose a blue unit";
    el.command.textContent="New round";
    const events=reply.events.filter(x=>
      ["unit_moved","unit_attacked","unit_destroyed"].includes(x)).join(" · ");
    el.event.textContent="Round "+reply.round+": Blue "+reply.playerAction+
      ". Red "+reply.botAction+". "+(events||"Positioning")+".";
    if(!current.ended)status("Choose your next order.");
    render();
  }catch(e){status(String(e?.message||e));}
  finally{updateBusy(false);}
}
el.start.addEventListener("click",startBattle);
el.newBattle.addEventListener("click",startBattle);
el.commit.addEventListener("click",()=>{if(queued)void advance(queued);});
el.pass.addEventListener("click",()=>{void advance({kind:"pass"});});
el.toggle3D.addEventListener("click",()=>{void toggleView();});
el.zoomIn.addEventListener("click",()=>scene3D?.zoomIn());
el.zoomOut.addEventListener("click",()=>scene3D?.zoomOut());
el.resetView.addEventListener("click",()=>scene3D?.reset());
