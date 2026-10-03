// Shared, data-only retained scene protocol. Geometry is in bounded world units.
export const sceneId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const keys=(v,required,optional=[])=>v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/<\/?[a-z][^>]*>/i.test(v)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const math=v=>text(v,2000)&&! /\\(?:html\w*|href|url|includegraphics|input|write|def|newcommand|require)\b/i.test(v);
const number=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function validateRetainedScene(block,{stored=false}={}){
 if(!keys(block,['id','type','width','height','objects'],['zones',...(!stored?['removedObjectIds']:[])])||block.type!=='scene'||!sceneId(block.id)||![block.width,block.height].every(v=>Number.isInteger(v)&&v>=100&&v<=2000)||!Array.isArray(block.objects)||block.objects.length>80)return null;
 const removed=block.removedObjectIds||[];
 if(!Array.isArray(removed)||removed.length>80||!removed.every(sceneId)||new Set(removed).size!==removed.length||!stored&&!block.objects.length&&!removed.length)return null;
 const ids=new Set(),point=(x,y)=>number(x,0,block.width)&&number(y,0,block.height);let vertices=0;
 for(const object of block.objects){
  if(!sceneId(object?.id)||ids.has(object.id)||removed.includes(object.id))return null;ids.add(object.id);
  const optional=['tone'];
  if(Object.hasOwn(object,'tone')&&!['ink','muted','accent'].includes(object.tone))return null;
  if(['rect','ellipse'].includes(object.type)){
   if(!keys(object,['id','type','x','y','width','height'],[...optional,'label'])||!point(object.x,object.y)||!number(object.width,1,block.width)||!number(object.height,1,block.height)||!point(object.x+object.width,object.y+object.height))return null;
  }else if(['line','arrow'].includes(object.type)){
   if(!keys(object,['id','type','x1','y1','x2','y2'],[...optional,'label'])||!point(object.x1,object.y1)||!point(object.x2,object.y2)||object.x1===object.x2&&object.y1===object.y2)return null;
  }else if(object.type==='polyline'){
   if(!keys(object,['id','type','points'],[...optional,'label'])||!Array.isArray(object.points)||object.points.length<2||object.points.length>128||!object.points.every(p=>Array.isArray(p)&&p.length===2&&point(...p))||!object.points.some(p=>p[0]!==object.points[0][0]||p[1]!==object.points[0][1]))return null;
   vertices+=object.points.length;if(vertices>512)return null;
  }else if(['text','math'].includes(object.type)){
   if(!keys(object,['id','type','x','y','width','height','text'],[...optional,'fontSize'])||!point(object.x,object.y)||!number(object.width,1,block.width)||!number(object.height,1,block.height)||!point(object.x+object.width,object.y+object.height)||!(object.type==='math'?math(object.text):text(object.text,1200))||Object.hasOwn(object,'fontSize')&&!number(object.fontSize,12,48))return null;
  }else return null;
  if(Object.hasOwn(object,'label')&&object.label!==''&&!text(object.label,120))return null;
 }
 return JSON.parse(JSON.stringify(block));
}
export function sceneHasVisualContent(block){return block?.type==='scene'&&Array.isArray(block.objects)&&block.objects.some(object=>object.type!=='text');}
export function blockHasVisualContent(block){return Boolean(block&&block.type!=='text'&&(block.type!=='scene'||sceneHasVisualContent(block)));}
export function sceneObjectText(object){return object?.text||object?.label||object?.type||'';}
