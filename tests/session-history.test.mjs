import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,stat,rm } from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createSessionHistory,pcmMetrics,returningGreeting,validateSessionReview} from '../server/session-history.mjs';
async function fixture(t,options={}){const directory=await mkdtemp(path.join(tmpdir(),'luna-history-test-'));const file=path.join(directory,'data','history.json');const manager=createSessionHistory({env:{},file,reviewDelayMs:1,...options});t.after(async()=>{await manager.close().catch(()=>{});await rm(directory,{recursive:true,force:true});});return {manager,file,directory};}
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Timed out.');}
const empty={notes:[],resume:null};
test('session lifecycle records only public fields, exact durations and idempotent review',async t=>{
 let time=Date.parse('2026-10-02T12:00:00Z'),calls=0;
 const {manager,file}=await fixture(t,{now:()=>time,organizer:{organize:async input=>{calls++;assert.equal(JSON.stringify(input).includes('PRIVATE-ANSWER'),false);return {notes:[{text:'Wants to practice matrices.',evidence:[{turnId:input.transcript[0].id,quote:'practice matrices'}]}],resume:null};}}});
 const id=manager.start({testId:'test1',title:'Algebra',localToday:'2026-10-02'});
 manager.transcript(id,{role:'user',text:'I want to practice matrices.'});
 const pcm=Buffer.alloc(3200);for(let i=0;i<1600;i++)pcm.writeInt16LE(2000,i*2);
 manager.userAudio(id,pcm.toString('base64'));manager.assistantAudio(id,Buffer.alloc(4800).toString('base64'));
 manager.problem(id,{type:'asked',questionId:'q1',topicId:'matrices',topicTitle:'Matrices',difficulty:'hard',answer:'PRIVATE-ANSWER'});
 manager.problem(id,{type:'attempt',questionId:'q1',attempt:1});manager.problem(id,{type:'result',questionId:'q1',verdict:'correct'});
 time+=5000;assert.equal(manager.finish(id,{reason:'stop'}),true);assert.equal(manager.finish(id),false);
 await until(async()=> (await manager.context('test1')).recentSessions[0]?.reviewStatus==='reviewed');await manager.flush();
 const context=await manager.context('test1');assert.equal(calls,1);assert.equal(context.sessionCount,1);assert.equal(context.totals.durationMs,5000);assert.equal(context.totals.userSpeechEstimatedMs,100);assert.equal(context.totals.assistantAudioGeneratedMs,100);assert.equal(context.totals.correct,1);assert.equal(context.notes[0].text,'Wants to practice matrices.');
 const disk=await readFile(file,'utf8');assert.equal(disk.includes('PRIVATE-ANSWER'),false);assert.equal((await stat(file)).mode&0o777,0o600);
 assert.match(returningGreeting(context,{localToday:'2026-10-03'}),/Matrices yesterday/);
 manager.transcript(id,{role:'user',text:'closed late event'});assert.equal((await manager.context('test1')).totals.durationMs,5000);
});
test('PCM counts silence separately and bounds invalid payloads',()=>{assert.deepEqual(pcmMetrics(Buffer.alloc(3200).toString('base64')),{durationMs:100,speechMs:0});assert.deepEqual(pcmMetrics(null),{durationMs:0,speechMs:0});assert.equal(returningGreeting({recentSessions:[]}),null);});
test('review rejects fake evidence and never retries failed sessions',async t=>{
 let calls=0;const {manager}=await fixture(t,{organizer:{organize:async()=>{calls++;return {notes:[{text:'Invented.',evidence:[{turnId:'wrong',quote:'fake'}]}],resume:null};}}});
 const id=manager.start({testId:'a'});manager.transcript(id,{role:'user',text:'Hello.'});manager.finish(id);
 await until(async()=> (await manager.context('a')).recentSessions[0]?.reviewStatus==='unreviewed');await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);assert.deepEqual((await manager.context('a')).notes,[]);
 assert.throws(()=>validateSessionReview({notes:[],resume:{text:'x',evidence:[{turnId:'a',quote:'absent'}]}},[{id:'a',text:'actual'}]));
});
test('history preserves every session while transcript and event caps disclose omissions',async t=>{
 const {manager,file}=await fixture(t,{maxTranscriptTurns:1,maxEvents:1});manager.setForegroundBusy(true);
 for(let i=0;i<7;i++){const id=manager.start({testId:'a'});manager.transcript(id,{role:'user',text:'first'});manager.transcript(id,{role:'user',text:'omitted'});manager.problem(id,{type:'asked',questionId:'q'});manager.problem(id,{type:'help',questionId:'q'});manager.finish(id);}
 await manager.flush();const context=await manager.context('a');assert.equal(context.sessionCount,7);assert.equal(context.recentSessions.length,5);assert.equal(context.totals.asked,7);assert.equal(context.totals.help,7);assert.equal(context.recentSessions[0].omittedEvents,1);assert.equal(context.recentSessions[0].omittedTranscriptTurns,1);assert.equal(JSON.parse(await readFile(file)).sessions.length,7);
});
test('single review queue never overlaps and foreground work pauses new reviews',async t=>{
 const releases=[];let calls=0;const {manager}=await fixture(t,{organizer:{organize:()=>{calls++;return new Promise(r=>releases.push(()=>r(empty)));}}});
 manager.setForegroundBusy(true);for(let i=0;i<2;i++){const id=manager.start({testId:'a'});manager.transcript(id,{role:'user',text:'Practice this next time.'});manager.finish(id);}await new Promise(r=>setTimeout(r,10));assert.equal(calls,0);manager.setForegroundBusy(false);await until(()=>calls===1);assert.equal(releases.length,1);releases.shift()();await until(()=>calls===2);releases.shift()();await until(async()=> (await manager.context('a')).recentSessions.every(s=>s.reviewStatus==='reviewed'));
});
test('restart abandons stale sessions at last activity, reviews them and retains history',async t=>{
 const first=await fixture(t);first.manager.setForegroundBusy(true);const id=first.manager.start({testId:'a'});first.manager.transcript(id,{role:'user',text:'Resume later.'});await first.manager.flush();const disk=JSON.parse(await readFile(first.file));disk.sessions[0].startedAt='2026-10-01T10:00:00Z';disk.sessions[0].lastSeenAt='2026-10-01T10:02:00Z';await writeFile(first.file,JSON.stringify(disk));
 const second=createSessionHistory({env:{},file:first.file,reviewDelayMs:1,organizer:{organize:async()=>empty}});t.after(()=>second.close());await until(async()=> (await second.context('a')).recentSessions[0]?.reviewStatus==='reviewed');const context=await second.context('a');assert.equal(context.totals.durationMs,120000);assert.equal(context.recentSessions[0].status,'abandoned');
});
test('corrupt history is preserved instead of overwritten',async t=>{
 const {manager,file}=await fixture(t);await manager.flush();await manager.close();await writeFile(file,'bad existing content');const next=createSessionHistory({env:{},file});next.start({testId:'a'});await assert.rejects(next.flush(),/unreadable/);await assert.rejects(next.close());assert.equal(await readFile(file,'utf8'),'bad existing content');
});
test('shutdown aborts an active review and never accepts late notes',async t=>{
 let signal,resolve;const {manager}=await fixture(t,{organizer:{organize:async(input,options)=>{signal=options.signal;return new Promise(r=>{resolve=()=>r({notes:[{text:'Late note',evidence:[{turnId:input.transcript[0].id,quote:'hello'}]}],resume:null});});}}});
 const id=manager.start({testId:'a'});manager.transcript(id,{role:'user',text:'hello'});manager.finish(id);await until(()=>Boolean(signal));await manager.close();assert.equal(signal.aborted,true);resolve();await new Promise(r=>setTimeout(r,5));await manager.flush();const context=await manager.context('a');assert.deepEqual(context.notes,[]);assert.equal(context.recentSessions[0].reviewStatus,'unreviewed');assert.equal(manager.start({testId:'a'}),null);
});
test('unreviewed interruptions are not retried after restart; pending reviews are',async t=>{
 const {manager,file}=await fixture(t);manager.setForegroundBusy(true);const id=manager.start({testId:'a'});manager.transcript(id,{role:'user',text:'Continue this problem later.'});manager.finish(id);await manager.close();let calls=0;const next=createSessionHistory({env:{},file,reviewDelayMs:1,organizer:{organize:async()=>{calls++;return empty;}}});await until(async()=> (await next.context('a')).recentSessions[0]?.reviewStatus==='reviewed');assert.equal(calls,1);await next.close();const data=JSON.parse(await readFile(file));data.sessions[0].reviewStatus='reviewing';await writeFile(file,JSON.stringify(data));const interrupted=createSessionHistory({env:{},file,reviewDelayMs:1,organizer:{organize:async()=>{calls++;return empty;}}});await interrupted.flush();assert.equal((await interrupted.context('a')).recentSessions[0].reviewStatus,'unreviewed');await new Promise(r=>setTimeout(r,5));assert.equal(calls,1);await interrupted.close();
});

