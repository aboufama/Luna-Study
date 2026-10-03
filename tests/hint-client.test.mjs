import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveVoiceSession} from '../src/live-voice.js';
import {receiveHintState,hintView} from '../src/hint-state.mjs';

const state=extra=>({type:'hint-state',questionId:'canonical-question',remaining:3,cooldownUntil:null,retryAfterMs:0,available:true,busy:false,suggested:false,reason:'ready',...extra});
function client(){
  const sent=[],hints=[],presence=[],media=[];
  const session=new LiveVoiceSession({onHintState:state=>hints.push(state),onPresence:state=>presence.push(state),onError:()=>{}});
  session.ready=true;session.startSent=true;session.onState('listening');session.socket={readyState:WebSocket.OPEN,send:value=>sent.push(JSON.parse(value)),close:()=>media.push('socket-close')};
  session.stream={getTracks:()=>[{stop:()=>media.push('track-stop')}]};session.context={state:'running',close:async()=>media.push('context-close')};
  session.processor={port:{onmessage:()=>{}},disconnect:()=>media.push('worklet-stop')};session.test={testId:'test',materials:[]};
  return {session,sent,hints,presence,media};
}
test('server state is bounded; expired display countdown cannot locally grant a hint',()=>{
  const parsed=receiveHintState(state({remaining:2,available:false,reason:'cooldown',retryAfterMs:45000,suggested:true}),1000);
  assert.equal(hintView(parsed,{voiceState:'listening',now:1000}).seconds,45);
  assert.equal(hintView(parsed,{voiceState:'listening',now:46000}).seconds,0);
  assert.equal(hintView(parsed,{voiceState:'listening',now:46000}).available,false);
  assert.equal(hintView(parsed,{voiceState:'listening',now:1000}).description,hintView(parsed,{voiceState:'listening',now:45000}).description,'no changing second count in accessible description');
  for(const extra of [{remaining:4},{retryAfterMs:45001},{questionId:7},{reason:'invented'},{available:1}])assert.equal(receiveHintState(state(extra),0),null);
  for(const extra of [{questionId:null},{remaining:0},{busy:true},{retryAfterMs:1},{reason:'not-ready'}])assert.equal(receiveHintState(state(extra),0).available,false);
});
test('one click sends only the action; pending, busy, absent question and closed sessions cannot grant hints',()=>{
  const {session,sent,hints}=client();assert.equal(session.requestHint(),false);
  session.receiveHintState(state({suggested:true}));assert.equal(session.requestHint(),true);assert.equal(session.requestHint(),false);
  assert.deepEqual(sent,[{type:'hint'}]);assert.equal(hints.at(-1).remaining,3,'client never decrements allowance');assert.equal(hints.at(-1).pending,true);
  session.receiveHintState(state({remaining:2,available:false,reason:'cooldown',retryAfterMs:45000}));assert.equal(session.requestHint(),false);
  session.receiveHintState(state());session.onState('speaking');assert.equal(session.requestHint(),false);
  session.onState('listening');session.closed=true;assert.equal(session.requestHint(),false);
});
test('server idle pause stops capture/playback but preserves the socket and question state',()=>{
  const {session,sent,presence,media}=client();session.receiveHintState(state({remaining:2}));session.turnId=9;
  session.receivePause({type:'paused',reason:'student-idle',resumable:true});
  assert.equal(session.closed,false);assert.equal(session.paused,true);assert.equal(session.ready,false);assert.equal(session.voiceState,'paused');assert.equal(session.hintState.remaining,2);assert.equal(session.ignoredTurns.has(9),true);
  assert.deepEqual(media,['track-stop','worklet-stop','context-close']);assert.deepEqual(sent,[]);assert.deepEqual(presence.at(-1),{paused:true,resuming:false,error:''});
  session.receiveResumed();assert.equal(session.paused,true,'unsolicited resumed packet cannot turn capture back on');assert.equal(session.requestHint(),false);
});
test('explicit resume reacquires microphone first and waits for authoritative resumed before streaming',async()=>{
  const {session,sent,presence}=client();session.receivePause({reason:'student-idle',resumable:true});let opens=0;
  session.openMicrophone=async()=>{opens++;assert.deepEqual(sent,[]);session.context={state:'running',close:async()=>{}};return true;};
  assert.equal(await session.resume(),true);assert.equal(opens,1);assert.deepEqual(sent,[{type:'resume'}]);assert.equal(session.paused,true);assert.equal(session.ready,false);
  assert.equal(await session.resume(),false);assert.equal(opens,1);
  session.receiveResumed();assert.equal(session.paused,false);assert.equal(session.ready,true);assert.equal(session.voiceState,'listening');assert.deepEqual(presence.at(-1),{paused:false,resuming:false,error:''});
  session.close();
});
test('denied microphone on resume keeps the saved session paused and sends nothing',async()=>{
  const {session,sent,presence}=client();session.receivePause({reason:'student-idle',resumable:true});
  session.openMicrophone=async()=>{throw new DOMException('Denied','NotAllowedError');};
  assert.equal(await session.resume(),false);assert.equal(session.paused,true);assert.equal(session.resuming,false);assert.equal(session.closed,false);assert.deepEqual(sent,[]);assert.match(presence.at(-1).error,/Allow microphone access/);
});

test('only explicit foreground activity sends one throttled presence packet; paused/hidden sessions send none',t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible'}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
  const {session,sent}=client();session.noteActivity();assert.deepEqual(sent,[]);
  session.noteActivity({foreground:true});session.noteActivity({foreground:true});assert.deepEqual(sent,[{type:'activity'}]);
  session.lastForegroundActivity=-Infinity;document.visibilityState='hidden';session.noteActivity({foreground:true});assert.equal(sent.length,1);
  document.visibilityState='visible';session.paused=true;session.noteActivity({foreground:true});assert.equal(sent.length,1);
});


test('unconfirmed problem replaces an enabled hint state without losing allowance or authorizing a click',()=>{
  const {session,sent}=client();session.receiveHintState(state());assert.equal(hintView(session.hintState,{voiceState:'listening'}).available,true);
  session.receiveHintState(state({remaining:2,reason:'unconfirmed-problem',available:false}));
  assert.equal(session.hintState.remaining,2);assert.equal(session.hintState.reason,'unconfirmed-problem');
  const view=hintView(session.hintState,{voiceState:'listening'});assert.equal(view.available,false);assert.match(view.description,/confirm the current problem/);assert.equal(session.requestHint(),false);assert.deepEqual(sent,[]);
  assert.equal(receiveHintState(state({reason:'unconfirmed-problem',available:true})).available,false,'conflicting availability cannot bypass the reason');
  session.receiveHintState(state({remaining:2}));assert.equal(session.requestHint(),true);assert.deepEqual(sent,[{type:'hint'}]);
});
