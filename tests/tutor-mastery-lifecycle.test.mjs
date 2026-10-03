import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedGrade,emptyTestMastery,applyMasteryEvent,publicMastery,masteryScopeContext,questionKey,validateGrade} from '../server/mastery.mjs';
import {lifecycleFixture,subjects,settle} from './helpers/tutor-lifecycle.mjs';

for(const [name,subject]of Object.entries(subjects))test(`${name}: written help remains grading evidence and cannot become an unassisted hard win even if both grader doubles say unassisted`,async t=>{
  const gradeCalls=[];
  const f=await lifecycleFixture(t,{subject,bank:true,integrations:{
    intentRouter:{classify:text=>({requestsHelp:text==='Please give me a hint.',answerAttempt:text===subject.answer,examDeadline:false})},
    canvasRouter:{classify:async(_,c)=>({needsCanvas:c.candidateTextOnly===true,candidateMatchesQuestion:c.currentQuestion?.question===subject.question&&c.candidateBoard?.text===subject.hint})},
    gradeAnswerImpl:args=>checkedGrade({...args,organizer:{async organize(input){gradeCalls.push(input);return{questionId:input.question.id,topicId:input.question.topicId,sourceIds:['notes'],verdict:'correct',reasoningSufficient:true,assistanceUsed:false,assistanceCitationIds:[],answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:[input.materials[0].excerpts[0].id]};}}}),
  }});
  const q=f.questions.find(q=>q.difficulty==='hard');
  f.commit('Ask me one practice question.');f.calls[0].resolve({reply:q.question,questionId:q.id});
  await f.waitFor(()=>f.problems.some(p=>p.type==='asked'));
  f.commit('Please give me a hint.');assert.equal(f.calls.length,1,'voice help must invite the button');
  f.speech.at(-1).options.onEnd();await f.packet({type:'hint'});await f.waitFor(()=>f.calls.length===2);
  f.calls[1].resolve({reply:'Use the written hint.',board:{title:subject.topic,mode:'patch',blocks:[{id:'hint',type:'text',content:subject.hint}]}});
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.visible));
  await f.packet({type:'canvas-select',boardRevision:f.messages.find(m=>m.type==='canvas').board.revision,blockId:'hint'});
  assert.equal(f.problems.filter(p=>p.type==='attempt').length,0,'selecting written help never counts as a spoken answer');
  f.commit(subject.answer);f.calls[2].resolve({reply:'That addresses the question.'});
  await f.waitFor(()=>f.decisions.some(e=>e.type==='grading.completed'));
  assert.equal(gradeCalls.length,2);assert.deepEqual(gradeCalls[0],gradeCalls[1]);
  assert.ok(gradeCalls[0].conversation.some(turn=>turn.content===`Shown on the whiteboard: ${subject.hint}`));
  const ledger=await f.ledger(),topic=ledger.topics[q.topicId];
  assert.equal(topic.score,30,'checked correct practice still earns the existing score increment');assert.deepEqual(topic.hardWins,[]);assert.equal(topic.mastered,false);
  const event=Object.values(ledger.events).find(value=>typeof value==='object');assert.equal(event.firstAttempt,true);assert.equal(event.unassisted,false);assert.equal(event.attempt,1);
  assert.equal(f.problems.filter(p=>p.type==='attempt').length,1);assert.equal(f.problems.filter(p=>p.type==='result').length,1);
  assert.equal(JSON.stringify(f.messages).includes('PRIVATE REFERENCE'),false);
});

