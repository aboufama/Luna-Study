import test from 'node:test';
import assert from 'node:assert/strict';
import {tutorTurnTask} from '../server/tutor-turn-task.mjs';

test('current academic response is anchored to the actual latest message without fabricating progress',()=>{
 const text='My answer is x = 7. Is that right?';
 const task=tutorTurnTask({text,readinessContext:{ready:true},studentIntent:{answerAttempt:null},hintContext:{questionId:'x',answerReviewPending:true}});
 assert.equal(task.latestStudentMessage,text);assert.equal(task.kind,'respond-to-student');
 assert.equal(task.reviewQuestionId,'x');assert.equal(task.allowWorkedReview,false);
 assert.equal(task.verdict,undefined);assert.equal(task.studentCompletedStep,undefined);
});

test('worked review requires both a checked attempt on an identified question and a current help request',()=>{
 for(const checked of [false,true])for(const help of [false,true,null])for(const questionId of [null,'x']){
  const task=tutorTurnTask({text:'Can we review it?',readinessContext:{ready:true},studentIntent:{requestsHelp:help},hintContext:{questionId,allowAnswerReview:checked}});
  assert.equal(task.allowWorkedReview,Boolean(questionId)&&checked&&help===true);
 }
});

test('actual Hint event takes precedence over earlier student conversation without unlocking review',()=>{
 const context={questionId:'x',hintAllowed:true,hintNumber:3,hintLevel:'next-step',allowAnswerReview:false};
 const task=tutorTurnTask({text:'Earlier answered calculator preference.',readinessContext:{ready:true},hintContext:context});
 assert.equal(task.kind,'deliver-authorized-hint');assert.equal(task.latestStudentMessage,undefined);
 assert.match(task.levelGoal,/last work the student actually supplied/);
 assert.equal(task.allowWorkedReview,undefined);
});

test('setup and system lead-in events are not mislabeled as new student messages',()=>{
 for(const args of [{},{text:'hello',readinessContext:{ready:false}},{text:null,readinessContext:{ready:true}},{text:'  ',readinessContext:{ready:true}}])assert.equal(tutorTurnTask(args),undefined);
});
