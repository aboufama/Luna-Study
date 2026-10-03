import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFixture, question, study } from './helpers/session-policy.mjs';
import { checkedGrade } from '../server/mastery.mjs';
import { createJevIntentRouter } from '../server/jev-intent.mjs';
import { createOpenAILuna } from '../server/openai-luna.mjs';
import { lifecycleFixture, subjects, settle } from './helpers/tutor-lifecycle.mjs';
const lastHints=f=>f.messages.filter(m=>m.type==='hint-state').at(-1);
const lastPractice=f=>f.messages.filter(m=>m.type==='practice-state').at(-1);

test('natural narrower scaffold retains the working problem and three hints without pretending it is a canonical prompt',async t=>{
 const intents=[];const f=await sessionFixture(t,{integrations:{intentRouter:{classify(text,context){intents.push(context);return{answerAttempt:false,requestsHelp:false};}},canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:true})}}});
 await f.commit('Ask me the same problem without solving it.');await f.complete(f.calls[1],'What direction would you compare first?');assert.equal(lastPractice(f).current.questionId,question.id);assert.equal(lastHints(f).available,true);
 await f.packet({type:'hint'});assert.equal(f.calls[2].input.activeQuestion,null);assert.equal(f.calls[2].input.workingProblem.id,question.id);assert.equal(f.calls[2].input.gradingContext.canonicalPromptActive,false);assert.equal(f.calls[2].input.hintContext.hintAllowed,true);await f.complete(f.calls[2]);assert.equal(lastHints(f).remaining,2);
 await f.commit('One local step.');assert.equal(intents.at(-1).activeQuestion,question.question);assert.equal(intents.at(-1).latestPromptIsCanonical,false);
});

test('unrelated unqueued target clears working focus; uncertainty preserves quota but disables use until exact restatement',async t=>{
 for(const relation of [false,null])await t.test(String(relation),async t=>{
  const f=await sessionFixture(t,{integrations:{canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:relation})}}});await f.packet({type:'hint'});await f.complete(f.calls[1]);await f.advance(45001);await f.commit('Continue');await f.complete(f.calls[2],'Where is the nucleus located?');assert.equal(lastHints(f).available,false);await f.packet({type:'hint'});
  if(relation===false){assert.equal(f.calls.length,3);assert.equal(lastPractice(f).current,null);assert.equal(lastHints(f).questionId,null);}
  else{assert.equal(lastPractice(f).current.questionId,question.id);assert.equal(lastHints(f).remaining,2);const c=f.calls[3];assert.equal(c.input.readinessContext.trigger,'restore-problem');assert.equal(c.input.hintContext.hintAllowed,false);assert.equal(c.options.resolveQuestion(question.id),question.question);c.resolve({reply:question.question,questionId:question.id});await f.flush();assert.equal(lastHints(f).available,true);assert.equal(lastHints(f).remaining,2);assert.equal(f.consumed,1);}
 });
});

test('date and local-day edits preserve current problem, delivered hint count and an in-flight academic turn',async t=>{
 const f=await sessionFixture(t,{start:{...study,date:'2026-10-14'},integrations:{canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:true})}}});await f.packet({type:'hint'});await f.complete(f.calls[1]);await f.commit('Continue this problem');const ongoing=f.calls[2];await f.packet({type:'setup',date:'',localToday:'2026-10-02'});assert.equal(ongoing.options.signal.aborted,false);assert.equal(lastPractice(f).current.questionId,question.id);assert.equal(lastHints(f).remaining,2);await f.complete(ongoing);await f.commit('Next');assert.equal(f.calls[3].input.workingProblem.id,question.id);assert.equal(f.calls[3].input.date,'');assert.equal(f.calls[3].input.localToday,'2026-10-02');
});

