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
  plannedMove:$("planned-move"),plannedAttack:$("planned-attack"),
  clearMove:$("clear-move"),clearAttack:$("clear-attack"),
  bidAmount:$("bid-amount"),bidBudget:$("bid-budget"),
  pass:$("skip-round"),victory:$("victory"),result:$("result"),
  resultDetail:$("result-detail"),newBattle:$("new-battle"),changeArena:$("change-arena"),
  threeD:$("game-3d"),threeDMarkers:$("game-3d-markers"),
  toggle3D:$("toggle-3d"),threeDTools:$("game-3d-tools"),
  zoomIn:$("game-3d-in"),zoomOut:$("game-3d-out"),resetView:$("game-3d-reset"),
};
const SVG="http://www.w3.org/2000/svg",RADIUS=33,HEIGHT=Math.sqrt(3)*RADIUS;
const colors={plain:"#4e7e58",forest:"#275541",mountain:"#71818d",water:"#246078"};
const letters={scout:"S",infantry:"I",heavy:"H"};
let sequence=0,current=null,selectedId=null,options=[],queued=null,busy=false;
let orders={move:null,attack:null,bid:0};
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
function labelOrder(choice){
  if(!choice||!current)return "Not set";
  const unit=current.units.find(u=>u.id===choice.unitId);
  const cell=current.board.find(c=>c.q===choice.to.q&&c.r===choice.to.r);
  const unitName=(unit?.type??"Squad").toUpperCase();
  return unitName+" · "+(choice.kind==="attack"?"Attack":"Move to")+" "+
    (cell?.terrain??"target");
}
function showOrders(){
  el.plannedMove.textContent=labelOrder(orders.move);
  el.plannedAttack.textContent=labelOrder(orders.attack);
  const available=current?.availableAp??3;
  el.bidBudget.textContent=orders.bid+" / "+available+" AP";
  for(const option of el.bidAmount.options){
    option.disabled=Number(option.value)>available;
  }
  el.bidAmount.value=String(Math.min(orders.bid,available));
}
function updateBusy(value){
  busy=value;
  el.commit.disabled=busy||(!orders.move&&!orders.attack&&orders.bid===0)||
    !current||!!current.ended;
  el.pass.disabled=busy||!current||!!current.ended;
  el.clearMove.disabled=busy||!orders.move||!!current?.ended;
  el.clearAttack.disabled=busy||!orders.attack||!!current?.ended;
  el.bidAmount.disabled=busy||!current||!!current.ended;
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
  document.body.classList.toggle("match-finished",Boolean(current.ended));
  el.round.textContent=current.ended
    ? "FINAL · "+current.round+" ROUNDS"
    : "ROUND "+(current.round+1)+" / "+current.roundCap;
  el.blue.textContent=String(current.blue);
  el.red.textContent=String(current.red);
  if(current.ended){
    const names={A:"Victory",B:"Defeat",draw:"Draw"};
    const reasons={
      elimination:"One army remains.",
      mutual_elimination:"Both armies fought to the last.",
      territory_control:"The battlefield has been claimed.",
      turn_cap:"The round limit has been reached.",
    };
    el.victory.hidden=false;
    el.result.textContent=names[current.ended.winner]??"Battle complete";
    el.resultDetail.textContent=(reasons[current.ended.reason]??"The battle is over.")+
      " · "+current.round+" rounds · Unranked";
    el.command.textContent="Battle complete";
    status("Battle finished. Choose your next battle.");
  }
  showOrders();updateBusy(busy);draw();sync3D();
}
async function startBattle(){
  updateBusy(true);status("Deploying squads…");
  try{
    const topology=document.querySelector('input[name="arena-topology"]:checked')?.value??"balanced61";
    const reply=await request("START",{
      seed:"local-"+crypto.randomUUID().slice(0,12),topology,
    });
    current=reply.state;selectedId=null;queued=null;options=[];
    orders={move:null,attack:null,bid:0};
    el.bidAmount.value="0";
    el.ready.hidden=true;el.victory.hidden=true;
    el.selected.textContent="Choose a blue unit";
    el.command.textContent="Select a squad";
    el.instruction.textContent="Queue one move and one attack. You can revise each before resolving.";
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
    const reply=await request("SELECT",{unitId:unit.id,orders});
    selectedId=unit.id;queued=null;options=reply.legal??[];
    el.selected.textContent=unit.type.toUpperCase()+" · "+unit.hp+" HP";
    el.command.textContent=options.length?"Choose a highlighted hex":"No legal orders";
    el.instruction.textContent=options.length?
      (orders.move?.unitId===unit.id
        ? "Move queued. Highlighted attacks use the planned destination. Visible enemies only."
        : "Move "+unit.moveRange+" hexes via clear terrain · Attack range "+
          unit.attackRange+". Queue either or both free slots."):
      "No valid move or visible attack. Select another squad.";
    draw();sync3D();
  }catch(e){status(String(e?.message||e));}
  finally{updateBusy(false);}
}
function clickCell(cell,piece,choice){
  if(!current||busy||current.ended)return;
  if(piece?.side==="A"){void selectUnit(piece);return;}
  if(choice){
    void (async()=>{
      const candidate={kind:choice.kind,unitId:selectedId,
        to:{q:cell.q,r:cell.r,s:-cell.q-cell.r}};
      const revised={...orders,[choice.kind]:candidate};
      updateBusy(true);
      try{
        await request("PREVIEW",{orders:revised});
        // A planned move may bring a known enemy into range. Requery the
        // authoritative Worker before revealing post-move attack highlights.
        const refreshed=choice.kind==="move" && selectedId
          ? await request("SELECT",{unitId:selectedId,orders:revised})
          : null;
        orders=revised;queued=candidate;
        if(refreshed)options=refreshed.legal??[];
        el.command.textContent=choice.kind==="attack"?"Attack queued":"Move queued";
        if(choice.kind==="move"){
          el.instruction.textContent="Move queued. Highlighted attacks use the planned destination. Visible enemies only.";
        }
        status(choice.kind==="move"
          ? "Move queued. Now add an attack, or resolve your round."
          : "Attack queued. You can still revise orders before resolving.");
        showOrders();draw();sync3D();
      }catch(error){
        status(String(error?.message??error));
      }finally{updateBusy(false);}
    })();
  }else if(!selectedId)status("Select a blue squad first.");
  else status("That hex is not a legal target.");
}
async function advance(action){
  if(!current||current.ended||busy)return;
  updateBusy(true);status("Resolving both armies…");
  try{
    const reply=await request("ACTION",{action});
    current=reply.state;selectedId=null;options=[];queued=null;
    orders={move:null,attack:null,bid:0};
    el.bidAmount.value="0";
    el.selected.textContent="Choose a blue unit";
    el.command.textContent="Choose a squad";
    const verbs={move:"advanced",attack:"attacked",
      "move+attack":"advanced and attacked",pass:"held position"};
    const summary="Blue "+(verbs[reply.playerAction]??"acted")+
      " · Red "+(verbs[reply.botAction]??"acted")+
      (reply.events.includes("unit_destroyed")?" · A squad fell":"");
    el.event.textContent="Round "+reply.round+" · "+summary;
    if(!current.ended)status(summary);
    render();
  }catch(e){status(String(e?.message||e));}
  finally{updateBusy(false);}
}
el.start.addEventListener("click",startBattle);
el.newBattle.addEventListener("click",startBattle);
el.changeArena.addEventListener("click",()=>{
  if(busy)return;
  el.victory.hidden=true;
  el.ready.hidden=false;
  el.start.focus();
});
el.commit.addEventListener("click",()=>{void advance({...orders});});
el.clearMove.addEventListener("click",()=>{void (async()=>{
  if(busy||!current)return;
  updateBusy(true);
  try{
    const next={...orders,move:null};
    let removedAttack=false;
    try{
      await request("PREVIEW",{orders:next});
    }catch{
      // An attack that only became legal from the planned destination must
      // not remain in a hidden, impossible order slot after clearing the move.
      next.attack=null;
      await request("PREVIEW",{orders:next});
      removedAttack=true;
    }
    const refreshed=selectedId
      ? await request("SELECT",{unitId:selectedId,orders:next})
      : null;
    orders=next;
    queued=orders.attack;
    if(refreshed)options=refreshed.legal??[];
    el.command.textContent=options.length?"Choose a highlighted hex":"Choose a squad";
    showOrders();draw();sync3D();
    status(removedAttack
      ? "Move cleared. Its dependent attack was also cleared."
      : "Move cleared.");
  }catch(error){status(String(error?.message??error));}
  finally{updateBusy(false);}
})();});
el.clearAttack.addEventListener("click",()=>{
  if(busy)return;
  orders.attack=null;
  queued=orders.move;
  showOrders();updateBusy(false);draw();sync3D();
  status("Attack cleared.");
});
el.bidAmount.addEventListener("change",()=>{
  if(busy||!current)return;
  const next=Number(el.bidAmount.value);
  if(!Number.isSafeInteger(next)||next<0||next>current.availableAp){
    el.bidAmount.value=String(orders.bid);return;
  }
  orders.bid=next;
  showOrders();updateBusy(false);
  status(next>0?"Bid "+next+" AP to act earlier. AP is spent whether you win initiative.":"Initiative bid removed.");
});
el.pass.addEventListener("click",()=>{void advance({kind:"pass"});});
el.toggle3D.addEventListener("click",()=>{void toggleView();});
el.zoomIn.addEventListener("click",()=>scene3D?.zoomIn());
el.zoomOut.addEventListener("click",()=>scene3D?.zoomOut());
el.resetView.addEventListener("click",()=>scene3D?.reset());
