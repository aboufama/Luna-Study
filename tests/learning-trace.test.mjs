import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { segmentSpokenText, createLearningTrace, createJevLearningClassifier } from '../server/learning-trace.mjs';
import { createSessionHistory } from '../server/session-history.mjs';
import { createUsageLedger } from '../server/usage-ledger.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<100;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('Expected trace state');}
const classification={source:'jev',category:{label:'answer_attempt',confidence:.8},expressedConfidence:{label:'tentative',confidence:.8},proposedCorrectness:{label:'appears_correct',confidence:.7,authoritative:false}};
const classified=entries=>({status:'classified',classifications:entries.map(()=>structuredClone(classification))});
const record=(trace,text,extra={})=>trace.record({sessionId:'session',transcriptId:'turn',turnId:4,role:'user',text,at:'2026-10-02T05:00:00Z',...extra});
function bodyFor(request){
 const answers={};
 for(const [name,question]of Object.entries(request.questions)){
  const label=name.endsWith('_category')?'answer_attempt':name.endsWith('_expressedConfidence')?'tentative':'appears_correct';
  answers[name]={type:'choice',choice:label,confidence:.8,probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key===label?1:0]))};
 }
 return {answers};
}

test('Jev token reporting is per test and records paid attempts even if result validation fails',async()=>{
 const ledger=createUsageLedger({file:null});
 const classifier=createJevLearningClassifier({usageLedger:ledger,env:{TYPESAFE_API_KEY:'test'},fetchImpl:async(_,options)=>({ok:true,json:async()=>({...bodyFor(JSON.parse(options.body)),usage:{input_tokens:22,output_tokens:8},model:'jev-latest'})})});
 await classifier.classify([{role:'user',text:'Five.'}],{testId:'a'});
 const first=await ledger.snapshot('a');assert.equal(first.totals.requests,1);assert.deepEqual(first.totals.units,{inputTokens:22,outputTokens:8});assert.equal(first.totals.exactUsd,null);
 const invalid=createJevLearningClassifier({usageLedger:ledger,env:{TYPESAFE_API_KEY:'test'},fetchImpl:async()=>({ok:true,json:async()=>({answers:{},usage:{input_tokens:10,output_tokens:4}})})});
 assert.equal((await invalid.classify([{role:'user',text:'Five.'}],{testId:'a'})).reason,'invalid-response');
 assert.equal((await ledger.snapshot('a')).totals.requests,2);
 const local=createJevLearningClassifier({usageLedger:ledger,env:{}});await local.classify([],{testId:'b'});
 assert.equal((await ledger.snapshot('b')).totals.requests,0);await ledger.close();
});

test('sentence boundaries preserve exact source offsets and stable ordinal IDs',()=>{
 const text='  Dr. Smith asked why. I think it is 3.5. Maybe?  ';
 const parts=segmentSpokenText(text);assert.ok(parts.length>=3);
 for(const part of parts)assert.equal(text.slice(part.start,part.end),part.text);
 assert.deepEqual(parts.map(part=>part.index),parts.map((_,index)=>index));
 const trace=createLearningTrace({classifier:{classify:async entries=>classified(entries)}});
 const entries=record(trace,text);assert.equal(entries[0].id,'turn:sentence:0');assert.equal(entries[0].turnId,4);
 assert.deepEqual(record(trace,'[Whiteboard] A matrix.'),[]);
 assert.deepEqual(record(trace,'[Whiteboard selection cleared, not a spoken answer]'),[]);
 assert.deepEqual(record(trace,'Metadata without a prefix.',{spoken:false}),[]);trace.close();
});

test('official typed Jev request contains spoken public text only and keeps proposed correctness nonauthoritative',async()=>{
 let request,options,url;
 const classifier=createJevLearningClassifier({env:{TYPESAFE_API_KEY:'private-key',TYPESAFE_MODEL:'jev-latest'},fetchImpl:async(u,o)=>{url=u;options=o;request=JSON.parse(o.body);return{ok:true,json:async()=>bodyFor(request)};}});
 const result=await classifier.classify([{role:'user',text:'Maybe five.'},{role:'assistant',text:'Let us check.'}],{context:[{role:'assistant',text:'How many?'}]});
 assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer private-key');
 assert.equal(JSON.stringify(request).includes('private-key'),false);assert.equal(Object.keys(request.questions).length,6);
 assert.ok(Object.values(request.questions).every(question=>question.type==='choice'));
 assert.equal(result.status,'classified');assert.equal(result.classifications[0].proposedCorrectness.authoritative,false);
 assert.equal(result.classifications[1].expressedConfidence.label,'not_applicable');assert.equal(result.classifications[1].proposedCorrectness.label,'not_applicable');
});

test('invalid, missing-key and stalled Jev responses fail safely without retries',async()=>{
 let calls=0;
 const absent=createJevLearningClassifier({env:{},fetchImpl:async()=>{calls++;throw new Error('unexpected');}});
 assert.equal((await absent.classify([{role:'user',text:'Hello.'}])).reason,'missing-key');assert.equal(calls,0);
 const invalid=createJevLearningClassifier({env:{TYPESAFE_API_KEY:'private'},fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({answers:{}})};}});
 assert.equal((await invalid.classify([{role:'user',text:'Hello.'}])).reason,'invalid-response');assert.equal(calls,1);
 let signal;
 const stalled=createJevLearningClassifier({env:{TYPESAFE_API_KEY:'private'},timeoutMs:5,fetchImpl:async(_,options)=>{signal=options.signal;calls++;return{ok:true,json:()=>new Promise(()=>{})};}});
 const failure=await stalled.classify([{role:'user',text:'Hello.'}]);assert.equal(failure.reason,'timeout');assert.equal(signal.aborted,true);assert.equal(calls,2);assert.equal(JSON.stringify(failure).includes('private'),false);
});

