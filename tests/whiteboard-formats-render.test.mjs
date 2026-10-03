import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFormat, formatPrompts } from '../benchmarks/whiteboard-formats-render.mjs';

const dsl = (objects, extras = {}) => JSON.stringify({title:'Example',mode:'replace',objects,...extras});
const svg = content => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">${content}</svg>`;

test('format prompts describe the supported protocols and current JSON uses production validation',()=>{
  assert.deepEqual(Object.keys(formatPrompts),['json','svg','dsl']);
  const good=parseFormat('json',JSON.stringify({title:'Payoffs',mode:'replace',blocks:[{id:'matrix',type:'matrix',rows:[['1, 2','3, 4'],['5, 6','7, 8']]}]}));
  assert.equal(good.valid,true);assert.deepEqual(good.stats.matrices[0],{id:'matrix',rows:2,cols:2,values:[['1, 2','3, 4'],['5, 6','7, 8']]});
  assert.equal(good.stats.cellIds.length,4);assert.ok(good.stats.ids.includes('matrix-cell-1-1'));
  assert.equal(parseFormat('json',JSON.stringify({title:'Unsupported',blocks:[{id:'plot',type:'plot',points:[[0,0],[1,1]]}]})).valid,false);
  assert.equal(parseFormat('json',JSON.stringify({title:'Too many',blocks:[{id:'diagram',type:'diagram',elements:Array.from({length:31},()=>({type:'line',x1:0,y1:0,x2:100,y2:100}))}]})).valid,false);
});

test('blank DSL matrices expand deterministically into exactly selectable dimensioned cells',()=>{
  const result=parseFormat('dsl',dsl([{id:'blank',type:'matrix',rows:8,cols:10}]));
  assert.equal(result.valid,true);assert.equal(result.stats.cellIds.length,80);
  assert.equal(result.stats.matrices[0].rows,8);assert.equal(result.stats.matrices[0].cols,10);
  assert.ok(result.stats.matrices[0].values.flat().every(value=>value===''));
  assert.equal(result.svg.match(/<rect /g).length,80);
  assert.equal(parseFormat('dsl',dsl([{id:'blank',type:'matrix',rows:8,cols:10,values:[['invented']]}])).valid,false);
  assert.equal(parseFormat('dsl',dsl([{id:123,type:'matrix',rows:2,cols:2}])).valid,false);
});

test('DSL patches retain unrelated object IDs and geometry while replacing only the changed object',()=>{
  const initial=parseFormat('dsl',dsl([{id:'line',type:'line',x1:10,y1:50,x2:90,y2:50},{id:'a',type:'point',x:26,y:50,label:'A: 0.2'},{id:'b',type:'point',x:74,y:50,label:'B: 0.8'}]));
  const update=parseFormat('dsl',dsl([{id:'a',type:'point',x:34,y:50,label:'A: 0.3'}],{mode:'patch'}),{previous:initial});
  assert.equal(update.valid,true);assert.deepEqual(update.scene.objects.find(object=>object.id==='b'),initial.scene.objects.find(object=>object.id==='b'));
  assert.equal(update.scene.objects.find(object=>object.id==='a').x,34);assert.deepEqual(update.stats.removedIds,[]);
  assert.ok(initial.stats.ids.every(id=>update.stats.retainedIds.includes(id)));
  const removed=parseFormat('dsl',dsl([],{mode:'patch',removedIds:['a']}),{previous:update.scene});
  assert.equal(removed.valid,true);assert.ok(removed.stats.removedIds.includes('a'));assert.ok(removed.stats.ids.includes('b'));
  assert.equal(parseFormat('dsl',dsl([],{mode:'patch',removedIds:['unknown']}),{previous:initial}).valid,false);
});

test('current JSON patches retain prior blocks and deterministic cell identities',()=>{
  const first=parseFormat('json',JSON.stringify({title:'Saved',mode:'replace',blocks:[{id:'matrix',type:'matrix',rows:[['1','2']]},{id:'note',type:'text',content:'Prior context'}]}));
  const update=parseFormat('json',JSON.stringify({title:'Patch',mode:'patch',blocks:[{id:'note',type:'text',content:'New context'}]}),{previous:first.scene});
  assert.equal(update.valid,true);assert.deepEqual(update.stats.matrices,first.stats.matrices);assert.ok(update.stats.retainedIds.includes('matrix-cell-0-1'));assert.ok(update.stats.texts.includes('New context'));
});