test('scaffold substep and unknown intent earn no attempt; explicit full-target answer is independently graded against original canonical task',async t=>{
 const grades=[], checks=[];const f=await lifecycleFixture(t,{subject:subjects.algebra,bank:true,integrations:{intentRouter:{classify(text,context){if(text==='Subtract three.')assert.equal(context.latestPromptIsCanonical,false);return{answerAttempt:text===subjects.algebra.answer?true:text==='Unclear.'?null:false,requestsHelp:false};}},canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:true})},gradeAnswerImpl:async input=>{grades.push(input);return checkedGrade({...input,organizer:{organize:async request=>{checks.push(request);return {questionId:request.question.id,topicId:request.question.topicId,sourceIds:['notes'],verdict:'correct',reasoningSufficient:true,assistanceUsed:false,assistanceCitationIds:[],answerCitationIds:[request.answerExcerpts[0].id],sourceCitationIds:[request.materials[0].excerpts[0].id]};}}});}}});
 const q=f.questions.find(x=>x.difficulty==='hard');f.commit('Ask');f.calls[0].resolve({reply:q.question,questionId:q.id});await f.waitFor(()=>f.problems.some(x=>x.type==='asked'));
 f.commit('Ask again without solving');f.calls[1].resolve({reply:'What equal operation would you try first?'});await settle();
 for(const [i,text]of ['Subtract three.','Unclear.'].entries()){f.commit(text);f.calls[i+2].resolve({reply:'Keep considering the original target.'});await settle();}assert.equal(grades.length,0);assert.equal(f.problems.some(x=>x.type==='attempt'),false);
 f.commit(subjects.algebra.answer);f.calls[4].resolve({reply:'That addresses the original equation.'});await f.waitFor(()=>grades.length===1);await f.waitFor(()=>f.problems.some(x=>x.type==='result'));assert.equal(checks.length,2);assert.equal(grades[0].question.id,q.id);assert.equal(grades[0].question.question,q.question);assert.deepEqual(grades[0].materials,f.start.materials);assert.equal(f.problems.filter(x=>x.type==='attempt').length,1);
});

test('an incoming answer waits for pending same-problem classification, but source changes invalidate that decision',async t=>{
 let release;const f=await sessionFixture(t,{integrations:{canvasRouter:{classify:async(_text,context)=>context.workingProblem?new Promise(resolve=>{release=resolve;}):({needsCanvas:false})}}});await f.commit('Start same problem');await f.complete(f.calls[1],'What direction would you consider first?');await f.commit('My full answer');assert.equal(f.calls.length,2,'new generation waits until the previous public prompt has a known target');release({needsCanvas:false,continuesWorkingProblem:true});await f.flush();assert.equal(f.calls.length,3);assert.equal(f.calls[2].input.workingProblem.id,question.id);
 f.calls[2].resolve({reply:'Which first step would you use?'});await f.flush();await f.packet({type:'materials',materials:[{id:'other',name:'New',text:'A new source.'}],indexStatus:'indexing'});release({needsCanvas:false,continuesWorkingProblem:true});await f.flush();assert.equal(lastPractice(f).current,null);assert.equal(lastHints(f).questionId,null);
});

test('clearing optional date does not abort or discard an already queued canonical grade',async t=>{
 let finish,input;const f=await lifecycleFixture(t,{bank:true,integrations:{intentRouter:{classify:text=>({answerAttempt:text===subjects.biology.answer,requestsHelp:false})},gradeAnswerImpl:args=>{input=args;return new Promise(resolve=>{finish=resolve;});}}});const q=f.questions.find(x=>x.difficulty==='hard');f.commit('Ask');f.calls[0].resolve({reply:q.question,questionId:q.id});await f.waitFor(()=>f.problems.some(x=>x.type==='asked'));f.commit(subjects.biology.answer);f.calls[1].resolve({reply:'Let us check that.'});await f.waitFor(()=>Boolean(finish));await f.packet({type:'setup',date:''});assert.equal(input.signal.aborted,false);finish({checked:true,verdict:'correct',unassisted:true});await f.waitFor(()=>f.problems.some(x=>x.type==='result'));
});

