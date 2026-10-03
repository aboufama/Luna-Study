import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBoard,validateStoredBoard,boardVisibleText,createTutorOutput} from '../server/tutor-output.mjs';
import {applyBoardUpdate,restoreBoard,resolveBoardSelection,rebaseBoardSelection,selectionIdentifier} from '../server/whiteboard.mjs';
import {resolvedZones,validateInteractionZones} from '../shared/board-parts.mjs';
import {validateRetainedScene,blockHasVisualContent} from '../shared/retained-scene.mjs';
import {rebaseClientSelection} from '../src/live-voice.js';
const cell={id:'cell',type:'ellipse',x:80,y:70,width:360,height:280,label:'Cell'};
const nucleus={id:'nucleus',type:'ellipse',x:210,y:140,width:100,height:100,label:'Nucleus'};
const note={id:'definition',type:'text',x:470,y:90,width:260,height:120,text:'The nucleus contains genetic material.',fontSize:20};
const scene=(objects=[cell,nucleus,note],extra={})=>({id:'lesson',type:'scene',width:800,height:500,objects,...extra});
const board=(block,extra={})=>({title:'Biology',blocks:[block],...extra});

test('retained scenes validate all teaching primitives and expose exact public labels',()=>{
 const block=scene([cell,nucleus,note,{id:'force',type:'arrow',x1:50,y1:400,x2:200,y2:400,label:'Force',tone:'accent'},{id:'axis',type:'line',x1:40,y1:450,x2:740,y2:450},{id:'curve',type:'polyline',points:[[40,430],[80,390],[120,430]],tone:'muted'},{id:'equation',type:'math',x:450,y:270,width:260,height:70,text:'2x+4=10',fontSize:24},{id:'box',type:'rect',x:10,y:10,width:40,height:40}]);
 const valid=validateBoard(board(block));assert.deepEqual(valid.blocks[0],block);
 for(const content of ['Cell','Nucleus',note.text,'Force','2x+4=10'])assert.ok(boardVisibleText(valid).includes(content));
 assert.ok(!boardVisibleText(valid).includes('Biology'));assert.ok(!boardVisibleText(valid).includes('objects'));
 assert.equal(blockHasVisualContent(scene([note])),false);assert.equal(blockHasVisualContent(block),true);
 const decoder=createTutorOutput();decoder.push(`<say>Inspect the cell.</say><board>${JSON.stringify(board(block))}</board>`);assert.deepEqual(decoder.finish().board,valid);
});

test('scene validator rejects executable content, unknown fields, unsafe bounds and conflicting IDs',()=>{
 const invalid=[scene([cell,{...nucleus,id:'cell'}]),scene([{...cell,x:790}]),scene([{...note,text:'<img src=x>'}]),scene([{...note,type:'math',text:'\\href{https://example.org}{x}'}]),scene([{...note,fontSize:10}]),scene([{...note,onclick:'bad'}]),scene([{...cell,tone:'red'}]),scene([{id:'path',type:'polyline',points:[[0,0],[900,1]]}]),scene([{id:'line',type:'line',x1:1,y1:1,x2:1,y2:1}]),scene([cell],{width:800.5}),scene([cell],{width:99}),scene([cell],{removedObjectIds:['cell']}),scene([cell],{removedObjectIds:['unknown','unknown']})];
 for(const value of invalid)assert.equal(validateRetainedScene(value),null,JSON.stringify(value));
 assert.equal(validateStoredBoard({...board(scene([cell],{removedObjectIds:['other']})),revision:'saved'}),null,'wire removals cannot persist');
 assert.equal(validateBoard(board({...scene(),objects:[]})),null,'empty newly generated scenes are rejected');
 assert.equal(validateBoard(board(scene([{...cell,unknown:undefined}]))),null,'undefined unknown fields cannot bypass strict validation');
 assert.equal(validateBoard(board(scene([{id:'point-only',type:'polyline',points:[[1,1],[1,1]]}]))),null);
});

