import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createUsageLedger, tokenUsage } from '../server/usage-ledger.mjs';

test('provider counters are allowlisted without converting usage or guessed prices to USD',()=>{
  assert.deepEqual(tokenUsage({input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:30},output_tokens_details:{reasoning_tokens:5},cost:8,secret:'private'}),{inputTokens:100,outputTokens:20,cachedInputTokens:30,reasoningTokens:5});
  assert.deepEqual(tokenUsage({inputTokens:2,outputTokens:3,cachedInputTokens:1,reasoningOutputTokens:2}),{inputTokens:2,outputTokens:3,cachedInputTokens:1,reasoningTokens:2});
  assert.deepEqual(tokenUsage({input_tokens:-1,output_tokens:Infinity}),{});
  assert.deepEqual(tokenUsage({input_tokens:100,input_tokens_details:{cached_tokens:20,cache_write_tokens:30}}),{inputTokens:100,cachedInputTokens:20,cacheWriteTokens:30});
});

test('per-test totals distinguish absent, partial, pending and fully provider-reported costs',async()=>{
  const ledger=createUsageLedger({file:null});
  const empty=await ledger.snapshot('a');
  assert.equal(empty.totals.exactUsd,null);assert.equal(empty.totals.complete,false);assert.equal(empty.totals.requests,0);
  const first=ledger.start('a',{category:'jev',provider:'typesafe',operation:'canvas'});
  first.update({units:{inputTokens:10,outputTokens:2,secret:123},costUsd:20});
  first.update({units:{inputTokens:11}});
  assert.equal((await ledger.snapshot('a')).totals.pendingRequests,1);
  first.finish();first.finish({providerReportedUsd:999});
  const voice=ledger.start('a',{category:'voice',provider:'elevenlabs'});voice.finish({providerReportedUsd:.02,units:{audioOutputMs:250}});
  ledger.start('b',{category:'llm'}).finish({providerReportedUsd:8});
  const partial=await ledger.snapshot('a');
  assert.equal(partial.totals.requests,2);assert.equal(partial.totals.reportedCostRequests,1);assert.equal(partial.totals.unpricedRequests,1);
  assert.equal(partial.totals.providerReportedUsd,.02);assert.equal(partial.totals.exactUsd,null);assert.equal(partial.totals.complete,false);
  assert.deepEqual(partial.totals.units,{inputTokens:11,outputTokens:2,audioOutputMs:250});
  assert.equal(partial.categories.find(c=>c.id==='voice').exactUsd,.02);
  first.update({providerReportedUsd:.01});
  const full=await ledger.snapshot('a');assert.equal(full.totals.exactUsd,.03);assert.equal(full.totals.complete,true);
  ledger.start('a',{category:'llm'}).finish({status:'failed'});
  assert.equal((await ledger.snapshot('a')).totals.exactUsd,null,'failed requests may still bill');
  await ledger.close();
});

test('ledger survives restart, isolates tests, contains no content, and preserves unreadable storage',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'luna-usage-')),file=path.join(directory,'usage.json');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const started=Date.parse('2026-10-02T01:00:00Z');
  const ledger=createUsageLedger({file,now:()=>started});
  ledger.start('a',{category:'llm',provider:'codex',text:'private transcript',materials:['private source']}).finish({units:{inputTokens:45,secret:9}});
  ledger.start('b',{category:'voice'});
  await ledger.flush();
  const raw=await readFile(file,'utf8');assert.equal(raw.includes('private'),false);assert.equal(raw.includes('secret'),false);
  assert.equal((await stat(file)).mode&0o777,0o600);
  const reopened=createUsageLedger({file,now:()=>started+1000});
  assert.equal((await reopened.snapshot('a')).totals.units.inputTokens,45);
  assert.equal((await reopened.snapshot('a')).trackingStartedAt,new Date(started).toISOString());
  assert.equal((await reopened.snapshot('b')).totals.pendingRequests,0);
  assert.equal((await reopened.snapshot('b')).totals.unpricedRequests,1);
  await ledger.close();await reopened.close();
  await writeFile(file,'unreadable');
  const corrupted=createUsageLedger({file});corrupted.start('c',{category:'jev'}).finish();
  assert.ok((await corrupted.snapshot('c')).notes.some(note=>note.includes('persistence')));
  await corrupted.close();assert.equal(await readFile(file,'utf8'),'unreadable');
});

