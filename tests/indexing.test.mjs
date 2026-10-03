import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMaterialIndexer, splitSource, validateChunkAnalyses, expandVerifiedQuotes } from '../server/indexing.mjs';
import { createApiHandler } from '../server/api.mjs';

const testId='12345678-1234-4234-9234-123456789abc';
const otherId='12345678-1234-4234-9234-123456789abd';
const source=(id,size=1200)=>({id,name:`${id}.txt`,text:`${id}: A supported source fact with qualifications. `.repeat(Math.ceil(size/35)).slice(0,size)});
const input=(materials,extra={})=>({testId,title:'Biology',materials,...extra});
const guide=materials=>({overview:'Study the source facts.',topics:materials.map(s=>({title:s.name,summary:s.text.slice(0,200),sourceIds:[s.id]}))});
const analysis=request=>({chunks:request.chunks.map(chunk=>({chunkId:chunk.chunkId,topics:[{title:'Fallible topic hint',citationIds:[chunk.excerpts.find(excerpt=>excerpt.text.trim()).id]}]}))});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('Indexing condition not reached.');}
function organizer(delayMs=3){
  const calls=[];let active=0,maxActive=0;
  return {available:true,model:'gpt-6-luna',calls,get maxActive(){return maxActive;},async organize(request,options){
    calls.push({request,options});active++;maxActive=Math.max(maxActive,active);
    try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,delayMs);options.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('aborted'));},{once:true});});return request.chunks?analysis(request):guide(request.materials);}
    finally{active--;}
  }};
}

test('small complete corpora use one direct call and exact final-guide cache without mutating originals',async()=>{
  const provider=organizer(),indexer=createMaterialIndexer({organizer:provider}),sources=[source('a',500),source('b',600)];
  const first=await indexer.organize(input(sources));assert.equal(provider.calls.length,1);assert.deepEqual(provider.calls[0].request.materials,sources);assert.equal(provider.calls[0].options.usageContext.operation,'index-direct');
  assert.deepEqual(provider.calls[0].options.schema.required,['overview','topics']);assert.deepEqual(Object.keys(first),['overview','topics']);
  first.topics[0].title='tampered';const repeated=await indexer.organize(input(sources));assert.notEqual(repeated.topics[0].title,'tampered');assert.equal(provider.calls.length,1);indexer.close();
});

test('default direct dispatch includes 32000 original characters and maps the first character beyond that boundary',async()=>{
  const provider=organizer(),indexer=createMaterialIndexer({organizer:provider});
  const complete=source('boundary',32000);
  await indexer.organize(input([complete]));
  assert.deepEqual(provider.calls.map(call=>call.options.usageContext.operation),['index-direct']);
  assert.equal(provider.calls[0].request.materials[0].text,complete.text);
  await indexer.organize(input([{...complete,text:complete.text+'x'}]));
  assert.deepEqual(provider.calls.slice(1).map(call=>call.options.usageContext.operation),['index-map','index-map','index-merge']);
  indexer.close();
});

test('larger corpora map in bounded parallel work, require every chunk, and merge verified originals',async()=>{
  const provider=organizer(8),events=[],indexer=createMaterialIndexer({organizer:provider,directChars:0,chunkChars:1000,batchChars:1000,diagnostics:{record:(id,event)=>events.push({id,...event})}});
  const sources=Array.from({length:4},(_,i)=>source(`source-${i}`));
  const result=await indexer.organize(input(sources));
  assert.equal(provider.maxActive,5);const maps=provider.calls.filter(call=>call.request.chunks),merge=provider.calls.at(-1);
  assert.equal(maps.flatMap(call=>call.request.chunks).length,8);assert.equal(merge.options.usageContext.operation,'index-merge');
  assert.deepEqual(merge.options.schema.required,['overview','topics']);assert.deepEqual(Object.keys(result),['overview','topics']);
  assert.deepEqual(merge.request.materials.map(({id,name})=>({id,name})),sources.map(({id,name})=>({id,name})));
  for(const material of merge.request.materials)for(const quote of material.text.split('\n\n'))assert.ok(sources.find(s=>s.id===material.id).text.includes(quote));
  assert.equal(merge.request.materials.some(s=>s.text.includes('Fallible topic hint')),false);
  assert.deepEqual(result.topics.flatMap(topic=>topic.sourceIds),sources.map(s=>s.id));
  const coverage=events.find(event=>event.type==='index.coverage.ready');assert.equal(coverage.details.total,8);assert.equal(coverage.details.sourceCount,4);
  assert.ok(provider.calls.every(call=>call.options.usageContext.testId===testId));indexer.close();
});

