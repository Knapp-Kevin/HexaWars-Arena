/**
 * Public HexaWars board projection -> detailed, deterministic Verdant geometry.
 * This module is deliberately DOM-free: no privileged match state or simulation.
 * Coordinate systems, unit positions and fog are supplied by public projections.
 */

export const HEX_RADIUS = 0.74;
const SQRT3 = Math.sqrt(3);
const TWO_PI = Math.PI * 2;
const COLOR = {
  plain:    [0.29, 0.51, 0.39],
  forest:   [0.14, 0.32, 0.25],
  hills:    [0.51, 0.43, 0.31],
  mountain: [0.49, 0.55, 0.60],
  water:    [0.085, 0.29, 0.45],
};
const HEIGHT = {plain:0.20, forest:0.31, hills:0.48, mountain:0.72, water:0.075};
const PALETTE = {A:[0.17,0.53,0.94], B:[0.90,0.24,0.27]};
// Verdant packed color convention: floor(red) is material mode.
// 0=diffuse, 1=animated water, 2=metal, 3=emissive. The fractional
// red component remains the visible linearized base-color input.
// This is a procedural material foundation, NOT UV texture skinning.
const STEEL = [2.13, 0.19, 0.25];

export function axialToWorld(cell) {
  return [
    cell.q * 1.5 * HEX_RADIUS,
    (cell.r + cell.q / 2) * SQRT3 * HEX_RADIUS,
  ];
}
export function axialDisk(radius) {
  if (!Number.isInteger(radius) || radius < 1 || radius > 30) throw new RangeError("Invalid map radius");
  const result = [];
  for (let q=-radius; q<=radius; q++) {
    for (let r=Math.max(-radius,-radius-q); r<=Math.min(radius,radius-q); r++) {
      result.push([q,r]);
    }
  }
  return result;
}
export function terrainKind(value) {
  const normalized = String(value ?? "plain").toLowerCase();
  return normalized === "plains" ? "plain" : (Object.hasOwn(COLOR,normalized) ? normalized : "plain");
}
export function boardBounds(cells) {
  if (!Array.isArray(cells) || !cells.length) throw new Error("No public board cells");
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const cell of cells) {
    if (!Number.isFinite(cell.q) || !Number.isFinite(cell.r)) throw new Error("Invalid axial board coordinate");
    const [x,z]=axialToWorld(cell);
    minX=Math.min(minX,x-HEX_RADIUS); maxX=Math.max(maxX,x+HEX_RADIUS);
    minZ=Math.min(minZ,z-HEX_RADIUS); maxZ=Math.max(maxZ,z+HEX_RADIUS);
  }
  return {
    minX,maxX,minZ,maxZ,
    center:[(minX+maxX)/2,0.25,(minZ+maxZ)/2],
    halfExtent:Math.max((maxX-minX)/2,(maxZ-minZ)/2),
    cells:cells.length,
  };
}
function mix(seed, salt=0) {
  let x=(Math.imul(seed.q+117,73856093)^Math.imul(seed.r+241,19349663)^Math.imul(salt+23,83492791))|0;
  x=Math.imul(x^(x>>>16),0x7feb352d);
  x=Math.imul(x^(x>>>15),0x846ca68b);
  return ((x^(x>>>16))>>>0)/4294967296;
}
function adjust(color,apply) {
  const material=Math.floor(color[0]);
  return color.map((value,i)=>{
    const base=i===0?value-material:value;
    const result=Math.min(.96,Math.max(.02,apply(base)));
    return i===0?material+result:result;
  });
}
function shade(color,factor){return adjust(color,v=>v*factor);}
function addColor(color,amount){return adjust(color,v=>v+amount);}