test('streaming updates coalesce into one active write and flush drains only the latest state',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'luna-usage-stream-')),file=path.join(directory,'usage.json');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let calls=0,active=0,maxActive=0,release,started;
  const firstStarted=new Promise(resolve=>{started=resolve;});
  const hold=new Promise(resolve=>{release=resolve;});
  const ledger=createUsageLedger({file,writeFileImpl:async(...args)=>{
    calls++;active++;maxActive=Math.max(maxActive,active);
    if(calls===1){started();await hold;}
    try{return await writeFile(...args);}finally{active--;}
  }});
  const meter=ledger.start('a',{category:'voice'});
  for(let i=1;i<=1000;i++)meter.update({units:{audioOutputMs:i}});
  assert.equal(calls,0,'normal audio updates must not enqueue immediate disk writes');
  const draining=ledger.flush();await firstStarted;
  for(let i=1001;i<=2000;i++)meter.update({units:{audioOutputMs:i}});
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(calls,1,'a slow disk cannot accumulate a write queue');
  release();await draining;
  assert.equal(calls,2);assert.equal(maxActive,1);
  assert.equal(JSON.parse(await readFile(file,'utf8')).events[0].units.audioOutputMs,2000);
  meter.finish({units:{audioOutputMs:2001}});await ledger.close();
  assert.equal(JSON.parse(await readFile(file,'utf8')).events[0].units.audioOutputMs,2001);
});

test('late accounting preserves canceled status and cumulative counters never move backward', async () => {
  const ledger = createUsageLedger({file:null});
  const meter = ledger.start('a',{category:'voice',provider:'elevenlabs'});
  meter.update({units:{characters:12}});
  meter.finish({status:'canceled',units:{characters:12}});
  meter.update({units:{characters:18}});
  meter.update({units:{characters:6}});
  const totals = (await ledger.snapshot('a')).totals;
  assert.equal(totals.units.characters,18);
  assert.equal(totals.statusCounts.canceled,1);
  assert.equal(totals.pendingRequests,0);
  assert.equal(totals.requests,1);
  await ledger.close();
});

test('unattributed calls are retained separately and incomplete usage is disclosed', async () => {
  const ledger = createUsageLedger({file:null});
  ledger.start(undefined,{category:'llm',provider:'openai',operation:'organize'}).finish({status:'failed'});
  ledger.start('a',{category:'llm',provider:'openai'}).finish({units:{inputTokens:20,outputTokens:2}});
  ledger.start('a',{category:'llm',provider:'openai'}).finish({status:'canceled'});
  const data = await ledger.snapshot('a');
  assert.equal(data.totals.requests,2);
  assert.equal(data.totals.missingUsageRequests,1);
  assert.deepEqual(data.totals.unitCoverage,{inputTokens:1,outputTokens:1});
  assert.equal(data.unattributed.requests,1);
  assert.equal(data.unattributed.statusCounts.failed,1);
  assert.equal(data.unattributed.missingUsageRequests,1);
  assert.equal((await ledger.snapshot('__unattributed__')).totals.requests,1);
  await ledger.close();
});

test('documented estimates never masquerade as billed cost or include requests with missing measurements', async () => {
  const ledger = createUsageLedger({file:null,now:()=>Date.parse('2026-10-02T12:00:00Z')});
  const meter = ledger.start('a',{category:'llm',provider:'openai',model:'gpt-6-luna'});
  meter.finish({units:{inputTokens:1000000,outputTokens:1000,cachedInputTokens:100000,cacheWriteTokens:0},serviceTier:'default'});
  ledger.start('a',{category:'jev',provider:'typesafe',model:'jev-1.13.0'}).finish({units:{inputTokens:1000}});
  ledger.start('a',{category:'llm',provider:'openai',model:'gpt-6-luna'}).finish({status:'canceled'});
  const data = await ledger.snapshot('a');
  assert.ok(data.totals.estimatedUsd > 0);
  assert.equal(data.totals.estimatedRequests,2);
  assert.equal(data.totals.unestimatedRequests,1);
  assert.equal(data.totals.estimateComplete,false);
  assert.equal(data.totals.exactUsd,null);
  assert.equal(data.totals.providerReportedUsd,null);
  assert.equal(data.totals.reportedCostRequests,0);
  assert.ok(data.totals.estimateSources.every(rate => rate.source.startsWith('https://') && rate.verifiedAt));
  await ledger.close();
});