test('indexing queues work beyond five jobs and honors a lower explicit concurrency',async t=>{
  for(const {name,concurrency,limit} of [
    {name:'default five',limit:5},
    {name:'larger configuration clamps to five',concurrency:99,limit:5},
    {name:'explicit two',concurrency:2,limit:2},
  ])await t.test(name,async t=>{
    const gates=[];let active=0,maxActive=0,completed=0,merges=0;
    const provider={available:true,model:'gpt-6-luna',async organize(request,{signal}){
      if(!request.chunks){
        merges++;assert.equal(completed,7,'merge waits for every map result');
        return guide(request.materials);
      }
      assert.equal(request.chunks.length,1,'full-size chunks cannot batch together');
      active++;maxActive=Math.max(maxActive,active);
      try{
        await new Promise((resolve,reject)=>{
          const abort=()=>reject(Error('canceled'));
          signal.addEventListener('abort',abort,{once:true});
          gates.push(()=>{signal.removeEventListener('abort',abort);resolve();});
        });
        completed++;return analysis(request);
      }finally{active--;}
    }};
    const indexer=createMaterialIndexer({organizer:provider,concurrency,directChars:0,chunkChars:1000,batchChars:1000});
    const pending=indexer.organize(input(Array.from({length:7},(_,i)=>source(`s${i}`,1000))));
    void pending.catch(()=>{});
    t.after(async()=>{indexer.close();await pending.catch(()=>{});});
    await until(()=>gates.length>=limit);await tick();
    assert.equal(gates.length,limit);assert.equal(active,limit);
    assert.equal(indexer.stats().active,limit);assert.equal(indexer.stats().queued,7-limit);
    assert.equal(merges,0);

    gates[0]();await until(()=>gates.length>=limit+1);await tick();
    assert.equal(gates.length,limit+1);assert.equal(active,limit);
    assert.equal(indexer.stats().active,limit);assert.equal(indexer.stats().queued,6-limit);
    assert.equal(completed,1);assert.equal(merges,0);
    for(let i=1;i<7;i++){await until(()=>Boolean(gates[i]));gates[i]();}
    const result=await pending;
    assert.equal(maxActive,limit);assert.equal(completed,7);assert.equal(merges,1);
    assert.equal(result.topics.length,7);assert.equal(indexer.stats().queued,0);
  });
});

test('small sources batch together instead of spawning one provider request per file',async()=>{
  const provider=organizer(),indexer=createMaterialIndexer({organizer:provider,directChars:0,chunkChars:1000,batchChars:22000});
  await indexer.organize(input(Array.from({length:10},(_,i)=>source(`s${i}`,350))));
  const maps=provider.calls.filter(call=>call.request.chunks);assert.equal(maps.length,2);assert.equal(maps[0].request.chunks.length,6);assert.equal(maps[1].request.chunks.length,4);indexer.close();
});

test('incremental imports reuse unchanged source chunks; content, title and test changes invalidate exact keys',async()=>{
  const provider=organizer(),indexer=createMaterialIndexer({organizer:provider,directChars:0,chunkChars:1000,batchChars:1000});
  const a=source('a'),b=source('b');
  await indexer.organize(input([a]));assert.equal(provider.calls.length,3);
  await indexer.organize(input([a,b]));assert.equal(provider.calls.length,6,'only two new chunks and one merge');
  const changed={...a,text:'Changed'+a.text.slice(7)};
  await indexer.organize(input([changed,b]));assert.equal(provider.calls.length,8,'only changed first chunk plus merge');
  await indexer.organize(input([changed,b],{title:'Chemistry'}));assert.equal(provider.calls.length,12,'new title remaps all chunks, batching the short tails');
  await indexer.organize(input([changed,b],{testId:otherId}));assert.equal(provider.calls.length,16,'another test has independent billed work');indexer.close();
});

test('shared in-flight work survives one subscriber canceling and retains accurate test attribution',async()=>{
  let release,began;const started=new Promise(resolve=>{began=resolve;});let calls=0,aborts=0;
  const provider={available:true,model:'gpt-6-luna',organize(request,{signal}){calls++;signal.addEventListener('abort',()=>{aborts++;},{once:true});return new Promise(resolve=>{release=()=>resolve(guide(request.materials));began();});}};
  const indexer=createMaterialIndexer({organizer:provider}),controller=new AbortController(),same=input([source('a',300)]);
  const first=indexer.organize(same,{signal:controller.signal}),second=indexer.organize(same);
  await started;controller.abort();await assert.rejects(first,error=>error.status===499);assert.equal(aborts,0);assert.equal(calls,1);
  release();assert.equal((await second).topics.length,1);assert.equal(aborts,0);indexer.close();
});

test('overlapping imports share source analysis and one canceled corpus cannot cancel the other',async()=>{
  let release,began;const started=new Promise(resolve=>{began=resolve;});const calls=[];
  const provider={available:true,model:'gpt-6-luna',async organize(request,options){calls.push({request,options});if(request.chunks){await new Promise(resolve=>{release=resolve;began();});return analysis(request);}return guide(request.materials);}};
  const indexer=createMaterialIndexer({organizer:provider,directChars:0,chunkChars:1000}),controller=new AbortController();
  const a=source('a',400),b=source('b',400),c=source('c',400);
  const first=indexer.organize(input([a,b]),{signal:controller.signal}),second=indexer.organize(input([a,c]));
  await started;controller.abort();await assert.rejects(first,error=>error.status===499);assert.equal(calls[0].options.signal.aborted,false);
  release();const result=await second;assert.deepEqual(result.topics.flatMap(topic=>topic.sourceIds),['a','c']);
  assert.equal(calls.filter(call=>call.request.chunks).flatMap(call=>call.request.chunks).filter(chunk=>chunk.sourceId==='a').length,1);indexer.close();
});

