import test from 'node:test';
import assert from 'node:assert/strict';
import { createTutorSessionTiming } from '../server/tutor-session-timing.mjs';
function clock() { let at = 0, next = 0; const tasks = new Map(); return { now: () => at, setTimeout(fn, ms) { const id = ++next; tasks.set(id, { fn, at: at + ms }); return id; }, clearTimeout: id => tasks.delete(id), advance(ms) { const until = at + ms; let runs = 0; while (true) { const found = [...tasks].filter(([,v]) => v.at <= until).sort((a,b) => a[1].at - b[1].at)[0]; if (!found) break; assert.ok(++runs < 100, 'timer must not spin'); tasks.delete(found[0]); at = found[1].at; found[1].fn(); } at = until; } }; }
test('study-ready coalesces by source and waits for playback and speaking to settle', () => {
 const c=clock(),events=[];const p=createTutorSessionTiming({...c,onLead:key=>events.push(key)});
 p.requestLead('old');p.requestLead('new');c.advance(5000);assert.deepEqual(events,[]);
 p.update({blocked:false,playbackUntil:6000});c.advance(1299);assert.deepEqual(events,[]);c.advance(1);assert.deepEqual(events,['new']);
 p.requestLead('new');c.advance(1000);assert.deepEqual(events,['new']);
 p.requestLead('last');p.cancelLead({consumed:true});p.requestLead('last');c.advance(1000);assert.deepEqual(events,['new']);p.close();
});
test('presence waits sixty seconds after playback, checks once and pauses after thirty more',()=>{
 const c=clock(),events=[];let p; p=createTutorSessionTiming({...c,onCheckIn(){events.push('check');p.update({blocked:true});},onPause(){events.push('pause');}});
 p.update({blocked:false,playbackUntil:5000});c.advance(64999);assert.deepEqual(events,[]);c.advance(1);assert.deepEqual(events,['check']);
 c.advance(90000);assert.deepEqual(events,['check'],'generation/playback never expires presence');p.update({blocked:false,playbackUntil:c.now()+1000});c.advance(30999);assert.deepEqual(events,['check']);c.advance(1);assert.deepEqual(events,['check','pause']);p.close();
});
test('genuine activity cancels a check-in and starts a fresh idle period; paused never wakes itself',()=>{
 const c=clock(),events=[];const p=createTutorSessionTiming({...c,onCheckIn:()=>events.push('check'),onPause:()=>events.push('pause')});p.update({blocked:false});c.advance(60000);p.activity();c.advance(59999);assert.deepEqual(events,['check']);c.advance(1);assert.deepEqual(events,['check','check']);p.update({paused:true});c.advance(1e6);assert.equal(events.length,2);p.update({paused:false});p.activity();c.advance(60000);assert.equal(events.length,3);p.close();
});
