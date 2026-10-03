import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBoard,validateStoredBoard,boardVisibleText,createTutorOutput} from '../server/tutor-output.mjs';
import {applyBoardUpdate,restoreBoard,resolveBoardSelection,rebaseBoardSelection,selectionIdentifier} from '../server/whiteboard.mjs';
const matrix={type:'matrix',id:'payoffs',label:'Row player, column player',rows:[['3, 3','0, 5'],['5, 0','1, 1']],rowLabels:['Cooperate','Defect'],columnLabels:['Cooperate','Defect']};
const update={title:'Prisoner game',blocks:[matrix,{type:'text',id:'question',content:'Which choice is best for the row player?'}]};
test('matrix schema validates dimensions, labels, safe notation and stable IDs',()=>{
 assert.deepEqual(validateBoard(update),update);
 for(const rows of [[],[['1'],['2','3']],Array.from({length:13},()=>['1']),[['x'.repeat(161)]],[['\\href{https://bad}{click}']],[['<script>bad</script>']]])assert.equal(validateBoard({...update,blocks:[{...matrix,rows}]}),null);
 for(const bad of [{...matrix,id:'bad id'},{...matrix,rowLabels:['Wrong length']},{...matrix,columnLabels:['x','y','z']},{...matrix,answer:'private'}])assert.equal(validateBoard({...update,blocks:[bad]}),null);
 assert.equal(validateBoard({...update,blocks:[matrix,matrix]}),null);assert.equal(validateBoard({...update,removedIds:['payoffs']}),null);
});
test('patches preserve a matrix, upsert named objects and remove only explicit IDs',()=>{
 const initial=applyBoardUpdate(null,update);assert.ok(initial.revision);assert.deepEqual(initial.blocks[0],matrix);
 const hint=applyBoardUpdate(initial,{title:'Prisoner game',blocks:[{id:'hint',type:'latex',content:'u_1(D,C)>u_1(C,C)'}]});assert.deepEqual(hint.blocks[0],matrix);assert.equal(hint.blocks.length,3);assert.notEqual(hint.revision,initial.revision);
 const changed=applyBoardUpdate(hint,{title:'Prisoner game',blocks:[{id:'hint',type:'latex',content:'5>3'}]});assert.equal(changed.blocks.length,3);assert.equal(changed.blocks[2].content,'5>3');
 const removed=applyBoardUpdate(changed,{title:'Prisoner game',blocks:[],removedIds:['hint']});assert.equal(removed.blocks.length,2);
 const replaced=applyBoardUpdate(removed,{title:'New equation',mode:'replace',blocks:[{id:'equation',type:'latex',content:'x+1=2'}]});assert.deepEqual(replaced.blocks.map(b=>b.id),['equation']);assert.equal(initial.blocks.length,2,'input scene remains unchanged');
});
test('legacy type-based IDs are stable and a short text hint cannot replace the matrix',()=>{
 const initial=applyBoardUpdate(null,{title:'Matrix',blocks:[{type:'matrix',rows:[['1','2']]}]});const next=applyBoardUpdate(initial,{title:'Hint',blocks:[{type:'text',content:'Compare columns.'}]});assert.equal(next.title,'Matrix');assert.equal(next.blocks.length,2);assert.deepEqual(next.blocks[0].rows,[['1','2']]);
 const duplicate=applyBoardUpdate(null,{title:'IDs',blocks:[{type:'text',content:'One'},{id:'legacy-text-0',type:'text',content:'Two'}]});assert.equal(new Set(duplicate.blocks.map(b=>b.id)).size,2);
});
test('selection resolves only current trusted matrix cells and diagram elements',()=>{
 const scene=applyBoardUpdate(null,update);const event={type:'canvas-select',boardRevision:scene.revision,blockId:'payoffs',cell:{row:1,col:0}};
 assert.deepEqual(resolveBoardSelection(scene,event),{boardRevision:scene.revision,blockId:'payoffs',type:'matrix',cell:{row:1,col:0},content:'5, 0',label:'Row player, column player',rowLabel:'Defect',columnLabel:'Cooperate'});
 for(const bad of [{...event,boardRevision:'stale'},{...event,blockId:'unknown'},{...event,content:'injected answer'},{...event,cell:{row:9,col:0}},{...event,cell:{row:0,col:-1}},{...event,cell:{row:0.5,col:0}},{...event,cell:{row:0,col:0,text:'injected'}},{...event,elementIndex:0}])assert.equal(resolveBoardSelection(scene,bad),null);
 const diagram=applyBoardUpdate(scene,{title:'Diagram',blocks:[{type:'diagram',id:'game-tree',elements:[{type:'circle',x:50,y:50,r:10,label:'Player 1'}]}]});assert.equal(resolveBoardSelection(diagram,{boardRevision:diagram.revision,blockId:'game-tree',elementIndex:0}).content,'Player 1');assert.equal(resolveBoardSelection(diagram,{boardRevision:diagram.revision,blockId:'game-tree',elementIndex:1}),null);
 assert.equal(resolveBoardSelection(diagram,event),null,'new scene revision invalidates old cell selection');
});
test('restored scenes receive a fresh revision and merged scene limits never truncate content',()=>{
 const initial=applyBoardUpdate(null,update),restored=restoreBoard(initial);assert.notEqual(restored.revision,initial.revision);assert.deepEqual(restored.blocks,initial.blocks);assert.equal(validateBoard(restored),null,'model cannot forge server revision');assert.deepEqual(validateStoredBoard(restored),restored);
 let scene=null;for(let i=0;i<12;i++)scene=applyBoardUpdate(scene,{title:'Bounded',blocks:[{type:'text',id:`block-${i}`,content:'Text'}]});assert.equal(scene.blocks.length,12);assert.equal(applyBoardUpdate(scene,{title:'Too many',blocks:[{type:'text',id:'extra',content:'No'}]}),null);assert.equal(scene.blocks.length,12);
 assert.equal(restoreBoard({...restored,blocks:[{...matrix,html:'bad'}]}),null);
});
test('selection clear requires the current revision and cannot contain a conflicting target',()=>{
 const scene=applyBoardUpdate(null,update),event={type:'canvas-select',boardRevision:scene.revision,clear:true};
 assert.deepEqual(resolveBoardSelection(scene,event),{boardRevision:scene.revision,clear:true});
 for(const bad of [{...event,boardRevision:'stale'},{...event,clear:false},{...event,clear:'true'},{...event,blockId:'payoffs'},{...event,cell:{row:0,col:0}},{...event,elementIndex:0},{...event,part:0},{...event,content:'injected'}])assert.equal(resolveBoardSelection(scene,bad),null);
 assert.equal(resolveBoardSelection(null,event),null);
});
test('fine targets resolve canonical repeated math symbols, text words, cell values and diagram labels',()=>{
 const scene=applyBoardUpdate(null,{title:'Selectable parts',blocks:[matrix,{id:'equation',type:'latex',content:'x+x=2'},{id:'words',type:'text',content:'Compare the first row with the second row.'},{id:'tree',type:'diagram',elements:[{type:'circle',x:50,y:50,r:10,label:'Player 1'}]}]});
 const pick=(blockId,part,extra={})=>resolveBoardSelection(scene,{type:'canvas-select',boardRevision:scene.revision,blockId,part,...extra});
 const first=pick('equation',0),second=pick('equation',2);
 assert.equal(first.content,'x');assert.equal(second.content,'x');assert.notEqual(first.part.index,second.part.index);
 assert.equal(second.parentContent,'x+x=2');assert.match(second.part.nearby,/x \+ x/);
 assert.equal(pick('words',3).content,'row');assert.equal(pick('words',7).content,'row.');
 const cell=pick('payoffs',2,{cell:{row:1,col:0}});assert.equal(cell.content,'0');assert.equal(cell.parentContent,'5, 0');assert.equal(cell.rowLabel,'Defect');
 const label=pick('tree',1,{elementIndex:0});assert.equal(label.content,'1');assert.equal(label.parentContent,'Player 1');
});
test('fine targets reject forged content, bad ordinals and ambiguous whole matrix or diagram targets',()=>{
 const scene=applyBoardUpdate(null,{title:'Bounded fine selection',blocks:[matrix,{id:'equation',type:'latex',content:'x+x'},{id:'line',type:'diagram',elements:[{type:'line',x1:10,y1:10,x2:80,y2:80}]}]});
 const event={type:'canvas-select',boardRevision:scene.revision,blockId:'equation',part:0};
 for(const part of [-1,0.5,512,'0',true,null,{index:0,text:'injected'}])assert.equal(resolveBoardSelection(scene,{...event,part}),null);
 for(const bad of [{...event,content:'injected'},{...event,parentContent:'injected'},{...event,boardRevision:'stale'},{...event,cell:{row:0,col:0}},{...event,elementIndex:0},{...event,blockId:'payoffs'},{...event,blockId:'line'},{...event,blockId:'line',elementIndex:0},{...event,clear:true}])assert.equal(resolveBoardSelection(scene,bad),null);
});
test('full matrix wording enters visible grounding while board data never enters speech',()=>{
 const scene=applyBoardUpdate(null,update),text=boardVisibleText(scene);for(const value of ['Cooperate','Defect','3, 3','0, 5','5, 0','1, 1','Which choice is best for the row player?'])assert.ok(text.includes(value));assert.doesNotMatch(text,/sourceIds|referenceAnswer|Prisoner game/,'internal scene title is not rendered evidence');
 const spoken=[],decoder=createTutorOutput({onText:t=>spoken.push(t)});for(const char of `<say>Consider this.</say><board>${JSON.stringify(update)}</board>`)decoder.push(char);assert.equal(spoken.join(''),'Consider this.');assert.deepEqual(decoder.finish().board,update);
});

