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
const STEEL = [0.13, 0.19, 0.25];

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
function shade(color,factor){return color.map(v=>Math.min(.96,Math.max(.02,v*factor)));}
function addColor(color,amount){return color.map(v=>Math.min(.96,Math.max(.02,v+amount)));}

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
  function tile(cell) {
    const [x,z]=axialToWorld(cell), kind=terrainKind(cell.terrain);
    let color=COLOR[kind];
    const variance=(mix(cell,7)-.5)*.15;
    color=addColor(color,variance);
    if(cell.controlledBy==="A")color=[color[0]*.86,color[1]*.98,Math.min(.95,color[2]*1.18)];
    if(cell.controlledBy==="B")color=[Math.min(.95,color[0]*1.17),color[1]*.88,color[2]*.91];
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
        tri(a,b,c,[.17,.44,.57]);
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
  function unit(piece,cell){
    const [x,z]=axialToWorld(cell);
    const y=HEIGHT[terrainKind(cell.terrain)];
    const team=PALETTE[piece.side];
    if(!team)return;
    const type=String(piece.type||"infantry").toLowerCase();
    const angle=piece.side==="A" ? 0 : Math.PI;
    // Stepped colored bases and bright unit silhouettes remain distinguishable
    // even if the camera is far enough to show the entire battlefield.
    plate(x,z,y+.015,.31,.075,STEEL);
    plate(x,z,y+.085,.27,.07,shade(team,.91));
    const ground=y+.15;
    const dark=shade(team,.48),bright=shade(team,1.25);
    if(type==="siege"||type==="heavy"){
      prism(x,z,ground,.21,.42,team,6,angle);
      plate(x,z,ground+.42,.25,.10,bright,angle);
      plate(x+.15*Math.cos(angle),z+.15*Math.sin(angle),ground+.35,.11,.10,dark,5);
    }else if(type==="captain"){
      prism(x,z,ground,.18,.58,team,6,angle);
      cone(x,z,ground+.58,.25,.37,bright,6,angle);
      for(let i=0;i<3;i++){
        const a=angle+TWO_PI*i/3;
        cone(x+Math.cos(a)*.17,z+Math.sin(a)*.17,ground+.56,.071,.20,[.91,.77,.44],4,a);
      }
    }else if(type==="raider"){
      cone(x,z,ground,.20,.68,team,5,angle);
      cone(x+.21*Math.cos(angle),z+.21*Math.sin(angle),ground+.16,.08,.46,bright,4,angle);
    }else if(type==="interceptor"){
      prism(x,z,ground,.18,.31,team,6,angle);
      for(const side of [-1,1]){
        const sx=x+Math.cos(angle+Math.PI/2)*side*.18;
        const sz=z+Math.sin(angle+Math.PI/2)*side*.18;
        cone(sx,sz,ground+.26,.12,.31,bright,4,angle+.2);
      }
      cone(x,z,ground+.35,.14,.34,team,5,angle);
    }else{
      cone(x,z,ground,.17,.68,team,6,angle);
      cone(x,z,ground+.46,.085,.29,bright,6,angle);
    }
    // Gold chevrons identify leaders without exposing hidden information.
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
