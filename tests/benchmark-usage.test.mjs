import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createUsageBudget } from '../benchmarks/usage-budget.mjs';

const voice='JBFqnCBsd6RMkjVDRZzb';
const tts='wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo';
const stt='wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000';
function fixture({cap=100,remaining=10000,category='premade',multiplier=.5,discount=1,maxRequests=3,seconds=0}={}) {
  const fetches=[],sockets=[];
  class FakeSocket extends EventEmitter {
    static OPEN=1;
    constructor(url){super();this.url=url;this.sent=[];this.terminated=false;sockets.push(this);this.on('error',error=>{this.failure=error;});}
    send(data,...args){this.sent.push(JSON.parse(data));if(typeof args.at(-1)==='function')args.at(-1)();}
    terminate(){if(this.terminated)return;this.terminated=true;this.emit('close');}
  }
  const fetchImpl=async(url,options)=>{
    fetches.push({url,method:options.method});
    let value={};
    if(url.endsWith('/subscription'))value={character_count:10,character_limit:remaining+10};
    if(url.endsWith('/models'))value=[{model_id:'eleven_v4_turbo',can_do_text_to_speech:true,model_rates:{character_cost_multiplier:multiplier,cost_discount_multiplier:discount}}];
    if(url.includes('/voices/'))value={voice_id:voice,category};
    return {ok:true,json:async()=>value};
  };
  return {fetches,sockets,options:{name:'offline-test',maxRequests,sttSessionMaxSeconds:seconds,env:{BENCHMARK_LIVE:'true',BENCHMARK_MAX_CREDITS:String(cap),ELEVENLABS_API_KEY:'mock-key'},fetchImpl,WebSocketImpl:FakeSocket}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('benchmark opt-in and a numeric positive ceiling are required before any read or provider open',async()=>{
  for(const env of [{},{BENCHMARK_LIVE:'false'},{BENCHMARK_LIVE:'true'},{BENCHMARK_LIVE:'true',BENCHMARK_MAX_CREDITS:'0'},{BENCHMARK_LIVE:'true',BENCHMARK_MAX_CREDITS:'1.2'}]){
    const f=fixture();await assert.rejects(createUsageBudget({...f.options,env}),/blocked/);assert.equal(f.fetches.length,0);assert.equal(f.sockets.length,0);
  }
});

test('quota, custom voice rates and missing model pricing fail closed',async()=>{
  for(const config of [{cap:100,remaining:99},{category:'professional'},{multiplier:null},{multiplier:0},{discount:NaN}]){
    const f=fixture(config);await assert.rejects(createUsageBudget(f.options));assert.equal(f.sockets.length,0);assert.ok(f.fetches.every(call=>call.method==='GET'));
  }
});

test('streamed text reserves before send, ignores discounts, and blocks the first over-budget write',async()=>{
  const f=fixture({cap:5}),budget=await createUsageBudget(f.options),socket=new budget.WebSocket(tts,{});
  socket.send(JSON.stringify({voices:[voice]}));
  socket.send(JSON.stringify({inputs:[{voice_id:voice,text:'abc'}]}));
  assert.equal(budget.record.reservedCredits,3);
  socket.send(JSON.stringify({inputs:[{voice_id:voice,text:'xyz'}]}));await tick();
  assert.equal(socket.sent.length,2,'third message is never sent');assert.equal(socket.terminated,true);assert.equal(budget.record.reservedCredits,3);assert.match(socket.failure.message,/budget exhausted/);
  assert.throws(()=>new budget.WebSocket(tts,{}),/closed/);
  const report=await budget.finish();assert.equal(report.before.remaining,10000);assert.equal(report.after.remaining,10000);assert.equal(report.observedAccountCreditDelta,0);
  assert.ok(f.fetches.every(call=>call.method==='GET'));
});

test('higher live model multipliers round upward and HTTP generation shares the same budget',async()=>{
  const f=fixture({cap:5,multiplier:1.5}),budget=await createUsageBudget(f.options);
  const options={method:'POST',body:JSON.stringify({model_id:'eleven_v4_turbo',text:'abc'})};
  await budget.fetchTts(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`,options);assert.equal(budget.record.reservedCredits,5);
  await assert.rejects(budget.fetchTts(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`,options),/exhausted/);
  assert.equal(f.fetches.filter(call=>call.method==='POST').length,1);
  await budget.finish();
});

test('full conservative STT reservation precedes connect and duration is bounded by both PCM and a timer',async()=>{
  const insufficient=fixture({cap:5999,seconds:15}),small=await createUsageBudget(insufficient.options);
  assert.throws(()=>new small.WebSocket(stt,{}),/exhausted/);assert.equal(insufficient.sockets.length,0);await small.finish();
  const f=fixture({cap:6000,seconds:.01}),budget=await createUsageBudget(f.options),socket=new budget.WebSocket(stt,{});
  assert.equal(budget.record.reservedCredits,6000);assert.equal(budget.record.sttReservedSeconds,60);
  socket.send(JSON.stringify({message_type:'input_audio_chunk',sample_rate:16000,audio_base_64:Buffer.alloc(640).toString('base64')}));await tick();
  assert.equal(socket.sent.length,0);assert.equal(socket.terminated,true);await budget.finish();
  const clock=fixture({cap:6000,seconds:.01}),timed=await createUsageBudget(clock.options),connection=new timed.WebSocket(stt,{});
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(connection.terminated,true);await timed.finish();
});

test('provider request count, approved voice, and approved endpoints are separately enforced',async()=>{
  const f=fixture({maxRequests:1}),budget=await createUsageBudget(f.options);
  assert.throws(()=>new budget.WebSocket('wss://untrusted.example/voice',{}),/not approved/);
  assert.throws(()=>new budget.WebSocket(`${tts.replace('eleven_v4_turbo','unknown')}`,{}),/Unverified/);
  const socket=new budget.WebSocket(tts,{});
  socket.send(JSON.stringify({voices:['not-approved']}));await tick();assert.equal(socket.sent.length,0);
  assert.throws(()=>new budget.WebSocket(tts,{}),/ceiling/);assert.equal(f.sockets.length,1);
  await budget.finish();
});

test('all six real Eleven benchmark entrypoints refuse an unapproved run before model or provider work',()=>{
  for(const name of ['eleven-tts','stt-latency','voice-pipeline','latency-iteration','latency-round2','latency-round2-prewarm']){
    const result=spawnSync(process.execPath,[`benchmarks/${name}.mjs`],{cwd:new URL('..',import.meta.url),env:{...process.env,BENCHMARK_LIVE:'false'},encoding:'utf8',timeout:5000});
    assert.notEqual(result.status,0,name);assert.match(result.stderr,/Live benchmark blocked/,name);
  }
});
