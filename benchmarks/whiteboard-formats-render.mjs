// Benchmark-only renderers. Production continues to use its existing board UI.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { validateBoard } from '../server/tutor-output.mjs';
import { applyBoardUpdate } from '../server/whiteboard.mjs';

export const formatPrompts = {
  json: `Return only a JSON board matching the current app: {"title":string,"mode":"replace"|"patch","blocks":array,"removedIds"?:string[]}. Stable block id is required. Blocks: matrix {id,type:"matrix",rows:string[][],rowLabels?:string[],columnLabels?:string[],label?:string}; diagram {id,type:"diagram",elements:array}; text or latex {id,type,content:string}. Diagram elements: line/arrow {type,x1,y1,x2,y2}; rect {type,x,y,width,height,label?}; circle {type,x,y,r,label?}; text {type,x,y,text}. Diagram coordinates 0..100; at most 30 total diagram primitives, 6 blocks, matrix at most 12x12. There is no polyline/path plot primitive: use line segments within the primitive budget. Render axes and clear numerical ticks for plots. Matrix empty values are empty strings. For edits use mode patch and preserve unrelated block IDs/content. Do not add unsupported properties, markdown, tools, or explanations.`,
  svg: `Return only a complete SVG document with xmlns="http://www.w3.org/2000/svg", viewBox="0 0 800 500", width="800", height="500". Allowed tags: svg,g,line,polyline,polygon,path,rect,circle,ellipse,text,tspan,title,desc. Use plain presentation attributes, no style/CSS, scripts, event handlers, href, images, external resources, use, defs, markers, foreignObject, DTD, or XML processing instructions. Allowed attributes: id, x,y,x1,y1,x2,y2,cx,cy,r,rx,ry,width,height,d,points,transform,fill,stroke,stroke-width,stroke-linecap,stroke-linejoin,font-size,font-family,font-weight,text-anchor,dominant-baseline,opacity,fill-opacity,stroke-opacity,viewBox,xmlns,role,aria-label,dx,dy. Numeric coordinates, safe named/hex colors; transform only translate/scale/rotate. Add stable semantic IDs to every visual object or its parent group. Every matrix cell must be its own rect with ID matrixId-cell-ROW-COL using zero-based indices; add text separately for values. For edits return the entire updated SVG while preserving all unchanged object IDs. Lay out labels legibly inside the 800x500 canvas. No markdown or explanations.`,
  dsl: `Return only JSON {title:string,mode:"replace"|"patch",objects:array,removedIds?:string[]}. Every object has a stable id and type. Supported objects: matrix {id,type:"matrix",rows:integer,cols:integer,values?:string[][],rowLabels?:string[],columnLabels?:string[],label?:string}; graph {id,type:"graph",nodes:[{id,label}],edges:[{id,from,to,label?}],direction?:"down"|"right"}; line {id,type:"line",x1,y1,x2,y2,label?}; point {id,type:"point",x,y,label?}; text {id,type:"text",x,y,text}; plot {id,type:"plot",points:[[x,y],...],xDomain:[min,max],yDomain:[min,max],label?}; axis {id,type:"axis",min:number,max:number,points:[{id,value:number,label:string}]}. Line/point/text coordinates are 0..100 in a shared canvas. Plot points are actual sampled data within its domains, never a formula to evaluate; renderer adds numerical axes/ticks. Matrix dimensions 1..12; omitted values means all cells blank. Matrix, graph, plot, and axis layout is deterministic; graph supports branches and return edges. Edges refer to node IDs. For patch replace only objects whose IDs change, retaining all other objects. Nested graph/axis objects replace as a unit, so retain their unaffected child IDs/data. No extra fields, markdown, or explanations.`,
};

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const validId = value => typeof value === 'string' && ID.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6;
const coordinate = value => finite(value) && value >= 0 && value <= 100;
const string = (value, max = 200) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const exact = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[char]);
const number = value => Math.round(value * 1000) / 1000;
const tag = (name, attrs, content = '') => `<${name} ${Object.entries(attrs).filter(([, value]) => value !== undefined).map(([key,value]) => `${key}="${escape(value)}"`).join(' ')}>${content}</${name}>`;
const label = (id,x,y,value,size=18,anchor='middle') => tag('text',{id,x:number(x),y:number(y),fill:'#172c3f',stroke:'none','font-size':size,'text-anchor':anchor,'dominant-baseline':'central'},escape(value));
const line = (id,x1,y1,x2,y2) => tag('line',{id,x1:number(x1),y1:number(y1),x2:number(x2),y2:number(y2)});
const wrap = body => tag('svg',{xmlns:'http://www.w3.org/2000/svg',viewBox:'0 0 800 500',width:800,height:500,fill:'none',stroke:'#425b70','stroke-width':2,'font-family':'Arial, sans-serif'},body);

