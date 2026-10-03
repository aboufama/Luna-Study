import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpeechAlignment } from '../shared/speech-alignment.mjs';
import { captionCues, createCaptionTimeline } from '../src/caption-timing.mjs';
import { LiveVoiceSession } from '../src/live-voice.js';
const alignment=(text,step=100)=>({chars:[...text],char_start_times_ms:[...text].map((_,i)=>i*step),char_durations_ms:[...text].map(()=>step)});

test('alignment validates bounded chunk-relative timestamps, snake and camel schemas',()=>{
  const data=alignment('Hi ',100);
  assert.deepEqual(normalizeSpeechAlignment(data,300),{chars:['H','i',' '],startsMs:[0,100,200],durationsMs:[100,100,100]});
  assert.ok(normalizeSpeechAlignment({chars:data.chars,charStartTimesMs:data.char_start_times_ms,charDurationsMs:data.char_durations_ms},300));
  for(const bad of [null,{...data,char_durations_ms:[100]}, {...data,char_start_times_ms:[0,200,100]}, {...data,char_start_times_ms:[0,Infinity,200]}, {...data,char_start_times_ms:[1000,1100,1200]}, {...data,chars:['H',{},' ']}])assert.equal(normalizeSpeechAlignment(bad,300),null);
});

test('model final and network final cannot reveal words before scheduled audio',()=>{
  const clock=createCaptionTimeline();clock.setText('Hi there.');
  clock.addAudio({start:10,duration:1,alignment:alignment('Hi there.',100)});clock.finish();
  assert.equal(clock.tick(9.99),null);
  assert.equal(clock.tick(10.21).text,'Hi');
  assert.equal(clock.tick(10.5),null);
  assert.equal(clock.tick(10.91).text,'Hi there.');
  assert.equal(clock.tick(11),null);assert.ok(clock.complete);
});

test('audio queue gaps do not advance captions and split words join across chunks',()=>{
  const clock=createCaptionTimeline();clock.setText('Mitochondria.');
  clock.addAudio({start:1,duration:.4,alignment:alignment('Mito',100)});
  assert.equal(clock.tick(1.4).text,'','the heard prefix keeps an unfinished word hidden, while its phrase may be visible');
  clock.addAudio({start:4,duration:.8,alignment:alignment('chondria.',100)});clock.finish();
  assert.equal(clock.tick(3.9),null,'silence gap consumes no media time');
  assert.equal(clock.tick(4.79),null);
  assert.equal(clock.tick(4.8).text,'Mitochondria.');
});

test('missing alignment estimates only against consumed PCM and completes at playback end',()=>{
  const clock=createCaptionTimeline();clock.setText('First part and the final phrase.');
  clock.addAudio({start:1,duration:4});
  assert.equal(clock.tick(.9),null);
  assert.equal(clock.tick(2).text,'First part');
  clock.finish();assert.equal(clock.tick(2),null,'end packet does not move the caption');
  const middle=clock.tick(3);assert.equal(middle.timing,'estimated');assert.notEqual(middle.text,'First part and the final phrase.');
  assert.equal(clock.tick(5).text,'First part and the final phrase.');assert.ok(clock.complete);
});

test('an EOF arriving after drained PCM never jumps to an unspoken estimated suffix',()=>{
  const clock=createCaptionTimeline();clock.setText('A deliberately much longer transcript than this tiny chunk.');
  clock.addAudio({start:1,duration:.25});clock.tick(1.25);clock.finish();
  assert.equal(clock.tick(2),null);
});

function client(t){
  const captions=[],transcripts=[],sources=[];
  const session=new LiveVoiceSession({onCaption:value=>captions.push(value),onTranscript:value=>transcripts.push(value)});
  session.context={currentTime:0,state:'running',outputTime:0,getOutputTimestamp(){return {contextTime:this.outputTime};},
    createBuffer(_channels,length,rate){return {duration:length/rate,getChannelData:()=>new Float32Array(length)};},
    createBufferSource(){const source={connect(){},disconnect(){},start(time){this.startTime=time;},stop(){this.stopped=true;}};sources.push(source);return source;},destination:{},close:async()=>{}};
  t.after(()=>{session.closed=true;session.clearAudio();});
  const tick=(contextTime,outputTime=contextTime)=>{session.context.currentTime=contextTime;session.context.outputTime=outputTime;session.updateCaption();};
  const audio=(turnId,text)=>session.playChunk({turnId,audio:Buffer.alloc(48000).toString('base64'),alignment:alignment(text,100)});
  return {session,captions,transcripts,sources,tick,audio};
}

