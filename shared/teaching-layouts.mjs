const own=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
const number=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e9;
const range=value=>Array.isArray(value)&&value.length===2&&value.every(number)&&value[0]<value[1];

export function validatePlot(block){
  if(!own(block,['id','type','xRange','yRange','series'],['xLabel','yLabel'])||!id(block.id)||block.type!=='plot'||!range(block.xRange)||!range(block.yRange)||!Array.isArray(block.series)||!block.series.length||block.series.length>4||['xLabel','yLabel'].some(key=>block[key]!==undefined&&!text(block[key],80)))return null;
  const ids=new Set();let count=0;
  for(const series of block.series){
    if(!own(series,['id','points'],['label','tone','interpolation'])||!id(series.id)||ids.has(series.id)||series.label!==undefined&&!text(series.label,100)||series.tone!==undefined&&!['ink','muted','accent'].includes(series.tone)||series.interpolation!==undefined&&!['linear','monotone'].includes(series.interpolation)||!Array.isArray(series.points)||!series.points.length||series.points.length>128)return null;
    ids.add(series.id);count+=series.points.length;
    for(const point of series.points)if(!Array.isArray(point)||point.length!==2||!point.every(number)||point[0]<block.xRange[0]||point[0]>block.xRange[1]||point[1]<block.yRange[0]||point[1]>block.yRange[1])return null;
    if(series.interpolation==='monotone'&&series.points.some((p,i)=>i&&p[0]<=series.points[i-1][0]))return null;
  }
  if(count>256)return null;
  return block;
}

// Shape-preserving cubic interpolation through supplied samples only. It never
// infers an equation, extrapolates, or introduces extrema between sample pairs.
export function plotCurveSegments(points){
  if(points.length<2)return [];
  const h=points.slice(1).map((p,i)=>p[0]-points[i][0]);
  const d=h.map((span,i)=>(points[i+1][1]-points[i][1])/span);
  const m=points.map((_,i)=>{
    if(i===0)return d[0];if(i===points.length-1)return d.at(-1);
    if(d[i-1]*d[i]<=0)return 0;
    const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];
    return (w1+w2)/(w1/d[i-1]+w2/d[i]);
  });
  return h.map((span,i)=>[points[i],[points[i][0]+span/3,points[i][1]+m[i]*span/3],[points[i+1][0]-span/3,points[i+1][1]-m[i+1]*span/3],points[i+1]]);
}

export function plotSeriesPath(series,g){
  const screen=series.points.map(([x,y])=>[g.x(x),g.y(y)]),position=point=>point.join(',');
  if(!series.points.length)return '';
  // Interpolate after normalization to avoid overflow from very small physical
  // units. Subpixel-coincident samples stay on the faithful linear fallback.
  if(series.interpolation!=='monotone'||screen.some((p,i)=>i&&p[0]<=screen[i-1][0]))return `M${screen.map(position).join(' L')}`;
  return `M${position(screen[0])}`+plotCurveSegments(screen).map(([,a,b,end])=>` C${position(a)} ${position(b)} ${position(end)}`).join('');
}

export function annotationRanges(block){
  if(!own(block,['id','type','text','spans'])||!id(block.id)||block.type!=='annotation'||!text(block.text,1200)||!Array.isArray(block.spans)||!block.spans.length||block.spans.length>8)return null;
  const ranges=[];
  for(const span of block.spans){
    if(!own(span,['quote','label'],['occurrence'])||!text(span.quote,400)||!text(span.label,80)||span.occurrence!==undefined&&(!Number.isInteger(span.occurrence)||span.occurrence<0||span.occurrence>31))return null;
    let from=0,start=-1;
    for(let occurrence=0;occurrence<=(span.occurrence||0);occurrence++){start=block.text.indexOf(span.quote,from);if(start<0)return null;from=start+span.quote.length;}
    const item={start,end:start+span.quote.length,label:span.label,quote:span.quote};
    // Nested teaching roles are useful (a subject inside a clause). Crossing
    // ranges and duplicate ranges cannot be represented without repeating text.
    if(ranges.some(other=>item.start===other.start&&item.end===other.end||item.start<other.start&&other.start<item.end&&item.end<other.end||other.start<item.start&&item.start<other.end&&other.end<item.end))return null;
    ranges.push(item);
  }
  return ranges.sort((a,b)=>a.start-b.start||b.end-a.end);
}

export function annotationTree(block){
  const ranges=annotationRanges(block);
  if(!ranges)return null;
  const roots=[],stack=[];
  for(const range of ranges){
    const node={...range,children:[]};
    while(stack.length&&range.start>=stack.at(-1).end)stack.pop();
    (stack.at(-1)?.children||roots).push(node);stack.push(node);
  }
  return roots;
}

export function plotTicks([lo,hi],target=5){
  const raw=(hi-lo)/target,scale=10**Math.floor(Math.log10(raw)),normalized=raw/scale;
  if(!scale)return [lo,hi];
  const step=(normalized<=1?1:normalized<=2?2:normalized<=2.5?2.5:normalized<=5?5:10)*scale;
  const first=Math.ceil(lo/step)*step,ticks=[];
  const decimals=Math.max(0,2-Math.floor(Math.log10(step)));
  for(let n=0;n<12;n++){
    const value=Number(decimals<=100?(first+n*step).toFixed(decimals):(first+n*step).toPrecision(17));
    if(value>hi+step*1e-9)break;
    if(value>=lo&&value<=hi&&(!ticks.length||value>ticks.at(-1)))ticks.push(Object.is(value,-0)?0:value);
  }
  return ticks.length?ticks:[lo,hi];
}

export const formatPlotTick=value=>String(value).replace(/^-/,'−');

export function plotGeometry(block){
  if(!validatePlot(block))throw Error('Invalid teaching plot');
  const xTicks=plotTicks(block.xRange),yTicks=plotTicks(block.yRange);
  const width=700,height=440,left=Math.max(72,...yTicks.map(t=>formatPlotTick(t).length*8+24)),right=38,top=42,bottom=64;
  const x=value=>left+(value-block.xRange[0])/(block.xRange[1]-block.xRange[0])*(width-left-right);
  const y=value=>height-bottom-(value-block.yRange[0])/(block.yRange[1]-block.yRange[0])*(height-top-bottom);
  const axisX=x(Math.max(block.xRange[0],Math.min(block.xRange[1],0))),axisY=y(Math.max(block.yRange[0],Math.min(block.yRange[1],0)));
  return {width,height,left,right,top,bottom,x,y,axisX,axisY,xTicks,yTicks};
}