test('empty and greeting-only sessions retain their logs and counts without review calls',async t=>{
 let time=Date.parse('2026-10-02T12:00:00Z'),calls=0;
 const {manager,file}=await fixture(t,{now:()=>time,organizer:{organize:async()=>{calls++;return empty;}}});
 manager.setForegroundBusy(true);
 const untouched=manager.start({testId:'a'});time+=1000;manager.finish(untouched,{reason:'page-hidden'});
 const greeted=manager.start({testId:'a'});manager.transcript(greeted,{role:'assistant',text:'Welcome back. What would you like to work on?'});manager.assistantAudio(greeted,Buffer.alloc(4800).toString('base64'));time+=2000;manager.finish(greeted,{reason:'inactive'});
 const context=await manager.context('a');assert.equal(context.sessionCount,2);assert.equal(context.totals.durationMs,3000);assert.equal(context.totals.assistantAudioGeneratedMs,100);assert.ok(context.recentSessions.every(s=>s.reviewStatus==='skipped-empty'));assert.deepEqual(context.notes,[]);
 manager.setForegroundBusy(false);await new Promise(r=>setTimeout(r,15));assert.equal(calls,0);await manager.flush();
 const saved=JSON.parse(await readFile(file)).sessions;assert.equal(saved.length,2);assert.equal(saved.find(s=>s.id===greeted).transcript.length,1);assert.equal(saved.find(s=>s.id===untouched).endReason,'page-hidden');
});