test('object patches retain omitted objects, strip removals, and require explicit replacement to resize',()=>{
 const original=applyBoardUpdate(null,board(scene())),copy=structuredClone(original);
 const moved={...nucleus,x:240};
 const patched=applyBoardUpdate(original,board(scene([moved],{removedObjectIds:['definition']})));
 assert.deepEqual(patched.blocks[0].objects,[cell,moved]);assert.equal(Object.hasOwn(patched.blocks[0],'removedObjectIds'),false);assert.deepEqual(original,copy);
 assert.equal(applyBoardUpdate(original,board(scene([moved],{width:900}))),null);
 assert.equal(applyBoardUpdate(original,board(scene([],{removedObjectIds:['guessed']}))),null);
 const replaced=applyBoardUpdate(original,board(scene([cell],{width:900}),{mode:'replace'}));assert.equal(replaced.blocks[0].width,900);assert.deepEqual(replaced.blocks[0].objects,[cell]);
});

test('retained object and board limits reject overflow transactionally',()=>{
 const objects=Array.from({length:80},(_,i)=>({id:`o${i}`,type:'rect',x:i*5,y:0,width:3,height:3}));
 const previous=applyBoardUpdate(null,board(scene(objects)));assert.ok(previous);
 const frozen=JSON.stringify(previous);assert.equal(applyBoardUpdate(previous,board(scene([{...cell,id:'overflow'}]))),null);assert.equal(JSON.stringify(previous),frozen);
 const tooMany=Array.from({length:81},(_,i)=>({...cell,id:`object${i}`}));assert.equal(validateBoard(board(scene(tooMany))),null);
});

test('scene selections use stable object identities and retain only unchanged targets after a patch',()=>{
 const before=applyBoardUpdate(null,board(scene()));
 const selected=resolveBoardSelection(before,{boardRevision:before.revision,blockId:'lesson',zoneId:'nucleus'});
 assert.equal(selected.objectId,'nucleus');assert.deepEqual(selected.object,nucleus);assert.equal(selected.content,'Nucleus');
 assert.deepEqual(resolvedZones(before.blocks[0]).map(z=>z.id),['cell','nucleus','definition']);
 assert.equal(resolveBoardSelection(before,{boardRevision:before.revision,blockId:'lesson',zoneId:'guessed'}),null);
 assert.equal(resolveBoardSelection(before,{boardRevision:before.revision,blockId:'lesson',zoneId:'nucleus',content:'forged'}),null);
 const after=applyBoardUpdate(before,board(scene([{...note,text:'Updated annotation.'}])));
 const rebased=rebaseBoardSelection(before,after,selected);assert.equal(rebased.objectId,'nucleus');assert.equal(rebased.boardRevision,after.revision);
 assert.deepEqual(rebaseClientSelection(before,after,selectionIdentifier(selected)),selectionIdentifier(rebased));
 const moved=applyBoardUpdate(after,board(scene([{...nucleus,x:250}])));assert.equal(rebaseBoardSelection(after,moved,rebased),null);assert.equal(rebaseClientSelection(after,moved,selectionIdentifier(rebased)),null);
 const group=resolveBoardSelection(before,{boardRevision:before.revision,targets:[{blockId:'lesson',zoneId:'nucleus'},{blockId:'lesson',zoneId:'definition'}]});
 assert.deepEqual(rebaseBoardSelection(before,after,group).targets.map(t=>t.objectId),['nucleus']);
});

test('authored scene zones resolve exact source text and reject incompatible anchors',()=>{
 const block=scene([note],{zones:[{id:'term',label:'Genetic material',anchor:{kind:'object',id:'definition',quote:'genetic material'}}]});
 assert.equal(validateInteractionZones(block),true);assert.equal(resolvedZones(block)[0].target.content,'genetic material');
 for(const anchor of [{kind:'object',id:'missing'},{kind:'object',id:'definition',index:0},{kind:'content',id:'definition'},{kind:'object',id:'definition',quote:'not present'}])assert.equal(validateInteractionZones({...block,zones:[{id:'term',label:'Term',anchor}]}),false);
});

