import test from 'node:test';
import assert from 'node:assert/strict';
import {runQualitySession} from '../benchmarks/tutor-quality-sessions.mjs';
import {equations,biology,materials,topics,pairedScript,sustainedScript} from '../benchmarks/tutor-quality-fixtures.mjs';

test('30-minute virtual quiz preserves hint permission, assistance, canonical questions and pause/resume',async()=>{
  const result=await runQualitySession();
  assert.equal(result.status,'completed',JSON.stringify(result.errors));assert.equal(result.simulatedMinutes,30);
  const step=id=>result.steps.find(value=>value.id===id);
  assert.equal(step('answer-bypass').requests,0,'a confirmed pre-attempt answer request gets a deterministic invitation, not a model answer');
  assert.match(step('answer-bypass').replies.join(' '),/Hint button/);
  assert.equal(step('answer-bypass').hintState.remaining,3);
  assert.equal(step('clarify-problem').hintState.questionId,step('start-equation').hintState.questionId,'clarification retains the same public problem');
  assert.deepEqual(['hint-one','hint-two','hint-three'].map(id=>step(id).hintState.remaining),[2,1,0]);
  assert.equal(step('duplicate-hint').requests,0);assert.equal(step('duplicate-hint').hintState.reason,'cooldown');
  assert.equal(step('hint-cap').requests,0);assert.equal(step('hint-cap').hintState.reason,'exhausted');
  assert.equal(step('topic-change').hintState.remaining,3);assert.notEqual(step('topic-change').hintState.questionId,step('hint-cap').hintState.questionId);
  const grades=result.gradeResults;
  assert.equal(grades[0].question,equations[0].question);assert.equal(grades[0].grade.verdict,'incorrect');
  assert.equal(grades[1].question,equations[0].question);assert.equal(grades[1].grade.verdict,'correct');
  const checkedEvents=Object.values(result.masteryLedger.events).filter(value=>typeof value==='object');
  assert.equal(checkedEvents.length,3);
  assert.deepEqual(checkedEvents.slice(0,2).map(value=>value.unassisted),[false,false]);
  assert.equal(checkedEvents[1].firstAttempt,false,'retry cannot become a first hard win');
  assert.equal(checkedEvents[2].unassisted,true);
  assert.ok(Object.values(result.masteryLedger.topics).every(topic=>!topic.mastered));
  assert.ok(result.messages.some(message=>message.type==='paused'&&message.resumable));
  assert.ok(result.messages.some(message=>message.type==='resumed'));
  assert.equal(result.steps.filter(value=>value.skipped).length,0);
  assert.equal(result.requests.filter(value=>value.kind==='grading').length,6,'all three grades use two independent checks');
  assert.ok(result.requests.filter(value=>value.kind==='tutor').flatMap(value=>value.inputSummary.bankQuestions).every(question=>!question.hasReferenceAnswer));
});

