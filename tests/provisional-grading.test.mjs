import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {checkedGrade,createMasteryStore,questionKey} from '../server/mastery.mjs';
import {lifecycleFixture,subjects,settle} from './helpers/tutor-lifecycle.mjs';

const testId='18e2ced5-fab7-4b23-ae07-abc99c94a610';
const question={id:'q-equation',topicId:'algebra',topicTitle:'Equations',difficulty:'hard',question:'How do equal operations solve 2x + 3 = 11, and why?',sourceIds:['notes']};
const key=questionKey(question),materials=[{id:'notes',name:'Original',text:subjects.algebra.source}];
const scope={provisional:true,latestPromptIsCanonical:false,previousAssistant:'Which operation would you try first?'};
const raw=(input,patch={})=>({questionId:question.id,topicId:question.topicId,sourceIds:['notes'],verdict:'incorrect',reasoningSufficient:false,assistanceUsed:false,assistanceCitationIds:[],targetAttempt:true,answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:[input.materials[0].excerpts[0].id],...patch});

test('provisional target identity is independent from correctness and requires two valid source-bound decisions',async t=>{
 for(const [name,pair,expected]of [
  ['wrong target answer',[{},{}],{checked:true,targetAttempt:true,verdict:'incorrect',unassisted:true}],
  ['correct reasoned target',[{verdict:'correct',reasoningSufficient:true},{verdict:'correct',reasoningSufficient:true}],{checked:true,targetAttempt:true,verdict:'correct',unassisted:true}],
  ['local scaffold',[{targetAttempt:false,verdict:'unclear'},{targetAttempt:false,verdict:'unclear'}],{checked:false,targetAttempt:false}],
  ['uncertain identity',[{targetAttempt:null,verdict:'unclear'},{targetAttempt:true}],null],
  ['identity disagreement',[{targetAttempt:false,verdict:'unclear'},{targetAttempt:true}],null],
  ['correctness disagreement',[{verdict:'partial'},{verdict:'incorrect'}],{checked:false,targetAttempt:true}],
  ['insufficient reasoning',[{verdict:'correct',reasoningSufficient:false},{verdict:'correct',reasoningSufficient:false}],{checked:false,targetAttempt:true}],
  ['unclear grade but known attempt',[{verdict:'unclear'},{verdict:'unclear'}],{checked:false,targetAttempt:true}],
 ])await t.test(name,async()=>{
  const calls=[];const result=await checkedGrade({question,answer:'x = 7, is that right?',materials,attemptContext:scope,organizer:{async organize(input,options){calls.push({input,options});return raw(input,pair[calls.length-1]);}}});
  assert.deepEqual(result,expected);assert.equal(calls.length,2);assert.deepEqual(calls[0].input,calls[1].input);assert.equal(calls[1].input.previousVerdict,undefined);
  assert.ok(calls.every(x=>x.options.schema.required.includes('targetAttempt')));assert.deepEqual(calls[0].options.schema.properties.targetAttempt,{type:['boolean','null']});
  assert.match(calls[0].options.instructions,/Earlier teaching or hints for a different practice problem alone do not establish assistance/);
 });
});

test('invalid or contradictory target review cannot dismiss a pending answer or consume an attempt',async()=>{
 for(const patch of [{targetAttempt:undefined},{targetAttempt:'true'},{targetAttempt:false,verdict:'correct'},{targetAttempt:null,verdict:'partial'},{targetAttempt:false,verdict:'unclear',sourceCitationIds:['foreign']},{targetAttempt:true,answerCitationIds:['fabricated']}]){
  let calls=0;const result=await checkedGrade({question,answer:'Subtract three.',materials,attemptContext:scope,organizer:{organize:async input=>{calls++;const value=raw(input,patch);if(value.targetAttempt===undefined)delete value.targetAttempt;return value;}}});
  assert.equal(result,null);assert.equal(calls,1);
 }
});