test('deleting all objects clears canonical blocks and cannot restore an empty board',()=>{
 const before=applyBoardUpdate(null,board(scene()));
 const cleared=applyBoardUpdate(before,board(scene([],{removedObjectIds:['cell','nucleus','definition']})));
 assert.ok(cleared);assert.deepEqual(cleared.blocks,[]);assert.equal(restoreBoard(cleared),null);assert.equal(restoreBoard({title:'Empty',revision:'saved',blocks:[scene([])]}),null);
 assert.equal(rebaseBoardSelection(before,cleared,resolveBoardSelection(before,{boardRevision:before.revision,blockId:'lesson',zoneId:'nucleus'})),null);
});

test('compact matrices expand sparse cells and blanks into canonical rows with identical selection semantics',()=>{
 const compact={id:'matrix',type:'matrix',size:[8,10],cells:[{row:2,col:4,value:'x'}],rowLabels:Array.from({length:8},(_,i)=>`r${i+1}`),columnLabels:Array.from({length:10},(_,i)=>`c${i+1}`)};
 const valid=validateBoard(board(compact));assert.equal(valid.blocks[0].rows.length,8);assert.equal(valid.blocks[0].rows[0].length,10);assert.equal(valid.blocks[0].rows[2][4],'x');assert.equal(valid.blocks[0].rows.flat().filter(Boolean).length,1);assert.equal(Object.hasOwn(valid.blocks[0],'size'),false);
 const saved=applyBoardUpdate(null,board(compact));const selected=resolveBoardSelection(saved,{boardRevision:saved.revision,blockId:'matrix',zoneId:'cell-2-4'});assert.equal(selected.content,'x');assert.equal(selected.rowLabel,'r3');
 assert.deepEqual(restoreBoard(saved).blocks,saved.blocks);
});

test('compact matrices reject duplicate, missing, unsafe and out-of-range cells without guessing',()=>{
 const base={id:'matrix',type:'matrix',size:[2,2],cells:[]};
 for(const change of [{size:[0,2]},{size:[13,2]},{size:[2.5,2]},{cells:[{row:0,col:0,value:'1'},{row:0,col:0,value:'2'}]},{cells:[{row:2,col:0,value:'1'}]},{cells:[{row:0,col:-1,value:'1'}]},{cells:[{row:0,col:0,value:'\\htmlClass{x}{y}'}]},{cells:[{row:0,col:0}]},{rows:[['1']]}])assert.equal(validateBoard(board({...base,...change})),null,JSON.stringify(change));
 assert.equal(validateStoredBoard({...board(base),revision:'saved'}),null,'stored matrices must already be canonical');
});


test('omitted compact cells are blank but malformed explicit cells remain rejected',()=>{
 const compact={id:'blank',type:'matrix',size:[8,10]};
 const parsed=validateBoard(board(compact));assert.equal(parsed.blocks[0].rows.length,8);assert.equal(parsed.blocks[0].rows[0].length,10);assert.ok(parsed.blocks[0].rows.flat().every(value=>value===''));
 assert.deepEqual(parsed,validateBoard(board({...compact,cells:[]})));
 for(const cells of [null,undefined,{},'',0])assert.equal(validateBoard(board({...compact,cells})),null);
 assert.equal(validateBoard(board({...compact,unexpected:[]})),null);
});

test('empty shape labels remain blank without relaxing unsafe labels or quote anchors',()=>{
 const empty={...cell,label:''},parsed=validateBoard(board(scene([empty])));assert.equal(parsed.blocks[0].objects[0].label,'');assert.equal(boardVisibleText(parsed),'');
 const stored=applyBoardUpdate(null,parsed);assert.deepEqual(restoreBoard(stored).blocks,stored.blocks);
 for(const label of [null,undefined,42,{},'<img src=x>',String.fromCharCode(0)])assert.equal(validateBoard(board(scene([{...cell,label}]))),null);
 assert.equal(validateBoard(board(scene([empty],{zones:[{id:'blank-quote',label:'Blank',anchor:{kind:'object',id:'cell',quote:''}}]}))),null);
 assert.equal(validateBoard(board(scene([{...empty,html:'<script/>'}]))),null);
});
