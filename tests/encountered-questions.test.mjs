import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sessionFixture,question,study} from './helpers/session-policy.mjs';
import {createMasteryStore} from '../server/mastery.mjs';
import {createOpenAILuna} from '../server/openai-luna.mjs';

const y={...question,id:'asked-y',difficulty:'hard',question:'How do equal operations solve 3y - 6 = 9, and why are they valid?'};
const w={...question,id:'asked-w',difficulty:'hard',question:'How do equal operations solve 5w - 10 = 20, and why are they valid?'};
const hints=f=>f.messages.filter(x=>x.type==='hint-state').at(-1);
function bankFixture(questions){const queued=new Map(questions.map(q=>[q.id,q])),consumed=[];return{consumed,bank:{topics:()=>[{id:question.topicId,title:question.topicTitle}],context:()=>({topics:[{questions:[...queued.values()]}]}),resolve:(_input,id)=>queued.get(id)||null,consume:()=>[],consumeById:(_input,id,reply)=>{const q=queued.get(id);if(!q||reply!==q.question)return[];queued.delete(id);consumed.push(id);return[q];}}};}
async function choose(f,q,text='Choose another problem'){await f.commit(text);const call=f.calls.at(-1);call.resolve({reply:q.question,questionId:q.id});await f.flush();return call;}

test('returning to a consumed question restores its original attempt, assistance and hint allowance',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'luna-encountered-')),path=join(dir,'mastery.json');t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=createMasteryStore({path,shared:false}),bank=bankFixture([y,w]),events=[];let n=0;
 const f=await sessionFixture(t,{greeting:{reply:y.question,questionId:y.id},intent:text=>({answerAttempt:text==='submitted answer',requestsHelp:false}),integrations:{questionBank:bank.bank,masteryStore:store,diagnostics:{record:(_id,event)=>events.push(event)},gradeAnswerImpl:async()=>({checked:true,verdict:n++?'correct':'incorrect',unassisted:true}),canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:true})}}});
 await f.commit('submitted answer');await f.complete(f.calls.at(-1),'I will check that.');await f.waitFor(()=>events.some(x=>x.type==='grading.completed'));
 await f.packet({type:'hint'});const hint=f.calls.at(-1);assert.equal(hint.input.turnTask.kind,'deliver-authorized-hint');assert.equal(hint.input.turnTask.questionId,y.id);await f.complete(hint,'Consider the constant term.');await f.advance(45001);
 await choose(f,w);assert.equal(hints(f).questionId,w.id);assert.equal(hints(f).remaining,3);
 await f.commit('Return to the previous problem');const restore=f.calls.at(-1);
 const prior=restore.input.encounteredQuestions.find(q=>q.id===y.id);assert.equal(prior.attempts,1);assert.equal(prior.assisted,true);assert.equal(prior.answer,undefined);assert.equal(restore.options.resolveQuestion(y.id),y.question);
 assert.ok(restore.input.privateQuestionBank.topics[0].questions.every(q=>q.id!==y.id));
 restore.resolve({reply:y.question,questionId:y.id});await f.flush();assert.equal(hints(f).questionId,y.id);assert.equal(hints(f).remaining,2);assert.deepEqual(bank.consumed,[y.id,w.id]);
 await f.commit('submitted answer');const retry=f.calls.at(-1);assert.equal(retry.input.activeQuestion.attempts,1);assert.equal(retry.input.activeQuestion.assisted,true);await f.complete(retry,'I will check your revised answer.');await f.waitFor(()=>events.filter(x=>x.type==='grading.completed').length===2);
 await store.flush();const saved=JSON.parse(await readFile(path,'utf8')).tests[study.testId],grades=Object.values(saved.events).filter(x=>typeof x==='object');
 assert.deepEqual(grades.map(x=>x.attempt),[1,2]);assert.deepEqual(grades.map(x=>x.firstAttempt),[true,false]);assert.deepEqual(saved.topics[y.topicId].hardWins,[]);assert.equal(grades[1].unassisted,false);
});

test('ambiguous identical historical wording and multiple questions require an exact offered ID',async t=>{
 const twin={...y,id:'same-wording'},bank=bankFixture([y,twin,w]);
 const f=await sessionFixture(t,{greeting:{reply:y.question,questionId:y.id},integrations:{questionBank:bank.bank,canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:false})}}});
 await choose(f,twin);await choose(f,w);
 await f.commit('Return to the earlier equation');f.calls.at(-1).resolve({reply:y.question});await f.flush();assert.equal(hints(f).questionId,null,'identical wording cannot silently choose which prior ID');
 await f.commit('Clarify');const exact=f.calls.at(-1);assert.equal(exact.options.resolveQuestion(y.id),y.question);exact.resolve({reply:y.question,questionId:y.id});await f.flush();assert.equal(hints(f).questionId,y.id);
 await f.commit('Ask two');f.calls.at(-1).resolve({reply:`${y.question} ${w.question}`,questionId:y.id});await f.flush();assert.equal(hints(f).questionId,null);
 assert.deepEqual(bank.consumed,[y.id,twin.id,w.id]);
});