test('problem evidence and capped user turns remain reviewable',async t=>{
 let calls=0;const {manager}=await fixture(t,{maxTranscriptTurns:1,organizer:{organize:async()=>{calls++;return empty;}}});
 const problem=manager.start({testId:'a'});manager.problem(problem,{type:'asked',questionId:'q',question:'What is diffusion?'});manager.finish(problem);
 const capped=manager.start({testId:'a'});manager.transcript(capped,{role:'assistant',text:'Welcome.'});manager.transcript(capped,{role:'user',text:'I want to practice diffusion.'});manager.finish(capped);
 await until(async()=> (await manager.context('a')).recentSessions.every(s=>s.reviewStatus==='reviewed'));assert.equal(calls,2);
});

test('legacy pending greeting-only sessions are skipped after restart',async t=>{
 const {manager,file}=await fixture(t);const id=manager.start({testId:'a'});manager.transcript(id,{role:'assistant',text:'Welcome.'});manager.finish(id);await manager.close();
 const saved=JSON.parse(await readFile(file));saved.sessions[0].reviewStatus='pending';delete saved.sessions[0].userTranscriptTurns;await writeFile(file,JSON.stringify(saved));
 let calls=0;const next=createSessionHistory({env:{},file,reviewDelayMs:1,organizer:{organize:async()=>{calls++;return empty;}}});t.after(()=>next.close());
 const context=await next.context('a');assert.equal(context.sessionCount,1);assert.equal(context.recentSessions[0].reviewStatus,'skipped-empty');await new Promise(r=>setTimeout(r,15));assert.equal(calls,0);
});

test('recent spoken work survives greeting-only reconnects without waiting for a review',async t=>{
 let time=Date.parse('2026-10-02T05:30:00Z'),calls=0;
 const {manager}=await fixture(t,{now:()=>time,organizer:{organize:async()=>{calls++;throw Error('No review needed for continuity');}}});
 manager.setForegroundBusy(true);
 const first=manager.start({testId:'economics'});
 const expected=[];
 for(const [role,text]of [['assistant','Which cells are equilibria?'],['user','The top-left and bottom-right cells.'],['assistant','That is correct.']]){
  time+=1000;manager.transcript(first,{role,text});expected.push({role,text,at:new Date(time).toISOString(),sessionId:first});
 }
 manager.transcript(first,{role:'user',spoken:false,text:'[Whiteboard selection] PRIVATE-SELECTOR'});
 time+=1000;manager.finish(first);
 const second=manager.start({testId:'economics'});
 for(const [role,text]of [['user','I already solved this. Give me a harder problem.'],['assistant','Let us move to a harder problem.']]){
  time+=1000;manager.transcript(second,{role,text,answer:'PRIVATE-ANSWER'});expected.push({role,text,at:new Date(time).toISOString(),sessionId:second});
 }
 manager.transcript(second,{role:'assistant',spoken:false,text:'Hidden technical update'});
 time+=1000;manager.finish(second);
 for(let index=0;index<8;index++){
  time+=1000;const greeting=manager.start({testId:'economics'});manager.transcript(greeting,{role:'assistant',text:'Welcome back. Try the old matrix again.'});manager.transcript(greeting,{role:'user',spoken:false,text:'[Whiteboard selection cleared, not a spoken answer]'});time+=100;manager.finish(greeting);
 }
 const other=manager.start({testId:'chemistry'});manager.transcript(other,{role:'user',text:'Other test request'});manager.finish(other);
 const current=manager.start({testId:'economics'});manager.transcript(current,{role:'user',text:'Current session stays in live history'});
 const context=await manager.context('economics',{excludeSessionId:current});
 assert.equal(calls,0);assert.deepEqual(context.recentConversation,expected);
 assert.equal(context.recentConversationWindow.eligibleSessions,2);assert.equal(context.recentConversationWindow.truncated,false);
 assert.equal(context.recentSessions.length,5,'existing session summary contract is preserved');
 assert.ok(context.recentSessions.every(session=>session.id!==first&&session.id!==second),'empty reconnects cannot displace dialogue even when they occupy summary slots');
 assert.equal(JSON.stringify(context.recentConversation).includes('PRIVATE'),false);
 manager.finish(current);assert.deepEqual((await manager.context('economics',{excludeSessionId:current})).recentConversation,expected,'explicit exclusion also applies to a finished session');
});

