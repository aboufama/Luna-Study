import test from 'node:test';
import assert from 'node:assert/strict';
import {createJevIntentRouter} from '../server/jev-intent.mjs';
import {lifecycleFixture,subjects,settle,conversation} from './helpers/tutor-lifecycle.mjs';

const saved={title:'Old algebra example',revision:'original',blocks:[{id:'equation',type:'latex',content:'2x + 3 = 11'}]};
const quiet={requestsHelp:false,answerAttempt:false,examDeadline:false};
const boardText=content=>({title:'Teaching notes',mode:'replace',blocks:[{id:'note',type:'text',content}]});

test('same Jev call asks about bounded visible content only and conservatively rejects ambiguous/contradictory hide decisions',async()=>{
  const cases=[[.99,.01,.01,true],[.9,.01,.01,true],[.89,.01,.01,null],[.1,.01,.01,false],[.99,.99,.01,false],[.99,.01,.99,false],[.99,.5,.01,true],[.5,.5,.01,null]];
  for(const [close,help,attempt,expected]of cases){
    let calls=0,payload;
    const router=createJevIntentRouter({env:{TYPESAFE_API_KEY:'fixture'},fetchImpl:async(_,options)=>{calls++;payload=JSON.parse(options.body);return{ok:true,json:async()=>({answers:{requests_help:{type:'noul',noul:help},answer_attempt:{type:'noul',noul:attempt},exam_deadline:{type:'noul',noul:.01},should_close_board:{type:'noul',noul:close}}})};}});
    const result=await router.classify('Switch topics.',{existingBoard:{title:'x'.repeat(300),text:'y'.repeat(4000),privateAnswer:'PRIVATE'},privateQuestionBank:{answer:'PRIVATE'}});
    assert.equal(result.shouldCloseBoard,expected);assert.equal(calls,1);assert.equal(payload.state.existing_board.title.length,160);assert.equal(payload.state.existing_board.text.length,3000);assert.equal(JSON.stringify(payload).includes('PRIVATE'),false);
    await router.classify('Same phrase without a visible board.');
    assert.equal(payload.questions.should_close_board,undefined);assert.equal(payload.state.existing_board,undefined);
  }
});

test('explicit topic shift hides before a deferred main response and preserves the retained board without affecting grades',async t=>{
  const contexts=[];
  const f=await lifecycleFixture(t,{start:{whiteboard:saved,whiteboardVisible:true},integrations:{intentRouter:{classify(_,context){contexts.push(context);return{...quiet,shouldCloseBoard:true};}}}});
  f.commit('Leave algebra and explain membranes verbally.');
  await f.waitFor(()=>f.calls.length===1&&f.messages.some(m=>m.type==='canvas'&&!m.visible),'hide before response resolves');
  const hide=f.messages.find(m=>m.type==='canvas');assert.equal(Object.hasOwn(hide,'board'),false);
  assert.equal(f.calls[0].input.whiteboardContext.visible,false);assert.equal(f.calls[0].input.whiteboardContext.board.blocks[0].content,'2x + 3 = 11');
  assert.equal(contexts.length,1);assert.equal(contexts[0].existingBoard.text,'2x + 3 = 11');
  assert.equal(f.problems.length,0);assert.equal(f.messages.some(m=>m.role==='assistant'),false);
  assert.ok(f.decisions.some(e=>e.type==='whiteboard.closed'&&e.details.reason==='student-topic-shift'));
});

test('early visibility does not wait for source prefetch, and completing prefetch cannot undo a manual reopen',async t=>{
  let finishPrefetch;
  const f=await lifecycleFixture(t,{env:{LUNA_ORGANIZER:'openai-api'},start:{whiteboard:saved,whiteboardVisible:true},integrations:{
    intentRouter:{classify:async()=>({...quiet,shouldCloseBoard:true})},
    createMaterialRetrievalImpl:()=>({snapshot:()=>null,close(){},prefetch:()=>new Promise(resolve=>{finishPrefetch=resolve;})}),
  }});
  f.commit('Switch to biology and explain it verbally.');
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&!m.visible),'hide while retrieval is pending');
  assert.equal(f.calls.length,0);assert.equal(typeof finishPrefetch,'function');
  await f.packet({type:'canvas-visibility',boardRevision:f.restored.board.revision,visible:true});
  finishPrefetch(null);await f.waitFor(()=>f.calls.length===1);
  assert.equal(f.calls[0].input.whiteboardContext.visible,true);
  assert.equal(f.messages.filter(m=>m.type==='canvas').length,1);
  const close=f.decisions.find(e=>e.type==='whiteboard.closed');assert.ok(close.details.latencyMs>=0);
});

