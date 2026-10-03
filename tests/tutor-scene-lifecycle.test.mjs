import test from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleFixture,settle,conversation} from './helpers/tutor-lifecycle.mjs';

const nucleus={id:'nucleus',type:'ellipse',x:250,y:170,width:80,height:70,label:'Nucleus'};
const membrane={id:'membrane',type:'ellipse',x:100,y:70,width:430,height:300,label:'Cell membrane'};
const block=objects=>({id:'cell',type:'scene',width:800,height:500,objects});
const initial={title:'Animal cell',revision:'saved',blocks:[block([membrane,nucleus])]};

test('out-of-order deletion cannot remove a retained object; current patch rebases selection and current removal clears it',async t=>{
  const pending=[];
  const f=await lifecycleFixture(t,{start:{whiteboard:initial,whiteboardVisible:true},integrations:{canvasRouter:{classify(text){if(text==='Welcome.')return{needsCanvas:false};return new Promise(resolve=>{pending.push({text,resolve});f.notify();});}}}});
  await f.packet({type:'canvas-select',boardRevision:f.restored.board.revision,blockId:'cell',zoneId:'nucleus'});
  f.commit('Remove the nucleus.');const old=f.calls[0];assert.equal(old.input.whiteboardContext.selection.objectId,'nucleus');
  old.resolve({reply:'I can remove that.',board:{title:'Animal cell',blocks:[{...block([]),removedObjectIds:['nucleus']}]}});await f.waitFor(()=>pending.length===1);
  f.commit('Keep the nucleus, move the membrane slightly instead.');
  f.calls[1].resolve({reply:'The nucleus stays in place.',board:{title:'Animal cell',blocks:[block([{...membrane,x:110}])]}});await f.waitFor(()=>pending.length===2);
  pending[1].resolve({needsCanvas:true});await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.board));
  pending[0].resolve({needsCanvas:false});await settle();
  const packets=f.messages.filter(m=>m.type==='canvas');assert.equal(packets.length,1);
  assert.deepEqual(packets[0].board.blocks[0].objects.map(o=>o.id),['membrane','nucleus']);assert.deepEqual(packets[0].board.blocks[0].objects.find(o=>o.id==='nucleus'),nucleus);
  assert.equal(packets[0].selection.zoneId,'nucleus');assert.equal(packets[0].selection.boardRevision,packets[0].board.revision);
  f.commit('Now remove the nucleus.');assert.equal(f.calls[2].input.whiteboardContext.selection.content,'Nucleus');
  f.calls[2].resolve({reply:'Removed the nucleus.',board:{title:'Animal cell',blocks:[{...block([]),removedObjectIds:['nucleus']}]}});await f.waitFor(()=>pending.length===3);pending[2].resolve({needsCanvas:false});
  await f.waitFor(()=>f.messages.filter(m=>m.type==='canvas').length===2);
  const removed=f.messages.filter(m=>m.type==='canvas').at(-1);assert.equal(removed.selection,null);assert.deepEqual(removed.board.blocks[0].objects.map(o=>o.id),['membrane']);
  assert.equal(f.calls.filter(c=>c.mode==='visual').length,0);
});

test('manual hide invalidates a pending scene replacement and its public teaching evidence',async t=>{
  let route;
  const f=await lifecycleFixture(t,{start:{whiteboard:initial,whiteboardVisible:true},integrations:{canvasRouter:{classify(text){if(text==='Welcome.')return{needsCanvas:false};return new Promise(resolve=>{route=resolve;f.notify();});}}}});
  f.commit('Show a force diagram.');f.calls[0].resolve({reply:'Consider the forces.',board:{title:'Forces',mode:'replace',blocks:[{id:'force',type:'scene',width:800,height:500,objects:[{id:'normal',type:'arrow',x1:400,y1:250,x2:400,y2:100,label:'N'},{id:'equation',type:'math',x:40,y:400,width:600,height:60,text:'N-mg=0'}]}]}});
  await f.waitFor(()=>Boolean(route));await f.packet({type:'canvas-visibility',boardRevision:f.restored.board.revision,visible:false});route({needsCanvas:true,shouldReplace:true});await settle();
  assert.equal(f.messages.some(m=>m.type==='canvas'),false);
  f.commit('Continue aloud.');const input=f.calls[1].input;assert.equal(input.whiteboardContext.visible,false);assert.equal(input.whiteboardContext.board.title,'Animal cell');
  assert.equal(conversation(input).some(turn=>turn.content.includes('Shown on the whiteboard:')&&turn.content.includes('N-mg=0')),false,'unseen canceled content must not become grading evidence');
});

test('partial speech cancels a scene patch before result publication and cannot add written answer evidence',async t=>{
  const f=await lifecycleFixture(t,{start:{whiteboard:initial,whiteboardVisible:true}});
  f.commit('Write a note.');const old=f.calls[0];f.partial('Wait, do not show that.');
  assert.equal(old.options.signal.aborted,true);old.resolve({reply:'Old note.',board:{title:'Animal cell',blocks:[block([{id:'answer',type:'text',x:30,y:420,width:650,height:50,text:'UNSEEN_ANSWER'}])]}});await settle();
  f.commit('Keep the existing diagram.');assert.equal(JSON.stringify(f.calls[1].input).includes('UNSEEN_ANSWER'),false);assert.equal(f.messages.some(m=>m.type==='canvas'),false);
});