function validateDsl(value, previous) {
  if (!exact(value,['title','mode','objects'],['removedIds']) || !string(value.title,120) || !['replace','patch'].includes(value.mode) || !Array.isArray(value.objects) || value.objects.length>30) throw Error('invalid-dsl-envelope');
  const removed=value.removedIds||[];
  if (!Array.isArray(removed)||removed.length>30||removed.some(id=>!validId(id))||new Set(removed).size!==removed.length) throw Error('invalid-removed-ids');
  const authored=new Set();
  for (const object of value.objects) {
    if (!validId(object?.id)||authored.has(object.id)||removed.includes(object.id)) throw Error('invalid-object-id');
    authored.add(object.id);
    const base=['id','type']; let valid=false;
    if (object.type==='matrix') {
      valid=exact(object,[...base,'rows','cols'],['values','rowLabels','columnLabels','label']) && Number.isInteger(object.rows)&&object.rows>=1&&object.rows<=12&&Number.isInteger(object.cols)&&object.cols>=1&&object.cols<=12;
      if(valid&&object.values!==undefined)valid=Array.isArray(object.values)&&object.values.length===object.rows&&object.values.every(row=>Array.isArray(row)&&row.length===object.cols&&row.every(cell=>string(cell,160)));
      for(const [key,size] of [['rowLabels',object.rows],['columnLabels',object.cols]])if(valid&&object[key]!==undefined)valid=Array.isArray(object[key])&&object[key].length===size&&object[key].every(value=>string(value,120));
    } else if(object.type==='graph') {
      valid=exact(object,[...base,'nodes','edges'],['direction'])&&(!object.direction||['down','right'].includes(object.direction))&&Array.isArray(object.nodes)&&object.nodes.length>0&&object.nodes.length<=30&&Array.isArray(object.edges)&&object.edges.length<=50;
      if(valid){const ids=new Set();valid=object.nodes.every(node=>exact(node,['id','label'])&&validId(node.id)&&!ids.has(node.id)&&ids.add(node.id)&&string(node.label,120));const edges=new Set();valid=valid&&object.edges.every(edge=>exact(edge,['id','from','to'],['label'])&&validId(edge.id)&&!ids.has(edge.id)&&!edges.has(edge.id)&&edges.add(edge.id)&&ids.has(edge.from)&&ids.has(edge.to)&&(edge.label===undefined||string(edge.label,120)));}
    } else if(object.type==='line') valid=exact(object,[...base,'x1','y1','x2','y2'],['label'])&&['x1','y1','x2','y2'].every(key=>coordinate(object[key]));
    else if(object.type==='point') valid=exact(object,[...base,'x','y'],['label'])&&coordinate(object.x)&&coordinate(object.y);
    else if(object.type==='text') valid=exact(object,[...base,'x','y','text'])&&coordinate(object.x)&&coordinate(object.y)&&string(object.text);
    else if(object.type==='plot') {
      valid=exact(object,[...base,'points','xDomain','yDomain'],['label'])&&['xDomain','yDomain'].every(key=>Array.isArray(object[key])&&object[key].length===2&&object[key].every(finite)&&object[key][0]<object[key][1]);
      valid=valid&&Array.isArray(object.points)&&object.points.length>=2&&object.points.length<=256&&object.points.every(point=>Array.isArray(point)&&point.length===2&&point.every(finite)&&point[0]>=object.xDomain[0]&&point[0]<=object.xDomain[1]&&point[1]>=object.yDomain[0]&&point[1]<=object.yDomain[1]);
    } else if(object.type==='axis') {
      valid=exact(object,[...base,'min','max','points'])&&finite(object.min)&&finite(object.max)&&object.min<object.max&&Array.isArray(object.points)&&object.points.length<=24;
      if(valid){const ids=new Set();valid=object.points.every(point=>exact(point,['id','value','label'])&&validId(point.id)&&!ids.has(point.id)&&ids.add(point.id)&&finite(point.value)&&point.value>=object.min&&point.value<=object.max&&string(point.label,120));}
    }
    if(!valid||object.label!==undefined&&!string(object.label,120))throw Error('invalid-dsl-object');
  }
  let objects=value.mode==='patch'?structuredClone(previous?.objects||[]):[];
  if(removed.some(id=>!objects.some(object=>object.id===id)))throw Error('unknown-removed-id');
  objects=objects.filter(object=>!removed.includes(object.id));
  for(const object of value.objects){const at=objects.findIndex(old=>old.id===object.id);if(at<0)objects.push(structuredClone(object));else objects[at]=structuredClone(object);}
  if(objects.length>30)throw Error('scene-object-limit');
  return {format:'dsl',title:value.title,objects};
}

