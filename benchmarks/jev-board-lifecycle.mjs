// Three paired production loopback trials, six main API calls maximum.
// STT emits known transcripts and TTS emits silent PCM after a fixed 100ms.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {lifecycleFixture,subjects,settle} from '../tests/helpers/tutor-lifecycle.mjs';
import {createOpenAILuna} from '../server/openai-luna.mjs';
import {createJevIntentRouter} from '../server/jev-intent.mjs';
import {createJevCanvasRouter} from '../server/jev.mjs';
import {createMaterialRetrieval} from '../server/material-retrieval.mjs';
import {createUsageLedger} from '../server/usage-ledger.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
const live=process.argv.includes('--live'),final=process.argv.includes('--final'),file=new URL(live?final?'./jev-board-lifecycle-results.final.json':'./jev-board-lifecycle-results.json':'./jev-board-lifecycle-results.offline.json',import.meta.url);
const hash=content=>createHash('sha256').update(content).digest('hex');
const inputs=[
 {id:'biology-to-history',subject:subjects.biology,board:'Cell membrane: selective boundary. Cytoplasm surrounds the nucleus.',prompt:'Put the cell diagram away. Let us switch to the French Revolution. Just tell me verbally which materials I should add for that topic.'},
 {id:'algebra-verbal-detour',subject:subjects.algebra,board:'2x + 3 = 11\n2x = 8\nx = 4',prompt:'Hide the board for now; I want a short verbal overview of how to plan this week’s revision instead. Please just give one sentence.'},
 {id:'grammar-to-forces',subject:subjects.grammar,board:'Although it was raining, Maya walked to class.\nAlthough it was raining: dependent clause.',prompt:'We have finished this sentence. Move to the force balance on a block. Just tell me verbally whether these notes cover that topic, without drawing yet.'},
];
const report={startedAt:new Date().toISOString(),live,model:'gpt-5.6-terra',counts:{openai:0,jev:0},caps:{openai:final?8:6,jev:12},runs:[],sources:{},scope:'Same current production live-voice adapter, with LUNA_EARLY_BOARD_HIDE off versus on. Three paired synthetic topic changes; condition order alternates. Real Terra and real Jev, local source lookup without semantic prefetch, no bank or grading. STT and TTS are deterministic doubles: first silent PCM100ms after first speech chunk; not actual ElevenLabs latency/cost. Complete trial holds shared provider lock. Tiny sample, not production percentiles.'};
for(const path of ['server/jev-intent.mjs','server/live-voice.mjs','server/openai-luna.mjs'])report.sources[path]=hash(await readFile(new URL(`../${path}`,import.meta.url)));
if(live&&(!process.env.OPENAI_API_KEY?.trim()||!process.env.TYPESAFE_API_KEY?.trim()))throw Error('Missing provider configuration');
for(const [index,item]of inputs.entries())for(const enabled of index%2?[true,false]:[false,true]){
  const record={id:`${item.id}-${enabled?'early':'legacy'}`,scenario:item.id,enabled,prompt:item.prompt,events:[],requests:[]},cleanup=[];
  let started=0,measuring=false,pending=0;
  const event=(type,details={})=>{if(measuring)record.events.push({type,atMs:Math.round((performance.now()-started)*10)/10,details});};
  const ledger=createUsageLedger({file:null});
  const counted=async(url,options)=>{
    const provider=url==='https://api.openai.com/v1/responses'?'openai':url==='https://api.typesafe.ai/v1/systemone'?'jev':null;
    if(!provider||report.counts[provider]>=report.caps[provider])throw Error('Provider call ceiling');
    if(!live)throw Error('Offline run must use fixtures');report.counts[provider]++;
    const body=JSON.parse(options.body),request={provider,model:body.model,atMs:Math.round((performance.now()-started)*10)/10,operation:provider==='jev'?Object.keys(body.questions).join(','):'tutor',inputHash:hash(options.body)};record.requests.push(request);
    const response=await fetch(url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(40000)].filter(Boolean))});request.status=response.status;return response;
  };
  const env={...process.env,LIVE_APIS:'true',LUNA_ORGANIZER:'openai-api',LUNA_TUTOR_MODEL:'gpt-5.6-terra',LUNA_EARLY_BOARD_HIDE:enabled?'on':'off'};
  const realIntent=createJevIntentRouter({env,fetchImpl:counted,usageLedger:ledger});
  const realCanvas=createJevCanvasRouter({env,fetchImpl:counted,usageLedger:ledger});
  const run=async()=>{
    const f=await lifecycleFixture({after:fn=>cleanup.push(fn)},{subject:item.subject,timeoutMs:45000,env,start:{whiteboard:{title:item.subject.topic,revision:'saved',blocks:[{id:'old-note',type:'text',content:item.board}]},whiteboardVisible:true},integrations:{usageLedger:ledger,
      createMaterialRetrievalImpl:config=>createMaterialRetrieval({...config,env:{}}),
      createLunaFastImpl:options=>{const actual=createOpenAILuna({...options,fetchImpl:counted});return{ready:async()=>{},close:()=>actual.close(),respond:async(input,callbacks)=>{
        if(!measuring){callbacks.onText?.('Welcome.');return{reply:'Welcome.'};}
        if(options.mode==='visual')throw Error('Unexpected recovery; preserve failed trial without extra model calls.');
        pending++;event('main-start');record.visibleAtMainStart=input.whiteboardContext.visible;
        try{if(!live){callbacks.onText?.('We can discuss that verbally.');return{reply:'We can discuss that verbally.'};}return await actual.respond(input,{...callbacks,onText:text=>{event('main-text',{text});callbacks.onText?.(text);}});}finally{pending--;event('main-complete');f.notify();}
      }};},
      createSpeechStreamImpl:options=>{let canceled=false,timer;return{write(){if(!timer)timer=setTimeout(()=>{if(!canceled){event('simulated-first-audio');options.onAudio(Buffer.alloc(480).toString('base64'));}},100);},finish(){setTimeout(()=>{if(!canceled)options.onEnd();},110);},cancel(){canceled=true;clearTimeout(timer);}};},
      intentRouter:{classify:async(...args)=>{const result=live?await realIntent.classify(...args):{answerAttempt:false,requestsHelp:false,shouldCloseBoard:enabled};event('intent',result);return result;}},
      canvasRouter:{classify:async(...args)=>{if(!measuring)return{needsCanvas:false};pending++;try{const result=live?await realCanvas.classify(...args):{needsCanvas:false,shouldClose:!enabled};event('canvas-decision',result);return result;}finally{pending--;f.notify();}}},
      diagnostics:{record:(_,value)=>event(value.type,value.details)},
    }});
    started=performance.now();measuring=true;f.commit(item.prompt);
    await f.waitFor(()=>f.messages.some(m=>m.type==='error')||(f.messages.some(m=>m.role==='assistant'&&m.final)&&pending===0&&record.events.some(e=>e.type==='canvas-decision')),'real main and board decision');await settle();
    record.messages=f.messages;record.status=f.messages.some(m=>m.type==='error')?'failed':'completed';
    record.closeAtMs=record.events.find(e=>e.type==='whiteboard.closed')?.atMs??null;
    record.closeReason=record.events.find(e=>e.type==='whiteboard.closed')?.details?.reason??null;
    record.firstTextMs=record.events.find(e=>e.type==='main-text')?.atMs??null;
    record.mainCompleteMs=record.events.find(e=>e.type==='main-complete')?.atMs??null;
    record.simulatedFirstAudioMs=record.events.find(e=>e.type==='simulated-first-audio')?.atMs??null;
    record.usage=await ledger.snapshot(f.start.testId);
  };
  try{if(live)await withProviderSlot(run);else await run();}catch(error){record.status='failed';record.failure={code:'trial-failed',name:error.name};}
  finally{measuring=false;for(const fn of cleanup.reverse())await fn();await ledger.close();}
  report.runs.push(record);await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({id:record.id,status:record.status,closeAtMs:record.closeAtMs,firstTextMs:record.firstTextMs,completeMs:record.mainCompleteMs,reason:record.closeReason,counts:report.counts}));
}
report.finishedAt=new Date().toISOString();await writeFile(file,JSON.stringify(report,null,2)+'\n');