function makeGeometry() {
  const positions=[], normals=[], colors=[], indices=[];
  function tri(a,b,c,color) {
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2];
    const vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const norm=Math.hypot(nx,ny,nz)||1;
    nx/=norm;ny/=norm;nz/=norm;
    for(const vertex of [a,b,c]) {
      positions.push(...vertex);
      normals.push(nx,ny,nz);
      colors.push(...color);
      indices.push(indices.length);
    }
  }
  function ring(x,z,y,radius,sides=6,rotation=0) {
    return Array.from({length:sides},(_,i)=>{
      const a=rotation+TWO_PI*i/sides;
      return [x+radius*Math.cos(a),y,z+radius*Math.sin(a)];
    });
  }
  function cap(center,outer,color) {
    for(let i=0;i<outer.length;i++) tri(center,outer[(i+1)%outer.length],outer[i],color);
  }
  function shell(top,bottom,color) {
    for(let i=0;i<top.length;i++){
      const j=(i+1)%top.length;
      tri(top[i],top[j],bottom[i],shade(color,.82));
      tri(bottom[i],top[j],bottom[j],shade(color,.72));
    }
  }
  function plate(x,z,y,rad,height,color,rotation=0,sides=6) {
    const top=ring(x,z,y+height,rad,sides,rotation);
    const bottom=ring(x,z,y,rad,sides,rotation);
    cap([x,y+height,z],top,color);
    shell(top,bottom,color);
    return y+height;
  }
  function cone(x,z,y,rad,height,color,sides=6,rotation=0) {
    const rim=ring(x,z,y,rad,sides,rotation);
    const peak=[x,y+height,z];
    for(let i=0;i<sides;i++){
      tri(peak,rim[(i+1)%sides],rim[i],shade(color,.84+.22*(i%3)/2));
    }
    return peak;
  }
  function prism(x,z,y,rad,height,color,sides=5,rotation=0) {
    const top=ring(x,z,y+height,rad*.63,sides,rotation);
    const bottom=ring(x,z,y,rad,sides,rotation);
    cap([x,y+height,z],top,shade(color,1.14));
    shell(top,bottom,color);
  }
  // Rigid accessories: armor plates, tracked chassis, shields, and barrels.
  // All surfaces are geometry, not baked image textures.
  function box(x,z,y,width,height,depth,color,rotation=0) {
    const c=Math.cos(rotation), sn=Math.sin(rotation);
    const p=(dx,dz,dy)=>[x+dx*c-dz*sn,y+dy,z+dx*sn+dz*c];
    const w=width/2,d=depth/2;
    const a=p(-w,-d,0),b=p(w,-d,0),c1=p(w,d,0),d1=p(-w,d,0);
    const e=p(-w,-d,height),f=p(w,-d,height),g=p(w,d,height),h=p(-w,d,height);
    tri(e,f,g,shade(color,1.16));tri(e,g,h,shade(color,1.16));
    tri(a,e,h,shade(color,.75));tri(a,h,d1,shade(color,.75));
    tri(b,c1,g,shade(color,.81));tri(b,g,f,shade(color,.81));
    tri(d1,h,g,shade(color,.89));tri(d1,g,c1,shade(color,.89));
    tri(a,b,f,shade(color,.70));tri(a,f,e,shade(color,.70));
  }
  function tile(cell) {
    const [x,z]=axialToWorld(cell), kind=terrainKind(cell.terrain);
    let color=COLOR[kind];
    const variance=(mix(cell,7)-.5)*.15;
    color=addColor(color,variance);
    if(cell.controlledBy==="A")color=[color[0]*.86,color[1]*.98,Math.min(.95,color[2]*1.18)];
    if(cell.controlledBy==="B")color=[Math.min(.95,color[0]*1.17),color[1]*.88,color[2]*.91];
    if(kind==="water")color=[1+color[0],color[1],color[2]];
    const y=HEIGHT[kind], base=-.16;
    const inner=ring(x,z,y,HEX_RADIUS*.79);
    const bevel=ring(x,z,y-.067,HEX_RADIUS*.957);
    const baseRing=ring(x,z,base,HEX_RADIUS*.957);
    // Beveled tile tops form legible borders without floating hex seams.
    cap([x,y,z],inner,color);
    for(let i=0;i<6;i++){
      const j=(i+1)%6;
      tri(inner[i],inner[j],bevel[j],shade(color,.87));
      tri(inner[i],bevel[j],bevel[i],shade(color,.83));
    }
    shell(bevel,baseRing,shade(color,.65));
    // A muted edge lip makes hex adjacency clear at every camera distance.
    const rim=ring(x,z,y-.049,HEX_RADIUS*.997);
    for(let i=0;i<6;i++){
      const j=(i+1)%6;
      tri(bevel[i],bevel[j],rim[j],shade(color,.52));
      tri(bevel[i],rim[j],rim[i],shade(color,.50));
    }

    // Deterministic terrain accents add visual information without changing
    // movement, fog, terrain meaning, damage or any authoritative rule.
    if(kind==="forest"){
      for(let i=0;i<3;i++){
        const a=TWO_PI*mix(cell,20+i),d=.20+.19*mix(cell,30+i);
        const tx=x+Math.cos(a)*d,tz=z+Math.sin(a)*d;
        plate(tx,tz,y,.052,.18,[.30,.22,.17]);
        const crown=[.10+.05*mix(cell,41+i),.28+.12*mix(cell,44+i)];
        cone(tx,tz,y+.12,crown[0]*1.5,crown[1],[.12,.34+.09*mix(cell,49+i),.22],6,a);
        cone(tx,tz,y+.28,crown[0],crown[1]*.85,[.18,.45,.30],6,a+.2);
      }
    }else if(kind==="mountain"){
      const spike=.55+.35*mix(cell,59);
      const a=mix(cell,61)*TWO_PI;
      cone(x+.06,z-.05,y-.02,.38,spike,[.49,.56,.64],5,a);
      cone(x-.22,z+.14,y-.03,.23,spike*.59,[.38,.47,.54],5,a+.4);
      cone(x+.06,z-.05,y+spike*.64,.14,spike*.38,[.76,.80,.82],5,a);
    }else if(kind==="hills"){
      prism(x-.12,z+.03,y,.23,.17,[.57,.50,.37],5,mix(cell,13)*TWO_PI);
      prism(x+.19,z-.13,y,.13,.12,[.62,.53,.38],5,mix(cell,15)*TWO_PI);
    }else if(kind==="water"){
      // Low-poly surface arcs represent currents and help distinguish water.
      for(let i=0;i<3;i++){
        const angle=TWO_PI*(i/3+mix(cell,71)*.09);
        const dx=Math.cos(angle),dz=Math.sin(angle);
        const a=[x+dx*.15,y+.012,z+dz*.15];
        const b=[x+dx*.34-dz*.085,y+.012,z+dz*.34+dx*.085];
        const c=[x+dx*.34+dz*.085,y+.012,z+dz*.34-dx*.085];
        tri(a,b,c,[1.17,.44,.57]);
      }
    }else{
      // Grasses, rocks and moss create detail without noisy random animation.
      for(let i=0;i<3;i++){
        const a=TWO_PI*mix(cell,80+i),d=.20+.18*mix(cell,90+i);
        const gx=x+Math.cos(a)*d,gz=z+Math.sin(a)*d;
        const bright=[.36,.62,.42],h=.085+.08*mix(cell,99+i);
        tri([gx-.045,y+.012,gz],[gx,y+h,gz+.02],[gx+.055,y+.012,gz-.04],shade(bright,.76+mix(cell,102+i)*.25));
      }
    }
  }
  function unit(piece,cell,pose={}) {
    const [naturalX,naturalZ]=axialToWorld(cell);
    const x=Number.isFinite(pose.x)?pose.x:naturalX;
    const z=Number.isFinite(pose.z)?pose.z:naturalZ;
    const lift=Number.isFinite(pose.lift)?Math.max(0,Math.min(.35,pose.lift)):0;
    const y=HEIGHT[terrainKind(cell.terrain)]+lift;
    const team=PALETTE[piece.side];
    if(!team)return;
    const type=String(piece.type||"infantry").toLowerCase();
    const angle=piece.side==="A" ? 0 : Math.PI;
    const dark=shade(team,.45),bright=shade(team,1.22);
    const metal=[2.27,.36,.43],gold=[2.66,.55,.25],accent=[3.66,.81,.90];
    // All roles share the same faction identity, ground contact and selection
    // silhouette, but none relies only on color to communicate its function.
    plate(x,z,y+.012,.31,.078,STEEL);
    plate(x,z,y+.087,.274,.066,bright);
    const ground=y+.153;
    if(type==="siege"||type==="heavy"){
      // Low armored tank: two side tracks, hull, pivoting turret, long gun.
      box(x,z-.18,ground,.40,.19,.12,dark,angle);
      box(x,z+.18,ground,.40,.19,.12,dark,angle);
      box(x,z,ground+.10,.49,.25,.34,team,angle);
      plate(x,z,ground+.36,.22,.12,metal,angle);
      box(x+.26*Math.cos(angle),z+.26*Math.sin(angle),ground+.40,.47,.10,.10,accent,angle);
      box(x-.15*Math.cos(angle),z-.15*Math.sin(angle),ground+.37,.12,.15,.17,bright,angle);
    }else if(type==="captain"){
      // Command tower: tall armor, golden crest, forward command pennant.
      prism(x,z,ground,.18,.52,team,6,angle);
      box(x,z,ground+.36,.22,.15,.19,metal,angle);
      cone(x,z,ground+.57,.21,.30,gold,6,angle);
      box(x+.16*Math.cos(angle),z+.16*Math.sin(angle),ground+.40,.07,.42,.07,gold,angle);
      tri([x,ground+1.02,z],[x+.26*Math.cos(angle),ground+.84,z+.26*Math.sin(angle)],[x,ground+.79,z],bright);
    }else if(type==="raider"){
      // Fast flanking fighter: wedge hull, aerodynamic paired fins.
      prism(x,z,ground,.22,.30,team,5,angle);
      cone(x+.13*Math.cos(angle),z+.13*Math.sin(angle),ground+.18,.17,.44,bright,4,angle);
      for(const side of [-1,1]){
        const a=angle+Math.PI/2;
        const fx=x+Math.cos(a)*.24*side,fz=z+Math.sin(a)*.24*side;
        box(fx,fz,ground+.09,.27,.08,.12,dark,angle);
      }
      box(x,z,ground+.34,.10,.10,.14,accent,angle);
    }else if(type==="interceptor"){
      // Aerial-defense scout: twin outriggers, raised sensor bar.
      box(x,z,ground,.37,.25,.29,team,angle);
      for(const side of [-1,1]){
        const a=angle+Math.PI/2;
        const fx=x+Math.cos(a)*.22*side,fz=z+Math.sin(a)*.22*side;
        box(fx,fz,ground+.19,.13,.24,.12,metal,angle);
        cone(fx,fz,ground+.43,.08,.23,bright,4,angle);
      }
      box(x,z,ground+.26,.10,.38,.10,dark,angle);
      box(x,z,ground+.63,.36,.06,.12,accent,angle);
    }else{
      // Recon/infantry: small armored body, head, directional sensor staff.
      box(x,z,ground,.24,.30,.22,team,angle);
      box(x,z,ground+.30,.19,.15,.18,metal,angle);
      cone(x,z,ground+.46,.13,.23,bright,6,angle);
      box(x-.19*Math.cos(angle),z-.19*Math.sin(angle),ground+.12,.055,.47,.055,dark,angle);
      plate(x-.19*Math.cos(angle),z-.19*Math.sin(angle),ground+.60,.08,.045,accent);
    }
    if(pose.hit){
      const intensity=Math.max(0,Math.min(1,pose.hit));
      plate(x,z,ground+.016,.34+.09*intensity,.02,[.95,.77,.39]);
    }
  }
  return {
    tile,unit,
    output:()=>({
      pos:new Float32Array(positions),
      norm:new Float32Array(normals),
      col:new Float32Array(colors),
      idx:new Uint32Array(indices),
    }),
  };
}

