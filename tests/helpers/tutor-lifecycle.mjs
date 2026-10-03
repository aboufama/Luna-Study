// Loopback transport; all provider boundaries are controlled test doubles.
// Real live-voice orchestration, question bank and mastery persistence are used.
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {attachLiveVoice} from '../../server/live-voice.mjs';
import {createQuestionBank} from '../../server/question-bank.mjs';
import {createMasteryStore} from '../../server/mastery.mjs';

export const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
export const subjects={
  biology:{title:'Biology',topic:'Membranes',source:'A cell membrane is a selective boundary. The nucleus lies inside the cell.',question:'Why is a cell membrane called a selective boundary?',answer:'It controls which substances cross the cell boundary.',hint:'Consider which substances can cross the boundary.'},
  algebra:{title:'Algebra',topic:'Equations',source:'For 2x + 3 = 11, subtract 3 from both sides to obtain 2x = 8, then divide by 2 to obtain x = 4.',question:'How do equal operations solve 2x + 3 = 11?',answer:'Subtract 3 from both sides, then divide both sides by 2, giving x = 4.',hint:'Subtract 3 from both sides before dividing by 2.'},
  grammar:{title:'Grammar',topic:'Clauses',source:'Although it was raining, Maya walked to class. Although it was raining is the dependent clause.',question:'Why is Although it was raining a dependent clause?',answer:'Although makes the clause depend on the main clause to complete the thought.',hint:'Consider what the subordinating conjunction Although does.'},
  physics:{title:'Physics',topic:'Forces',source:'For a stationary block with no vertical acceleration, N − mg = 0. Horizontal net force is F − f = ma.',question:'Why does N − mg equal zero for a block without vertical acceleration?',answer:'Newton’s second law gives zero net vertical force because vertical acceleration is zero.',hint:'Apply Newton’s second law along the vertical direction.'},
};

export async function lifecycleFixture(t,{subject=subjects.biology,start:extra={},integrations={},env={},bank=false,timeoutMs=2000}={}){
  const dir=await mkdtemp(join(tmpdir(),'luna-modular-lifecycle-'));
  const store=createMasteryStore({path:join(dir,'mastery.json'),shared:false});
  const start={title:subject.title,date:'2026-10-14',indexStatus:'ready',testId:randomUUID(),materials:[{id:'notes',name:`${subject.title} notes`,text:subject.source}],...extra};
  const messages=[],calls=[],speech=[],stt=[],decisions=[],problems=[],changes=new EventEmitter();
  const notify=()=>changes.emit('change');
  const waitFor=(predicate,label='condition')=>predicate()?Promise.resolve():new Promise((resolve,reject)=>{
    const check=()=>{if(predicate()){clearTimeout(timer);changes.off('change',check);resolve();}};
    const timer=setTimeout(()=>{changes.off('change',check);reject(Error(`Timed out: ${label}`));},timeoutMs);
    changes.on('change',check);check();
  });
  let questionBank,questions=[];
  if(bank){
    let batch=0;
    questionBank=createQuestionBank({idleDelayMs:0,organizer:{available:true,async organize(request){
      if(batch++)throw Error('Fixture deliberately stops background refill.');
      return{questions:request.slots.map(slot=>({slotId:slot.slotId,difficulty:slot.difficulty,question:slot.difficulty==='hard'?subject.question:`What is the ${slot.difficulty} idea in ${subject.topic}?`,answer:`PRIVATE REFERENCE: ${subject.answer}`,sourceIds:slot.sourceIds}))};
    }}});
    assert.equal(questionBank.schedule(start,{topics:[{title:subject.topic,summary:subject.source,sourceIds:['notes']}]}),true);
    for(let n=0;!questionBank.context(start)&&n<200;n++)await new Promise(resolve=>setTimeout(resolve,5));
    questions=questionBank.context(start)?.topics[0]?.questions||[];assert.equal(questions.length,3);
  }
  class MockStt extends EventEmitter{
    static OPEN=1;
    constructor(){super();this.readyState=1;this.bufferedAmount=0;stt.push(this);queueMicrotask(()=>this.receive({message_type:'session_started'}));}
    receive(value){this.emit('message',Buffer.from(JSON.stringify(value)));}
    send(_,callback){callback?.();}
    terminate(){this.readyState=3;this.emit('close');}
  }
  const server=createServer((_,res)=>res.writeHead(404).end());
  const attached=attachLiveVoice(server,{cliOrganizer:{available:true,organize(){throw Error('No provider calls in lifecycle tests.');}},env:{LIVE_APIS:'true',ELEVENLABS_API_KEY:'test-double',...env},WebSocketImpl:MockStt,questionBank,masteryStore:store,
    createLunaFastImpl:({mode='voice'})=>({ready:async()=>{},close:async()=>{},respond(input,options){
      if(input.readinessContext?.trigger==='session-start'){options.onText?.('Welcome.');return Promise.resolve({reply:'Welcome.'});}
      return new Promise((resolve,reject)=>{calls.push({mode,input,options,resolve,reject});notify();});
    }}),
    createSpeechStreamImpl:options=>{const stream={options,writes:[],cancellations:0,finishes:0,write(text){this.writes.push(text);notify();},finish(){this.finishes++;notify();},cancel(){this.cancellations++;notify();}};speech.push(stream);notify();return stream;},
    intentRouter:{classify:()=>({answerAttempt:false,requestsHelp:false,examDeadline:false})},
    tutorIntentRouter:{classify:async()=>({acknowledgesMastery:false})},canvasRouter:{classify:async()=>({needsCanvas:false})},
    sessionHistory:{start:()=> 'fixture-session',context:async()=>null,problem:(_,event)=>{problems.push(event);notify();}},
    diagnostics:{record:(_,event)=>{decisions.push(event);notify();}},...integrations});
  let client;
  t.after(async()=>{client?.terminate();await attached.close();await new Promise(resolve=>server.close(resolve));questionBank?.close();await store.flush();await rm(dir,{recursive:true,force:true});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  client=new WebSocket(`${origin.replace('http:','ws:')}/api/live-voice`,{origin});
  client.on('message',bytes=>{messages.push(JSON.parse(bytes.toString()));notify();});
  await once(client,'open');client.send(JSON.stringify({type:'start',...start}));
  await waitFor(()=>messages.some(m=>m.type==='study-ready')&&messages.some(m=>m.setup&&m.final),'ready and greeting');
  const restored=messages.find(m=>m.type==='canvas');
  client.send(JSON.stringify({type:'interrupt'}));await waitFor(()=>messages.some(m=>m.type==='interrupt'));
  await store.flush();await settle();messages.length=0;speech.length=0;decisions.length=0;
  const packet=async value=>{client.send(JSON.stringify(value));const pong=once(client,'pong');client.ping();await pong;await settle();};
  return{start,store,questionBank,questions,calls,speech,messages,decisions,problems,restored,waitFor,notify,packet,
    commit:text=>stt.at(-1).receive({message_type:'committed_transcript',text}),partial:text=>stt.at(-1).receive({message_type:'partial_transcript',text}),
    ledger:async()=>JSON.parse(await readFile(join(dir,'mastery.json'),'utf8')).tests[start.testId],
  };
}

export function conversation(input){
  const seen=new Map();
  return[...(input.conversationMemory?.earlierTurns||[]).map(([id,role,value])=>{const content=typeof value==='string'?value:seen.get(value.repeat);assert.equal(typeof content,'string');seen.set(id,content);return{role,content};}),...input.conversation];
}
