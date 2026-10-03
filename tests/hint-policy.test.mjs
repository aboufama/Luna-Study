import test from 'node:test';
import assert from 'node:assert/strict';
import {createHintPolicy,createHintPolicyStore,isHintRequest,hintRequestReply,hintTurnTask} from '../server/hint-policy.mjs';

test('an unconfirmed working problem never invites use of a disabled Hint button',()=>{
  const reply=hintRequestReply({reason:'unconfirmed-problem'});
  assert.match(reply,/confirm the current problem/);
  assert.doesNotMatch(reply,/use the Hint button/i);
});

const scope={testId:'18e2ced5-fab7-4b23-ae07-abc99c94a110',sourceRevision:'source-revision-one'};
const question={id:'question-one',topicId:'algebra',question:'If 2x + 3 = 11, what is x?',sourceIds:['original'],answer:'x = 4'};
function fixture(options={}){
  let now=100_000;const store=createHintPolicyStore({now:()=>now,...options}),policy=createHintPolicy({store});
  policy.setScope(scope);policy.activate(question);
  return {policy,store,advance:ms=>{now+=ms;},now:()=>now};
}
function deliver(policy){const request=policy.reserve();assert.equal(request.allowed,true);assert.equal(policy.commit(request.permit),true);policy.cancel(request.permit);return request.permit;}

test('only the button message has the request shape; client counts and claimed permission are rejected',()=>{
  assert.equal(isHintRequest({type:'hint'}),true);
  for(const value of [null,[],{type:'help'},{type:'hint',remaining:3},{type:'hint',questionId:question.id},{type:'hint',allowed:true},{type:'hint',cooldownUntil:0}])assert.equal(isHintRequest(value),false);
  const {policy}=fixture();
  for(const text of ['Please help.','Just tell me the answer.','I do not know.','Solve it for me.']){
    assert.equal(policy.context().hintAllowed,false,text);
    assert.match(hintRequestReply(policy.status()),/Hint button/);
    assert.equal(policy.status().remaining,3,'a verbal request or invitation has no state mutation');
  }
});

test('three graduated permits are enforced with45-second cooldown and the cap never regenerates',()=>{
  const {policy,advance,now}=fixture();
  assert.deepEqual(policy.status(),{questionId:question.id,remaining:3,cooldownUntil:null,retryAfterMs:0,available:true,busy:false,suggested:false,reason:'ready'});
  for(const [index,level]of ['orientation','strategy','next-step'].entries()){
    const request=policy.reserve();assert.equal(request.allowed,true);assert.equal(request.state.remaining,2-index);assert.equal(request.state.busy,true);
    assert.equal(policy.reserve().allowed,false,'double clicks cannot grant simultaneous hints');
    const context=policy.context(request.permit);assert.equal(context.hintAllowed,true);assert.equal(context.hintNumber,index+1);assert.equal(context.hintLevel,level);assert.equal(context.allowAnswerReview,false);
    assert.equal(policy.commit(request.permit),true);assert.equal(policy.commit(request.permit),true,'commit is idempotent');
    assert.equal(policy.context(request.permit).hintsUsed,index+1);
    policy.cancel(request.permit);
    assert.equal(policy.status().cooldownUntil,now()+45_000);assert.equal(policy.status().remaining,2-index);
    assert.equal(policy.reserve({remaining:3,cooldownUntil:0}).allowed,false,'client-looking values do not alter quota');
    advance(44_999);assert.equal(policy.status().retryAfterMs,1);assert.equal(policy.status().available,false);
    advance(1);assert.equal(policy.status().available,index<2);assert.equal(policy.status().reason,index<2?'ready':'exhausted');
  }
  advance(10*60_000);assert.equal(policy.status().remaining,0);assert.equal(policy.reserve().allowed,false);
  assert.equal(policy.context().requiresAttempt,true);assert.match(hintRequestReply(policy.status()),/three hints/);
});

test('failed or interrupted undelivered hints refund the reservation; partial delivery permanently counts',()=>{
  const {policy,advance}=fixture();
  const undelivered=policy.reserve();assert.equal(policy.status().remaining,2);
  assert.equal(policy.cancel(undelivered.permit),true);assert.equal(policy.status().remaining,3);assert.equal(policy.status().available,true);
  assert.equal(policy.commit(undelivered.permit),false,'late generation cannot expose a canceled permit');
  const partial=policy.reserve();policy.commit(partial.permit);policy.cancel(partial.permit);
  assert.equal(policy.status().remaining,2);assert.equal(policy.status().reason,'cooldown');
  assert.equal(policy.cancel(partial.permit),false,'cancel does not refund a delivered hint');
  advance(45_000);assert.equal(policy.status().available,true);
  const stalled=policy.reserve();advance(120_000);
  assert.equal(policy.context(stalled.permit).hintAllowed,false);assert.equal(policy.commit(stalled.permit),false);assert.equal(policy.status().remaining,2,'expired unused reservations do not spend a hint');
});

