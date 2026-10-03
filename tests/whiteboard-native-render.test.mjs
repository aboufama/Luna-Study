import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNative} from '../benchmarks/whiteboard-native-render.mjs';
import {auditCityEdit} from '../benchmarks/whiteboard-native-audit.mjs';
const scene=elements=>({type:'excalidraw',version:2,elements,files:{}});
const cell={id:'matrix-cell-0-0',type:'rectangle',x:10,y:10,width:40,height:30};
test('native Excalidraw contract accepts stable source elements without fabricating text dimensions',()=>{
  const input=scene([cell,{id:'label',type:'text',x:10,y:50,width:80,height:25,text:'source',fontSize:20,fontFamily:2}]);
  assert.equal(validateNative('excalidraw',input),input);
  assert.throws(()=>validateNative('excalidraw',scene([{...cell,type:'text',text:'lost',width:0,fontSize:20,fontFamily:2}])),/empty/);
});
test('native scene rejects duplicate identities, external types/files/links and invalid geometry',()=>{
  for(const input of [scene([cell,cell]),scene([{...cell,type:'image'}]),scene([{...cell,link:'https://example.com'}]),scene([{...cell,x:Infinity}]),{...scene([cell]),files:{image:{dataURL:'data:image/png;base64,'}}}])assert.throws(()=>validateNative('excalidraw',input));
});
test('Vega contract requires static inline data and rejects network/expression paths',()=>{
  const spec={data:{values:[{id:'p0',x:0,y:0}]},mark:'point',encoding:{x:{field:'x',type:'quantitative'}}};
  assert.equal(validateNative('vega',spec),spec);
  for(const input of [{...spec,data:{url:'https://example.com/data'}},{...spec,transform:[{calculate:'x'}]},{...spec,encoding:{x:{expr:'danger()'}}},{...spec,params:[{}]}])assert.throws(()=>validateNative('vega',input));
});
test('city edit audit treats native IDs as opaque and detects changes to unaffected objects',()=>{
  const before=[{id:'vendor-a-marker',type:'ellipse',x:20,y:50,width:8,height:8},{id:'vendor-a-label',type:'text',x:18,y:30,text:'Vendor A 0.2'},{id:'other-marker',type:'ellipse',x:80,y:50,width:8,height:8},{id:'other-label',type:'text',x:78,y:30,text:'Vendor B 0.8'}];
  const after=before.map(el=>el.id.startsWith('vendor-a')?{...el,x:el.x+10,...(el.type==='text'?{text:'Vendor A 0.3'}:{})}:{...el});
  assert.equal(auditCityEdit(before,after).pass,true);
  after[2].x+=1;
  assert.equal(auditCityEdit(before,after).pass,false);
  assert.equal(auditCityEdit(before,after.slice(0,3)).idsPreserved,false);
});