test('question-bank failure cannot leave an untracked scaffold marked as a canonical scoring prompt',async t=>{
 for(const malformed of [false,true])await t.test(String(malformed),async t=>{
  const f=await sessionFixture(t,{integrations:{questionBank:{topics:()=>[],context:()=>null,consumeById:()=>[question],consume(){if(malformed)return{bad:true};throw Error('bank unavailable');}},canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:true})}}});
  await f.commit('Scaffold');await f.complete(f.calls[1],'What local step would you try?');await f.commit('Continue');assert.equal(f.calls[2].input.activeQuestion,null);assert.equal(f.calls[2].input.workingProblem.id,question.id);assert.equal(f.calls[2].input.gradingContext.canonicalPromptActive,false);
 });
});

test('confirmed setup clarification does not reactivate uncertain scope until canonical wording is actually restated',async t=>{
 let clarify=false;const f=await sessionFixture(t,{integrations:{intentRouter:{classify:()=>({requestsHelp:false,answerAttempt:false,setupClarification:clarify})},canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:null})}}});
 await f.commit('Continue');await f.complete(f.calls[1],'What next step might you use?');assert.equal(lastHints(f).available,false);assert.equal(lastHints(f).reason,'unconfirmed-problem');
 clarify=true;await f.commit('Which givens?');await f.complete(f.calls[2],'Which part of the givens is unclear?');assert.equal(lastHints(f).available,false,'setup classification is not canonical restatement');assert.equal(f.calls[2].input.workingProblem.answer,undefined);
 await f.commit('Restate it exactly');await f.complete(f.calls[3],question.question);assert.equal(lastHints(f).available,true);assert.equal(f.consumed,1);
});

test('wrong or incomplete original-target answers requesting a check reach both graders while scaffold-only and uncertain inputs do not',async t=>{
 const submitted=['x = 7, is that right?','x = 4, can you check?'],checks=[],grades=[],requests=[];
 const intentRouter=createJevIntentRouter({env:{TYPESAFE_API_KEY:'mock'},fetchImpl:async(_url,options)=>{
  const body=JSON.parse(options.body);requests.push(body);
  const attempt=submitted.includes(body.state.student_utterance)?.99:body.state.student_utterance==='Maybe.'?.88:.01;
  return{ok:true,json:async()=>({answers:{answer_attempt:{type:'noul',noul:attempt},requests_help:{type:'noul',noul:submitted.includes(body.state.student_utterance)?.99:.01},exam_deadline:{type:'noul',noul:.01}}})};
 }});
 const f=await lifecycleFixture(t,{subject:subjects.algebra,bank:true,integrations:{intentRouter,canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:true})},gradeAnswerImpl:async input=>{
  grades.push(input);return checkedGrade({...input,organizer:{organize:async (request,options)=>{assert.match(options.instructions,/pure help request with no assessable target answer/);assert.match(options.instructions,/requests checking remains assessable/);checks.push(request);return{questionId:request.question.id,topicId:request.question.topicId,sourceIds:['notes'],verdict:input.attemptContext?'unclear':input.answer===submitted[0]?'incorrect':'partial',...(input.attemptContext?{targetAttempt:false}:{}),reasoningSufficient:false,assistanceUsed:false,assistanceCitationIds:[],answerCitationIds:[request.answerExcerpts[0].id],sourceCitationIds:[request.materials[0].excerpts[0].id]};}}});
 }}});
 const q=f.questions.find(x=>x.difficulty==='hard');
 async function turn(text,reply){const n=f.calls.length;f.commit(text);await f.waitFor(()=>f.calls.length>n);f.calls[n].resolve(reply);await settle();return f.calls[n];}
 await turn('Ask',{reply:q.question,questionId:q.id});await turn('Same question',{reply:'What operation might you try first?'});
 await turn('Subtract three.',{reply:'Keep considering the target.'});await turn('Maybe.',{reply:'Consider the original equation.'});
 await f.waitFor(()=>f.decisions.some(x=>x.type==='grading.skipped'&&x.details.reason==='not-original-target-attempt'));assert.equal(grades.length,1);assert.equal(f.problems.filter(x=>x.type==='attempt').length,0);
 for(const [i,answer]of submitted.entries()){
  const call=await turn(answer,{reply:'I will check that submitted answer.'});
  assert.equal(call.input.currentProblem.latestStudent.content,answer,'latest evidence remains verbatim');
  assert.equal(call.input.hintContext.answerAttemptReceived,true);
  await f.waitFor(()=>f.problems.filter(x=>x.type==='result').length===i+1);
 }
 assert.equal(checks.length,6);assert.equal(grades.length,3);assert.ok(grades.every(value=>value.question.id===q.id&&value.question.question===q.question));
 assert.equal(f.problems.filter(x=>x.type==='attempt').length,2);assert.deepEqual((await f.ledger()).topics[q.topicId].hardWins,[]);assert.equal((await f.ledger()).topics[q.topicId].mastered,false);
 const gates=f.decisions.filter(x=>x.type==='grading.eligibility').map(x=>x.details);
 assert.ok(gates.some(x=>x.reason==='not-an-attempt'&&x.answerAttemptProbability===.01&&!x.canonicalPromptActive));
 assert.ok(gates.some(x=>x.reason==='queued-provisional-review'&&x.answerAttemptProbability===.88&&x.answerAttemptThreshold===.9));
 assert.equal(gates.filter(x=>x.reason==='queued-target-attempt'&&x.helpIntent==='yes').length,2);
 assert.ok(requests.filter(x=>submitted.includes(x.state.student_utterance)).every(x=>x.state.latest_prompt_is_canonical===false));
});