test('generic graphs lay out branches and cycles while preserving authored node and edge IDs',()=>{
  const graph={id:'process',type:'graph',nodes:[{id:'observe',label:'Observe'},{id:'hypothesize',label:'Hypothesize'},{id:'test',label:'Test'}],edges:[{id:'forward-1',from:'observe',to:'hypothesize'},{id:'forward-2',from:'hypothesize',to:'test'},{id:'return',from:'test',to:'observe',label:'Revise'}]};
  const result=parseFormat('dsl',dsl([graph]));
  assert.equal(result.valid,true);assert.ok(result.svg.includes('<path id="return"'));
  for(const id of ['process','observe','test','return'])assert.ok(result.stats.authoredIds.includes(id));
  assert.deepEqual(result.stats.texts,['Revise','Observe','Hypothesize','Test']);
  assert.equal(parseFormat('dsl',dsl([{...graph,edges:[{id:'bad',from:'observe',to:'unknown'}]}])).valid,false);
});

test('sampled plots render data with numerical axes and reject executable expressions or out-of-domain points',()=>{
  const plot={id:'curve',type:'plot',points:[[-2,4],[-1,1],[0,0],[1,1],[2,4]],xDomain:[-2,2],yDomain:[0,4],label:'y = x²'};
  const result=parseFormat('dsl',dsl([plot]));assert.equal(result.valid,true);
  assert.deepEqual(result.stats.plots,[{id:'curve',points:plot.points,xDomain:plot.xDomain,yDomain:plot.yDomain}]);
  assert.ok(result.stats.ids.includes('curve-x-axis'));assert.ok(result.stats.texts.includes('-2'));assert.ok(result.stats.texts.includes('4'));assert.ok(result.stats.texts.includes('x'));assert.ok(result.stats.texts.includes('y'));
  assert.equal(parseFormat('dsl',dsl([{...plot,expression:'x*x'}])).valid,false);
  assert.equal(parseFormat('dsl',dsl([{...plot,points:[[0,0],[3,9]]}])).valid,false);
});

test('number lines map domain values deterministically and escape plain labels',()=>{
  const result=parseFormat('dsl',dsl([{id:'axis',type:'axis',min:0,max:1,points:[{id:'a',value:.2,label:'A < B'},{id:'b',value:.8,label:'B'}]}]));
  assert.equal(result.valid,true);assert.ok(result.svg.includes('cx="202"'));assert.ok(result.svg.includes('A &lt; B'));assert.ok(result.stats.texts.includes('A < B'));
});

test('restricted SVG rejects executable, external, malformed, duplicate, and unselectable markup',()=>{
  const good=parseFormat('svg',svg('<line id="line" x1="20" y1="50" x2="700" y2="50"/><text id="label" x="100" y="80">A &amp; B</text>'));
  assert.equal(good.valid,true);assert.deepEqual(good.stats.texts,['A & B']);
  for(const markup of [
    svg('<script id="evil">alert(1)</script>'),svg('<foreignObject id="evil"/>'),svg('<image id="evil" href="https://example.com/a"/>'),
    svg('<rect id="r" x="0" y="0" width="10" height="10" onclick="evil()"/>'),svg('<rect id="r" fill="url(https://example.com/a)"/>'),
    svg('<text id="r" style="color:red">x</text>'),svg('<line id="duplicate"/><circle id="duplicate"/>'),svg('<line x1="0" y1="0" x2="1" y2="1"/>'),
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+svg('<text id="x">&x;</text>'),
    svg('<g id="bad"><line id="line"></g>'),svg('<g id="x" xmlns="https://example.com"/>'),
  ])assert.equal(parseFormat('svg',markup).valid,false,markup);
  const updated=parseFormat('svg',svg('<line id="line" x1="40" y1="50" x2="700" y2="50"/><text id="label" x="100" y="80">Updated</text>'),{previous:good});
  assert.equal(updated.valid,true);assert.deepEqual(updated.stats.retainedIds,['line','label']);
});

test('direct SVG cell IDs expose dimensions and canonically identified value text without guessing scene semantics',()=>{
  const result=parseFormat('svg',svg('<rect id="m-cell-0-0" x="10" y="10" width="100" height="80"/><text id="m-cell-0-0-text" x="60" y="50">1, 6, 1</text><rect id="m-cell-0-1" x="110" y="10" width="100" height="80"/>'));
  assert.equal(result.valid,true);
  assert.deepEqual(result.stats.matrices,[{id:'m',rows:1,cols:2,values:[['1, 6, 1','']],indexedCells:2,completeGrid:true}]);
});
