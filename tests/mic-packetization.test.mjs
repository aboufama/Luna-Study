import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { LiveVoiceSession } from '../src/live-voice.js';

const code=await readFile(new URL('../public/live-mic-worklet.js',import.meta.url),'utf8');
function processAudio({inputRate=48000,chunkSamples,frames=[128],seconds=1}={}) {
  const packets=[];let Processor,processedInputs=0;
  const context=vm.createContext({sampleRate:inputRate,AudioWorkletProcessor:class{constructor(){this.port={postMessage:packet=>packets.push({...packet,inputFrameEnd:processedInputs})};}},registerProcessor:(_name,Class)=>{Processor=Class;},Int16Array,Math});
  new vm.Script(code).runInContext(context);
  const processor=new Processor({processorOptions:{chunkSamples}}),inputSamples=Math.round(inputRate*seconds);
  let frameIndex=0;
  for(let offset=0;offset<inputSamples;){
    const length=Math.min(frames[frameIndex++%frames.length],inputSamples-offset),frame=new Float32Array(length);
    // A sum of tones exposes reset artifacts and resampling phase shifts.
    for(let i=0;i<length;i++){const t=(offset+i)/inputRate;frame[i]=.35*Math.sin(2*Math.PI*437*t)+.1*Math.cos(2*Math.PI*1237*t);}
    processedInputs=offset+length;assert.equal(processor.process([[frame]]),true);offset+=length;
  }
  return{packets,pcm:Buffer.concat(packets.map(packet=>Buffer.from(packet.audio))),processor};
}

for(const inputRate of [44100,48000])test(`20 ms packets preserve exactly the original PCM at ${inputRate} Hz input`,()=>{
  const original=processAudio({inputRate,seconds:2}),fast=processAudio({inputRate,chunkSamples:320,seconds:2,frames:[128,73,256,64,97]});
  assert.equal(original.packets.length,20);assert.equal(fast.packets.length,100);
  assert.equal(fast.pcm.length,64_000,'32,000 samples at 16 kHz; no loss or duplicated samples');
  assert.deepEqual(fast.pcm,original.pcm,'packet size and processing callback boundaries cannot change samples');
  assert.ok(fast.packets.every(packet=>packet.audio.byteLength===640&&Number.isFinite(packet.rms)&&packet.rms>0));
});

test('shorter packets reduce capture batching delay without waiting for a 100 ms group',()=>{
  const slow=processAudio(),fast=processAudio({chunkSamples:320});
  assert.ok(slow.packets[0].inputFrameEnd/48000*1000>=100);
  assert.ok(fast.packets[0].inputFrameEnd/48000*1000>=20);
  assert.ok(fast.packets[0].inputFrameEnd/48000*1000<23,'only render-quantum rounding remains at 48 kHz');
  assert.equal(slow.packets.length,10);assert.equal(fast.packets.length,50);
  // Sample timestamps inside one complete packet give a precise batching-only
  // bound; microphone drivers, rendering and network delay are not included.
  const maximumDelayMs=samples=>(samples-1)/16000*1000;
  assert.equal(maximumDelayMs(1600)-maximumDelayMs(320),80);
  assert.equal((maximumDelayMs(1600)-maximumDelayMs(320))/2,40);
});

test('unknown worklet options preserve the bounded original packet size',()=>{
  for(const chunkSamples of [undefined,0,-1,Infinity,1600,'320',1_000_000]){
    const result=processAudio({chunkSamples});
    assert.equal(result.packets.length,10);assert.ok(result.packets.every(packet=>packet.audio.byteLength===3200));
  }
});

test('only GPT-Live requests 20 ms microphone packets and cleanup stops the mock track',async t=>{
  const descriptors=new Map(['window','navigator','AudioWorkletNode'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(()=>{for(const[key,descriptor]of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  const created=[],tracks=[];
  class Context{constructor(){this.audioWorklet={addModule:async()=>{}};this.destination={};}async resume(){}async close(){}createMediaStreamSource(){return{connect(){},disconnect(){}};}createGain(){return{gain:{value:1},connect(){},disconnect(){}};}}
  Object.defineProperty(globalThis,'window',{configurable:true,value:{AudioContext:Context}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{const track={stopped:false,stop(){this.stopped=true;}};tracks.push(track);return{getTracks:()=>[track]};}}}});
  Object.defineProperty(globalThis,'AudioWorkletNode',{configurable:true,value:class{constructor(_context,name,options){created.push({name,options});this.port={};}connect(){}disconnect(){}}});
  for(const socketPath of ['/api/live-voice','/api/gpt-live']){const session=new LiveVoiceSession({socketPath});await session.openMicrophone();session.stopMicrophone();}
  assert.deepEqual(created.map(item=>item.options.processorOptions.chunkSamples),[1600,320]);
  assert.ok(tracks.every(track=>track.stopped));
});