test('a temporary write failure recovers without dropping measurements or overwriting unreadable storage', async t => {
  const directory=await mkdtemp(path.join(tmpdir(),'luna-usage-recovery-')),file=path.join(directory,'usage.json');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let failNext=true;
  const ledger=createUsageLedger({file,writeFileImpl:async(...args)=>{
    if(failNext){failNext=false;throw Object.assign(new Error('temporary disk failure'),{code:'ENOSPC'});}
    return writeFile(...args);
  }});
  const meter=ledger.start('a',{category:'llm',provider:'openai'});
  meter.update({units:{inputTokens:10}});
  await ledger.flush();
  assert.equal((await ledger.snapshot('a')).storage.status,'write-error');
  meter.finish({units:{inputTokens:12,outputTokens:4}});
  await ledger.flush();
  assert.equal((await ledger.snapshot('a')).storage.status,'ok');
  assert.ok((await ledger.snapshot('a')).storage.lastSavedAt);
  const saved=JSON.parse(await readFile(file,'utf8'));
  assert.equal(saved.events.length,1);
  assert.deepEqual(saved.events[0].units,{inputTokens:12,outputTokens:4});
  assert.equal(saved.events[0].status,'completed');
  await ledger.close();
});

test('a failed explicit flush retries automatically without another request or flush', {timeout:5000}, async t => {
  const directory=await mkdtemp(path.join(tmpdir(),'luna-usage-auto-retry-')),file=path.join(directory,'usage.json');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let calls=0, recovered;
  const savedAgain=new Promise(resolve=>{recovered=resolve;});
  const ledger=createUsageLedger({file,writeFileImpl:async(...args)=>{
    if(++calls===1)throw Object.assign(new Error('temporary failure'),{code:'ENOSPC'});
    await writeFile(...args);
    recovered();
  }});
  t.after(()=>ledger.close());
  ledger.start('a',{category:'voice',provider:'elevenlabs'}).finish({units:{characters:21}});
  await ledger.flush();
  assert.equal((await ledger.snapshot('a')).storage.status,'write-error');
  await savedAgain;
  // Wait for the automatic atomic rename and status update, without forcing a write.
  for(let i=0;i<50 && (await ledger.snapshot('a')).storage.status==='write-error';i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await ledger.snapshot('a')).storage.status,'ok');
  assert.equal(calls,2);
  assert.equal(JSON.parse(await readFile(file,'utf8')).events[0].units.characters,21);
});

test('aggregated pricing sources retain caveats from earlier partial requests', async () => {
  const ledger=createUsageLedger({file:null});
  const metadata={category:'llm',provider:'openai',model:'gpt-6-luna',serviceTier:'standard'};
  ledger.start('a',metadata).finish({status:'canceled',units:{inputTokens:100,outputTokens:2}});
  ledger.start('a',metadata).finish({units:{inputTokens:100,outputTokens:2,cachedInputTokens:0,cacheWriteTokens:0}});
  const data=await ledger.snapshot('a');
  assert.equal(data.totals.estimateSources.length,1);
  assert.equal(data.totals.partialEstimatedRequests,1);
  assert.equal(data.totals.estimateComplete,false);
  const notes=data.totals.estimateSources[0].notes;
  assert.ok(notes.some(note=>note.includes('Cache-write counts were not reported')));
  assert.ok(notes.some(note=>note.includes('Cache-read counts were not reported')));
  assert.ok(notes.some(note=>note.includes('canceled')));
  await ledger.close();
});

test('estimate totals retain documented precision without floating-point display artifacts', async () => {
  const ledger=createUsageLedger({file:null});
  for (const inputTokens of [1100000,2200000,3300000]) {
    ledger.start('a',{category:'jev',provider:'typesafe',model:'jev-1.13.0'}).finish({units:{inputTokens}});
  }
  assert.equal((await ledger.snapshot('a')).totals.estimatedUsd,.2772);
  await ledger.close();
});