test('encountered catalog is source-scoped and bounded; stale turn callbacks cannot resurrect cleared or evicted questions',async t=>{
 const questions=Array.from({length:27},(_,i)=>({...y,id:`question-${i}`,question:`How would you reason about source problem ${i}?`})),bank=bankFixture(questions);
 const f=await sessionFixture(t,{greeting:{reply:questions[0].question,questionId:questions[0].id},integrations:{questionBank:bank.bank,canvasRouter:{classify:async()=>({needsCanvas:false})}}});
 let stale;
 for(let i=1;i<questions.length;i++){await f.advance(6001);const call=await choose(f,questions[i]);if(i===1){stale=call;assert.equal(call.options.resolveQuestion(questions[0].id),questions[0].question);}}
 await f.commit('Return');const call=f.calls.at(-1);assert.equal(call.input.encounteredQuestions.length,24);assert.equal(call.options.resolveQuestion(questions[0].id),null);assert.equal(stale.options.resolveQuestion(questions[0].id),null);
 assert.equal(call.input.encounteredQuestions.at(-1).id,questions.at(-1).id);
 await f.packet({type:'materials',materials:[{id:'replacement',name:'New source',text:'A different original source.'}],indexStatus:'indexing'});
 assert.equal(call.options.signal.aborted,true);assert.equal(call.options.resolveQuestion(questions.at(-1).id),null);assert.equal(hints(f).questionId,null);
});

test('production OpenAI adapter restores a historical ID absent from both current question and refilled bank',async t=>{
 const bank=bankFixture([y,w]),inputs=[];const outputs=[`<ask>${y.id}</ask>`,'<say>Consider the constant term.</say>',`<ask>${w.id}</ask>`,`<ask>${y.id}</ask>`];
 const f=await sessionFixture(t,{integrations:{questionBank:bank.bank,canvasRouter:{classify:async()=>({needsCanvas:false})},createLunaFastImpl:()=>createOpenAILuna({env:{OPENAI_API_KEY:'mock'},fetchImpl:async(_url,options)=>{
  const payload=JSON.parse(options.body);inputs.push(JSON.parse(payload.input));const output=outputs.shift();assert.equal(typeof output,'string');
  return new Response([{type:'response.output_text.delta',delta:output},{type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}]}}].map(x=>`data: ${JSON.stringify(x)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
 }})}});
 await f.packet({type:'hint'});await f.waitFor(()=>hints(f)?.remaining===2&&!hints(f)?.busy);await f.advance(45001);
 await f.commit('Choose a different equation');await f.waitFor(()=>hints(f)?.questionId===w.id);
 await f.commit('Return to the equation we skipped');await f.waitFor(()=>hints(f)?.questionId===y.id);
 const input=inputs.at(-1);assert.equal(input.workingProblem.id,w.id);assert.ok(input.encounteredQuestions.some(q=>q.id===y.id));assert.equal(input.privateQuestionBank.topics[0].questions.length,0);assert.equal(hints(f).remaining,2);assert.deepEqual(bank.consumed,[y.id,w.id]);
});

test('every explicit Hint click has a fresh server task and the third grant is delivered without fabricated student history',async t=>{
 const f=await sessionFixture(t);await f.commit('I would like to consider this myself.');await f.complete(f.calls[1],'Take your time.');
 const history=structuredClone(f.calls[1].input.conversation);
 for(let i=1;i<=3;i++){
  await f.packet({type:'hint'});const call=f.calls.at(-1);assert.equal(call.input.turnTask.kind,'deliver-authorized-hint');assert.equal(call.input.turnTask.hintNumber,i);assert.equal(call.input.hintContext.hintAllowed,true);assert.equal(call.input.hintContext.requiresAttempt,false);
  assert.deepEqual(call.input.conversation.filter(turn=>turn.role==='user'),history.filter(turn=>turn.role==='user'),'a click is a server event, never an invented student utterance');
  await f.complete(call,`Nudge ${i}.`);assert.equal(hints(f).remaining,3-i);if(i<3)await f.advance(45001);
 }
 const before=f.calls.length;await f.advance(45001);await f.packet({type:'hint'});assert.equal(f.calls.length,before);assert.equal(hints(f).reason,'exhausted');
});
