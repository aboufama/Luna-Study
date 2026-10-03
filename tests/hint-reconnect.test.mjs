import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHintPolicy,createHintPolicyStore} from '../server/hint-policy.mjs';
import {createMasteryStore} from '../server/mastery.mjs';
import {sessionFixture,question,study} from './helpers/session-policy.mjs';

const hard={...question,difficulty:'hard'};
const current=f=>f.messages.findLast(x=>x.type==='practice-state')?.current;
const hints=f=>f.messages.findLast(x=>x.type==='hint-state');
async function infrastructure(t){
  const directory=await mkdtemp(join(tmpdir(),'luna-hint-reconnect-'));
  const path=join(directory,'mastery.json'),mastery=createMasteryStore({path,shared:false});
  const hintStore=createHintPolicyStore({now:()=>1_000_000});
  t.after(async()=>{await mastery.flush();await rm(directory,{recursive:true,force:true});});
  return {mastery,hintStore,async events(){await mastery.flush();return Object.values(JSON.parse(await readFile(path,'utf8')).tests[study.testId]?.events||{});}};
}
async function open(t,resources,{q=hard,start=study,gradeAnswerImpl=async()=>({checked:true,verdict:'correct',unassisted:true})}={}){
  let consumed=false;
  return sessionFixture(t,{start,greeting:{reply:q.question,questionId:q.id},intent:text=>({answerAttempt:text==='My full answer.',requestsHelp:false}),integrations:{
    createHintPolicyImpl:()=>createHintPolicy({store:resources.hintStore}),masteryStore:resources.mastery,gradeAnswerImpl,
    questionBank:{topics:()=>[{id:q.topicId,title:q.topicTitle}],context:()=>({topics:[{title:q.topicTitle,questions:[q]}]}),resolve:(_,id)=>id===q.id?q:null,consumeById:(_,id,reply)=>{if(id!==q.id||reply!==q.question||consumed)return[];consumed=true;return[q];},consume:()=>[],discard(){}},
    canvasRouter:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:true})},
  }});
}
async function disconnect(f){const closed=once(f.client,'close');f.client.terminate();await closed;for(let n=0;n<3;n++)await new Promise(resolve=>setImmediate(resolve));}
async function answer(f){await f.commit('My full answer.');await f.complete(f.calls.at(-1),'Thank you for your explanation.');await f.waitFor(()=>f.messages.some(x=>x.type==='mastery'&&x.mastery.topics.some(topic=>topic.score>0)),'persisted grade');}

test('delivered hint survives a real voice reconnect and regenerated canonical ID without earning an unassisted win',async t=>{
  for(const renamed of [false,true])await t.test(renamed?'new bank ID':'same bank ID',async t=>{
    const resources=await infrastructure(t),first=await open(t,resources);
    await first.packet({type:'hint'});await first.complete(first.calls[1],'Compare which side has more particles.');
    assert.equal(current(first).assisted,true);await disconnect(first);
    const q=renamed?{...hard,id:'regenerated-diffusion'}:hard;
    const second=await open(t,resources,{q,start:{...study,date:'2026-10-18'}});
    assert.equal(second.calls[0].input.conversation.length,0,'new socket has no fabricated prior transcript');
    assert.equal(current(second).questionId,q.id);assert.equal(current(second).assisted,true);
    assert.equal(hints(second).questionId,q.id);assert.equal(hints(second).remaining,2);
    await answer(second);
    const [event]=await resources.events();assert.equal(event.questionId,q.id);assert.equal(event.firstAttempt,true);assert.equal(event.unassisted,false,'trusted delivered exposure overrides an unassisted model double');
    assert.equal(second.messages.findLast(x=>x.type==='mastery').mastery.topics[0].score,30);
  });
});

test('an unexposed canceled hint does not taint a first answer after reconnect',async t=>{
  const resources=await infrastructure(t),first=await open(t,resources);
  await first.packet({type:'hint'});const generation=first.calls[1];await first.packet({type:'interrupt'});
  generation.options.onText('Canceled late hint');generation.resolve({reply:'Canceled late hint'});await first.flush();
  assert.equal(hints(first).remaining,3);await disconnect(first);
  const second=await open(t,resources,{q:{...hard,id:'reasked'}});
  assert.equal(current(second).assisted,false);assert.equal(hints(second).remaining,3);
  await answer(second);const [event]=await resources.events();assert.equal(event.firstAttempt,true);assert.equal(event.unassisted,true);
});

test('new source revision isolates old hint exposure while date-only changes do not',async t=>{
  const resources=await infrastructure(t),first=await open(t,resources);
  await first.packet({type:'hint'});await first.complete(first.calls[1]);
  await first.packet({type:'setup',date:'2026-10-20'});assert.equal(current(first).assisted,true);assert.equal(hints(first).remaining,2);
  await disconnect(first);
  const next={...study,materials:[{...study.materials[0],text:study.materials[0].text+' This revised original adds another example.'}]};
  const second=await open(t,resources,{start:next,q:{...hard,id:'revised-source-question'}});
  assert.equal(current(second).assisted,false);assert.equal(hints(second).remaining,3);
  await answer(second);assert.equal((await resources.events())[0].unassisted,true);
});

test('a hint delivered after submission never rewrites the captured prior eligibility snapshot',async t=>{
  const resources=await infrastructure(t);let finish,started;
  const began=new Promise(resolve=>{started=resolve;});
  const f=await open(t,resources,{gradeAnswerImpl:()=>new Promise(resolve=>{finish=resolve;started();})});
  await f.commit('My full answer.');await f.complete(f.calls[1],'Thank you for your explanation.');await began;
  await f.packet({type:'hint'});await f.complete(f.calls[2],'Consider the concentration on each side.');
  assert.equal(hints(f).remaining,2);assert.equal(current(f).assisted,true);
  finish({checked:true,verdict:'correct',unassisted:true});
  await f.waitFor(()=>f.messages.some(x=>x.type==='mastery'&&x.mastery.topics.some(topic=>topic.score>0)),'original submission grade');
  const [event]=await resources.events();assert.equal(event.firstAttempt,true);assert.equal(event.unassisted,true,'later exposure is not retroactive');
});