test('one worker batches sentences serially while logging survives queue capacity and failure',async()=>{
 let active=0,maxActive=0,resolve;
 const classifier={classify(entries){active++;maxActive=Math.max(maxActive,active);return new Promise(done=>{resolve=()=>{active--;done(classified(entries));};});}};
 const trace=createLearningTrace({classifier,batchSize:1,maxQueuedBatches:1});
 const first=record(trace,'First.');await tick();assert.equal(first[0].status,'classifying');
 const next=record(trace,'Second. Third. Fourth.',{transcriptId:'next'});assert.equal(next.length,3);assert.equal(next[0].status,'queued');assert.equal(next[1].failure,'queue-capacity');assert.equal(next[2].failure,'queue-capacity');
 resolve();await tick();assert.equal(first[0].status,'classified');assert.equal(next[0].status,'classifying');assert.equal(maxActive,1);
 resolve();await tick();assert.equal(next[0].status,'classified');assert.equal(trace.status().automaticRetries,0);trace.close();
});

test('shutdown aborts active work, marks queued records and ignores late classifications',async()=>{
 let resolve,signal;
 const trace=createLearningTrace({batchSize:1,classifier:{classify(_,options){signal=options.signal;return new Promise(done=>{resolve=done;});}}});
 const entries=record(trace,'One. Two.');await tick();trace.close();
 assert.equal(signal.aborted,true);assert.equal(entries[0].failure,'interrupted');assert.equal(entries[1].failure,'shutdown');
 resolve(classified([entries[0]]));await tick();assert.equal(entries[0].classification,null);assert.equal(entries[0].status,'unclassified');
});

test('history persists all sentence logs separately from transcript caps and links only checked turn grades',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'luna-trace-')),file=path.join(directory,'history.json');
 let calls=0;
 const manager=createSessionHistory({file,env:{},maxTranscriptTurns:1,maxTranscriptChars:100,learningClassifier:{async classify(entries){calls++;return classified(entries);}}});
 t.after(async()=>{await manager.close();await rm(directory,{recursive:true,force:true});});
 const id=manager.start({testId:'test',title:'Biology'});
 manager.transcript(id,{role:'assistant',text:'What is diffusion?',turnId:1,spoken:true});
 manager.transcript(id,{role:'user',text:'I think particles move down the gradient. Is that right?',turnId:2,spoken:true});
 manager.transcript(id,{role:'assistant',text:'[Whiteboard] Secret-looking but public matrix metadata.',turnId:3,spoken:false});
 manager.problem(id,{type:'result',turnId:2,questionId:'q1',attempt:1,verdict:'incorrect'});
 manager.problem(id,{type:'result',turnId:99,questionId:'q1',attempt:1,verdict:'incorrect',checked:true});
 manager.problem(id,{type:'result',turnId:2,questionId:'q1',attempt:1,verdict:'correct',checked:true});
 manager.problem(id,{type:'result',turnId:2,questionId:'q1',attempt:1,verdict:'correct',checked:true});
 await until(async()=> (await manager.trace('test')).summary.classified===3);
 let trace=await manager.trace('test');assert.equal(trace.summary.sentences,3);assert.equal(calls,2);
 assert.equal(trace.sessions[0].entries[0].checkedGrades.length,0);
 const answered=trace.sessions[0].entries.filter(entry=>entry.role==='user');assert.equal(answered.length,2);
 for(const entry of answered){assert.equal(entry.checkedGrades.length,1);assert.equal(entry.checkedGrades[0].verdict,'correct');assert.equal(entry.checkedGrades[0].scope,'turn');assert.equal(entry.classification.proposedCorrectness.authoritative,false);}
 trace.sessions[0].entries[0].text='tampered';assert.equal((await manager.trace('test')).sessions[0].entries[0].text,'What is diffusion?');
 await manager.flush();const stored=JSON.parse(await readFile(file,'utf8'));assert.equal(stored.sessions[0].transcript.length,1);assert.equal(stored.sessions[0].learningTrace.length,3);assert.equal((await stat(file)).mode&0o777,0o600);
 assert.equal(JSON.stringify(await manager.context('test')).includes('classification'),false,'debug trace never enters tutor memory');
 manager.finish(id);await manager.close();
 const reopened=createSessionHistory({file,env:{},learningClassifier:{async classify(){throw new Error('Historical trace must not call provider');}}});
 assert.equal((await reopened.trace('test')).summary.sentences,3);await reopened.close();
});

test('pending persisted classifications become interrupted records on restart without provider backfill',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'luna-trace-restart-')),file=path.join(directory,'history.json');t.after(()=>rm(directory,{recursive:true,force:true}));
 await writeFile(file,JSON.stringify({version:1,sessions:[{id:'s',testId:'a',startedAt:'2026-10-01T00:00:00Z',endedAt:'2026-10-01T00:01:00Z',transcript:[],events:[],learningTrace:[{id:'e',text:'One.',status:'classifying'}],reviewStatus:'skipped-empty'}]}));
 let calls=0;const manager=createSessionHistory({file,env:{},learningClassifier:{async classify(){calls++;}}});
 const trace=await manager.trace('a');assert.equal(trace.sessions[0].entries[0].failure,'process-restart');assert.equal(calls,0);await manager.close();
});
