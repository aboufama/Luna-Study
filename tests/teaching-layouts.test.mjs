import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlot,plotGeometry,plotTicks,annotationRanges,annotationTree,plotCurveSegments,plotSeriesPath,formatPlotTick} from '../shared/teaching-layouts.mjs';
import {validateBoard,boardVisibleText} from '../server/tutor-output.mjs';
import {applyBoardUpdate} from '../server/whiteboard.mjs';
const plot={id:'curve',type:'plot',xRange:[-2,2],yRange:[0,4],xLabel:'x',yLabel:'y',series:[{id:'f',label:'y = x²',points:[[-2,4],[-1,1],[0,0],[1,1],[2,4]]}]};
test('plot axes, tick positions and source points share exactly one numerical transform',()=>{
  const g=plotGeometry(plot);assert.equal(g.x(0),g.axisX);assert.equal(g.y(0),g.axisY);
  assert.equal(g.x(-1)-g.x(-2),g.x(2)-g.x(1));
  assert.equal(g.x(0)-g.x(-1),g.x(1)-g.x(0));
  assert.equal(g.y(0)-g.y(1),(g.y(0)-g.y(4))/4);
  for(const x of g.xTicks)assert.ok(g.x(x)>=g.left&&g.x(x)<=g.width-g.right);
  for(const y of g.yTicks)assert.ok(g.y(y)>=g.top&&g.y(y)<=g.height-g.bottom);
  const board=applyBoardUpdate(null,validateBoard({title:'Parabola',blocks:[plot]}));assert.match(boardVisibleText(board),/\(-2, 4\).*\(0, 0\).*\(2, 4\)/);
});
test('ticks remain bounded and ordered over fractional, negative and scientific ranges',()=>{
  for(const r of [[-.0004,.0002],[1e8,1e9],[-5,-1],[0,1],[1.5,1.51],[1,1.00001],[1e8,1e8+.001],[0,Number.MIN_VALUE],[1e-310,2e-310]]){const ticks=plotTicks(r);assert.ok(ticks.length>0&&ticks.length<=12);assert.ok(ticks.every((v,i)=>v>=r[0]&&v<=r[1]&&(i===0||v>ticks[i-1])));assert.equal(new Set(ticks.map(formatPlotTick)).size,ticks.length,'Distinct numerical values must never collapse into identical displayed labels.');}
});
test('plot data rejects nonfinite, out-of-domain, executable and unbounded input without silently clipping',()=>{
  for(const invalid of [{...plot,xRange:[2,-2]},{...plot,yRange:[0,0]},{...plot,series:[{id:'bad',points:[[0,Infinity]]}]},{...plot,series:[{id:'bad',points:[[3,1]]}]},{...plot,expression:'alert(1)'},{...plot,series:[{id:'bad',points:Array.from({length:129},()=>[0,0])}]}])assert.equal(validatePlot(invalid),null);
});
test('annotations locate original phrases once and preserve repeated occurrences explicitly',()=>{
  const block={id:'sentence',type:'annotation',text:'After rain stopped, Maya walked.',spans:[{quote:'After rain stopped',label:'Dependent clause'},{quote:'Maya walked',label:'Main clause'}]};
  assert.deepEqual(annotationRanges(block).map(r=>block.text.slice(r.start,r.end)),block.spans.map(s=>s.quote));
  assert.ok(validateBoard({title:'Clauses',blocks:[block]}));
  assert.equal(annotationRanges({...block,text:'very very',spans:[{quote:'very',label:'second',occurrence:1}]})[0].start,5);
  const nested={...block,spans:[...block.spans,{quote:'rain',label:'subject'}]};
  assert.equal(annotationTree(nested)[0].children[0].quote,'rain');
  assert.ok(validateBoard({title:'Nested roles',blocks:[nested]}));
  assert.equal(annotationRanges({...block,spans:[...block.spans,{quote:'stopped, Maya',label:'crossing overlap'}]}),null);
  assert.equal(annotationRanges({...block,spans:[...block.spans,block.spans[0]]}),null);
  assert.equal(annotationRanges({...block,spans:[{quote:'invented',label:'not in source'}]}),null);
});

test('optional smooth plots pass through every sample without inventing intervening extrema',()=>{
  const points=[[-2,4],[-1,1],[0,0],[1,1],[2,4]];
  for(const sample of [points,[[0,0],[.01,10],[5,11],[6,11],[7,-2]],[[0,5],[1,3],[2,1]]]){
    const segments=plotCurveSegments(sample);assert.equal(segments.length,sample.length-1);
    segments.forEach(([start,a,b,end],i)=>{
      assert.deepEqual(start,sample[i]);assert.deepEqual(end,sample[i+1]);
      for(let j=0;j<=100;j++){const t=j/100,u=1-t,y=u**3*start[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t**3*end[1];assert.ok(y>=Math.min(start[1],end[1])-1e-10&&y<=Math.max(start[1],end[1])+1e-10);}
    });
  }
  const smooth={...plot,series:[{...plot.series[0],interpolation:'monotone'}]};assert.ok(validatePlot(smooth));assert.match(plotSeriesPath(smooth.series[0],plotGeometry(smooth)),/ C/);
  assert.equal(validatePlot({...smooth,series:[{...smooth.series[0],points:[[0,0],[0,1]]}]}),null);
  const microscopic={...smooth,xRange:[0,2e-310],series:[{id:'tiny',interpolation:'monotone',points:[[0,0],[1e-310,1],[2e-310,4]]}]};
  assert.doesNotMatch(plotSeriesPath(microscopic.series[0],plotGeometry(microscopic)),/NaN|Infinity/);
});