function matrixSvg(object,box) {
  const rows=object.values||Array.from({length:object.rows},()=>Array(object.cols).fill(''));
  const width=Math.min(680,box.w-90),height=Math.min(350,box.h-50),x=box.x+(box.w-width)/2+15,y=box.y+(box.h-height)/2+12,cw=width/object.cols,ch=height/object.rows;
  const size=Math.max(10,Math.min(20,ch*.42,cw/Math.max(3,...rows.flat().map(value=>value.length))));
  let svg=object.label?label(`${object.id}-label`,box.x+box.w/2,box.y+15,object.label,16):'';
  object.columnLabels?.forEach((value,c)=>{svg+=label(`${object.id}-column-${c}`,x+(c+.5)*cw,y-15,value,14);});
  object.rowLabels?.forEach((value,r)=>{svg+=label(`${object.id}-row-${r}`,x-12,y+(r+.5)*ch,value,14,'end');});
  rows.forEach((row,r)=>row.forEach((value,c)=>{const id=`${object.id}-cell-${r}-${c}`;svg+=tag('rect',{id,x:number(x+c*cw),y:number(y+r*ch),width:number(cw),height:number(ch),fill:'#ffffff'});if(value)svg+=label(`${id}-text`,x+(c+.5)*cw,y+(r+.5)*ch,value,size);}));
  return tag('g',{id:object.id},svg);
}