test('saved teaching notes restore without a title-based text ban',()=>{
 const notes={title:'Study notes',blocks:[{type:'text',content:'Diffusion moves particles down their concentration gradient.'}]};
 assert.equal(restoreBoard(notes).blocks[0].content,notes.blocks[0].content);
 const saved=applyBoardUpdate(null,notes),restored=restoreBoard(saved);assert.deepEqual(restored.blocks,saved.blocks);assert.notEqual(restored.revision,saved.revision);
 assert.ok(restoreBoard(applyBoardUpdate(null,update)));
});

test('visual-only restoration drops standalone prose without changing matrix IDs or selection targets',()=>{
 const saved=applyBoardUpdate(null,{title:'Saved game',blocks:[{type:'text',content:'Which outcome is the Nash equilibrium, and why?'},{type:'matrix',rows:[['3,2','0,1'],['1,0','2,3']],rowLabels:['Up','Down'],columnLabels:['Left','Right']}]});
 const original=structuredClone(saved),matrixBlock=saved.blocks[1];
 const selected=resolveBoardSelection(saved,{boardRevision:saved.revision,blockId:matrixBlock.id,cell:{row:0,col:0}});
 const restored=restoreBoard(saved,{visualOnly:true});
 assert.deepEqual(restored.blocks,[matrixBlock]);assert.equal(restored.blocks[0].id,'legacy-matrix-1');
 assert.notEqual(restored.revision,saved.revision);
 assert.equal(rebaseBoardSelection(saved,restored,selected).content,'3,2');
 assert.deepEqual(saved,original,'the saved input remains unchanged');
 assert.equal(restoreBoard(saved).blocks.length,2,'schema compatibility is unchanged unless requested');
});