test('an interrupted turn with deferred prefetch cannot hide the next turn or start a stale response',async t=>{
  const classifications=[],prefetches=[];
  const f=await lifecycleFixture(t,{env:{LUNA_ORGANIZER:'openai-api'},start:{whiteboard:saved,whiteboardVisible:true},integrations:{
    intentRouter:{classify:()=>new Promise(resolve=>classifications.push(resolve))},
    createMaterialRetrievalImpl:()=>({snapshot:()=>null,close(){},prefetch:()=>new Promise(resolve=>prefetches.push(resolve))}),
  }});
  f.commit('Switch topics.');await settle();
  f.commit('Actually keep this equation.');await settle();
  classifications[0]({...quiet,shouldCloseBoard:true});prefetches[0](null);await settle();
  assert.equal(f.calls.length,0);assert.equal(f.messages.some(m=>m.type==='canvas'),false);
  classifications[1]({...quiet,shouldCloseBoard:false});prefetches[1](null);
  await f.waitFor(()=>f.calls.length===1);
  assert.equal(f.calls[0].input.whiteboardContext.visible,true);
});

test('unknown intent and vague references keep the current scene; a hidden scene is never offered for early-hide classification',async t=>{
  for(const visible of [true,false])await t.test(String(visible),async t=>{
    let context;
    const f=await lifecycleFixture(t,{start:{whiteboard:saved,whiteboardVisible:visible},integrations:{intentRouter:{classify(_,value){context=value;return{requestsHelp:null,answerAttempt:null,shouldCloseBoard:null};}}}});
    f.commit('What about this one?');await f.waitFor(()=>f.calls.length===1);
    assert.equal(Boolean(context.existingBoard),visible);assert.equal(f.calls[0].input.whiteboardContext.visible,visible);assert.equal(f.messages.some(m=>m.type==='canvas'),false);
  });
});

test('explicit off switch preserves the previous close-after-response flow and excludes extra board classification',async t=>{
  let context;
  const f=await lifecycleFixture(t,{env:{LUNA_EARLY_BOARD_HIDE:'off'},start:{whiteboard:saved,whiteboardVisible:true},integrations:{intentRouter:{classify(_,value){context=value;return{...quiet,shouldCloseBoard:true};}},canvasRouter:{classify:async text=>({needsCanvas:false,shouldClose:text!=='Welcome.'})}}});
  f.commit('Move on to another subject.');await f.waitFor(()=>f.calls.length===1);await settle();
  assert.equal(context.existingBoard,undefined);assert.equal(f.messages.some(m=>m.type==='canvas'),false);assert.equal(f.calls[0].input.whiteboardContext.visible,true);
  f.calls[0].resolve({reply:'Let us change subjects.'});await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&!m.visible));
});

test('a stale intent cannot hide a newer turn or override close/reopen manual intent',async t=>{
  for(const supersede of ['new-turn','manual-close-reopen'])await t.test(supersede,async t=>{
    const pending=[];
    const f=await lifecycleFixture(t,{start:{whiteboard:saved,whiteboardVisible:true},integrations:{intentRouter:{classify(text,context,options){return new Promise(resolve=>pending.push({text,context,options,resolve}));}}}});
    f.commit('Switch away.');assert.equal(pending.length,1);
    if(supersede==='new-turn'){
      f.partial('Actually');f.commit('Actually keep this diagram.');assert.equal(pending[0].options.signal.aborted,true);
      pending[1].resolve({...quiet,shouldCloseBoard:false});await f.waitFor(()=>f.calls.length===1);
    }else for(const visible of [false,true])await f.packet({type:'canvas-visibility',boardRevision:f.restored.board.revision,visible});
    pending[0].resolve({...quiet,shouldCloseBoard:true});await settle();
    assert.equal(f.messages.some(m=>m.type==='canvas'),false);
    if(supersede==='manual-close-reopen')await f.waitFor(()=>f.calls.length===1);
    assert.equal(f.calls[0].input.whiteboardContext.visible,true);
  });
});

