// General 2D implicit union. Targets remain semantic rectangles; only the
// decoration is solved here. The output includes exterior and hole contours.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(...values)=>values.every(Number.isFinite);
function prepared(shape){
  if(shape.kind==='rect'&&finite(shape.x,shape.y,shape.width,shape.height)&&shape.width>0&&shape.height>0){
    const radius=clamp(Number.isFinite(shape.radius)?shape.radius:0,0,Math.min(shape.width,shape.height)/2);
    return {kind:shape.kind,x:shape.x,y:shape.y,width:shape.width,height:shape.height,radius,left:shape.x,top:shape.y,right:shape.x+shape.width,bottom:shape.y+shape.height};
  }
  if(shape.kind==='circle'&&finite(shape.x,shape.y,shape.r)&&shape.r>0)return {kind:shape.kind,x:shape.x,y:shape.y,r:shape.r,left:shape.x-shape.r,top:shape.y-shape.r,right:shape.x+shape.r,bottom:shape.y+shape.r};
  if(shape.kind==='capsule'&&finite(shape.x1,shape.y1,shape.x2,shape.y2,shape.r)&&shape.r>0){
    const reverse=shape.x1>shape.x2||shape.x1===shape.x2&&shape.y1>shape.y2;
    return {kind:shape.kind,x1:reverse?shape.x2:shape.x1,y1:reverse?shape.y2:shape.y1,x2:reverse?shape.x1:shape.x2,y2:reverse?shape.y1:shape.y2,r:shape.r,left:Math.min(shape.x1,shape.x2)-shape.r,top:Math.min(shape.y1,shape.y2)-shape.r,right:Math.max(shape.x1,shape.x2)+shape.r,bottom:Math.max(shape.y1,shape.y2)+shape.r};
  }
  throw new TypeError('Invalid contour primitive');
}
function distance(shape,x,y){
  if(shape.kind==='rect'){
    const dx=Math.abs(x-shape.x-shape.width/2)-shape.width/2+shape.radius;
    const dy=Math.abs(y-shape.y-shape.height/2)-shape.height/2+shape.radius;
    return Math.hypot(Math.max(dx,0),Math.max(dy,0))+Math.min(Math.max(dx,dy),0)-shape.radius;
  }
  if(shape.kind==='circle')return Math.hypot(x-shape.x,y-shape.y)-shape.r;
  const vx=shape.x2-shape.x1,vy=shape.y2-shape.y1;
  const t=clamp(((x-shape.x1)*vx+(y-shape.y1)*vy)/Math.max(.00001,vx*vx+vy*vy),0,1);
  return Math.hypot(x-shape.x1-vx*t,y-shape.y1-vy*t)-shape.r;
}
const smoothMinimum=(a,b,k)=>{if(!Number.isFinite(a))return b;if(!k)return Math.min(a,b);const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};
const rounded=value=>Math.round(value*100)/100;
function pathFor(points){
  const middle=(a,b)=>`${rounded((a.x+b.x)/2)},${rounded((a.y+b.y)/2)}`;
  let d=`M${middle(points.at(-1),points[0])}`;
  for(let i=0;i<points.length;i++)d+=`Q${rounded(points[i].x)},${rounded(points[i].y)} ${middle(points[i],points[(i+1)%points.length])}`;
  return `${d}Z`;
}

/** Rounded boxes, circles and capsules share one distance field and contour.
 * Marching-square saddles use the actual field at the cell center. Shared grid
 * edge IDs prevent cracks, and closed cycles retain interior holes. */