test('visual-only patches remove old and new standalone prose while retaining actual visual labels',()=>{
 const saved=applyBoardUpdate(null,update),original=structuredClone(saved);
 const diagram={id:'flow',type:'diagram',elements:[{type:'text',x:10,y:20,text:'High'},{type:'arrow',x1:20,y1:50,x2:80,y2:50},{type:'text',x:70,y:20,text:'Low'}]};
 const changed=applyBoardUpdate(saved,{title:'Hint',blocks:[{id:'instruction',type:'text',content:'Compare the two sides.'},diagram,{id:'equation',type:'latex',content:'c_1>c_2'}]},{visualOnly:true});
 assert.deepEqual(changed.blocks.map(block=>block.id),['payoffs','flow','equation']);
 assert.deepEqual(changed.blocks[0],matrix);assert.deepEqual(changed.blocks[1],diagram);
 assert.deepEqual(saved,original);
 const legacy=applyBoardUpdate(null,{title:'Legacy',blocks:[{type:'text',content:'Question?'},{type:'matrix',rows:[['1']]}]},{visualOnly:true});
 assert.equal(legacy.blocks[0].id,'legacy-matrix-1','filtering does not renumber generated IDs');
});

test('visual-only mode rejects scenes with no diagram, matrix or mathematical notation',()=>{
 const textOnly={title:'Question',blocks:[{id:'question',type:'text',content:'Which choice is best?'}]};
 assert.equal(applyBoardUpdate(null,textOnly,{visualOnly:true}),null);
 assert.equal(restoreBoard(textOnly,{visualOnly:true}),null);
 const saved=applyBoardUpdate(null,textOnly);
 assert.equal(restoreBoard(saved,{visualOnly:true}),null);
 const visual=applyBoardUpdate(null,update);
 assert.equal(applyBoardUpdate(visual,{...textOnly,mode:'replace'},{visualOnly:true}),null);
 assert.ok(visual.blocks.some(block=>block.type==='matrix'),'a rejected replacement does not mutate the current scene');
});