test('extended30-minute quiz earns mastery only after three distinct unassisted hard wins and resumes after new indexing',async()=>{
  const script=pairedScript.filter(item=>item.at<=380_000);
  let at=430_000;
  for(const [index,equation]of equations.slice(1).entries()){
    script.push({id:`next-hard-${index+2}`,at,text:'Ask me the next hard equation question.'});
    script.push({id:`earned-hard-${index+2}`,at:at+40_000,text:`My answer is: ${equation.answer}`});at+=100_000;
  }
  script.push({id:'biology-switch',at:760_000,text:'Let us change topics. Ask me the hard membrane question.'},{id:'biology-answer',at:800_000,text:`My answer is: ${biology.answer}`},{id:'manual-pause',at:850_000,packet:{type:'pause'}},{id:'resume',at:910_000,packet:{type:'resume'}});
  const nextMaterials=materials.map(source=>({...source,id:`${source.id}-revised`})),nextTopics=topics.map(topic=>({...topic,sourceIds:topic.sourceIds.map(id=>`${id}-revised`)}));
  script.push({id:'index-new-material',at:1_000_000,index:{materials:nextMaterials,topics:nextTopics}});
  const result=await runQualitySession({script});
  assert.equal(result.status,'completed',JSON.stringify(result.errors));assert.equal(result.simulatedMinutes,30);
  const events=Object.values(result.masteryLedger.events).filter(value=>typeof value==='object'),equationEvents=events.filter(event=>event.topicTitle==='Equations');
  assert.equal(equationEvents.length,5,'one helped problem with two attempts and three fresh hard problems');
  const originalTopic=result.masteryLedger.topics[equationEvents[0].topicId];
  assert.equal(originalTopic.hardWins.length,3);assert.equal(originalTopic.score,100);assert.equal(originalTopic.mastered,true);
  assert.equal(equationEvents[0].unassisted,false);assert.equal(equationEvents[1].firstAttempt,false);
  const beforeIndex=result.steps.find(step=>step.id==='biology-answer').mastery;
  assert.equal(beforeIndex.overall,65,'mastering algebra does not imply mastering all current topics');
  const indexed=result.steps.find(step=>step.id==='index-new-material');
  assert.equal(indexed.replies.length,1,'ready indexing automatically starts one new grounded turn');
  assert.ok(result.messages.some(message=>message.type==='transcript'&&message.final&&message.stepId==='index-new-material'));
  assert.equal(indexed.mastery.overall,0,'new source revision cannot inherit old coverage scores');
  assert.equal(result.requests.some(request=>request.inputSummary?.sourceIds.some(id=>id.endsWith('-revised'))),true);
});

test('measured scaffold keeps working hints and date changes without making a substep a canonical grade',async()=>{
  const script=[
    pairedScript[0],
    {id:'local-substep',at:30_000,text:'My answer is: I subtracted 3.'},
    {id:'calendar-only',at:40_000,packet:{type:'setup',date:''}},
    {id:'hint-after-scaffold',at:50_000,packet:{type:'hint'}},
    {id:'whole-target',at:105_000,text:`My answer is: ${equations[0].answer}`},
    {id:'different-canonical',at:125_000,text:"Let's change topics now. Ask me the hard cell membrane and transport question."},
    {id:'different-unqueued',at:145_000,text:'Ask an unrelated recall question.'},
    {id:'no-stale-hint',at:165_000,packet:{type:'hint'}},
  ];
  const result=await runQualitySession({script,virtualDurationMs:180_000,
    tutorOutputImpl(input){
      const text=input.conversation?.findLast(turn=>turn.role==='user')?.content||'';
      if(text.startsWith('Please start with the hard equation'))return '<say>Start with 2x + 3 = 11. What equal operation would you try first, and what would the equation become?</say>';
      if(text==='My answer is: I subtracted 3.')return '<say>Can you explain why the operation preserves equality?</say>';
      if(text==='Ask an unrelated recall question.')return '<say>Where is the nucleus located?</say>';
    },
    intentRouterImpl:{classify(text,context){return{requestsHelp:false,setupClarification:false,examDeadline:false,answerAttempt:Boolean(context.activeQuestion)&&text.startsWith('My answer is')&&!(context.latestPromptIsCanonical===false&&text==='My answer is: I subtracted 3.')};}},
    canvasRouterImpl:{async classify(reply){return {needsCanvas:false,continuesWorkingProblem:!reply.includes('Where is the nucleus located?')};}},
  });
  assert.equal(result.status,'completed',JSON.stringify(result.errors));
  const step=id=>result.steps.find(item=>item.id===id),id=step('start-equation').hintState.questionId;
  assert.ok(id,'same-problem scaffold retains a working identity');
  assert.equal(step('local-substep').hintState.questionId,id);
  assert.equal(step('calendar-only').hintState.questionId,id);
  assert.equal(step('hint-after-scaffold').hintState.questionId,id);
  assert.equal(step('hint-after-scaffold').hintState.remaining,2);
  const scaffoldRequest=result.requests.find(request=>request.stepId==='local-substep'&&request.kind==='tutor');
  assert.equal(scaffoldRequest.inputSummary.activeQuestionId,null,'scaffold is not an exact canonical prompt');
  assert.equal(scaffoldRequest.inputSummary.workingProblem.id,id);
  assert.equal(result.gradeResults.length,1,'a local substep never reaches canonical grading');
  assert.equal(result.gradeResults[0].question,equations[0].question);
  assert.equal(result.gradeResults[0].grade.verdict,'correct');
  const events=Object.values(result.masteryLedger.events).filter(value=>typeof value==='object');
  assert.equal(events[0].unassisted,false,'delivered hint stays attached to the original question');
  assert.notEqual(step('different-canonical').hintState.questionId,id);
  assert.equal(step('different-canonical').hintState.remaining,3);
  assert.equal(step('different-unqueued').hintState.questionId,null,'a new target does not inherit the previous problem');
  assert.equal(step('no-stale-hint').requests,0);
});