test('failed reviews still expose the newest exact spoken exchange chronologically',async t=>{
 let time=Date.parse('2026-10-02T06:00:00Z');
 const {manager}=await fixture(t,{now:()=>time,organizer:{organize:async()=>{throw Error('Reviewer unavailable');}}});
 const id=manager.start({testId:'a'});manager.transcript(id,{role:'user',text:'Please continue with the new topic.'});time+=1200;manager.transcript(id,{role:'assistant',text:'We will continue there.'});manager.finish(id);
 await until(async()=>(await manager.context('a')).recentSessions[0]?.reviewStatus==='unreviewed');
 const context=await manager.context('a');
 assert.deepEqual(context.recentConversation.map(turn=>turn.text),['Please continue with the new topic.','We will continue there.']);
 assert.ok(context.recentConversation[0].at<context.recentConversation[1].at);
 for(const turn of context.recentConversation)assert.deepEqual(Object.keys(turn).sort(),['at','role','sessionId','text']);
 assert.deepEqual(context.notes,[]);
});

test('recent conversation caps whole turns and protects the newest student intent',async t=>{
 let time=Date.parse('2026-10-02T07:00:00Z');const {manager}=await fixture(t,{now:()=>time});manager.setForegroundBusy(true);
 const id=manager.start({testId:'a'});
 for(let index=0;index<20;index++){time+=1000;manager.transcript(id,{role:index%2?'assistant':'user',text:`Exact turn ${index}.`});}
 manager.finish(id);let context=await manager.context('a');
 assert.equal(context.recentConversation.length,12);assert.equal(context.recentConversation[0].text,'Exact turn 8.');
 assert.equal(context.recentConversationWindow.omittedTurns,8);assert.equal(context.recentConversationWindow.truncated,true);
 const long=manager.start({testId:'bounded'}),request='U'.repeat(4000),reply='A'.repeat(3000);
 manager.transcript(long,{role:'user',text:request});time+=1000;manager.transcript(long,{role:'assistant',text:reply});manager.finish(long);
 context=await manager.context('bounded');
 assert.deepEqual(context.recentConversation.map(turn=>turn.text),[request],'drop an over-budget generated reply whole rather than the latest student request');
 assert.equal(context.recentConversationWindow.maxTurns,12);assert.equal(context.recentConversationWindow.maxChars,6000);
 assert.equal(context.recentConversationWindow.omittedTurns,1);assert.equal(context.recentConversationWindow.omittedChars,3000);
 assert.equal(context.recentConversation.reduce((sum,turn)=>sum+turn.text.length,0),4000);
});

test('synthetic-only visits and persisted source truncation are explicit in the continuity window',async t=>{
 const {manager}=await fixture(t,{maxTranscriptTurns:2});manager.setForegroundBusy(true);
 const synthetic=manager.start({testId:'a'});manager.transcript(synthetic,{role:'assistant',text:'Welcome.'});manager.transcript(synthetic,{role:'user',text:'[Whiteboard selection] old legacy event without spoken flag'});manager.finish(synthetic);
 assert.deepEqual((await manager.context('a')).recentConversation,[]);
 const real=manager.start({testId:'a'});manager.transcript(real,{role:'user',text:'An actual spoken request.'});manager.transcript(real,{role:'assistant',text:'A generated reply.'});manager.transcript(real,{role:'user',text:'This turn exceeds the persisted cap.'});manager.finish(real);
 const context=await manager.context('a');assert.equal(context.recentConversation.length,2);
 assert.equal(context.recentConversationWindow.sourceOmittedTurns,1);assert.ok(context.recentConversationWindow.sourceOmittedChars>0);assert.equal(context.recentConversationWindow.truncated,true);
});
