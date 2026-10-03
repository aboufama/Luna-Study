const own=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(value);
const label=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);

/** A small semantic graph, with bounded deterministic layout. No executable
 * markup, generated coordinates, hidden labels, or inferred relationships. */
export function validateFlow(block){
  if(!own(block,['id','type','nodes','edges'],['direction'])||!id(block.id)||block.type!=='flow'||!Array.isArray(block.nodes)||block.nodes.length<2||block.nodes.length>10||!Array.isArray(block.edges)||!block.edges.length||block.edges.length>16||block.direction!==undefined&&!['right','down'].includes(block.direction))return null;
  const ids=new Set();
  for(const node of block.nodes){if(!own(node,['id','label'],['tone'])||!id(node.id)||ids.has(node.id)||!label(node.label,100)||node.tone!==undefined&&!['ink','muted','accent'].includes(node.tone))return null;ids.add(node.id);}
  const links=new Set(),indegree=new Map([...ids].map(key=>[key,0]));
  for(const edge of block.edges){const key=`${edge?.from}:${edge?.to}`;if(!own(edge,['from','to'],['label'])||!ids.has(edge.from)||!ids.has(edge.to)||edge.from===edge.to||links.has(key)||edge.label!==undefined&&!label(edge.label,64))return null;links.add(key);indegree.set(edge.to,indegree.get(edge.to)+1);}
  const queue=[...ids].filter(key=>!indegree.get(key));let count=0;
  for(let i=0;i<queue.length;i++){count++;for(const edge of block.edges.filter(e=>e.from===queue[i])){indegree.set(edge.to,indegree.get(edge.to)-1);if(!indegree.get(edge.to))queue.push(edge.to);}}
  if(count!==ids.size)return null; // Cycles need an explicitly authored scene.
  return block;
}

export function layoutFlow(block,{maxWidth}={}){
  if(!validateFlow(block))throw Error('Invalid teaching flow');
  const ranks=new Map(block.nodes.map(n=>[n.id,0]));
  for(let pass=0;pass<block.nodes.length;pass++)for(const e of block.edges)ranks.set(e.to,Math.max(ranks.get(e.to),ranks.get(e.from)+1));
  const depth=Math.max(...ranks.values())+1,layers=Array.from({length:depth},(_,rank)=>block.nodes.filter(n=>ranks.get(n.id)===rank));
  // Long sequences read vertically rather than shrinking text into a long strip.
  const widest=Math.max(...layers.map(layer=>layer.length));
  // Very narrow study frames cannot fit parallel readable columns. A tree can
  // retain its exact edges in a vertical outline, with a dedicated left rail
  // for each depth. Graphs with multiple parents keep the ordinary layout and
  // its accessible native scrolling rather than inventing a tree relationship.
  if(Number.isFinite(maxWidth)&&maxWidth>=180&&maxWidth<320&&widest>1&&block.nodes.every(node=>block.edges.filter(edge=>edge.to===node.id).length<=1))return narrowTree(block,maxWidth);
  const narrow=Number.isFinite(maxWidth)&&maxWidth>0&&maxWidth<520;
  const down=narrow||(block.direction==='down'||depth>3)&&!(widest>3&&depth<=3);
  const crossGap=narrow?12:42;
  const nodeWidth=narrow?Math.min(200,Math.max(120,(maxWidth-40)/widest-crossGap)):200;
  const nodeColumns=narrow?Math.max(10,Math.floor((nodeWidth-24)/8.5)):20;
  const nodeHeight=Math.max(72,...block.nodes.map(n=>Math.ceil(n.label.length/nodeColumns)*23+26));
  const maxLabelWidth=narrow?Math.min(184,nodeWidth):184;
  const labelColumns=narrow?Math.max(10,Math.floor((maxLabelWidth-10)/8.5)):24;
  const labelHeight=Math.max(29,...block.edges.map(e=>Math.ceil((e.label?.length||0)/labelColumns)*21+8));
  const gap=down?Math.max(96,labelHeight+64):Math.max(145,...block.edges.map(e=>Math.min(184,(e.label?.length||0)*8.5+10)+56));
  const step=down?nodeHeight+gap:nodeWidth+gap,crossStep=down?nodeWidth+crossGap:nodeHeight+48;
  const width=down?widest*crossStep+40:depth*step-gap+80;
  const height=down?depth*step-gap+80:widest*crossStep+40;
  const positions=new Map();
  layers.forEach((nodes,rank)=>nodes.forEach((node,index)=>{
    const across=(index-(nodes.length-1)/2)*crossStep;
    positions.set(node.id,{x:down?width/2-nodeWidth/2+across:40+rank*step,y:down?40+rank*step:height/2-nodeHeight/2+across});
  }));
  const objects=[],edgeLabels=[];
  // Edges are underneath nodes. Each label occupies the clear inter-layer gap.
  block.edges.forEach((edge,index)=>{
    const a=positions.get(edge.from),b=positions.get(edge.to);
    const x1=down?a.x+nodeWidth/2:a.x+nodeWidth,y1=down?a.y+nodeHeight:a.y+nodeHeight/2;
    const x2=down?b.x+nodeWidth/2:b.x,y2=down?b.y:b.y+nodeHeight/2;
    const mid=down?y1+24:x1+24;
    const points=down?[[x1,y1],[x1,mid],[x2,mid],[x2,y2-7]]:[[x1,y1],[mid,y1],[mid,y2],[x2-7,y2]];
    objects.push({id:`edge-${index}`,type:'polyline',points,tone:'muted'});
    objects.push({id:`tip-${index}`,type:'arrow',x1:down?x2:x2-12,y1:down?y2-12:y2,x2,y2,tone:'muted'});
    if(edge.label){
      const labelWidth=Math.min(maxLabelWidth,edge.label.length*8.5+12),labelHeight=Math.ceil(edge.label.length/labelColumns)*21+8;
      let x=down?x2-labelWidth/2:(mid+x2)/2-labelWidth/2,y=down?(mid+y2)/2-labelHeight/2:y2-labelHeight/2;
      // The label has a white backing in the renderer; the route remains visible
      // before/after it, avoiding text struck through by the connector.
      x=Math.max(4,Math.min(width-labelWidth-4,x));y=Math.max(4,Math.min(height-labelHeight-4,y));
      edgeLabels.push({id:`edge-label-${index}`,type:'text',x,y,width:labelWidth,height:labelHeight,text:edge.label,fontSize:16});
    }
  });
  objects.push(...edgeLabels);
  for(const node of block.nodes){const p=positions.get(node.id);objects.push({id:`node-${node.id}`,type:'rect',...p,width:nodeWidth,height:nodeHeight,label:node.label,tone:node.tone||'ink'});}
  return {id:block.id,type:'scene',width,height,objects};
}