test('sustained virtual study keeps academic exchanges through minute29 without false completion',async()=>{
  const result=await runQualitySession({script:sustainedScript});
  assert.equal(result.status,'completed',JSON.stringify(result.errors));
  assert.equal(result.simulatedMinutes,30);
  const academic=sustainedScript.filter(step=>step.text);
  assert.ok(academic.length>=24);
  assert.equal(academic.at(-1).at,29*60_000);
  assert.ok(academic.slice(1).every((step,index)=>step.at-academic[index].at<=120_000),'meaningful exchanges span the whole session, with no large idle padding');
  assert.equal(result.steps.filter(step=>step.skipped).length,0);
  assert.ok(result.messages.some(message=>message.type==='paused'));
  assert.ok(result.messages.some(message=>message.type==='resumed'));
  const events=Object.values(result.masteryLedger.events).filter(value=>typeof value==='object');
  assert.ok(events.length>=8,'sustained answers reached actual source/evidence validation with deterministic decision doubles');
  const originalAlgebra=result.masteryLedger.topics[events.find(event=>event.topicTitle==='Equations').topicId];
  assert.equal(originalAlgebra.hardWins.length,2,'helped problems and repeated reviews cannot become new unassisted hard wins');
  assert.equal(originalAlgebra.mastered,false);
  assert.ok(Object.values(result.masteryLedger.topics).every(topic=>!topic.mastered));
});

test('uncertain local substep cannot consume the later genuine canonical first attempt',async()=>{
  const script=[pairedScript[0],
    {id:'uncertain-substep',at:45_000,text:'My answer is: I subtracted 3.'},
    {id:'uncertain-wrong-target',at:90_000,text:'My answer is x = 7, because I subtracted 3 and stopped.'},
    {id:'uncertain-correct-target',at:135_000,text:`My answer is: ${equations[0].answer}`},
  ];
  const result=await runQualitySession({script,virtualDurationMs:155_000,
    tutorOutputImpl(input){const text=input.conversation?.findLast(turn=>turn.role==='user')?.content||'';if(text.startsWith('Please start with'))return '<say>What equal operation would you try first?</say>';},
    intentRouterImpl:{classify(text){return {requestsHelp:false,setupClarification:false,examDeadline:false,answerAttempt:text.startsWith('My answer is')?null:false,answerAttemptProbability:text.startsWith('My answer is')?.89:.03,answerAttemptThreshold:.9,source:'jev'};}},
    canvasRouterImpl:{async classify(){return {needsCanvas:false,continuesWorkingProblem:true};}},
  });
  assert.equal(result.status,'completed',JSON.stringify(result.errors));
  assert.equal(result.gradeResults.length,3);
  assert.deepEqual(result.gradeResults.map(item=>item.grade?.targetAttempt),[false,true,true]);
  assert.equal(result.gradeResults[0].grade.checked,false);
  const events=Object.values(result.masteryLedger.events).filter(value=>typeof value==='object');
  assert.equal(events.length,2,'rejected local substep must not become a persisted target attempt');
  assert.deepEqual(events.map(event=>event.attempt),[1,2]);
  assert.deepEqual(events.map(event=>event.firstAttempt),[true,false]);
  assert.deepEqual(events.map(event=>event.verdict),['incorrect','correct']);
  assert.ok(events.every(event=>event.questionId===events[0].questionId));
  assert.equal(result.requests.filter(request=>request.kind==='grading').length,6,'each provisional candidate receives two independent source checks');
});