test('production adapter restores a consumed canonical ID after bank refill without consuming again or resetting hint quota',async t=>{
 let consumed=0;const inputs=[];
 const outputs=[`<ask>${question.id}</ask>`,'<say>Consider which side has more particles.</say>','<say>Which direction would you compare first?</say>',`<ask>${question.id}</ask>`];
 const bank={topics:()=>[],context:()=>({topics:[{questions:consumed?[{...question,id:'new-slot',question:'What is a concentration gradient?'}]:[question]}]}),consume:()=>[],consumeById:(_input,id,reply)=>id===question.id&&reply===question.question&&!consumed++?[question]:[],resolve:(_input,id)=>!consumed&&id===question.id?question:null};
 const f=await sessionFixture(t,{integrations:{questionBank:bank,canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:null})},createLunaFastImpl:()=>createOpenAILuna({env:{OPENAI_API_KEY:'mock'},fetchImpl:async(_url,options)=>{
  const payload=JSON.parse(options.body);inputs.push(JSON.parse(typeof payload.input==='string'?payload.input:payload.input[0].content));const output=outputs.shift();assert.equal(typeof output,'string');
  const events=[{type:'response.output_text.delta',delta:output},{type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}]}}];
  return new Response(events.map(x=>`data: ${JSON.stringify(x)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
 }})}});
 await f.packet({type:'hint'});await f.waitFor(()=>lastHints(f)?.remaining===2&&!lastHints(f)?.busy);await f.advance(45001);
 await f.commit('Continue');await f.waitFor(()=>lastHints(f)?.reason==='unconfirmed-problem');
 await f.commit('help');await f.waitFor(()=>lastHints(f)?.available===true);
 assert.equal(consumed,1);assert.equal(lastHints(f).remaining,2);assert.equal(lastPractice(f).current.questionId,question.id);
 assert.equal(inputs.at(-1).workingProblem.id,question.id);assert.equal(inputs.at(-1).readinessContext.trigger,'restore-problem');assert.equal(inputs.at(-1).hintContext.hintAllowed,false);assert.ok(inputs.at(-1).privateQuestionBank.topics[0].questions.every(x=>x.id!==question.id));assert.equal(outputs.length,0);
});
