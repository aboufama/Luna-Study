import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveVoiceSession } from '../src/live-voice.js';

function fixture(t, socketPath='/api/gpt-live') {
  const sources=[],session=new LiveVoiceSession({socketPath});
  session.context={currentTime:0,state:'running',destination:{},
    createBuffer(_channels,length,rate){const samples=new Float32Array(length);return{duration:length/rate,getChannelData:()=>samples,samples};},
    createBufferSource(){const source={connect(){},disconnect(){},start(time){this.startTime=time;},stop(){this.stopped=true;}};sources.push(source);return source;},
  };
  t.after(()=>{session.closed=true;session.clearAudio();});
  let sample=0;
  function packet(atMs,{rate=16000,durationMs=40,turnId=1}={}) {
    const bytes=Buffer.alloc(rate*durationMs/1000*2);
    for(let i=0;i<bytes.length;i+=2)bytes.writeInt16LE(Math.round(Math.sin(2*Math.PI*437*sample++/rate)*8000),i);
    session.context.currentTime=atMs/1000;
    session.playChunk({audio:bytes.toString('base64'),sampleRate:rate,turnId});
    return bytes;
  }
  return {session,sources,packet};
}

test('continuous 16 kHz sine remains contiguous under bounded packet jitter',t=>{
  const f=fixture(t),arrivals=[0,49,101,120,182,205,267,280,337,370];
  const input=arrivals.map(at=>f.packet(at));
  assert.equal(f.sources[0].startTime,.080,'one small startup reserve, not a delay per chunk');
  for(let i=1;i<f.sources.length;i++)assert.ok(Math.abs(f.sources[i].startTime-f.sources[i-1].startTime-f.sources[i-1].buffer.duration)<1e-10,'adjacent chunks share an exact sample boundary');
  for(let index=0;index<input.length;index++)for(let sample=0;sample<input[index].length/2;sample++)assert.equal(f.sources[index].buffer.samples[sample],input[index].readInt16LE(sample*2)/32768,'the jitter buffer does not alter PCM or speech rate');
});

test('a continuous packet arriving before its deadline does not create a new safety-margin gap',t=>{
  const f=fixture(t);f.packet(0,{durationMs:100});f.packet(170,{durationMs:100});
  assert.equal(f.sources[1].startTime,.18,'10 ms of queued audio is enough to append without a gap');
});

test('an actual continuous-stream underrun reestablishes the bounded reserve once',t=>{
  const f=fixture(t);f.packet(0,{durationMs:100});f.packet(220,{durationMs:100});f.packet(310,{durationMs:100});
  assert.equal(f.sources[1].startTime,.30);
  assert.equal(f.sources[2].startTime,.40);
  assert.ok(f.sources.every(source=>source.startTime>=0),'no chunk is scheduled retroactively');
});

test('burst ElevenLabs TTS retains its previous 25 ms onset and sample rate',t=>{
  const f=fixture(t,'/api/live-voice');f.packet(0,{rate:24000,durationMs:100});f.packet(40,{rate:24000,durationMs:100});
  assert.equal(f.sources[0].startTime,.025);assert.equal(f.sources[1].startTime,.125);
  assert.equal(f.sources[0].buffer.duration,.1);
});

test('interrupt clears queued jitter reserve and stale packets; new speech gets a fresh reserve',t=>{
  const f=fixture(t);f.packet(0);f.packet(40);
  f.session.ignoredTurns.add(1);f.session.clearAudio();f.packet(60);
  assert.equal(f.sources.length,2);assert.ok(f.sources.every(source=>source.stopped));
  f.packet(70,{turnId:2});assert.ok(Math.abs(f.sources[2].startTime-.15)<1e-10);
  assert.equal(f.session.turnId,2);
});
