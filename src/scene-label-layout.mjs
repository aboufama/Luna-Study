const normalize=text=>String(text||'').normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim();
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
function bounds(o){
 if('x'in o)return{x:o.x,y:o.y,width:o.width,height:o.height};
 const points=o.points||[[o.x1,o.y1],[o.x2,o.y2]],xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 return{x:Math.min(...xs)-3,y:Math.min(...ys)-3,width:Math.max(...xs)-Math.min(...xs)+6,height:Math.max(...ys)-Math.min(...ys)+6};
}
// The model supplies geometry and exact wording. The viewer positions captions
// off strokes, avoids occupied boxes, and never duplicates an explicit label.
export function sceneLabelLayout(block){
 const labels=new Map(),placed=[],explicit=new Set(block.objects.filter(o=>o.type==='text').map(o=>normalize(o.text)));
 for(const o of block.objects){
  if(!o.label)continue;
  if(explicit.has(normalize(o.label))){labels.set(o.id,null);continue;}
  const shape=['rect','ellipse'].includes(o.type),w=shape?Math.max(1,o.width-12):Math.min(320,Math.max(42,o.label.length*10)),h=shape?Math.min(Math.max(24,o.height-16),Math.max(28,Math.ceil(o.label.length/Math.max(8,Math.floor(w/9)))*23)):32;
  let points;
  if(shape)points=[[o.x+o.width/2,o.y+o.height/2],[o.x+o.width/2,o.y+h/2+5],[o.x+o.width/2,o.y+o.height-h/2-5]];
  else {
   const a=o.points?.[0]||[o.x1,o.y1],b=o.points?.at(-1)||[o.x2,o.y2],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],vertical=Math.abs(b[1]-a[1])>Math.abs(b[0]-a[0]);
   points=vertical?[[mid[0]+w/2+14,mid[1]],[mid[0]-w/2-14,mid[1]]]:[[mid[0],mid[1]-h/2-10],[mid[0],mid[1]+h/2+10]];
   for(const p of [a,b])points.push([p[0]+w/2+12,p[1]-h/2-10],[p[0]-w/2-12,p[1]+h/2+10]);
  }
  const candidates=points.map(([x,y])=>({x:Math.max(0,Math.min(block.width-w,x-w/2)),y:Math.max(0,Math.min(block.height-h,y-h/2)),width:w,height:h}));
  const obstacles=block.objects.filter(other=>other.id!==o.id).filter(other=>{
   if(!shape||!['rect','ellipse'].includes(other.type))return true;
   return !(other.x<=o.x&&other.y<=o.y&&other.x+other.width>=o.x+o.width&&other.y+other.height>=o.y+o.height);
  }).map(bounds).concat(placed);
  const score=box=>obstacles.reduce((sum,other)=>sum+overlap(box,other),0);
  let best=candidates[0],bestScore=score(best);for(const box of candidates.slice(1)){const value=score(box);if(value<bestScore){best=box;bestScore=value;}if(!bestScore)break;}
  labels.set(o.id,best);placed.push(best);
 }
 return labels;
}