export function contourUnion(input,{step=1.5,smoothing=2.4}={}){
  if(!Array.isArray(input)||!input.length)return {d:'',contours:[],bounds:null};
  if(input.length>4096)throw new RangeError('Too many contour primitives');
  const shapes=[...new Map(input.map(prepared).map(shape=>[JSON.stringify(shape),shape])).values()].sort((a,b)=>a.left-b.left||a.top-b.top||a.right-b.right||a.bottom-b.bottom||a.kind.localeCompare(b.kind)||JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const feature=Math.min(...shapes.map(shape=>shape.kind==='rect'?Math.min(shape.width,shape.height):shape.r*2));
  const desired=Math.min(finite(step)?clamp(step,.01,4):1.5,Math.max(.001,feature/4));
  const k=Math.min(finite(smoothing)?clamp(smoothing,0,6):2.4,feature*.5),margin=k+desired*3;
  const left=Math.min(...shapes.map(s=>s.left))-margin,top=Math.min(...shapes.map(s=>s.top))-margin;
  const right=Math.max(...shapes.map(s=>s.right))+margin,bottom=Math.max(...shapes.map(s=>s.bottom))+margin;
  if(!finite(left,top,right,bottom)||right-left>100000||bottom-top>100000)throw new RangeError('Contour coordinate span is too large');
  const pitch=Math.max(desired,Math.sqrt((right-left)*(bottom-top)/250000),(right-left)/4096,(bottom-top)/4096);
  const cols=Math.ceil((right-left)/pitch),rows=Math.ceil((bottom-top)/pitch),stride=cols+1;
  // Spatial bins keep the 32-target case interactive. Only primitives close
  // enough to influence the zero contour enter a sample's smooth minimum.
  const binSize=Math.max(32,(right-left)/64,(bottom-top)/64),reach=k+pitch*2,bins=new Map();
  for(const shape of shapes)for(let by=Math.floor((shape.top-reach)/binSize);by<=Math.floor((shape.bottom+reach)/binSize);by++)for(let bx=Math.floor((shape.left-reach)/binSize);bx<=Math.floor((shape.right+reach)/binSize);bx++){
    const key=`${bx}:${by}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(shape);
  }
  const field=(x,y)=>{let result=Infinity;const nearby=bins.get(`${Math.floor(x/binSize)}:${Math.floor(y/binSize)}`);if(!nearby)return reach;
    for(const shape of nearby){
      if(result<0&&(x<shape.left-k||x>shape.right+k||y<shape.top-k||y>shape.bottom+k))continue;
      result=smoothMinimum(result,distance(shape,x,y),k);
    }return result;
  };
  const values=new Float32Array((cols+1)*(rows+1));
  for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++)values[y*stride+x]=field(left+x*pitch,top+y*pitch);
  const nodes=new Map();
  function node(key,x1,y1,x2,y2,a,b){if(nodes.has(key))return nodes.get(key);const t=clamp(a/(a-b),0,1),value={key,x:left+(x1+(x2-x1)*t)*pitch,y:top+(y1+(y2-y1)*t)*pitch,next:[]};nodes.set(key,value);return value;}
  const pairs={1:[[3,0]],2:[[0,1]],3:[[3,1]],4:[[1,2]],6:[[0,2]],7:[[3,2]],8:[[2,3]],9:[[0,2]],11:[[1,2]],12:[[1,3]],13:[[0,1]],14:[[3,0]]};
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const a=values[y*stride+x],b=values[y*stride+x+1],c=values[(y+1)*stride+x+1],d=values[(y+1)*stride+x];
    const mask=Number(a<=0)+Number(b<=0)*2+Number(c<=0)*4+Number(d<=0)*8;if(!mask||mask===15)continue;
    let segments=pairs[mask];
    if(mask===5||mask===10){const centerInside=field(left+(x+.5)*pitch,top+(y+.5)*pitch)<=0;segments=(mask===5)===centerInside?[[0,1],[2,3]]:[[3,0],[1,2]];}
    const edge=index=>index===0?node(`h:${x}:${y}`,x,y,x+1,y,a,b):index===1?node(`v:${x+1}:${y}`,x+1,y,x+1,y+1,b,c):index===2?node(`h:${x}:${y+1}`,x,y+1,x+1,y+1,d,c):node(`v:${x}:${y}`,x,y,x,y+1,a,d);
    for(const [from,to]of segments){const start=edge(from),end=edge(to);start.next.push(end);end.next.push(start);}
  }
  const visited=new Set(),contours=[];
  for(const start of nodes.values()){
    if(visited.has(start.key))continue;
    const points=[];let current=start,previous=null;
    do{visited.add(current.key);points.push({x:current.x,y:current.y});const next=current.next.find(item=>item!==previous);previous=current;current=next;}while(current&&current!==start&&!visited.has(current.key));
    if(current===start&&points.length>=3)contours.push(points);
  }
  return {d:contours.map(pathFor).join(''),contours,bounds:{left,top,right,bottom},pitch};
}

const nearestAxis=(a0,a1,b0,b1)=>a1<b0?[a1,b0]:b1<a0?[a0,b1]:[(Math.max(a0,b0)+Math.min(a1,b1))/2,(Math.max(a0,b0)+Math.min(a1,b1))/2];
/** Semantic boxes acquire short necks only across a bounded geometric gap.
 * No matrix coordinates, rows, columns, or hardcoded selection patterns. */
export function selectionContours(rects,{gap=22,padding=4,radius=8,...options}={}){
  const boxes=[...new Map(rects.filter(rect=>finite(rect.x,rect.y,rect.width,rect.height)&&rect.width>0&&rect.height>0).map(({x,y,width,height})=>{const box={x,y,width,height};return [JSON.stringify(box),box];})).values()];
  if(boxes.length>128)throw new RangeError('Too many selection rectangles');
  const shapes=boxes.map(rect=>({kind:'rect',x:rect.x-padding,y:rect.y-padding,width:rect.width+padding*2,height:rect.height+padding*2,radius}));
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j], [x1,x2]=nearestAxis(a.x-padding,a.x+a.width+padding,b.x-padding,b.x+b.width+padding),[y1,y2]=nearestAxis(a.y-padding,a.y+a.height+padding,b.y-padding,b.y+b.height+padding);
    const separation=Math.hypot(x2-x1,y2-y1);
    if(separation>gap)continue;
    if(separation===0&&(distance(prepared(shapes[i]),x1,y1)<=0||distance(prepared(shapes[j]),x1,y1)<=0))continue;
    shapes.push({kind:'capsule',x1,y1,x2,y2,r:Math.max(2.5,Math.min(6,a.width*.2,a.height*.2,b.width*.2,b.height*.2))});
  }
  return contourUnion(shapes,options);
}