test('matrix axis labels and words resolve only from the current canonical scene',()=>{
 const scene=applyBoardUpdate(null,{title:'Labels',blocks:[{...matrix,rowLabels:['Row one','Row two'],columnLabels:['Column one','Column two']}]});
 const event={type:'canvas-select',boardRevision:scene.revision,blockId:'payoffs',label:{axis:'row',index:1},part:1};
 const resolved=resolveBoardSelection(scene,event);
 assert.equal(resolved.content,'two');assert.equal(resolved.parentContent,'Row two');assert.equal(resolved.matrixLabel,matrix.label);assert.deepEqual(resolved.label,{axis:'row',index:1});assert.equal(resolved.part.index,1);
 assert.deepEqual(selectionIdentifier(resolved),{boardRevision:scene.revision,blockId:'payoffs',label:{axis:'row',index:1},part:1});
 assert.equal(resolveBoardSelection(scene,{...event,label:{axis:'column',index:0},part:0}).content,'Column');
 for(const bad of [{...event,boardRevision:'old'},{...event,label:{axis:'row',index:2}},{...event,label:{axis:'row',index:-1}},{...event,label:{axis:'row',index:0.5}},{...event,label:{axis:'col',index:0}},{...event,label:{axis:'row',index:0,text:'forged'}},{...event,label:{axis:'row'}},{...event,label:[]},{...event,cell:{row:0,col:0}},{...event,elementIndex:0},{...event,part:99},{...event,content:'forged'},{...event,type:'anything'}])assert.equal(resolveBoardSelection(scene,bad),null);
 const noLabels=applyBoardUpdate(null,{title:'Unlabeled',blocks:[{id:'payoffs',type:'matrix',rows:[['1']]}]});
 assert.equal(resolveBoardSelection(noLabels,{...event,boardRevision:noLabels.revision,label:{axis:'row',index:0},part:0}),null);
});

test('selection rebases across unrelated patches and reconnect but clears for changed or removed blocks',()=>{
 const original=applyBoardUpdate(null,update);
 const selected=resolveBoardSelection(original,{boardRevision:original.revision,blockId:'payoffs',cell:{row:1,col:0},part:2});
 const patched=applyBoardUpdate(original,{title:'Hint',blocks:[{id:'hint',type:'text',content:'Compare the rows.'}]});
 const rebased=rebaseBoardSelection(original,patched,selected);
 assert.equal(rebased.content,'0');assert.equal(rebased.boardRevision,patched.revision);assert.deepEqual(rebased.cell,selected.cell);assert.equal(rebased.part.index,2);
 assert.equal(resolveBoardSelection(patched,selectionIdentifier(selected)),null,'old packets stay stale');
 const restored=restoreBoard(patched),afterReconnect=rebaseBoardSelection(patched,restored,rebased);
 assert.equal(afterReconnect.boardRevision,restored.revision);assert.equal(afterReconnect.content,'0');
 const changed=applyBoardUpdate(patched,{title:'Changed',blocks:[{...matrix,rows:[['9','9'],['5, 0','1, 1']]}]});
 assert.equal(rebaseBoardSelection(patched,changed,rebased),null,'even a different changed cell invalidates the whole selected block');
 const removed=applyBoardUpdate(patched,{title:'Removed',blocks:[],removedIds:['payoffs']});
 assert.equal(rebaseBoardSelection(patched,removed,rebased),null);
 assert.equal(rebaseBoardSelection(patched,restored,{...rebased,boardRevision:'stale'}),null);
 assert.equal(selectionIdentifier(null),null);
});