test('a grade finishing after sources are replaced cannot publish mastery or regain a first attempt',async t=>{
  let finishGrade,gradeInput;
  const f=await lifecycleFixture(t,{bank:true,integrations:{intentRouter:{classify:text=>({answerAttempt:text===subjects.biology.answer,requestsHelp:false})},gradeAnswerImpl:input=>{gradeInput=input;f.notify();return new Promise(resolve=>{finishGrade=resolve;});}}});
  const q=f.questions.find(q=>q.difficulty==='hard');f.commit('Ask.');f.calls[0].resolve({reply:q.question,questionId:q.id});await f.waitFor(()=>f.problems.some(p=>p.type==='asked'));
  f.commit(subjects.biology.answer);f.calls[1].resolve({reply:'Let us check that.'});await f.waitFor(()=>Boolean(finishGrade));
  await f.packet({type:'materials',materials:[{id:'new-notes',name:'Grammar notes',text:subjects.grammar.source}],indexStatus:'indexing'});
  assert.equal(gradeInput.signal.aborted,true);finishGrade({checked:true,verdict:'correct',unassisted:true});await settle();
  assert.equal(f.problems.some(p=>p.type==='result'),false);assert.equal(f.messages.some(m=>m.type==='mastery'&&m.mastery.overall>0),false);
  const reservation=await f.store.reserveAttempt(f.start.testId,{questionId:'new-id-same-question',questionKey:questionKey(q),attempt:1});assert.equal(reservation.firstAttempt,false);
});

test('subject-local hard wins and complete indexed coverage remain distinct from whole-course completion',()=>{
  const state=emptyTestMastery();state.activeTopics=Object.entries(subjects).map(([id,s])=>({id,title:s.topic}));
  let sequence=0;
  const event=(topic,question,patch={})=>({id:`event-${++sequence}`,questionId:`q-${sequence}`,questionKey:questionKey({topicId:topic,question}),attempt:1,topicId:topic,topicTitle:subjects[topic].topic,difficulty:'hard',verdict:'correct',checked:true,firstAttempt:true,unassisted:true,...patch});
  for(const topic of Object.keys(subjects)){
    for(let n=0;n<3;n++)applyMasteryEvent(state,event(topic,`${subjects[topic].question} Variant ${n}`));
    const score=publicMastery(state);assert.equal(score.topics.find(t=>t.id===topic).mastered,true);
    assert.equal(masteryScopeContext(score).courseCoverage,'unverified');
  }
  assert.equal(publicMastery(state).overall,100);assert.equal(masteryScopeContext(publicMastery(state)).allCurrentTopicsMastered,true);
  assert.equal(masteryScopeContext(publicMastery(state),[...state.activeTopics,{id:'chemistry',title:'Reaction equations'}]).allCurrentTopicsMastered,false);
  const assisted=emptyTestMastery();for(const topic of Object.keys(subjects))for(let n=0;n<4;n++)applyMasteryEvent(assisted,event(topic,`Distinct assisted ${topic} ${n}`,{unassisted:false}));
  assert.equal(publicMastery(assisted).overall,90);assert.ok(publicMastery(assisted).topics.every(t=>!t.mastered));assert.equal(masteryScopeContext(publicMastery(assisted)).allCurrentTopicsMastered,false);
});

test('cross-subject grading citations tolerate line wrapping but preserve mathematical signs, grammar words and source identity',()=>{
  for(const [id,subject]of Object.entries(subjects)){
    const question={id:`q-${id}`,topicId:id,sourceIds:['notes']},answer=subject.answer;
    const grade={questionId:question.id,topicId:id,sourceIds:['notes'],verdict:'correct',reasoningSufficient:true,assistanceUsed:false,answerQuotes:[answer],sourceQuotes:[{sourceId:'notes',quote:subject.source}]};
    const materials=[{id:'notes',text:subject.source.replaceAll(' ',' \n ')}];
    assert.ok(validateGrade(grade,question,answer,materials));
    for(const modified of [subject.source.replace(/[A-Za-z]/,'Z'),`${subject.source} Invented conclusion.`,subject.source.replace(' ', ' NOT ')])assert.equal(validateGrade({...grade,sourceQuotes:[{sourceId:'notes',quote:modified}]},question,answer,materials),null);
    assert.equal(validateGrade({...grade,sourceQuotes:[{sourceId:'different-source',quote:subject.source}]},question,answer,materials),null);
  }
  const state=emptyTestMastery(),base={id:'one',questionId:'same-q',questionKey:questionKey({topicId:'physics',question:'N − mg = 0?'}),attempt:1,topicId:'physics',topicTitle:'Forces',difficulty:'hard',verdict:'correct',checked:true,firstAttempt:true,unassisted:true};
  applyMasteryEvent(state,base);assert.equal(applyMasteryEvent(state,{...base,id:'duplicate'}).applied,false);assert.equal(publicMastery(state).overall,30);
});
