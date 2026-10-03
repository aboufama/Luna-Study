import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmWav, validPcm, sseData, localRequestAllowed } from '../protocol.mjs';
import { TurnDetector } from '../audio.mjs';
test('PCM WAV framing preserves bytes, rate, and file length', () => {
  const input = Buffer.from([0,0,255,127,0,128]); const wav = pcmWav(input);
  assert.equal(wav.toString('ascii',0,4),'RIFF'); assert.equal(wav.readUInt32LE(24),16000);
  assert.equal(wav.readUInt32LE(4),wav.length-8); assert.equal(wav.readUInt32LE(40),input.length); assert.deepEqual(wav.subarray(44),input);
});
test('audio validation rejects truncated, oversized, and non-PCM input', () => {
  assert.equal(validPcm(Buffer.alloc(640).toString('base64')),true);
  for(const value of [null,'','ab!!','YWJj',Buffer.alloc(100).toString('base64')]) assert.equal(validPcm(value,10),false);
});
test('stream parser handles split UTF-8, CRLF, keepalives, and stop sentinel', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\ndata: {"delta":"hé"}\r\n\r\ndata: {"delta":"llo"}\n\ndata: [DONE]\n\ndata: {"delta":"ignored"}\n');
  async function* body(){for(let i=0;i<bytes.length;i+=3)yield bytes.slice(i,i+3);}
  const result=[];for await(const m of sseData(body()))result.push(m);
  assert.deepEqual(result,[{delta:'hé'},{delta:'llo'}]);
});
test('loopback boundary blocks foreign hosts and cross-origin requests', () => {
  const allowed=(host,origin)=>localRequestAllowed({headers:{host,origin}},5196);
  assert.equal(allowed('localhost:5196','http://localhost:5196'),true);
  assert.equal(allowed('127.0.0.1:5196','http://127.0.0.1:5196'),true);
  assert.equal(allowed('localhost:5196','https://evil.example'),false);
  assert.equal(allowed('evil.example','http://localhost:5196'),false);
});
test('turn detector retains onset, waits through a brief pause, and rejects silence', () => {
  let starts=0;const turns=[];const vad=new TurnDetector({onStart:()=>starts++,onEnd:t=>turns.push(t),silenceMs:460});
  let t=0;const feed=(count,level)=>{for(let i=0;i<count;i++){t+=20;vad.push(new Float32Array(320).fill(level),t);}};
  feed(30,0);assert.equal(starts,0);feed(20,.1);feed(12,0);assert.equal(turns.length,0);feed(12,.1);feed(23,0);
  assert.equal(starts,1);assert.equal(turns.length,1);assert.equal(turns[0].committedAt-turns[0].endedAt,460);assert.ok(turns[0].audio.length>320*32);assert.equal(vad.active,false);
  feed(100,0);assert.equal(turns.length,1);
});