test('authored semantic zones resolve exact phrases, expressions and matrix payoff values',()=>{
 const scene=applyBoardUpdate(null,{title:'Intentional choices',blocks:[
  {...matrix,zones:[{id:'row-payoff',label:'Row player payoff',anchor:{kind:'cell',row:1,col:0,quote:'5'}},{id:'column-action',label:'Other player choice',anchor:{kind:'column-label',index:0}}]},
  {id:'equation',type:'latex',content:'x+x+1=2',zones:[{id:'second-term',label:'Second term',anchor:{kind:'content',quote:'x+1'}}]},
  {id:'sentence',type:'text',content:'Compare the first row with the second row.',zones:[{id:'second-row',label:'Second row phrase',anchor:{kind:'content',quote:'second row'}}]},
 ]});assert.ok(scene);
 const pick=(blockId,zoneId)=>resolveBoardSelection(scene,{boardRevision:scene.revision,blockId,zoneId});
 assert.equal(pick('payoffs','row-payoff').content,'5');assert.equal(pick('payoffs','row-payoff').parentContent,'5, 0');assert.deepEqual(pick('payoffs','row-payoff').cell,{row:1,col:0});
 assert.equal(pick('payoffs','column-action').content,'Cooperate');assert.equal(pick('equation','second-term').content,'x+1');assert.equal(pick('sentence','second-row').content,'second row');
 assert.deepEqual(selectionIdentifier(pick('equation','second-term')),{boardRevision:scene.revision,blockId:'equation',zoneId:'second-term'});
 const after=applyBoardUpdate(scene,{title:'Hint',blocks:[{id:'hint',type:'text',content:'A hint.'}]});assert.equal(rebaseBoardSelection(scene,after,pick('equation','second-term')).zoneId,'second-term');
 const restored=restoreBoard(scene);assert.equal(rebaseBoardSelection(scene,restored,pick('payoffs','row-payoff')).content,'5');
 for(const extra of [{part:0},{cell:{row:1,col:0}},{content:'forged'},{anchor:{kind:'content'}},{zoneId:'missing'},{boardRevision:'stale'}])assert.equal(resolveBoardSelection(scene,{boardRevision:scene.revision,blockId:'payoffs',zoneId:'row-payoff',...extra}),null);
 assert.equal(resolveBoardSelection(scene,{boardRevision:scene.revision,blockId:'payoffs',cell:{row:1,col:0},part:0}),null,'explicit zones cannot be bypassed with legacy ordinals');
});

test('zone validation rejects forged anchors, overlapping targets and unsafe math boundaries',()=>{
 const wrap=zones=>({title:'Zones',blocks:[{id:'math',type:'latex',content:'x+x+1=\\frac{a}{b}',zones}]});
 const good={id:'second-x',label:'Second variable',anchor:{kind:'content',quote:'x',occurrence:1}};assert.ok(validateBoard(wrap([good])));
 for(const bad of [
  {...good,id:'bad id'},{...good,label:'<script>bad</script>'},{...good,answer:'private'},
  {...good,anchor:{kind:'content',quote:'z'}},{...good,anchor:{kind:'content',quote:'x',occurrence:3}},
  {...good,anchor:{kind:'content',quote:'frac'}},{...good,anchor:{kind:'content',quote:'{a'}},
  {...good,anchor:{kind:'content',quote:'x',occurrence:-1}},{...good,anchor:{kind:'content',quote:'x',text:'forged'}},
  {...good,anchor:{kind:'cell',row:0,col:0}},{...good,anchor:{kind:'content',occurrence:0}},
 ])assert.equal(validateBoard(wrap([bad])),null);
 assert.equal(validateBoard(wrap([good,good])),null);assert.equal(validateBoard(wrap([good,{id:'overlap',label:'Overlapping sum',anchor:{kind:'content',quote:'x+1'}}])),null);
 assert.equal(validateBoard(wrap(Array.from({length:17},(_,i)=>({...good,id:`zone-${i}`})))),null);
 const badCell={...matrix,zones:[{id:'bad',label:'Bad cell',anchor:{kind:'cell',row:20,col:0}}]};assert.equal(validateBoard({title:'Bad',blocks:[badCell]}),null);
});