export function buildBattlefieldMesh(projection) {
  const cells=projection?.board?.cells;
  const units=projection?.board?.units;
  if(!Array.isArray(cells)||!Array.isArray(units))throw new Error("Invalid public projection");
  const geometry=makeGeometry(),indexed=new Map();
  for(const cell of cells){
    if(!Number.isInteger(cell.q)||!Number.isInteger(cell.r))throw new Error("Invalid projection coordinate");
    const key=`${cell.q},${cell.r}`;
    if(indexed.has(key))throw new Error("Duplicate projection hex");
    geometry.tile(cell);
    indexed.set(key,cell);
  }
  for(const piece of units){
    const cell=indexed.get(`${piece.q},${piece.r}`);
    if(cell)geometry.unit(piece,cell);
  }
  return geometry.output();
}

/**
 * Split terrain from animated units. This uses the pinned Verdant renderer's
 * native static/dynamic upload API, avoiding terrain rebuilds during movement.
 * Poses are coordinates from public snapshots, never authoritative actions.
 */
export function buildBattlefieldLayers(projection, poses = {}) {
  const cells=projection?.board?.cells, units=projection?.board?.units;
  if(!Array.isArray(cells)||!Array.isArray(units)) throw new Error("Invalid public projection");
  const terrain=makeGeometry(), models=makeGeometry(), byCoord=new Map();
  for (const cell of cells) {
    if(!Number.isInteger(cell.q)||!Number.isInteger(cell.r)) throw new Error("Invalid projection coordinate");
    const key=`${cell.q},${cell.r}`;
    if(byCoord.has(key)) throw new Error("Duplicate projection hex");
    byCoord.set(key,cell);
    terrain.tile(cell);
  }
  for (const piece of units) {
    const ground=byCoord.get(`${piece.q},${piece.r}`);
    if(ground) models.unit(piece,ground,poses[piece.id]??{});
  }
  return {terrain:terrain.output(),units:models.output()};
}

/** Rebuild only visible models while Verdant retains static terrain buffers. */
export function buildUnitsMesh(projection, poses = {}) {
  const cells=projection?.board?.cells, units=projection?.board?.units;
  if(!Array.isArray(cells)||!Array.isArray(units)) throw new Error("Invalid public projection");
  const byCoord = new Map();
  for(const cell of cells){
    if(!Number.isInteger(cell.q)||!Number.isInteger(cell.r)) throw new Error("Invalid projection coordinate");
    const key=`${cell.q},${cell.r}`;
    if(byCoord.has(key))throw new Error("Duplicate projection hex");
    byCoord.set(key,cell);
  }
  const models=makeGeometry();
  for(const piece of units){
    const ground=byCoord.get(`${piece.q},${piece.r}`);
    if(ground) models.unit(piece,ground,poses[piece.id]??{});
  }
  return models.output();
}
