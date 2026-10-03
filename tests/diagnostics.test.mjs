import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiagnostics } from '../server/diagnostics.mjs';
import { checkedGrade } from '../server/mastery.mjs';
const id='18e2ced5-fab7-4b23-ae07-abc99c94a111', other='18e2ced5-fab7-4b23-ae07-abc99c94a112';
async function file(t){const dir=await mkdtemp(join(tmpdir(),'luna-diagnostics-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'events.json');}

test('timeline persists public decisions, keeps tests separate, and strips unrelated sensitive fields',async t=>{
  const path=await file(t),logger=createDiagnostics({file:path});
  logger.record(id,{type:'whiteboard.decision',turnId:4,details:{probability:.4,reason:'uncertain',authorization:'SECRET',materials:[{text:'PRIVATE SOURCE'}],reply:'Compare the rows.'}});
  logger.record(other,{type:'session.started',details:{sourceCount:2}});
  assert.equal(logger.clientRecord(id,{type:'whiteboard.shown',details:{reason:'forged'}}),false);
  assert.equal(logger.clientRecord(id,{type:'import.extracted',details:{fileName:'notes.pdf',characters:125,reply:'forged reply',boardJson:'forged board'}}),true);
  await logger.flush();
  const text=await readFile(path,'utf8');assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('PRIVATE SOURCE'));assert.ok(!text.includes('forged'));
  const restored=createDiagnostics({file:path}),snapshot=await restored.read(id);
  assert.equal(snapshot.events.length,2);assert.equal(snapshot.events[0].turnId,4);
  assert.equal(snapshot.events[1].origin,'client');assert.equal(snapshot.events[0].details.reply,'Compare the rows.');
  await restored.flush();
});

test('retention is bounded and explicitly reports lost older events',async t=>{
  const logger=createDiagnostics({file:await file(t),maxEvents:2,maxTotalEvents:3});
  for(let i=0;i<4;i++)logger.record(id,{type:'turn.started',turnId:i});
  logger.record(other,{type:'session.started'});logger.record(other,{type:'turn.started'});
  const snapshot=await logger.read(id);assert.equal(snapshot.events.length,1);assert.equal(snapshot.truncated,true);assert.equal(snapshot.omittedEvents,3);
  await logger.flush();
});

test('voice fidelity keeps raw public wording and separate match flags without trusting client claims',async t=>{
  const path=await file(t),logger=createDiagnostics({file:path});
  const details={reply:'Okay, compare the rows.',reason:'approved-body-with-neutral-ack',literalExact:false,normalizedExact:false,approvedBodyMatched:true,allowedPrefix:'Okay'};
  logger.record(id,{type:'voice.content-checked',turnId:4,details:{...details,audio:'PRIVATE_AUDIO',reasoning:'PRIVATE_REASONING'}});
  logger.clientRecord(id,{type:'import.completed',details:{literalExact:true,normalizedExact:true,approvedBodyMatched:true,allowedPrefix:'forged'}});
  await logger.flush();
  const snapshot=await logger.read(id);
  assert.deepEqual(snapshot.events[0].details,details);
  assert.deepEqual(snapshot.events[1].details,{});
  assert.doesNotMatch(await readFile(path,'utf8'),/PRIVATE_|forged/);
});

test('corrupt existing history is preserved and storage failures are visible',async t=>{
  const path=await file(t);await writeFile(path,'not json');
  const logger=createDiagnostics({file:path});logger.record(id,{type:'turn.started'});await logger.flush();
  const result=await logger.read(id);assert.match(result.storageError,/preserved/);assert.equal(result.events.length,1);assert.equal(await readFile(path,'utf8'),'not json');
});

test('retrieval context measurements persist without source bodies, private banks, queries or reasoning', async t => {
  const logger = createDiagnostics({ file: await file(t) });
  const counts = { sourceRevision: 'a'.repeat(64), chunkIds: ['c_original'], sourceCharacters: 50000, retrievedCharacters: 6000, contextCharacters: 13000, historyCharacters: 2200, recentTurns: 8, olderTurns: 4, bankCharacters: 3200 };
  logger.record(id, { type: 'tutor.context-built', turnId: 7, details: { ...counts, materials: [{ text: 'hidden-source' }], privateQuestionBank: { answer: 'hidden-answer' }, query: 'hidden-query', reasoning: 'hidden-reasoning' } });
  const snapshot = await logger.read(id);
  assert.deepEqual(snapshot.events[0].details, counts);
  assert.equal(snapshot.events[0].turnId, 7);
  assert.doesNotMatch(JSON.stringify(snapshot), /hidden-/);
  await logger.flush();
});

test('question and grading decisions retain public identities and eligibility but no private grading payload',async t=>{
  const logger=createDiagnostics({file:await file(t)});
  const details={questionId:'q-123',verdict:'correct',firstAttempt:true,unassisted:false,applied:false,attempt:1,reason:'validated-agreement'};
  logger.record(id,{type:'grading.completed',turnId:8,details:{...details,answer:'private-key',sourceQuotes:['private-source'],reasoning:'hidden'}});
  assert.deepEqual((await logger.read(id)).events[0].details,details);await logger.flush();
});

test('grading candidate decisions retain the exact gate and normalized confidence without student text or provider payload',async t=>{
 const path=await file(t),logger=createDiagnostics({file:path});
 const details={provisional:true,reason:'uncertain-attempt',questionId:'q-target',canonicalPromptActive:false,workingRelation:'current',attemptIntent:'unknown',helpIntent:'no',deadlineIntent:'no',answerAttemptProbability:.88,answerAttemptThreshold:.9,intentSource:'jev'};
 logger.record(id,{type:'grading.eligibility',turnId:12,details:{...details,studentUtterance:'PRIVATE_STUDENT',rawResponse:{token:'SECRET'},answer:'PRIVATE_ANSWER',reasoning:'PRIVATE_REASONING'}});
 assert.deepEqual((await logger.read(id)).events[0].details,details);await logger.flush();assert.doesNotMatch(await readFile(path,'utf8'),/PRIVATE|SECRET/);
});


test('current hint events retain grant and future availability separately without permit tokens',async t=>{
 const path=await file(t),logger=createDiagnostics({file:path});
 const details={candidateMatchesQuestion:false,candidateMatchProbability:.03,continuesWorkingProblem:null,questionId:'q-target',taskKind:'deliver-authorized-hint',hintNumber:3,hintLevel:'next-step',hintAllowed:true,hintsRemaining:1,hintAvailable:false,requiresAttempt:false,encounteredCount:4,workingProblemConfirmed:true};
 logger.record(id,{type:'hint.requested',turnId:13,details:{...details,permit:{id:'PRIVATE_PERMIT'},instruction:'PRIVATE_PROMPT',studentAnswer:'PRIVATE_ANSWER'}});
 await logger.flush();
 const restored=createDiagnostics({file:path});assert.deepEqual((await restored.read(id)).events[0].details,details);
 assert.doesNotMatch(await readFile(path,'utf8'),/PRIVATE_/);await restored.flush();
});


test('assistance decisions persist bounded resolved public excerpts, rejecting client spoofing and extra fields',async t=>{
 const path=await file(t),logger=createDiagnostics({file:path});
 const evidence=Array.from({length:6},(_,i)=>({id:`h-${i}`,turnIndex:i,quote:'Public assistant excerpt. '.repeat(40),turnId:99,privateAnswer:'PRIVATE_REFERENCE',reasoning:'PRIVATE_REASONING'}));
 const details={assistanceUsed:true,assistanceCitationIds:evidence.map(e=>e.id),assistanceEvidence:evidence};
 logger.record(id,{type:'grading.check',turnId:12,details:{...details,materials:'PRIVATE_SOURCE'}});
 logger.clientRecord(id,{type:'import.completed',details});
 await logger.flush();const snapshot=await logger.read(id),saved=snapshot.events[0].details;
 assert.equal(saved.assistanceUsed,true);assert.equal(saved.assistanceCitationIds.length,4);assert.equal(saved.assistanceEvidence.length,4);
 assert.deepEqual(Object.keys(saved.assistanceEvidence[0]),['id','turnIndex','quote']);assert.equal(saved.assistanceEvidence[0].quote.length,600);
 assert.deepEqual(snapshot.events[1].details,{});assert.doesNotMatch(await readFile(path,'utf8'),/PRIVATE_/);
});


test('real grader citation resolution reaches persisted assistance diagnostics with original public wording',async t=>{
 const logger=createDiagnostics({file:await file(t)}),help='Divide both sides by 2 to isolate x.';
 const grade=await checkedGrade({testId:id,question:{id:'q',topicId:'equations',sourceIds:['s'],question:'Solve 2x = 4 and explain why.',difficulty:'hard'},answer:'x = 2; dividing both sides preserves equality.',materials:[{id:'s',text:'Dividing both sides of 2x = 4 by 2 gives x = 2 and preserves equality.'}],conversation:[{role:'assistant',content:help}],organizer:{organize:async input=>({questionId:'q',topicId:'equations',sourceIds:['s'],verdict:'correct',reasoningSufficient:true,assistanceUsed:true,answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:[input.materials[0].excerpts[0].id],assistanceCitationIds:[input.assistanceEvidence[0].excerpts[0].id]})},onDecision:details=>logger.record(id,{type:'grading.check',details})});
 assert.equal(grade?.unassisted,false);
 const evidence=(await logger.read(id)).events.filter(event=>event.details.reason==='assistance-evidence');
 assert.equal(evidence.length,2);for(const event of evidence){assert.equal(event.details.assistanceEvidence[0].quote,help);assert.equal(event.details.assistanceEvidence[0].turnIndex,0);assert.equal(event.details.assistanceEvidence[0].id,event.details.assistanceCitationIds[0]);}
 await logger.flush();
});
