import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {WebSocketServer} from 'ws';
import {createAudioProbe,deriveTrialMetrics,speechEnergyEnd,summarizeLatencies,auditSpokenFidelity} from './gpt-live-audio-probe.mjs';

test('speech endpoint excludes trailing silence, preserves actual 16-bit input',()=>{
  const pcm=Buffer.alloc(6400);
  for(let index=0;index<3200;index+=2)pcm.writeInt16LE(index%4?1000:-1000,index);
  assert.equal(speechEnergyEnd(pcm),3200);
  assert.equal(speechEnergyEnd(Buffer.alloc(320)),0);
  assert.throws(()=>speechEnergyEnd(Buffer.alloc(3)),/16-bit/);
});

test('first audio retains overlapping filler and never claims useful answer latency',()=>{
  const input={startedAtMs:100,energySpeechEndAtMs:500,pcmEndAtMs:540};
  const events=[
    {type:'audio',atMs:50,bytes:400},
    {type:'audio',atMs:480,bytes:200,turnId:2},
    {type:'transcript',atMs:485,role:'assistant',text:'Okay.',final:false,turnId:2},
    {type:'transcript',atMs:650,role:'user',text:'Help me.',final:true,turnId:2},
    {type:'audio',atMs:950,bytes:600,turnId:2},
    {type:'transcript',atMs:1000,role:'assistant',text:'Okay. What have you tried?',final:true,turnId:2},
    {type:'audio-end',atMs:1200,turnId:2,approx:true},
  ];
  const result=deriveTrialMetrics(events,input);
  assert.equal(result.energySpeechEndToFirstAudioMs,-20);
  assert.equal(result.commitToFirstAudioMs,-170);
  assert.equal(result.outputAudioBytes,800);
  assert.equal(result.firstUsefulAudioMs,null);
  assert.equal(result.outputOverlapsInput,true);
  assert.deepEqual(result.assistantTranscripts,['Okay. What have you tried?']);
});

test('summary excludes failed attempts without erasing their denominator upstream',()=>{
  assert.deepEqual(summarizeLatencies([{status:'complete',energySpeechEndToFirstAudioMs:100},{status:'failed',energySpeechEndToFirstAudioMs:1},{status:'complete',energySpeechEndToFirstAudioMs:300}]),{n:2,median:200,minimum:100,maximum:300});
  assert.equal(summarizeLatencies([]).n,0);
});

test('reported native voice text is checked separately from approved backend captions',()=>{
  const events=[
    {phase:'test',type:'transcript',role:'assistant',final:true,text:'Why is the membrane selective?'},
    {phase:'test',type:'voice-debug',eventType:'live-output-transcript',deliveredStreamActive:false,delta:'Okay. '},
    {phase:'test',type:'voice-debug',eventType:'live-output-transcript',deliveredStreamActive:true,delta:'How does it maintain homeostasis?'},
    {phase:'test',type:'audio-end',approx:true},
  ];
  const [result]=auditSpokenFidelity(events);
  assert.equal(result.exactReportedTextMatch,false);
  assert.equal(result.transcriptWhileDeliveryActive,'How does it maintain homeostasis?');
  assert.equal(result.approximateAudioEnd,true);
});

test('a permitted neutral prefix remains distinct from literal and normalized equality',()=>{
  const events=[
    {phase:'test',type:'transcript',role:'assistant',final:true,text:'Tell me your first step.'},
    {phase:'test',type:'voice-debug',eventType:'live-output-transcript',deliveredStreamActive:true,delta:'Okay, tell me your first step.'},
  ];
  const [result]=auditSpokenFidelity(events,{matchApprovedBody:(expected,actual)=>actual.replace(/^Okay, /,'').toLowerCase()===expected.toLowerCase()});
  assert.equal(result.trimmedLiteralTextMatch,false);
  assert.equal(result.exactReportedTextMatch,false);
  assert.equal(result.approvedBodyMatch,true);
  assert.equal(result.allowedNeutralPrefixApplied,true);
});

test('loopback probe exercises startup, real-time audio packets, transcript and bounded teardown',async()=>{
  const server=createServer(),wss=new WebSocketServer({server});
  let sent=0,stopped=false,startedSpeech=false;
  wss.on('connection',socket=>{
    const send=packet=>socket.send(JSON.stringify(packet));
    socket.on('message',raw=>{
      const packet=JSON.parse(raw);
      if(packet.type==='start'){
        send({type:'ready'});send({type:'audio',audio:Buffer.alloc(320).toString('base64'),sampleRate:16000,turnId:1});
        send({type:'transcript',role:'assistant',text:'Try this question.',final:true,turnId:1});send({type:'audio-end',turnId:1,approx:true});
      }else if(packet.type==='audio'){
        if(Buffer.from(packet.audio,'base64').some(byte=>byte!==0))startedSpeech=true;
        if(!startedSpeech||++sent!==2)return;
        send({type:'transcript',role:'user',text:'What is next?',final:true,turnId:2});
        send({type:'transcript',role:'assistant',text:'Tell me your first step.',final:false,turnId:2});
        send({type:'audio',audio:Buffer.alloc(640).toString('base64'),sampleRate:16000,turnId:2});
        send({type:'canvas',visible:false,board:null});
        send({type:'transcript',role:'assistant',text:'Tell me your first step.',final:true,turnId:2});send({type:'audio-end',turnId:2,approx:true});
      }else if(packet.type==='stop')stopped=true;
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  let probe;
  try{
    probe=await createAudioProbe({origin,path:'/api/gpt-live',start:{title:'Synthetic probe'},timeoutMs:5000});
    await probe.drainGreeting({waitMs:1000});
    const pcm=Buffer.alloc(6400);for(let index=0;index<3200;index+=2)pcm.writeInt16LE(1000,index);
    const result=await probe.utterance({id:'question',text:'What is next?',pcm,maxSilenceMs:1000,replyTimeoutMs:1000});
    assert.equal(result.status,'complete');assert.equal(result.outputAudioBytes,640);assert.equal(result.outputAudioChunks,1);
    assert.deepEqual(result.assistantTranscripts,['Tell me your first step.']);
    assert.ok(result.energySpeechEndToFirstAudioMs>=90);assert.ok(result.energySpeechEndToFirstAudioMs<1000);
    assert.equal(probe.record.events.filter(event=>event.type==='audio').every(event=>!Object.hasOwn(event,'audio')),true);
    assert.equal(probe.record.events.find(event=>event.type==='audio-end').approx,true);
    assert.equal(probe.record.events.find(event=>event.type==='audio').sampleRate,16000);
    probe.close();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(stopped,true);
  }finally{
    probe?.close();for(const client of wss.clients)client.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));
  }
});

test('probe refuses remote origins before opening a network connection',async()=>{
  await assert.rejects(createAudioProbe({origin:'https://api.openai.com',start:{}}),/loopback/);
});