async function ledger(t){const dir=await mkdtemp(join(tmpdir(),'luna-provisional-ledger-')),path=join(dir,'mastery.json');t.after(()=>rm(dir,{recursive:true,force:true}));const store=createMasteryStore({path,shared:false});await store.setTopics(testId,[{id:question.topicId,title:question.topicTitle}]);return{store,path,read:async()=>JSON.parse(await readFile(path,'utf8')).tests[testId]};}
const candidate=(id,provisional=true,questionId=question.id,questionKeyValue=key)=>({id,questionId,questionKey:questionKeyValue,provisional});

test('definite non-target consumes nothing; recognized targets reserve in submission order',async t=>{
 const {store,read}=await ledger(t);
 await store.beginCandidate(testId,candidate('local'));await store.beginCandidate(testId,candidate('wrong'));await store.beginCandidate(testId,candidate('later',false));
 assert.deepEqual(await store.resolveCandidate(testId,{id:'local',targetAttempt:false}),{targetAttempt:false});
 assert.deepEqual((await read()).seenAttempts,{});
 assert.deepEqual(await store.resolveCandidate(testId,{id:'wrong',targetAttempt:true}),{targetAttempt:true,attempt:1,firstAttempt:true});
 assert.deepEqual(await store.resolveCandidate(testId,{id:'later',targetAttempt:true}),{targetAttempt:true,attempt:2,firstAttempt:false});
 assert.deepEqual((await read()).pendingCandidates,{});assert.equal((await read()).seenQuestions[key],2);
});

test('pending provisional and confirmed submissions survive restart without stealing later firstness from unrelated questions',async t=>{
 for(const provisional of [true,false])await t.test(String(provisional),async t=>{
  const {store,path,read}=await ledger(t);await store.beginCandidate(testId,candidate('interrupted',provisional));
  const reopened=createMasteryStore({path,shared:false});await reopened.beginCandidate(testId,candidate('retry',false));
  assert.deepEqual(await reopened.resolveCandidate(testId,{id:'retry',targetAttempt:true}),{targetAttempt:true,attempt:1,firstAttempt:false});
  const otherKey=questionKey({...question,question:'How do equal operations solve 4z − 5 = 19?'});
  await reopened.beginCandidate(testId,candidate('transfer',false,'q-transfer',otherKey));
  assert.deepEqual(await reopened.resolveCandidate(testId,{id:'transfer',targetAttempt:true}),{targetAttempt:true,attempt:1,firstAttempt:true});
  const saved=await read();assert.equal(Object.keys(saved.pendingCandidates).length,1);assert.equal(saved.pendingCandidates.interrupted.provisional,provisional);assert.doesNotMatch(JSON.stringify(saved.pendingCandidates),/2x|student|source|answer|text/);
 });
});

test('a queued cancellation guard is checked inside atomic candidate and score mutations',async t=>{
 const {store,read}=await ledger(t);await store.beginCandidate(testId,candidate('stale'));
 let valid=true;const pending=store.resolveCandidate(testId,{id:'stale',targetAttempt:true},{isCurrent:()=>valid});valid=false;
 assert.equal(await pending,null);assert.equal(Object.keys((await read()).seenAttempts).length,0);assert.ok((await read()).pendingCandidates.stale);
 const result=await store.record(testId,{id:'stale-event',questionId:question.id,questionKey:key,attempt:1,topicId:question.topicId,topicTitle:question.topicTitle,difficulty:'hard',verdict:'correct',firstAttempt:true,unassisted:true,checked:true},{isCurrent:()=>false});
 assert.equal(result.applied,false);assert.equal(result.canceled,true);assert.deepEqual((await read()).events,{});
});