test('client uses output playhead, preserves full analytics, pauses and resumes without wall-clock advance',t=>{
  const f=client(t);f.session.receiveTranscript({role:'assistant',text:'Hi there.',final:true,turnId:1});
  assert.equal(f.transcripts[0].text,'Hi there.');assert.ok(f.captions.every(value=>value.text===''));
  f.audio(1,'Hi there.');f.session.receiveAudioEnd(1);
  f.tick(.8,.24);assert.equal(f.captions.at(-1).text,'Hi','queued PCM does not imply heard words');
  f.session.context.state='suspended';f.tick(1.2);assert.equal(f.captions.at(-1).text,'Hi');
  f.session.context.state='running';f.tick(1.2);assert.equal(f.captions.at(-1).text,'Hi there.');
});

test('barge-in, late packets, replacement turns and stop clear caption timers and text',t=>{
  const f=client(t);f.session.receiveTranscript({role:'assistant',text:'Old words.',final:true,turnId:1});f.audio(1,'Old words.');
  f.tick(.5);assert.equal(f.captions.at(-1).text,'Old');
  f.session.ignoredTurns.add(1);f.session.clearAudio();assert.equal(f.captions.at(-1).text,'');assert.equal(f.session.captionTimer,null);
  f.audio(1,'Old words.');f.session.receiveTranscript({role:'assistant',text:'Late!',turnId:1});f.session.receiveAudioEnd(1);
  assert.equal(f.captions.at(-1).text,'');assert.equal(f.transcripts.length,1);
  f.session.receiveTranscript({role:'assistant',text:'New words.',final:true,turnId:2});f.audio(2,'New words.');
  f.tick(1);assert.equal(f.captions.at(-1).text,'New');
  f.session.close();assert.equal(f.captions.at(-1).text,'');assert.equal(f.session.captionTimer,null);assert.ok(f.sources.every(source=>source.stopped));
});

test('film phrases show a few whole words at the first aligned word, never the generated final cue',()=>{
  const text='The first step compares both choices. The next step considers the other player. Finally we check the equilibrium.';
  const clock=createCaptionTimeline({maxChars:48});clock.setText(text);
  clock.addAudio({start:5,duration:text.length*.1,alignment:alignment(text,100)});clock.finish();
  assert.equal(clock.tick(4.99),null);
  const initial=clock.tick(5.01);assert.equal(initial.phrase,'The first step compares both choices.');assert.equal(initial.text,'');
  const middle=clock.tick(6);assert.equal(middle.phrase,initial.phrase,'the whole cue stays steady as its words play');
  const cues=captionCues(text,48);const next=clock.tick(5+cues[1].start*.1+.01);
  assert.equal(next.phrase,cues[1].text);assert.notEqual(next.phrase,cues.at(-1).text);
  assert.equal(clock.tick(5+text.length*.1).phrase,cues.at(-1).text);
});

test('responsive cue fitting reflows the current playback point without moving it',()=>{
  const text='Compare the first row with the second row to identify the best possible response for this player.';
  const clock=createCaptionTimeline({maxChars:76});clock.setText(text);clock.addAudio({start:0,duration:10,alignment:alignment(text,100)});
  const wide=clock.tick(.1);clock.setMaxChars(36);const narrow=clock.tick(.1);
  assert.ok(narrow.phrase.length<=36);assert.ok(wide.phrase.length>narrow.phrase.length);assert.equal(narrow.cue.start,0);assert.equal(clock.playedSeconds,.1);
});

test('output timestamp zero is not replaced by a future audio scheduling clock',t=>{
  const f=client(t);f.session.receiveTranscript({role:'assistant',text:'Hi there.',final:true,turnId:1});f.audio(1,'Hi there.');f.session.receiveAudioEnd(1);
  f.tick(.8,0);assert.ok(f.captions.every(value=>!value.text&&!value.phrase));
});