function graphSvg(object,box) {
  const depth=new Map(object.nodes.map(node=>[node.id,0])),indegree=new Map(object.nodes.map(node=>[node.id,0]));
  for(const edge of object.edges)indegree.set(edge.to,indegree.get(edge.to)+1);
  const queue=object.nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id);let visited=0;
  while(queue.length){const id=queue.shift();visited++;for(const edge of object.edges.filter(edge=>edge.from===id)){depth.set(edge.to,Math.max(depth.get(edge.to),depth.get(id)+1));indegree.set(edge.to,indegree.get(edge.to)-1);if(indegree.get(edge.to)===0)queue.push(edge.to);}}
  if(visited!==object.nodes.length)object.nodes.forEach((node,index)=>depth.set(node.id,index));
  const levels=Math.max(...depth.values())+1,positions=new Map();
  for(let level=0;level<levels;level++){const nodes=object.nodes.filter(node=>depth.get(node.id)===level);nodes.forEach((node,index)=>{const across=(index+1)/(nodes.length+1),along=(level+.5)/levels;positions.set(node.id,object.direction==='right'?{x:box.x+60+along*(box.w-120),y:box.y+35+across*(box.h-70)}:{x:box.x+60+across*(box.w-120),y:box.y+35+along*(box.h-70)});});}
  let svg='';
  object.edges.forEach((edge,index)=>{const a=positions.get(edge.from),b=positions.get(edge.to),back=depth.get(edge.to)<=depth.get(edge.from),horizontal=object.direction==='right';let lx=(a.x+b.x)/2+12,ly=(a.y+b.y)/2;
    if(back){const side=horizontal?box.y+box.h-16-(index%3)*14:box.x+box.w-25-(index%3)*18;svg+=tag('path',{id:edge.id,d:horizontal?`M ${a.x} ${a.y} C ${a.x} ${side} ${b.x} ${side} ${b.x} ${b.y}`:`M ${a.x} ${a.y} C ${side} ${a.y} ${side} ${b.y} ${b.x} ${b.y}`});if(horizontal)ly=side-12;else lx=side-25;}
    else svg+=line(edge.id,a.x,a.y,b.x,b.y);
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,ex=b.x-dx/len*23,ey=b.y-dy/len*23;
    svg+=tag('polyline',{id:`${edge.id}-arrow`,points:`${number(ex-dx/len*8-dy/len*4)},${number(ey-dy/len*8+dx/len*4)} ${number(ex)},${number(ey)} ${number(ex-dx/len*8+dy/len*4)},${number(ey-dy/len*8-dx/len*4)}`});
    if(edge.label)svg+=label(`${edge.id}-label`,lx,ly-10,edge.label,14);
  });
  for(const node of object.nodes){const p=positions.get(node.id),width=Math.min(150,Math.max(90,node.label.length*8));svg+=tag('g',{id:node.id},tag('rect',{id:`${node.id}-box`,x:number(p.x-width/2),y:number(p.y-21),width,height:42,rx:8,fill:'#f3f7fa'})+label(`${node.id}-label`,p.x,p.y,node.label,16));}
  return tag('g',{id:object.id},svg);
}

function plotSvg(object,box){
  const left=box.x+70,right=box.x+box.w-35,top=box.y+35,bottom=box.y+box.h-55;
  const x=value=>left+(value-object.xDomain[0])/(object.xDomain[1]-object.xDomain[0])*(right-left),y=value=>bottom-(value-object.yDomain[0])/(object.yDomain[1]-object.yDomain[0])*(bottom-top);
  const axisX=x(Math.max(object.xDomain[0],Math.min(object.xDomain[1],0))),axisY=y(Math.max(object.yDomain[0],Math.min(object.yDomain[1],0)));
  let svg=line(`${object.id}-x-axis`,left,axisY,right,axisY)+line(`${object.id}-y-axis`,axisX,top,axisX,bottom)+label(`${object.id}-x-name`,right+15,axisY-12,'x',16)+label(`${object.id}-y-name`,axisX+14,top-12,'y',16);
  for(let i=0;i<=4;i++){const xv=object.xDomain[0]+(object.xDomain[1]-object.xDomain[0])*i/4,yv=object.yDomain[0]+(object.yDomain[1]-object.yDomain[0])*i/4;svg+=line(`${object.id}-xtick-${i}`,x(xv),axisY-4,x(xv),axisY+4)+label(`${object.id}-xlabel-${i}`,x(xv),Math.min(box.y+box.h-15,axisY+20),number(xv),13);svg+=line(`${object.id}-ytick-${i}`,axisX-4,y(yv),axisX+4,y(yv))+label(`${object.id}-ylabel-${i}`,axisX-10,y(yv),number(yv),13,'end');}
  svg+=tag('polyline',{id:`${object.id}-curve`,points:object.points.map(point=>`${number(x(point[0]))},${number(y(point[1]))}`).join(' '),stroke:'#216c9f','stroke-width':3});
  if(object.label)svg+=label(`${object.id}-label`,(left+right)/2,box.y+14,object.label,16);
  return tag('g',{id:object.id},svg);
}