test('later confirmed answer waits behind provisional review; assistance is fixed at submission and scope-only rejection leaves quota untouched',async t=>{
 for(const rejected of [false,true])await t.test(String(rejected),async t=>{
  const grades=[];let release;const f=await lifecycleFixture(t,{subject:subjects.algebra,bank:true,integrations:{intentRouter:{classify:text=>({answerAttempt:text==='candidate'?null:text==='later',answerAttemptProbability:text==='candidate'?.89:.99,answerAttemptThreshold:.9,requestsHelp:false,source:'jev'})},canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:true})},gradeAnswerImpl:input=>{grades.push(input);if(grades.length===1)return new Promise(resolve=>{release=resolve;});return Promise.resolve({checked:true,verdict:'correct',unassisted:true});}}});
  const q=f.questions.find(x=>x.difficulty==='hard');
  async function turn(text,result){const n=f.calls.length;f.commit(text);await f.waitFor(()=>f.calls.length>n);f.calls[n].resolve(result);await settle();return f.calls[n];}
  await turn('ask',{reply:q.question,questionId:q.id});await turn('scaffold',{reply:'Which operation first?'});
  const first=await turn('candidate',{reply:'I will review that submitted work.'});await f.waitFor(()=>Boolean(release));
  assert.equal(first.input.hintContext.answerReviewPending,true);assert.equal(first.input.hintContext.allowAnswerReview,false);assert.equal(first.input.hintContext.hintAllowed,false);
  assert.equal(f.problems.filter(x=>x.type==='attempt').length,0);assert.equal(grades[0].attemptContext.provisional,true);
  await turn('later',{reply:'I will check this answer too.'});await settle();assert.equal(grades.length,1);assert.equal(Object.keys((await f.ledger()).seenAttempts).length,0,'later confirmed candidate cannot jump earlier review');
  release(rejected?{checked:false,targetAttempt:false}:{checked:true,targetAttempt:true,verdict:'incorrect',unassisted:true});
  await f.waitFor(()=>f.problems.filter(x=>x.type==='result').length===(rejected?1:2));
  const events=Object.values((await f.ledger()).events).filter(x=>typeof x==='object');
  assert.deepEqual(events.map(x=>x.attempt),rejected?[1]:[1,2]);assert.deepEqual(events.map(x=>x.firstAttempt),rejected?[true]:[true,false]);
  assert.equal(grades[0].conversation.some(x=>x.content==='I will review that submitted work.'),false,'grading excludes later tutor feedback');
  assert.equal((await f.ledger()).topics[q.topicId].hardWins.length,rejected?1:0);
 });
});

test('later delivered hint never rewrites a provisional submission assistance snapshot, and stale source review never commits',async t=>{
 for(const cancelSource of [false,true])await t.test(String(cancelSource),async t=>{
  let release,gradingInput;const f=await lifecycleFixture(t,{subject:subjects.algebra,bank:true,integrations:{intentRouter:{classify:text=>({answerAttempt:text==='candidate'?null:false,answerAttemptProbability:.79,answerAttemptThreshold:.8,source:'jev',requestsHelp:false})},canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:true})},gradeAnswerImpl:input=>{gradingInput=input;return new Promise(resolve=>{release=resolve;});}}});
  const q=f.questions.find(x=>x.difficulty==='hard');f.commit('ask');f.calls[0].resolve({reply:q.question,questionId:q.id});await f.waitFor(()=>f.problems.some(x=>x.type==='asked'));
  f.commit('candidate');f.calls[1].resolve({reply:'I will review what you submitted.'});await f.waitFor(()=>Boolean(release),'provisional review starts');
  if(cancelSource){
   await f.packet({type:'materials',materials:[{id:'replacement',name:'New source',text:subjects.grammar.source}],indexStatus:'indexing'});assert.equal(gradingInput.signal.aborted,true);
  }else{
   f.speech.at(-1).options.onEnd();await f.packet({type:'hint'});await f.waitFor(()=>f.calls.length===3);f.calls[2].options.onText?.('Consider the additive term.');f.calls[2].resolve({reply:'Consider the additive term.'});await settle();
   assert.equal(gradingInput.conversation.some(x=>x.content==='Consider the additive term.'),false,'later hint absent from submission evidence');
  }
  release({checked:true,targetAttempt:true,verdict:'correct',unassisted:true});
  if(cancelSource){await settle();await f.store.flush();assert.equal(f.problems.filter(x=>x.type==='attempt').length,0);assert.equal(f.problems.filter(x=>x.type==='result').length,0);assert.equal(Object.keys((await f.ledger()).pendingCandidates).length,1);}
  else{await f.waitFor(()=>f.problems.some(x=>x.type==='result'));const result=Object.values((await f.ledger()).events).find(x=>typeof x==='object');assert.equal(result.unassisted,true,'assistance after this answer cannot retroactively disqualify it');assert.equal(result.firstAttempt,true);}
 });
});