test('each current grant stays actionable even when the button has no later hints available',()=>{
  const {policy,advance}=fixture();
  for(let ordinal=1;ordinal<=3;ordinal++){
    assert.equal(policy.context().hintAvailable,true);
    assert.equal(hintTurnTask(policy.context()),undefined,'ordinary speech never becomes a Hint event');
    const {permit}=policy.reserve(),context=policy.context(permit);
    assert.equal(context.hintsRemaining,4-ordinal,'the current undelivered grant remains owed');
    assert.equal(context.requiresAttempt,false,'the third granted hint cannot demand an attempt instead');
    assert.equal(context.hintAvailable,false,'no concurrent button grant');
    assert.equal(policy.status().remaining,3-ordinal,'button reflects later availability');
    const task=hintTurnTask(context);
    assert.equal(task.kind,'deliver-authorized-hint');assert.equal(task.questionId,question.id);
    assert.equal(task.hintNumber,ordinal);assert.equal(task.hintLevel,['orientation','strategy','next-step'][ordinal-1]);
    assert.match(task.instruction,/clicked Hint NOW/);
    policy.commit(permit);
    assert.equal(policy.context(permit).requiresAttempt,false,'streaming delivery retains its valid grant');
    policy.cancel(permit);
    assert.equal(hintTurnTask(policy.context(permit)),undefined,'canceled permits cannot create a current event');
    assert.equal(policy.context().hintAvailable,false);assert.equal(policy.context().retryAfterMs,45_000);
    advance(45_000);
  }
  assert.equal(policy.context().hintsRemaining,0);
  assert.equal(policy.context().requiresAttempt,true);
  assert.equal(policy.context().hintAvailable,false);
});

test('opaque permits cannot be forged, reused across sessions, or used after changing question or sources',()=>{
  const {policy,store}=fixture(),request=policy.reserve();
  assert.equal(policy.commit({...request.permit}),false);assert.equal(policy.context({...request.permit}).hintAllowed,false);
  const other=createHintPolicy({store});other.setScope(scope);other.activate(question);
  assert.equal(other.reserve().allowed,false,'one shared question cannot have concurrent session permits');
  assert.equal(other.commit(request.permit),false);assert.equal(other.cancel(request.permit),false);
  policy.activate({...question,id:'question-two'});assert.equal(policy.commit(request.permit),false);assert.equal(policy.context(request.permit).hintAllowed,false);
  policy.activate(question);assert.equal(policy.status().remaining,3);
  const stale=policy.reserve();policy.setScope({...scope,sourceRevision:'updated-source'});policy.activate(question);
  assert.equal(policy.commit(stale.permit),false);assert.equal(policy.status().remaining,3);
  policy.setScope(scope);policy.activate(question);assert.equal(policy.status().remaining,3,'canceled work did not charge the old revision');
});

test('pause and reconnect preserve scoped quota and cooldown while other tests and source revisions remain independent',()=>{
  const {policy,store,advance}=fixture();deliver(policy);policy.activate(null);
  assert.equal(policy.status().reason,'no-question');policy.activate(question);assert.equal(policy.status().remaining,2);
  policy.reset();
  const resumed=createHintPolicy({store});resumed.setScope({...scope,testId:scope.testId.toUpperCase()});resumed.activate(question);
  assert.equal(resumed.status().remaining,2);assert.equal(resumed.status().retryAfterMs,45_000);
  advance(45_000);deliver(resumed);assert.equal(resumed.status().remaining,1);
  for(const next of [{...scope,testId:'18e2ced5-fab7-4b23-ae07-abc99c94a111'},{...scope,sourceRevision:'other-originals'}]){
    const isolated=createHintPolicy({store});isolated.setScope(next);isolated.activate(question);assert.equal(isolated.status().remaining,3);
  }
  resumed.activate({...question,id:'different-question',question:'If 3y = 12, what is y?'});assert.equal(resumed.status().remaining,3);
  resumed.activate(question);assert.equal(resumed.status().remaining,1);
});

test('readiness, foreground activity, missing questions, and changed identity cannot grant permission',()=>{
  const {policy}=fixture();
  assert.equal(policy.reserve({ready:false}).state.reason,'not-ready');assert.equal(policy.reserve({busy:true}).state.reason,'busy');
  assert.equal(policy.status({suggested:true}).suggested,true);assert.equal(policy.context().hintAllowed,false,'a glow offers the button, never grants it');
  assert.equal(policy.status().remaining,3);
  policy.activate({...question,question:'A different problem with the same ID?'});assert.equal(policy.status().reason,'no-question');
  assert.equal(policy.reserve().allowed,false);
  policy.activate(question);assert.equal(policy.status().remaining,3);
  policy.setScope({testId:'invalid',sourceRevision:'x'});policy.activate(question);assert.equal(policy.status().reason,'no-question');
});