function renderDsl(scene){
  const panels=scene.objects.filter(object=>['matrix','graph','plot','axis'].includes(object.type)),height=440/Math.max(1,panels.length);let svg='';
  for(const object of scene.objects){const index=panels.indexOf(object),box={x:20,y:30+Math.max(0,index)*height,w:760,h:height};
    if(object.type==='matrix')svg+=matrixSvg(object,box);
    else if(object.type==='graph')svg+=graphSvg(object,box);
    else if(object.type==='plot')svg+=plotSvg(object,box);
    else if(object.type==='axis'){
      const x=value=>box.x+50+(value-object.min)/(object.max-object.min)*(box.w-100),y=box.y+box.h/2;
      let body=line(`${object.id}-line`,x(object.min),y,x(object.max),y)+label(`${object.id}-min`,x(object.min),y+30,object.min)+label(`${object.id}-max`,x(object.max),y+30,object.max);
      for(const point of object.points)body+=tag('circle',{id:point.id,cx:number(x(point.value)),cy:number(y),r:5,fill:'#216c9f'})+label(`${point.id}-label`,x(point.value),y-25,point.label,16);
      svg+=tag('g',{id:object.id},body);
    }else if(object.type==='line'){svg+=line(object.id,object.x1*8,object.y1*5,object.x2*8,object.y2*5);if(object.label)svg+=label(`${object.id}-label`,(object.x1+object.x2)*4,(object.y1+object.y2)*2.5-16,object.label);}
    else if(object.type==='point'){svg+=tag('circle',{id:object.id,cx:object.x*8,cy:object.y*5,r:5,fill:'#216c9f'});if(object.label)svg+=label(`${object.id}-label`,object.x*8,object.y*5-20,object.label);}
    else if(object.type==='text')svg+=label(object.id,object.x*8,object.y*5,object.text);
  }return wrap(svg);
}

function renderJson(board){
  const height=440/Math.max(1,board.blocks.length);let svg='';
  board.blocks.forEach((block,index)=>{const box={x:20,y:30+index*height,w:760,h:height};
    if(block.type==='matrix')svg+=matrixSvg({...block,values:block.rows,rows:block.rows.length,cols:block.rows[0].length},box);
    else if(block.type==='diagram'){let body='';block.elements.forEach((item,i)=>{const id=`${block.id}-element-${i}`,x=value=>box.x+value/100*box.w,y=value=>box.y+value/100*box.h;
      if(item.type==='line'||item.type==='arrow'){body+=line(id,x(item.x1),y(item.y1),x(item.x2),y(item.y2));if(item.type==='arrow'){const dx=x(item.x2)-x(item.x1),dy=y(item.y2)-y(item.y1),length=Math.hypot(dx,dy)||1;body+=tag('polyline',{id:`${id}-arrow`,points:`${number(x(item.x2)-dx/length*10-dy/length*5)},${number(y(item.y2)-dy/length*10+dx/length*5)} ${number(x(item.x2))},${number(y(item.y2))} ${number(x(item.x2)-dx/length*10+dy/length*5)},${number(y(item.y2)-dy/length*10-dx/length*5)}`});}}
      if(item.type==='rect')body+=tag('rect',{id,x:x(item.x),y:y(item.y),width:item.width/100*box.w,height:item.height/100*box.h,fill:'#ffffff'});
      if(item.type==='circle')body+=tag('circle',{id,cx:x(item.x),cy:y(item.y),r:item.r/100*Math.min(box.w,box.h),fill:'#ffffff'});
      if(item.text||item.label)body+=label(item.type==='text'?id:`${id}-label`,x(item.x+(item.type==='rect'?item.width/2:0)),y(item.y+(item.type==='rect'?item.height/2:0)),item.text||item.label,16);
    });svg+=tag('g',{id:block.id},body);}
    else svg+=label(block.id,box.x+box.w/2,box.y+box.h/2,block.content,18);
  });return wrap(svg);
}

