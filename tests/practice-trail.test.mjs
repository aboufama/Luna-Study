import test from 'node:test';
import assert from 'node:assert/strict';
import {createPracticeTrail} from '../server/practice-trail.mjs';
const question={id:'q1',question:'Which way does the force point?',topicTitle:'Forces',answer:'Private answer must never appear.'};
test('canonical restatement and a problem switch keep the active unattempted question current',()=>{
  const trail=createPracticeTrail();
  const membrane={id:'membrane',question:'Why is a cell membrane called a selective boundary, and how do passive and active transport differ?',topicTitle:'Cell transport'};
  const algebra={id:'algebra',question:'How do equal operations solve 2x + 3 = 11, and why are those operations valid?',topicTitle:'Equations'};
  const expectCurrent=question=>{
    const state=trail.sync({question,attempts:0,assisted:false});
    assert.equal(state.current.questionId,question.id);
    assert.equal(state.current.status,'current','an active question has not been set aside');
    assert.equal(state.current.attempts,0,'restatement and switching do not invent attempts');
    return state;
  };
  expectCurrent(membrane);
  assert.deepEqual(expectCurrent(membrane).recent,[],'repeating the canonical question does not create another entry');
  const switched=expectCurrent(algebra);
  assert.equal(switched.recent[0].questionId,membrane.id);
  assert.equal(switched.recent[0].status,'set-aside');
  const revisited=expectCurrent(membrane);
  assert.equal(revisited.recent[0].questionId,algebra.id);
  assert.equal(revisited.recent[0].status,'set-aside');
  const inactive=trail.sync(null);
  assert.equal(inactive.current,null);
  assert.ok(inactive.recent.every(item=>item.status==='set-aside'));
});

test('switching and revisiting preserve attempted and independently checked outcomes',()=>{
  for(const status of ['attempted','reviewed','completed']){
    const trail=createPracticeTrail();
    trail.sync({question});trail.attempted(question.id);
    if(status!=='attempted')trail.checked(question.id,{checked:true,verdict:status==='completed'?'correct':'partial'});
    trail.sync({question:{...question,id:'q2'}});
    assert.equal(trail.snapshot().recent[0].status,status);
    const revisited=trail.sync({question,attempts:0});
    assert.equal(revisited.current.status,status,'activation cannot erase an attempt or checked grade');
    assert.equal(revisited.current.attempts,1);
    trail.sync(null);
    assert.equal(trail.snapshot().recent.find(item=>item.questionId===question.id).status,status);
  }
});

test('practice trail exposes asked problems, not private answers or invented completed status',()=>{
  const trail=createPracticeTrail();trail.sync({question,attempts:0,assisted:false});
  assert.equal(trail.snapshot().current.question,question.question);assert.equal(JSON.stringify(trail.snapshot()).includes('Private answer'),false);
  trail.sync({question:{...question,id:'q2',question:'What is a vector?'}});
  assert.equal(trail.snapshot().recent[0].status,'set-aside','skipping an unattempted problem is not an attempt');
  trail.attempted('q1');assert.equal(trail.snapshot().recent[0].status,'attempted');
  trail.checked('q1',{verdict:'correct',checked:false});assert.equal(trail.snapshot().recent[0].status,'attempted');
  trail.checked('q1',{verdict:'correct',checked:true});assert.equal(trail.snapshot().recent[0].status,'completed');
  assert.deepEqual(trail.clear(),{current:null,recent:[]});
});
test('trail survives current-question updates and bounds public history without changing a score',()=>{
  const trail=createPracticeTrail({limit:3});
  for(let i=0;i<4;i++)trail.sync({question:{...question,id:'q'+i}});
  assert.equal(trail.snapshot().recent.length,2);assert.equal(trail.snapshot().current.questionId,'q3');
  trail.sync({question:{...question,id:'q3'},attempts:2,assisted:true});assert.equal(trail.snapshot().current.attempts,2);
  trail.checked('q3',{checked:true,verdict:'partial'});trail.sync(null);
  assert.equal(trail.snapshot().current,null);assert.equal(trail.snapshot().recent.at(-1).status,'reviewed');
});
