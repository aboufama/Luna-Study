import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFlow,layoutFlow} from '../shared/flow-layout.mjs';
import {validateBoard,validateStoredBoard,boardVisibleText} from '../server/tutor-output.mjs';
import {applyBoardUpdate} from '../server/whiteboard.mjs';
const flow={id:'process',type:'flow',nodes:[{id:'dna',label:'DNA'},{id:'rna',label:'RNA'},{id:'protein',label:'Protein'}],edges:[{from:'dna',to:'rna',label:'transcription'},{from:'rna',to:'protein',label:'translation'}]};
test('semantic diagrams preserve exact source labels and relationships through board persistence',()=>{
  const candidate=validateBoard({title:'Expression',mode:'replace',blocks:[flow]});assert.ok(candidate);
  const board=applyBoardUpdate(null,candidate);assert.ok(validateStoredBoard(board));
  assert.match(boardVisibleText(board),/DNA → RNA: transcription/);
  const updated=applyBoardUpdate(board,{title:'Expression',blocks:[{...flow,nodes:flow.nodes.slice(0,2),edges:flow.edges.slice(0,1)}]});
  assert.equal(updated.blocks[0].nodes.length,2,'semantic block patches do not retain stale nodes');
});
test('deterministic graph layouts bound all geometry and keep node boxes disjoint across subjects and shapes',()=>{
  for(const direction of ['right','down'])for(const count of [2,3,5,10])for(const topology of ['chain','tree','fan']){
    const f={id:'layout',type:'flow',direction,nodes:Array.from({length:count},(_,i)=>({id:`n${i}`,label:i===0?'A long source label covering a concept, process, or named event':'Concept '+i})),edges:Array.from({length:count-1},(_,i)=>({from:`n${topology==='chain'?i:topology==='fan'?0:Math.floor(i/2)}`,to:`n${i+1}`}))};
    const scene=layoutFlow(f);assert.ok(scene.width<=2500&&scene.height<=2500);
    const boxes=scene.objects.filter(o=>o.type==='rect');
    for(const o of boxes){assert.ok(o.x>=0&&o.y>=0&&o.x+o.width<=scene.width&&o.y+o.height<=scene.height);for(const p of boxes.filter(p=>p!==o))assert.ok(o.x+o.width<=p.x||p.x+p.width<=o.x||o.y+o.height<=p.y||p.y+p.height<=o.y);}
  }
});
test('cyclic, unknown, duplicate and executable graph data is rejected without guessing a correction',()=>{
  const invalid=[{...flow,edges:[...flow.edges,{from:'protein',to:'dna'}]},{...flow,edges:[{from:'dna',to:'missing'}]},{...flow,nodes:[...flow.nodes,flow.nodes[0]]},{...flow,edges:[flow.edges[0],flow.edges[0]]},{...flow,nodes:[{id:'a',label:'<script>run()</script>'},flow.nodes[1]]},{...flow,nodes:Array.from({length:11},(_,i)=>({id:'n'+i,label:'node'}))}];
  for(const value of invalid)assert.equal(validateFlow(value),null);
});
test('narrow semantic branches retain labels and edges at readable sizes within the viewport',()=>{
 const f={id:'transport',type:'flow',direction:'down',nodes:[{id:'membrane',label:'Cell membrane: controls what crosses'},{id:'diffusion',label:'Diffusion: down concentration gradient; no energy'},{id:'active',label:'Active transport: against concentration gradient; uses energy'}],edges:[{from:'membrane',to:'diffusion',label:'passive movement'},{from:'membrane',to:'active',label:'energy-requiring movement'}]};
 const original=structuredClone(f),wide=layoutFlow(f),narrow=layoutFlow(f,{maxWidth:350});assert.deepEqual(f,original);assert.ok(narrow.width<=350);assert.ok(narrow.height>wide.height);
 assert.deepEqual(narrow.objects.filter(o=>o.type==='rect').map(o=>o.label),f.nodes.map(n=>n.label));assert.equal(narrow.objects.filter(o=>o.type==='arrow').length,2);
 for(const obj of narrow.objects.filter(o=>['text','rect'].includes(o.type))){assert.ok(obj.x>=0&&obj.x+obj.width<=350);if(obj.type==='text')assert.equal(obj.fontSize,16);}
 const boxes=narrow.objects.filter(o=>o.type==='rect');for(const a of boxes)for(const b of boxes.filter(b=>b!==a))assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
 assert.deepEqual(layoutFlow(f,{maxWidth:800}),wide,'desktop keeps existing layout');
});
test('very narrow study frames stack tree branches without turning siblings into a sequence',()=>{
 const f={id:'transport',type:'flow',nodes:[{id:'root',label:'Cell membrane: controls what crosses'},{id:'first',label:'Diffusion: down concentration gradient; no energy'},{id:'second',label:'Active transport: against concentration gradient; uses energy'}],edges:[{from:'root',to:'first',label:'passive movement'},{from:'root',to:'second',label:'energy-requiring movement'}]};
 const scene=layoutFlow(f,{maxWidth:258}),byId=new Map(scene.objects.map(object=>[object.id,object]));
 assert.equal(scene.width,258);
 const root=byId.get('node-root'),first=byId.get('node-first'),second=byId.get('node-second');
 assert.ok(first.y>root.y+root.height&&second.y>first.y+first.height);
 for(const [index,edge] of f.edges.entries()){
  const route=byId.get(`edge-${index}`),target=byId.get(`node-${edge.to}`),tip=byId.get(`tip-${index}`);
  assert.deepEqual(route.points[0],[root.x,root.y+root.height/2],'Each branch still starts at its actual parent');
  assert.deepEqual([tip.x2,tip.y2],[target.x,target.y+target.height/2]);
  assert.equal(byId.get(`edge-label-${index}`).text,edge.label);
 }
 for(const node of f.nodes){const text=byId.get(`node-label-${node.id}`);assert.equal(text.text,node.label);assert.equal(text.fontSize,18);}
 for(const object of scene.objects.filter(object=>object.type==='text'||object.type==='rect'))assert.ok(object.x>=0&&object.y>=0&&object.x+object.width<=258&&object.y+object.height<=scene.height);
 const join={id:'join',type:'flow',nodes:[...f.nodes,{id:'end',label:'Shared result'}],edges:[...f.edges,{from:'first',to:'end'},{from:'second',to:'end'}]};
 assert.ok(layoutFlow(join,{maxWidth:258}).width>258,'A multiple-parent graph keeps explicit geometry and native scroll instead of losing a relationship');
});
