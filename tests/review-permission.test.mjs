import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMasteryStore} from '../server/mastery.mjs';
import {sessionFixture,question,study} from './helpers/session-policy.mjs';

test('partial work still scores, but a shortcut request cannot generate a full solution; a checked wrong target permits review',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'luna-review-permission-')),path=join(directory,'mastery.json'),mastery=createMasteryStore({path,shared:false});
 t.after(async()=>{await mastery.flush();await rm(directory,{recursive:true,force:true});});
 const partial='Particles move somehow, but I have not decided which direction.',wrong='They diffuse from lower concentration to higher concentration.',shortcut='Please give me the complete worked answer.';
 const graded=[];
 const f=await sessionFixture(t,{intent:text=>({answerAttempt:[partial,wrong].includes(text),requestsHelp:text===shortcut}),integrations:{
  masteryStore:mastery,questionBank:{topics:()=>[{id:question.topicId,title:question.topicTitle}],context:()=>({topics:[{title:question.topicTitle,questions:[question]}]}),resolve:(_,id)=>id===question.id?question:null,consumeById:(_,id,reply)=>id===question.id&&reply===question.question?[question]:[],consume:()=>[],discard(){}},
  canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:true})},
  gradeAnswerImpl:async input=>{graded.push(input.answer);return{checked:true,verdict:input.answer===partial?'partial':'incorrect',unassisted:true};},
 }});
 await f.commit(partial);await f.complete(f.calls.at(-1),'You have identified motion; now specify the direction.');
 await f.waitFor(()=>f.messages.some(m=>m.type==='mastery'&&m.mastery.topics[0]?.score===3),'partial score');
 const before=f.calls.length;
 await f.commit(shortcut);await f.flush();
 assert.equal(f.calls.length,before,'pure solution request after partial work uses no unconstrained tutor generation');
 assert.match(f.speech.at(-1).text,/Hint button/);
 assert.equal(f.messages.findLast(m=>m.type==='hint-state').remaining,3);
 await f.packet({type:'hint'});const hint=f.calls.at(-1);
 assert.equal(f.calls.length,before+1);assert.equal(hint.input.hintContext.hintAllowed,true);
 assert.equal(hint.input.hintContext.allowAnswerReview,false);
 assert.equal(hint.input.privateQuestionBank.topics[0].questions[0].answer,undefined);
 await f.complete(hint,'Compare the concentration on the two sides.');
 const priorGrades=f.messages.filter(m=>m.type==='mastery').length;
 await f.commit(wrong);await f.complete(f.calls.at(-1),'Check the direction against the concentration gradient.');
 await f.waitFor(()=>graded.length===2&&f.messages.filter(m=>m.type==='mastery').length>priorGrades&&f.messages.findLast(m=>m.type==='mastery')?.mastery.topics[0]?.score===0,'incorrect score');
 const afterWrong=f.calls.length;await f.commit(shortcut);
 assert.equal(f.calls.length,afterWrong+1,'a checked contradicted target answer permits a requested review');
 const review=f.calls.at(-1);assert.equal(review.input.hintContext.allowAnswerReview,true);
 assert.equal(review.input.hintContext.hintAllowed,false,'full review is not an extra Hint grant');
 assert.equal(review.input.privateQuestionBank.topics[0].questions[0].answer,question.answer);
 await f.complete(review,'Particles diffuse from higher concentration to lower concentration.');
 await mastery.flush();const saved=JSON.parse(await readFile(path,'utf8')).tests[study.testId];
 const events=Object.values(saved.events).filter(value=>typeof value==='object');
 assert.deepEqual(events.map(e=>[e.verdict,e.attempt]),[['partial',1],['incorrect',2]],'the permission change never suppresses or adds scoring attempts');
 assert.equal(saved.topics[question.topicId].score,0);assert.equal(saved.topics[question.topicId].mastered,false);
});