test('natural interruption rejects old audio, captions and a late scene while a new subject renders',async t=>{
  const f=await lifecycleFixture(t);
  f.commit('Show the cell.');const old=f.calls[0],oldSpeech=f.speech[0];old.options.onText('The cell');
  f.partial('Wait');assert.equal(old.options.signal.aborted,true);assert.equal(oldSpeech.cancellations,1);
  f.commit('Use the force equation instead.');const current=f.calls[1];
  old.options.onText(' STALE_TAIL');oldSpeech.options.onAudio('AAAA');
  old.resolve({reply:'STALE_FINAL',board:{title:'Stale cell',blocks:[{id:'old',type:'latex',content:'STALE_BOARD'}]}});
  current.resolve({reply:'Consider the net force.',board:{title:'Forces',mode:'replace',blocks:[{id:'force',type:'latex',content:'F − f = ma'}]}});
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.visible),'new force board');await settle();
  assert.deepEqual(f.messages.filter(m=>m.type==='canvas').map(m=>m.board.title),['Forces']);
  assert.equal(JSON.stringify(f.messages).includes('STALE'),false);assert.equal(f.messages.some(m=>m.type==='audio'),false);
});

test('reverse-order routing after rapid subject changes cannot hide or append to the current board',async t=>{
  const pending=[];
  const f=await lifecycleFixture(t,{start:{whiteboard:saved,whiteboardVisible:true},integrations:{canvasRouter:{classify(text,context){if(text==='Welcome.')return{needsCanvas:false};return new Promise(resolve=>{pending.push({text,context,resolve});f?.notify();});}}}});
  f.commit('Leave this equation.');f.calls[0].resolve({reply:'We can discuss grammar.'});await f.waitFor(()=>pending.length===1);
  f.commit('Show the sentence annotation.');f.calls[1].resolve({reply:'Notice the dependent clause.',board:boardText('Although it was raining: dependent clause.\nMaya walked to class: main clause.')});await f.waitFor(()=>pending.length===2);
  pending[1].resolve({needsCanvas:true,shouldReplace:true});await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.visible));
  pending[0].resolve({needsCanvas:false,shouldClose:true});await settle();
  const canvases=f.messages.filter(m=>m.type==='canvas');assert.equal(canvases.length,1);assert.deepEqual(canvases[0].board.blocks.map(b=>b.id),['note']);
});

for(const [name,subject]of Object.entries(subjects))test(`${name}: useful written teaching survives removal of a redundant spoken question and stays public evidence`,async t=>{
  const f=await lifecycleFixture(t,{subject,bank:true,integrations:{canvasRouter:{classify:async(_,context)=>({needsCanvas:context.candidateTextOnly===true,candidateMatchesQuestion:context.currentQuestion?.question===subject.question&&context.candidateBoard?.text===subject.hint})}}});
  const q=f.questions.find(q=>q.difficulty==='hard');
  f.commit('Ask one question and leave a concise useful note.');
  assert.equal(f.calls[0].options.resolveQuestion(q.id),q.question);
  f.calls[0].resolve({reply:q.question,questionId:q.id,board:{title:subject.topic,blocks:[{id:'redundant',type:'text',content:q.question},{id:'teaching',type:'text',content:subject.hint}]}});
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.visible));
  const canvas=f.messages.find(m=>m.type==='canvas');assert.deepEqual(canvas.board.blocks.map(b=>b.id),['teaching']);
  assert.equal(f.problems.filter(p=>p.type==='asked').length,1);assert.equal(f.problems.some(p=>p.type==='attempt'),false);
  f.commit('Let me consider that.');assert.equal(f.calls[1].input.activeQuestion.id,q.id);
  assert.ok(conversation(f.calls[1].input).some(turn=>turn.content===`Shown on the whiteboard: ${subject.hint}`));
  assert.equal(JSON.stringify(f.messages).includes('PRIVATE REFERENCE'),false);
});