test('missing, duplicate or invented source evidence rejects the whole guide and never schedules merge',async()=>{
  const chunk={chunkId:'a',text:'Verified content. '.repeat(30)};
  for(const value of [{chunks:[]},{chunks:[{chunkId:'unknown',topics:[]}]},{chunks:[{chunkId:'a',topics:[{title:'Fake',citationIds:['unknown-citation']}]}]}])assert.throws(()=>validateChunkAnalyses(value,[chunk]),error=>error.status===502);
  const provider={available:true,model:'gpt-6-luna',calls:0,async organize(request){this.calls++;return {chunks:request.chunks.map(chunk=>({chunkId:chunk.chunkId,topics:[{title:'Fake',citationIds:['unknown-citation']}]}))};}};
  const indexer=createMaterialIndexer({organizer:provider,directChars:0});
  await assert.rejects(indexer.organize(input([source('a')])));await tick();assert.equal(provider.calls,1);assert.equal(indexer.stats().cacheEntries,0);indexer.close();
});

test('failure and deadline abort sibling/queued work without marking partial indexing ready',async()=>{
  let calls=0,aborts=0;
  const provider={available:true,model:'gpt-6-luna',organize(_request,{signal}){calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborts++;reject(Error('canceled'));},{once:true}));}};
  const indexer=createMaterialIndexer({organizer:provider,directChars:0,chunkChars:1000,batchChars:1000});
  await assert.rejects(indexer.organize(input([source('a',8000)]),{timeoutMs:10}),error=>error.status===504);await until(()=>indexer.stats().active===0);
  assert.equal(calls,5);assert.equal(aborts,5);assert.equal(indexer.stats().queued,0);assert.equal(indexer.stats().cacheEntries,0);indexer.close();
});

test('chunk splitting preserves complete source text and valid surrogate boundaries; cache retention is bounded',async()=>{
  const s={id:'emoji',name:'Notes',text:'a'.repeat(999)+'😀'+'b'.repeat(1400)};const chunks=splitSource(s,1000);
  assert.equal(chunks.map(chunk=>chunk.text).join(''),s.text);assert.ok(chunks.every(chunk=>!/[\uD800-\uDBFF]$/.test(chunk.text)));
  let now=0;const provider=organizer(),indexer=createMaterialIndexer({organizer:provider,now:()=>now,ttlMs:100,maxCacheEntries:1});
  await indexer.organize(input([source('a',300)]));await indexer.organize(input([source('b',300)]));assert.equal(indexer.stats().cacheEntries,1);
  now=101;assert.equal(indexer.stats().cacheEntries,0);await indexer.organize(input([source('b',300)]));assert.equal(provider.calls.length,3);indexer.close();
});

test('verified fragments regain original example context without generated text or duplicate paragraphs',()=>{
  const first='Solve 6x + 1 = 1. Subtract 1 and divide by 6 to get x = 0. Check: 6(0) + 1 = 1.';
  const second='The derivative of a constant is zero.';
  const text=first+'\r\n\r\n'+second;
  assert.deepEqual(expandVerifiedQuotes(text,[{quote:'Check: 6(0) + 1 = 1.'},{quote:'Subtract 1 and divide by 6'},{quote:'constant is zero.'}]),[first,second]);
  assert.throws(()=>expandVerifiedQuotes(text,[{quote:'invented'}]));
  const long='a'.repeat(5000)+'exact sentence'+'b'.repeat(5000);
  assert.deepEqual(expandVerifiedQuotes(long,[{quote:'exact sentence'}]),['exact sentence'],'unbounded paragraphs do not inflate excerpts');
});

test('API waits for complete validated indexing and cancels provider work on client disconnect',async t=>{
  let passed,release;const scheduled=[];
  const indexer={organize(received,options){passed={received,options};return new Promise(resolve=>{release=()=>resolve(guide(received.materials));});}};
  const handler=createApiHandler({env:{LIVE_APIS:'true',OPENAI_API_KEY:'test'},indexer,questionBank:{schedule:(...args)=>scheduled.push(args)}});
  const server=createServer(async(req,res)=>{if(!await handler(req,res)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));const origin=`http://127.0.0.1:${server.address().port}`,controller=new AbortController();
  const response=fetch(`${origin}/api/organize`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(input([source('a',300)])),signal:controller.signal});
  await until(()=>Boolean(passed));assert.equal(scheduled.length,0);assert.equal(passed.received.testId,testId);controller.abort();await assert.rejects(response);await until(()=>passed.options.signal.aborted);release();await tick();assert.equal(scheduled.length,0);
});