function narrowTree(block,width){
  const incoming=new Map(block.edges.map((edge,index)=>[edge.to,{...edge,index}]));
  const children=new Map(block.nodes.map(node=>[node.id,block.edges.filter(edge=>edge.from===node.id).map(edge=>block.nodes.find(n=>n.id===edge.to))]));
  const rows=[];
  const visit=(node,depth)=>{rows.push({node,depth});for(const child of children.get(node.id))visit(child,depth+1);};
  for(const root of block.nodes.filter(node=>!incoming.has(node.id)))visit(root,0);
  const lines=(text,columns)=>{let count=1,used=0;for(const word of text.split(/\s+/)){if(used&&used+1+word.length>columns){count++;used=0;}if(word.length>columns){count+=Math.floor((word.length-1)/columns);used=(word.length-1)%columns+1;}else used+=(used?1:0)+word.length;}return count;};
  const positions=new Map(),labels=[];let cursor=20;
  for(const {node,depth} of rows){
    const x=28+Math.min(depth,4)*10,nodeWidth=width-x-16,edge=incoming.get(node.id);
    if(edge?.label){const height=lines(edge.label,Math.max(8,Math.floor((nodeWidth-12)/9)))*21+12;labels.push({id:`edge-label-${edge.index}`,type:'text',x,y:cursor,width:nodeWidth,height,text:edge.label,fontSize:16});cursor+=height+12;}
    else if(edge)cursor+=24;
    const height=Math.max(72,lines(node.label,Math.max(8,Math.floor((nodeWidth-24)/10)))*24+28);
    positions.set(node.id,{x,y:cursor,width:nodeWidth,height,depth});cursor+=height+24;
  }
  const objects=[];
  for(const [index,edge]of block.edges.entries()){
    const a=positions.get(edge.from),b=positions.get(edge.to),rail=10+Math.min(a.depth,4)*10,y1=a.y+a.height/2,y2=b.y+b.height/2;
    objects.push({id:`edge-${index}`,type:'polyline',points:[[a.x,y1],[rail,y1],[rail,y2],[b.x-7,y2]],tone:'muted'});
    objects.push({id:`tip-${index}`,type:'arrow',x1:b.x-12,y1:y2,x2:b.x,y2,tone:'muted'});
  }
  objects.push(...labels);
  for(const {node}of rows){const p=positions.get(node.id),box={x:p.x,y:p.y,width:p.width,height:p.height};objects.push({id:`node-${node.id}`,type:'rect',...box,label:node.label,tone:node.tone||'ink'});objects.push({id:`node-label-${node.id}`,type:'text',x:box.x+12,y:box.y+12,width:box.width-24,height:box.height-24,text:node.label,fontSize:18,tone:node.tone||'ink'});}
  return {id:block.id,type:'scene',width,height:cursor,objects};
}

export function flowVisibleText(block){
  const labels=new Map(block.nodes.map(node=>[node.id,node.label]));
  return [...block.nodes.map(n=>n.label),...block.edges.map(e=>`${labels.get(e.from)} → ${labels.get(e.to)}${e.label?`: ${e.label}`:''}`)].join('\n');
}