test('only an agreed correct or incorrect target answer permits full review; partials and hints do not',()=>{
  const {policy}=fixture();deliver(policy);
  for(const result of [{verdict:'correct'},{checked:false,verdict:'correct'},{checked:true,verdict:'partial'},{checked:true,verdict:'unclear'},{checked:true,verdict:'help-request'}]){
    assert.equal(policy.markAttempt(question,result),false);assert.equal(policy.context().allowAnswerReview,false);
  }
  assert.equal(policy.markAttempt({...question,id:'foreign'},{checked:true,verdict:'correct'}),false);
  assert.equal(policy.markAttempt({...question,sourceIds:['different']},{checked:true,verdict:'correct'}),false);
  assert.equal(policy.markAttempt(question,{checked:true,verdict:'incorrect'}),true);assert.equal(policy.context().allowAnswerReview,true);
  policy.activate({...question,id:'next-question',question:'If 3y = 12, what is y?'});assert.equal(policy.context().allowAnswerReview,false);
  policy.activate(question);assert.equal(policy.context().allowAnswerReview,true);
});

test('masking preserves every queued question and metadata while hiding unattempted reference answers',()=>{
  const {policy}=fixture(),next={...question,id:'next',question:'What is 2 + 2?',answer:'4'};
  const bank={version:1,topics:[{topicId:'algebra',title:'Algebra',questions:[question,next]}]},original=structuredClone(bank);
  const hidden=policy.maskBank(bank);assert.deepEqual(bank,original,'source bank remains private and unchanged');
  assert.deepEqual(hidden.topics[0].questions.map(q=>q.id),[question.id,next.id]);
  assert.equal(hidden.topics[0].questions[0].answer,undefined);assert.equal(hidden.topics[0].questions[1].answer,undefined);
  assert.equal(hidden.topics[0].title,'Algebra');assert.deepEqual(hidden.topics[0].questions[0].sourceIds,question.sourceIds);
  const hint=policy.reserve();assert.equal(policy.maskBank(bank).topics[0].questions[0].answer,undefined,'a hint permit is not solution permission');policy.cancel(hint.permit);
  policy.markAttempt(question,{checked:true,verdict:'partial'});
  assert.equal(policy.maskBank(bank).topics[0].questions[0].answer,undefined,'partial credit never exposes the reference answer');
  policy.markAttempt(question,{checked:true,verdict:'correct'});
  const after=policy.maskBank(bank);assert.equal(after.topics[0].questions[0].answer,question.answer);assert.equal(after.topics[0].questions[1].answer,undefined);
});

test('shared retention expires and is bounded without claiming restart durability',()=>{
  const {policy,store,advance}=fixture({ttlMs:100,maxEntries:2});deliver(policy);
  advance(101);const expired=createHintPolicy({store});expired.setScope(scope);expired.activate(question);assert.equal(expired.status().remaining,3);
  deliver(expired);
  for(const id of ['second','third']){const other=createHintPolicy({store});other.setScope(scope);other.activate({...question,id,question:`What is the ${id} problem?`});}
  const evicted=createHintPolicy({store});evicted.setScope(scope);evicted.activate(question);assert.equal(evicted.status().remaining,3,'old entries can expire or leave the bounded LRU');
});

test('canonical target quota and committed exposure survive bank IDs, with public IDs local to each session',()=>{
  const {policy,store,advance}=fixture();
  const reserved=policy.reserve();assert.equal(policy.deliveredHints(question),0);policy.cancel(reserved.permit);
  deliver(policy);assert.equal(policy.deliveredHints(question),1);
  const renamed={...question,id:'regenerated-id',question:'  IF 2x + 3 = 11, WHAT IS x?  '};
  const reconnected=createHintPolicy({store});reconnected.setScope(scope);reconnected.activate(renamed);
  assert.equal(reconnected.status().questionId,renamed.id);assert.equal(policy.status().questionId,question.id);
  assert.equal(reconnected.status().remaining,2);assert.equal(reconnected.deliveredHints(renamed),1);
  advance(45_000);deliver(reconnected);advance(45_000);
  policy.activate({...question,id:'third-bank-id'});deliver(policy);
  assert.equal(reconnected.status().remaining,0);assert.equal(reconnected.reserve().allowed,false);
  assert.equal(reconnected.deliveredHints(renamed),3);
  reconnected.activate({...renamed,question:'If 2x - 3 = 11, what is x?'});
  assert.equal(reconnected.status().reason,'no-question','public ID reuse cannot change the operator');
  reconnected.activate(renamed);assert.equal(reconnected.status().remaining,0);
});

test('canceled reservations have no exposure and source/test scope never inherits committed hints',()=>{
  const {policy,store}=fixture();const grant=policy.reserve();policy.reset();
  const resumed=createHintPolicy({store});resumed.setScope(scope);resumed.activate(question);
  assert.equal(resumed.deliveredHints(question),0);assert.equal(resumed.status().remaining,3);
  assert.equal(policy.commit(grant.permit),false);deliver(resumed);
  for(const next of [{...scope,sourceRevision:'changed-originals'},{...scope,testId:'18e2ced5-fab7-4b23-ae07-abc99c94a111'}]){
    resumed.setScope(next);resumed.activate(question);assert.equal(resumed.deliveredHints(question),0);
  }
  resumed.setScope(scope);resumed.activate(question);assert.equal(resumed.deliveredHints(question),1);
  resumed.setScope(null);assert.equal(resumed.deliveredHints(question),0);
});