test('rendered math zones wrap complete source expressions without universal leaf buttons or HTML trust',async()=>{
 const {resolvedZones,renderZonedMath,interactionZones}=await import('../shared/board-parts.mjs');
 const block={type:'latex',content:'x+x+1=2',zones:[{id:'sum',label:'Second term',anchor:{kind:'content',quote:'x+1'}}]};
 const markup=renderZonedMath(block.content,resolvedZones(block));assert.equal((markup.match(/data-board-zone=/g)||[]).length,1);assert.ok(markup.includes('data-board-zone="sum"'));assert.doesNotMatch(markup,/data-board-part|tabindex/);
 assert.doesNotMatch(renderZonedMath('\\htmlData{evil=forged}{x}',[]),/data-evil/);
 assert.doesNotMatch(renderZonedMath('\\href{https://bad.example}{x}',[]),/<a\s/);
 assert.deepEqual(interactionZones({type:'text',content:'These words are ordinary prose.'}),[]);
 assert.deepEqual(interactionZones({...matrix,zones:[]}),[]);
 assert.equal(interactionZones(matrix).filter(zone=>zone.anchor.kind==='cell').length,4);
 assert.equal(interactionZones({type:'latex',content:'x+x=2'}).length,1);
});

test('saved LaTeX matrices derive complete cell zones with exact repeated source anchors',async()=>{
 const {interactionZones,resolvedZones,renderZonedMath}=await import('../shared/board-parts.mjs');
 const block={id:'old-matrix',type:'latex',content:String.raw`\begin{pmatrix}1 & 1 \\ \frac{a+b}{2} & 3\end{pmatrix}`};
 const zones=interactionZones(block);assert.equal(zones.length,4);assert.deepEqual(zones.map(zone=>zone.anchor.quote),['1','1',String.raw`\frac{a+b}{2}`,'3']);
 assert.equal(zones[0].anchor.occurrence,0);assert.equal(zones[1].anchor.occurrence,1);
 const markup=renderZonedMath(block.content,resolvedZones(block));assert.equal((markup.match(/data-board-zone=/g)||[]).length,4);assert.doesNotMatch(markup,/katex-error|data-board-part/);
 const scene=applyBoardUpdate(null,{title:'Saved matrix',blocks:[block]});
 const pick=resolveBoardSelection(scene,{boardRevision:scene.revision,blockId:block.id,zoneId:'legacy-cell-1-0'});
 assert.equal(pick.content,String.raw`\frac{a+b}{2}`);assert.equal(pick.parentContent,block.content);
 const restored=restoreBoard(scene);assert.equal(rebaseBoardSelection(scene,restored,pick).content,pick.content);
});

test('saved payoff arrays retain header and cell zones without selecting rules or splitting expressions',async()=>{
 const {interactionZones,resolvedZones,renderZonedMath}=await import('../shared/board-parts.mjs');
 const block={type:'latex',content:String.raw`\begin{array}{c|cc} & \text{Cooperate} & \text{Defect} \\ \hline \text{Cooperate} & (3,3) & (0,5) \\[2pt] \text{Defect} & (5,0) & (1,1) \end{array}`};
 const zones=interactionZones(block);assert.equal(zones.length,8);assert.equal(zones[0].id,'legacy-cell-0-1');
 assert.deepEqual(zones.map(zone=>zone.anchor.quote),[String.raw`\text{Cooperate}`,String.raw`\text{Defect}`,String.raw`\text{Cooperate}`,'(3,3)','(0,5)',String.raw`\text{Defect}`,'(5,0)','(1,1)']);
 const markup=renderZonedMath(block.content,resolvedZones(block));assert.equal((markup.match(/data-board-zone=/g)||[]).length,8);assert.doesNotMatch(markup,/katex-error/);
 const escaped={type:'latex',content:String.raw`\begin{array}{cc}\text{A\&B} & \frac{1}{2} \\ 3 & 4\end{array}`};
 assert.equal(interactionZones(escaped).length,4);assert.equal(interactionZones(escaped)[0].anchor.quote,String.raw`\text{A\&B}`);
});

test('authored zones win and ambiguous legacy TeX conservatively keeps one equation',async()=>{
 const {interactionZones}=await import('../shared/board-parts.mjs');
 const content=String.raw`\begin{matrix}1&2\\3&4\end{matrix}`,authored=[{id:'chosen',label:'Chosen value',anchor:{kind:'content',quote:'3'}}];
 assert.deepEqual(interactionZones({type:'latex',content,zones:authored}),authored);assert.deepEqual(interactionZones({type:'latex',content,zones:[]}),[]);assert.equal(interactionZones({type:'latex',content}).length,4,'compact row separators do not look like partial control words');
 for(const source of [String.raw`\begin{matrix}1&2\\3\end{matrix}`,String.raw`\begin{matrix}\begin{matrix}1\end{matrix}&2\end{matrix}`,String.raw`\begin{array}{cc}\multicolumn{2}{c}{One}\end{array}`,String.raw`\begin{matrix}{1&2\end{matrix}`,String.raw`\begin{matrix}1&2\end{matrix}+\begin{matrix}3&4\end{matrix}`]){
  assert.deepEqual(interactionZones({type:'latex',content:source}),[{id:'whole',label:'Select equation',anchor:{kind:'content'}}]);
 }
});

