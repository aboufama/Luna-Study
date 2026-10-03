import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceActivityGuard } from '../src/voice-activity.mjs';
import { LiveVoiceSession } from '../src/live-voice.js';

function fixture() {
  let time=0,id=0;const timers=new Map(),pauses=[];
  const guard=createVoiceActivityGuard({onPause:reason=>pauses.push(reason),now:()=>time,
    schedule:(fn,delay)=>{timers.set(++id,{fn,at:time+delay});return id;},cancel:id=>timers.delete(id)});
  function advance(ms) {
    const end=time+ms;
    for(;;){const item=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!item||item[1].at>end)break;time=item[1].at;timers.delete(item[0]);item[1].fn();}
    time=end;
  }
  return {guard,pauses,timers,advance};
}

test('visible inactivity closes once after two minutes and cannot resume automatically',()=>{
  const {guard,pauses,advance,timers}=fixture();advance(119999);assert.deepEqual(pauses,[]);
  advance(1);assert.deepEqual(pauses,['inactive']);guard.setHidden(false);guard.touch();advance(240000);
  assert.equal(pauses.length,1);assert.equal(timers.size,0);
});

test('background pause waits 30 seconds, refreshed by actual user activity',()=>{
  const {guard,pauses,advance}=fixture();guard.setHidden(true);advance(25000);guard.touch();
  advance(29999);assert.deepEqual(pauses,[]);advance(1);assert.deepEqual(pauses,['background-idle']);
});

test('returning from a brief background visit gives time to continue studying',()=>{
  const {guard,pauses,advance}=fixture();guard.setHidden(true);advance(29000);guard.setHidden(false);
  advance(119999);assert.deepEqual(pauses,[]);advance(1);assert.deepEqual(pauses,['inactive']);
});

test('reasoning and playing a tutor response are not treated as inactivity',()=>{
  const {guard,pauses,advance}=fixture();guard.setBusy(true);advance(240000);assert.deepEqual(pauses,[]);
  guard.setBusy(false);advance(119999);assert.deepEqual(pauses,[]);advance(1);assert.deepEqual(pauses,['inactive']);
});

test('background answers finish, then close if the user does not respond',()=>{
  const {guard,pauses,advance}=fixture();guard.setHidden(true);guard.setBusy(true);advance(90000);
  assert.deepEqual(pauses,[]);guard.setBusy(false);advance(29999);assert.deepEqual(pauses,[]);
  advance(1);assert.deepEqual(pauses,['background-idle']);
});

test('manual cleanup cancels all guard timers',()=>{
  const {guard,pauses,advance,timers}=fixture();guard.setHidden(true);guard.stop();
  assert.equal(timers.size,0);advance(240000);assert.deepEqual(pauses,[]);
});

test('suspended background playback cannot hold a paid session busy indefinitely',()=>{
  const {guard,pauses,advance}=fixture();const session=new LiveVoiceSession({});
  session.activity=guard;session.context={state:'running'};session.onState('speaking');guard.setHidden(true);
  advance(25000);session.context.state='suspended';session.updateActivityState();advance(30000);
  assert.deepEqual(pauses,['background-idle']);
});

test('pausing stops media, closes the socket and sends an auditable stop reason',()=>{
  const calls=[];const session=new LiveVoiceSession({onPause:r=>calls.push(['paused',r]),onClose:()=>calls.push(['closed'])});
  session.send=value=>calls.push(['send',value]);session.activity={stop:()=>calls.push(['guard-stop'])};
  session.stream={getTracks:()=>[{stop:()=>calls.push(['track-stop'])}]};
  session.socket={close:()=>calls.push(['socket-close'])};
  session.context={close:()=>{calls.push(['context-close']);return Promise.resolve();}};
  session.pause('background-idle');session.pause('background-idle');
  assert.deepEqual(calls,[['paused','background-idle'],['send',{type:'stop',reason:'background-idle'}],['guard-stop'],['socket-close'],['track-stop'],['context-close'],['closed']]);
});
