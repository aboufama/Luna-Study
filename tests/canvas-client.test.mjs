import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveVoiceSession } from '../src/live-voice.js';

const scene={revision:'saved',blocks:[{id:'equation',type:'latex',content:'x+2=4',zones:[{id:'variable',label:'Unknown',anchor:{kind:'content',quote:'x'}}]}]};
const chosen={boardRevision:'saved',blockId:'equation',zoneId:'variable'};
function client(){
  const sent=[],received=[];
  const session=new LiveVoiceSession({onCanvas:message=>received.push(message)});
  session.test={whiteboard:scene,whiteboardSelection:null};
  session.startSent=true;session.awaitingBoardRestore=true;
  session.send=message=>sent.push(message);
  return {session,sent,received};
}

test('a click during reconnect is sent against the restored revision and stays selected',()=>{
  const {session,sent,received}=client();
  session.selectCanvas(chosen);
  assert.equal(sent.length,0);
  session.receiveCanvas({type:'canvas',board:{...scene,revision:'restored'},selection:null});
  const rebased={...chosen,boardRevision:'restored'};
  assert.deepEqual(sent,[{type:'canvas-select',...rebased}]);
  assert.deepEqual(received[0].selection,rebased);
  assert.deepEqual(session.test.whiteboardSelection,rebased);
});

test('a clear during reconnect overrides the restored selection',()=>{
  const {session,sent,received}=client();
  session.selectCanvas({boardRevision:'saved',clear:true});
  session.receiveCanvas({type:'canvas',board:{...scene,revision:'restored'},selection:{...chosen,boardRevision:'restored'}});
  assert.deepEqual(sent,[{type:'canvas-select',boardRevision:'restored',clear:true}]);
  assert.equal(received[0].selection,null);
});

test('a changed restored block cannot receive a queued stale click',()=>{
  const {session,sent,received}=client();
  session.selectCanvas(chosen);
  session.receiveCanvas({type:'canvas',board:{revision:'restored',blocks:[{...scene.blocks[0],content:'y=9'}]},selection:null});
  assert.deepEqual(sent,[]);assert.equal(received[0].selection,null);
});

test('legacy board packets rebase the client snapshot across unchanged blocks',()=>{
  const {session,received}=client();
  session.awaitingBoardRestore=false;session.test.whiteboardSelection=chosen;
  session.receiveCanvas({type:'canvas',board:{...scene,revision:'next'}});
  assert.deepEqual(session.test.whiteboardSelection,{...chosen,boardRevision:'next'});
  assert.deepEqual(received[0].selection,session.test.whiteboardSelection);
});

test('material changes clear the queued selection and saved board together',()=>{
  const {session}=client();session.selectCanvas(chosen);
  session.updateMaterials([{id:'new',name:'notes',text:'new material'}]);
  assert.equal(session.test.whiteboard,null);assert.equal(session.test.whiteboardSelection,null);
  assert.equal(session.pendingCanvasSelection,null);assert.equal(session.awaitingBoardRestore,false);
});

test('manual visibility during reconnect wins over the restored state without deleting the board',()=>{
  const {session,sent,received}=client();session.setCanvasVisible(false);
  assert.equal(sent.length,0);
  session.receiveCanvas({type:'canvas',board:{...scene,revision:'restored'},visible:true,selection:null});
  assert.deepEqual(sent,[{type:'canvas-visibility',boardRevision:'restored',visible:false}]);
  assert.equal(received[0].visible,false);assert.equal(session.test.whiteboardVisible,false);
  assert.equal(session.test.whiteboard.revision,'restored');
});
test('natural hide packets preserve the stored scene and selection',()=>{
  const {session,received}=client();session.awaitingBoardRestore=false;session.test.whiteboardSelection=chosen;
  session.receiveCanvas({type:'canvas',visible:false});
  assert.equal(session.test.whiteboard,scene);assert.equal(session.test.whiteboardSelection,chosen);
  assert.equal(session.test.whiteboardVisible,false);assert.equal(received[0].visible,false);
});

test('late hide from an interrupted turn cannot undo a newer manual open',()=>{
  const {session,sent,received}=client();session.awaitingBoardRestore=false;
  session.setCanvasVisible(true);session.ignoredTurns.add(7);
  session.receiveCanvas({type:'canvas',id:7,visible:false});
  assert.deepEqual(sent,[{type:'canvas-visibility',boardRevision:'saved',visible:true}]);
  assert.equal(session.test.whiteboardVisible,true);assert.equal(session.test.whiteboard,scene);
  assert.deepEqual(received,[]);
});

test('late board from an interrupted turn is ignored while a current turn opens normally',()=>{
  const {session,received}=client();session.awaitingBoardRestore=false;session.ignoredTurns.add(7);
  session.receiveCanvas({type:'canvas',id:7,visible:true,board:{...scene,revision:'stale'}});
  assert.equal(session.test.whiteboard,scene);assert.deepEqual(received,[]);
  session.receiveCanvas({type:'canvas',id:8,visible:true,board:{...scene,revision:'current'}});
  assert.equal(session.test.whiteboard.revision,'current');assert.equal(session.test.whiteboardVisible,true);
  assert.equal(received.length,1);
});

test('multiple selected zones survive reconnect with only safe identifiers sent',()=>{
  const {session,sent,received}=client();
  const group={boardRevision:'saved',targets:[{blockId:'equation',zoneId:'variable',content:'forged'}]};
  session.selectCanvas(group);
  session.receiveCanvas({type:'canvas',board:{...scene,revision:'restored'},selection:null});
  const expected={boardRevision:'restored',targets:[{blockId:'equation',zoneId:'variable'}]};
  assert.deepEqual(sent,[{type:'canvas-select',...expected}]);assert.deepEqual(received[0].selection,expected);
});
test('multi-selection rebases surviving blocks independently',()=>{
  const {session,received}=client();session.awaitingBoardRestore=false;
  session.test.whiteboard={revision:'saved',blocks:[...scene.blocks,{id:'other',type:'latex',content:'y=4'}]};
  session.test.whiteboardSelection={boardRevision:'saved',targets:[{blockId:'equation',zoneId:'variable'},{blockId:'other',zoneId:'whole'}]};
  session.receiveCanvas({type:'canvas',board:{revision:'next',blocks:[...scene.blocks,{id:'other',type:'latex',content:'y=5'}]}});
  assert.deepEqual(received[0].selection,{boardRevision:'next',targets:[{blockId:'equation',zoneId:'variable'}]});
});