test('group selection atomically validates source zones, sorts identifiers and never trusts caller content',()=>{
 const scene=applyBoardUpdate(null,{title:'Groups',blocks:[matrix,{id:'equation',type:'latex',content:'x+1=2'}]});
 const targets=[{blockId:'payoffs',zoneId:'cell-1-0'},{blockId:'equation',zoneId:'whole'},{blockId:'payoffs',zoneId:'cell-0-1'}];
 const event={type:'canvas-select',boardRevision:scene.revision,targets};
 const selected=resolveBoardSelection(scene,event);assert.ok(selected);
 assert.deepEqual(selected.targets.map(target=>target.content),['x+1=2','0, 5','5, 0']);
 assert.deepEqual(selected.targets[2].cell,{row:1,col:0});assert.equal(selected.targets[2].rowLabel,'Defect');
 assert.deepEqual(selectionIdentifier(selected),{boardRevision:scene.revision,targets:[targets[1],targets[2],targets[0]]});
 for(const bad of [
  {...event,boardRevision:'stale'},{...event,clear:true},{...event,content:'forged'},{...event,blockId:'payoffs'},
  {...event,targets:null},{...event,targets:[targets[0],targets[0]]},
  {...event,targets:[targets[0],{blockId:'equation',zoneId:'missing'}]},
  {...event,targets:[targets[0],{blockId:'equation',zoneId:'whole',content:'fake'}]},
  {...event,targets:[targets[0],{blockId:'payoffs',cell:{row:0,col:0}}]},
  {...event,targets:[targets[0],null]},
 ])assert.equal(resolveBoardSelection(scene,bad),null);
 assert.deepEqual(resolveBoardSelection(scene,{boardRevision:scene.revision,targets:[]}),{boardRevision:scene.revision,clear:true});
 assert.equal(selectionIdentifier(resolveBoardSelection(scene,{boardRevision:scene.revision,targets:[]})),null);
});

test('group size is bounded at32 and supports multiple zones in one block',()=>{
 const grid={id:'grid',type:'matrix',rows:Array.from({length:8},()=>Array.from({length:8},()=> '1'))};
 const scene=applyBoardUpdate(null,{title:'Grid',blocks:[grid]});
 const targets=Array.from({length:33},(_,i)=>({blockId:'grid',zoneId:`cell-${Math.floor(i/8)}-${i%8}`}));
 assert.equal(resolveBoardSelection(scene,{boardRevision:scene.revision,targets:targets.slice(0,32)}).targets.length,32);
 assert.equal(resolveBoardSelection(scene,{boardRevision:scene.revision,targets}),null);
});

test('groups restore with fresh revision and rebase only targets in unchanged blocks',()=>{
 const scene=applyBoardUpdate(null,{title:'Group persistence',blocks:[matrix,{id:'equation',type:'latex',content:'x+1=2'}]});
 const selection=resolveBoardSelection(scene,{boardRevision:scene.revision,targets:[{blockId:'payoffs',zoneId:'cell-0-0'},{blockId:'payoffs',zoneId:'cell-1-1'},{blockId:'equation',zoneId:'whole'}]});
 const restored=restoreBoard(scene),restoredSelection=rebaseBoardSelection(scene,restored,selection);
 assert.equal(restoredSelection.targets.length,3);assert.equal(restoredSelection.boardRevision,restored.revision);
 const patched=applyBoardUpdate(restored,{title:'New',blocks:[{id:'equation',type:'latex',content:'x+2=3'}]});
 const retained=rebaseBoardSelection(restored,patched,restoredSelection);
 assert.equal(retained.targets.length,2);assert.ok(retained.targets.every(target=>target.blockId==='payoffs'));
 const removed=applyBoardUpdate(patched,{title:'Remove',blocks:[],removedIds:['payoffs']});assert.equal(rebaseBoardSelection(patched,removed,retained),null);
 assert.equal(rebaseBoardSelection(scene,restored,{...selection,boardRevision:'stale'}),null);
});
