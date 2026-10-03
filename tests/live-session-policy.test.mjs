import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFixture, question, study } from './helpers/session-policy.mjs';
const hints=f=>f.messages.filter(m=>m.type==='hint-state').at(-1);
const practice=f=>f.messages.filter(m=>m.type==='practice-state').at(-1);
test('ready welcome leads with canonical question and masks unattempted private answer',async t=>{
 const f=await sessionFixture(t);assert.equal(f.calls.length,1);assert.equal(f.calls[0].input.conversation.length,0);assert.equal(f.calls[0].input.privateQuestionBank.topics[0].questions[0].answer,undefined);assert.equal(practice(f).current.questionId,question.id);assert.equal(hints(f).remaining,3);assert.equal(hints(f).available,true);assert.equal(JSON.stringify(f.messages).includes(question.answer),false);
});
test('matching readiness coalesces while welcome is speaking and begins after playback without invented user speech',async t=>{
 const f=await sessionFixture(t,{start:{...study,indexStatus:'indexing'},greeting:{reply:'Your material is indexing.'},autoEnd:false});
 await f.packet({type:'index-status',status:'ready',revision:'notes'});await f.packet({type:'index-status',status:'ready',revision:'notes'});await f.advance(2000);assert.equal(f.calls.length,1);assert.equal(f.speech[0].canceled,undefined);
 f.speech[0].options.onAudio(Buffer.alloc(48_000).toString('base64'));await f.end();await f.advance(1299);assert.equal(f.calls.length,1);await f.advance(1);assert.equal(f.calls.length,2);assert.equal(f.calls[1].input.readinessContext.trigger,'study-ready');assert.equal(f.calls[1].input.conversation.some(x=>x.role==='user'),false);
});
test('partial or committed study input consumes queued automatic turn and stale source completion cannot lead',async t=>{
 const f=await sessionFixture(t,{start:{...study,indexStatus:'indexing'},greeting:{reply:'Indexing.'}});await f.packet({type:'index-status',status:'ready',revision:'notes'});await f.partial('Wait');await f.advance(5000);assert.equal(f.calls.length,1);await f.commit('Let us start');assert.equal(f.calls.length,2);await f.complete(f.calls[1]);await f.advance(1000);assert.equal(f.calls.length,2);
 await f.packet({type:'materials',materials:[{id:'new',name:'History',text:'The event occurred in 1914.'}],indexStatus:'indexing'});await f.packet({type:'index-status',status:'ready',revision:'notes'});await f.advance(1000);assert.equal(f.calls.length,2);
});
test('voice help cannot grant a hint; button commits once before exposure and cooldown gets fresh server availability',async t=>{
 const f=await sessionFixture(t);await f.commit('help');assert.equal(f.calls.length,1);assert.match(f.speech.at(-1).text,/Hint button/);assert.equal(hints(f).remaining,3);assert.equal(practice(f).current.assisted,false);
 await f.packet({type:'hint',remaining:99});assert.equal(f.calls.length,1);await f.packet({type:'hint'});assert.equal(f.calls.length,2);assert.equal(f.calls[1].input.hintContext.hintAllowed,true);assert.equal(f.calls[1].input.readinessContext.trigger,'hint-button');assert.equal(f.calls[1].input.conversation.some(x=>x.role==='user'&&x.content===null),false);
 await f.packet({type:'hint'});assert.equal(f.calls.length,2);await f.complete(f.calls[1]);assert.equal(hints(f).remaining,2);assert.equal(practice(f).current.assisted,true);assert.equal(hints(f).reason,'cooldown');await f.advance(45001);assert.equal(hints(f).available,true);assert.equal(practice(f).current.questionId,question.id);
});
test('cancel before first hint exposure refunds, while interruption after a delta keeps the charge',async t=>{
 const f=await sessionFixture(t);await f.packet({type:'hint'});const canceled=f.calls[1];await f.packet({type:'interrupt'});assert.equal(hints(f).remaining,3);canceled.options.onText('Late solution');canceled.resolve({reply:'Late solution'});await f.flush();assert.equal(f.messages.some(x=>x.text==='Late solution'),false);
 await f.packet({type:'hint'});f.calls[2].options.onText('Focus on concentration.');await f.flush();await f.packet({type:'interrupt'});assert.equal(hints(f).remaining,2);assert.equal(practice(f).current.assisted,true);
});
test('silence checks in then pauses STT while preserving question and allowance; PCM cannot resume',async t=>{
 const f=await sessionFixture(t);await f.packet({type:'hint'});await f.complete(f.calls[1]);await f.advance(60000);assert.equal(f.speech.at(-1).text,'Are you still there?');assert.equal(f.calls.length,2);await f.advance(30000);assert.equal(f.messages.at(-1).type,'paused');assert.equal(f.messages.at(-1).resumable,true);assert.equal(f.sockets[0].readyState,3);assert.equal(f.client.readyState,1);
 await f.packet({type:'audio',audio:'AAA='});await f.packet({type:'activity'});assert.equal(f.sockets.length,1);await f.packet({type:'resume'});await f.waitFor(()=>f.messages.some(x=>x.type==='resumed'));assert.equal(f.sockets.length,2);assert.equal(hints(f).remaining,2);assert.equal(practice(f).current.questionId,question.id);assert.equal(f.calls.length,2);
 f.sockets[0].receive({message_type:'committed_transcript',text:'Stale old stream'});await f.flush();assert.equal(f.calls.length,2);
});
test('generation and live partials never trigger absence, while real activity resets idle time',async t=>{
 const f=await sessionFixture(t);await f.commit('Explain the setup');await f.advance(180000);assert.equal(f.speech.length,2);await f.complete(f.calls[1]);await f.advance(59000);await f.packet({type:'activity'});await f.advance(59000);assert.equal(f.speech.length,2);await f.partial('I think');await f.advance(180000);assert.equal(f.messages.some(x=>x.type==='paused'),false);
});
test('only confirmed setup clarification bypasses help invitation and preserves consumed question through follow-up punctuation',async t=>{
 const f=await sessionFixture(t,{intent:text=>({requestsHelp:true,setupClarification:text==='Which problem?',answerAttempt:false,examDeadline:false})});
 await f.commit('Which problem?');assert.equal(f.calls.length,2);assert.equal(f.calls[1].input.hintContext.setupClarification,true);assert.equal(f.calls[1].input.hintContext.hintAllowed,false);await f.complete(f.calls[1],'We are comparing these two concentrations. Can you identify the givens?');assert.equal(practice(f).current.questionId,question.id);assert.equal(practice(f).current.assisted,false);assert.equal(hints(f).remaining,3);
 await f.commit('What is the answer?');assert.equal(f.calls.length,2);assert.match(f.speech.at(-1).text,/Hint button/);assert.equal(hints(f).remaining,3);
});
test('canonical restatement after resume never resets used hints or consumes a second bank slot',async t=>{
 const f=await sessionFixture(t);await f.packet({type:'hint'});await f.complete(f.calls[1]);await f.packet({type:'pause'});await f.packet({type:'resume'});await f.commit('Restate it');const c=f.calls[2];assert.equal(c.options.resolveQuestion(question.id),question.question);c.resolve({reply:question.question,questionId:question.id});await f.flush();assert.equal(f.consumed,1);assert.equal(hints(f).remaining,2);assert.equal(practice(f).current.assisted,true);
});
test('all three button hints stay scoped and exhausted voice requests cannot generate a fourth',async t=>{
 const f=await sessionFixture(t);
 for(let n=1;n<=3;n++){await f.packet({type:'hint'});const c=f.calls[n];assert.equal(c.input.hintContext.hintNumber,n);await f.complete(c,`Use scaffold ${n}.`);assert.equal(hints(f).remaining,3-n);if(n<3)await f.advance(45001);}
 await f.advance(45001);await f.packet({type:'hint'});assert.equal(f.calls.length,4);assert.equal(hints(f).reason,'exhausted');await f.commit('help');assert.equal(f.calls.length,4);assert.match(f.speech.at(-1).text,/three hints/);assert.equal(practice(f).current.questionId,question.id);
});
test('source replacement revokes an unexposed hint and its late board, text and audio cannot reach the new study',async t=>{
 const f=await sessionFixture(t);await f.packet({type:'hint'});const c=f.calls[1],speech=f.speech.at(-1);await f.packet({type:'materials',materials:[{id:'other',name:'History',text:'An event occurred in 1914.'}],indexStatus:'indexing'});assert.equal(c.options.signal.aborted,true);assert.equal(hints(f).questionId,null);assert.equal(practice(f).current,null);
 c.options.onText('PRIVATE late hint');speech.options.onAudio('AAA=');c.resolve({reply:'PRIVATE late hint',board:{title:'Late',blocks:[{type:'text',content:'PRIVATE late hint'}]}});await f.flush();assert.equal(f.messages.some(x=>String(x.text||'').includes('PRIVATE late hint')),false);assert.equal(f.messages.filter(x=>x.type==='canvas').at(-1).board,null);
});
test('late PCM send acknowledgments remain on the old STT operation across pause and resume',async t=>{
 const meters=[];const f=await sessionFixture(t,{integrations:{usageLedger:{start(_test,meta){const entry={meta,units:{},finish:null};meters.push(entry);return {update(v){Object.assign(entry.units,v.units);},finish(v){entry.finish=v;Object.assign(entry.units,v.units);}};}}}});
 let ack;f.sockets[0].send=(_value,callback)=>{ack=callback;};await f.packet({type:'audio',audio:Buffer.alloc(3200).toString('base64')});await f.packet({type:'pause'});await f.packet({type:'resume'});await f.packet({type:'audio',audio:Buffer.alloc(6400).toString('base64')});ack();await f.flush();
 const recognition=meters.filter(x=>x.meta.operation==='speech-recognition');assert.equal(recognition.length,2);assert.equal(recognition[0].units.audioInputMs,100);assert.equal(recognition[1].units.audioInputMs,200);assert.equal(recognition[0].finish.status,'completed');assert.equal(f.messages.some(x=>x.type==='error'),false);
});