const SVG_TAGS=new Set('svg g line polyline polygon path rect circle ellipse text tspan title desc'.split(' '));
const SVG_ATTRS=new Set('id x y x1 y1 x2 y2 cx cy r rx ry width height d points transform fill stroke stroke-width stroke-linecap stroke-linejoin font-size font-family font-weight text-anchor dominant-baseline opacity fill-opacity stroke-opacity viewBox xmlns role aria-label dx dy'.split(' '));
const numericAttrs=new Set('x y x1 y1 x2 y2 cx cy r rx ry width height stroke-width font-size opacity fill-opacity stroke-opacity dx dy'.split(' '));
function checkedSvg(value){
  if(typeof value!=='string'||value.length>100000||/<!|<\?/.test(value))throw Error('forbidden-svg-declaration');
  const errors=[],document=new DOMParser({errorHandler:{warning:()=>errors.push('xml-warning'),error:()=>errors.push('xml-error'),fatalError:()=>errors.push('xml-fatal')}}).parseFromString(value,'image/svg+xml');
  if(errors.length||document.documentElement?.tagName!=='svg'||document.documentElement.getAttribute('xmlns')!=='http://www.w3.org/2000/svg'||document.documentElement.getAttribute('viewBox').trim().replace(/\s+/g,' ')!=='0 0 800 500')throw Error('invalid-svg-document');
  const ids=[],texts=[],authoredShapes=[],cells=[],textById=new Map();let elements=0;
  function walk(node,parentId=null){
    if(node.nodeType===3){if(!['text','tspan','title','desc'].includes(node.parentNode?.tagName)&&node.data.trim())throw Error('unexpected-svg-text');return;}
    if(node.nodeType!==1)throw Error('forbidden-svg-node');
    if(!SVG_TAGS.has(node.tagName)||node.namespaceURI!=='http://www.w3.org/2000/svg'||++elements>1000)throw Error('forbidden-svg-element');
    const id=node.getAttribute('id');if(id){if(!ID.test(id)||ids.includes(id))throw Error('duplicate-or-invalid-svg-id');ids.push(id);}
    for(let i=0;i<node.attributes.length;i++){const attribute=node.attributes.item(i),name=attribute.name,val=attribute.value;
      if(!SVG_ATTRS.has(name)||/url\s*\(|javascript:|data:|https?:|file:/i.test(val)&&name!=='xmlns')throw Error('forbidden-svg-attribute');
      if(name==='xmlns'&&val!=='http://www.w3.org/2000/svg')throw Error('forbidden-svg-namespace');
      if(numericAttrs.has(name)&&(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(val)||!finite(Number(val))))throw Error('invalid-svg-number');
      if(['fill','stroke'].includes(name)&&! /^(?:#[a-f0-9]{3,8}|[a-z]+)$/i.test(val))throw Error('invalid-svg-color');
      if(name==='transform'&&! /^(?:(?:translate|scale|rotate)\(\s*[-+\deE.,\s]+\)\s*)+$/.test(val))throw Error('invalid-svg-transform');
      if(name==='d'&&(!/^[MmLlHhVvCcSsQqTtAaZz\d\s.,+eE-]+$/.test(val)||val.length>12000))throw Error('invalid-svg-path');
      if(name==='points'&&(!/^[\d\s.,+eE-]+$/.test(val)||val.length>12000))throw Error('invalid-svg-points');
    }
    if(['line','polyline','polygon','path','rect','circle','ellipse','text'].includes(node.tagName)){if(!id&&!parentId)throw Error('missing-svg-object-id');authoredShapes.push({id:id||parentId,type:node.tagName});}
    if(node.tagName==='text'){texts.push(node.textContent);if(id)textById.set(id,node.textContent);}
    if(node.tagName==='rect'&&/-cell-\d+-\d+$/.test(id))cells.push(id);
    for(let child=node.firstChild;child;child=child.nextSibling)walk(child,id||parentId);
  }
  for(let child=document.firstChild;child;child=child.nextSibling){if(child.nodeType===3&&!child.data.trim())continue;walk(child);}
  const root=document.documentElement;root.setAttribute('width','800');root.setAttribute('height','500');
  const groups=new Map();
  for(const cell of cells){const [,id,r,c]=cell.match(/^(.*)-cell-(\d+)-(\d+)$/);if(Number(r)>=12||Number(c)>=12)continue;if(!groups.has(id))groups.set(id,[]);groups.get(id).push({cell,r:Number(r),c:Number(c)});}
  const matrices=[...groups].map(([id,entries])=>{const rows=1+Math.max(...entries.map(entry=>entry.r)),cols=1+Math.max(...entries.map(entry=>entry.c)),values=Array.from({length:rows},()=>Array(cols).fill(''));for(const entry of entries)values[entry.r][entry.c]=textById.get(`${entry.cell}-text`)||'';return {id,rows,cols,values,indexedCells:entries.length,completeGrid:entries.length===rows*cols};});
  return {svg:new XMLSerializer().serializeToString(root),ids,texts,cells,matrices,elements,shapes:authoredShapes};
}

export function parseFormat(format,text,{previous}={}){
  try{
    if(!Object.hasOwn(formatPrompts,format)||typeof text!=='string'||text.length>100000)throw Error('invalid-format-input');
    const prior=previous?.scene||previous;let scene,svg,matrices=[],plots=[],authoredIds=[];
    if(format==='svg'){const checked=checkedSvg(text.trim());scene={format:'svg',svg:checked.svg};svg=checked.svg;authoredIds=checked.ids;matrices=checked.matrices;}
    else if(format==='json'){
      const board=validateBoard(JSON.parse(text));if(!board)throw Error('invalid-current-json');
      const merged=applyBoardUpdate(prior?.format==='json'?prior.board:null,board);if(!merged)throw Error('invalid-current-json-patch');
      scene={format:'json',board:merged};svg=renderJson(merged);authoredIds=merged.blocks.map(block=>block.id);
      matrices=merged.blocks.filter(block=>block.type==='matrix').map(block=>({id:block.id,rows:block.rows.length,cols:block.rows[0].length,values:block.rows}));
    }else{
      scene=validateDsl(JSON.parse(text),prior?.format==='dsl'?prior:null);svg=renderDsl(scene);authoredIds=scene.objects.flatMap(object=>[object.id,...(object.nodes||[]).map(node=>node.id),...(object.edges||[]).map(edge=>edge.id),...(object.type==='axis'?object.points.map(point=>point.id):[])]);
      matrices=scene.objects.filter(object=>object.type==='matrix').map(object=>({id:object.id,rows:object.rows,cols:object.cols,values:object.values||Array.from({length:object.rows},()=>Array(object.cols).fill(''))}));
      plots=scene.objects.filter(object=>object.type==='plot').map(({id,points,xDomain,yDomain})=>({id,points,xDomain,yDomain}));
    }
    const checked=checkedSvg(svg),previousIds=prior?.format===format?checkedSvg(format==='svg'?prior.svg:format==='json'?renderJson(prior.board):renderDsl(prior)).ids:[];
    const ids=checked.ids,stats={ids,selectableIds:ids,texts:checked.texts,authoredIds,derivedIds:ids.filter(id=>!authoredIds.includes(id)),cellIds:checked.cells,matrices,plots,elements:checked.elements,shapes:checked.shapes,retainedIds:previousIds.filter(id=>ids.includes(id)),removedIds:previousIds.filter(id=>!ids.includes(id)),svgBytes:Buffer.byteLength(checked.svg)};
    return {valid:true,scene,svg:checked.svg,errors:[],stats};
  }catch(error){return {valid:false,scene:null,svg:null,errors:[error instanceof SyntaxError?'invalid-json':String(error.message).slice(0,120)],stats:{ids:[],selectableIds:[],texts:[],matrices:[],plots:[]}};}
}
