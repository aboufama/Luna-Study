// Paid only with explicit --live and BENCHMARK_LIVE=true. The run uses isolated
// in-memory test context and an ephemeral local port, never the user's demo.
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createAudioProbe,speechEnergyEnd,summarizeLatencies,auditSpokenFidelity} from './gpt-live-audio-probe.mjs';
import {createUsageBudget} from './usage-budget.mjs';
import {attachLiveVoice} from '../server/live-voice.mjs';
import {createOpenAIOrganizer,createOpenAILuna} from '../server/openai-luna.mjs';
import {createSpeechStream} from '../server/speech-stream.mjs';
import {createUsageLedger} from '../server/usage-ledger.mjs';
import {createMasteryStore} from '../server/mastery.mjs';
import {createQuestionBank} from '../server/question-bank.mjs';
import {createJevIntentRouter} from '../server/jev-intent.mjs';
import {createJevCanvasRouter} from '../server/jev.mjs';
import {createJevTutorIntentRouter} from '../server/jev-tutor-intent.mjs';
import {createMaterialRetrieval} from '../server/material-retrieval.mjs';
import {validateVoiceSetup} from '../server/onboarding.mjs';
import {materials,topics,fixtureBankOrganizer} from './tutor-quality-fixtures.mjs';

const PHRASE="My test is tomorrow. Let's practice active and passive transport.";
const SOURCE_MODEL='eleven_flash_v2_5';
const hash=value=>createHash('sha256').update(value).digest('hex');
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const POLICIES=[
  {id:'canonical-question',text:'Please ask me the membrane transport question.'},
  {id:'unauthorized-hint',text:"I don't know. Please give me a hint."},
  {id:'problem-switch',text:"Let's switch to solving two x plus three equals eleven. Ask me without solving it."},
];
const setup=(testId,scenario='smoke')=>({testId,title:scenario==='policy'?'Membrane transport then equations quiz':'Synthetic cell transport quiz',date:'2026-10-03',localToday:'2026-10-02',difficulty:'test',indexStatus:'ready',materials:scenario==='policy'?[materials[1],materials[0]]:materials.filter(source=>source.id==='biology-notes'),topics:scenario==='policy'?[topics[1],topics[0]]:topics.filter(topic=>topic.title==='Cell transport')});

export async function runComparison({output,sessions=2,scenario='smoke',env=process.env,onProgress=()=>{}}={}) {
  if(env.BENCHMARK_LIVE!=='true')throw Error('Set BENCHMARK_LIVE=true only for the explicitly authorized paid comparison.');
  if(![1,2,4].includes(sessions))throw Error('Only one GPT-Live session, the two-session smoke or four-session comparison is supported.');
  if(!output)throw Error('Choose a fresh results path.');
  if(!['smoke','policy'].includes(scenario))throw Error('Choose smoke or policy scenario.');
  validateVoiceSetup(setup(randomUUID(),scenario));
  try{await readFile(output);throw Error('Refusing to overwrite existing benchmark results.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const codeHashes={};
  for(const file of ['../server/gpt-live-transport.mjs','../server/live-voice.mjs','../server/openai-luna.mjs','../server/material-retrieval.mjs','./gpt-live-audio-probe.mjs','./gpt-live-compare.mjs'])codeHashes[file]=hash(await readFile(new URL(file,import.meta.url)));
  const {createGptLiveTransport,normalizeGptLiveSpeechText,compareGptLiveSpeech}=await import('../server/gpt-live-transport.mjs');
  const fidelityOptions={normalize:normalizeGptLiveSpeechText,matchApprovedBody:(expected,actual)=>compareGptLiveSpeech(expected,actual).matched,normalization:'number-and-operator-preserving; one finite neutral prefix allowed only with complete approved body; raw text retained'};
  if(codeHashes['../server/gpt-live-transport.mjs']!==hash(await readFile(new URL('../server/gpt-live-transport.mjs',import.meta.url))))throw Error('Voice adapter changed during benchmark setup; restart with a stable revision.');
  const directory=await mkdtemp(join(tmpdir(),'luna-gpt-live-compare-'));
  const script=scenario==='policy'?POLICIES:[{id:'transport-practice',text:PHRASE}];
  const report={startedAt:new Date().toISOString(),status:'running',scenario,script,codeHashes,sessions:[],method:'Matched synthetic 16 kHz PCM replayed at real-time cadence into isolated production voice orchestration. Startup speech is drained before measured requests. No microphone/speaker, no saved audio, no human learning claim. First received PCM can be filler; useful academic answer audio latency is unmeasured. GPT-Live audio-end may be a silence heuristic. Stop for manual review at the first native voice/backend text mismatch.',configuration:{retrieval:'production Jev prefetch and bounded retrieval tools enabled',questionBank:'fixed fixture preparation; production bank identity, masking and consumption',mastery:'isolated production store and production checked grading',studySources:'original synthetic text fixtures; no screenshot or import-indexing benchmark in this cohort'},ceilings:{sessions,sessionSeconds:scenario==='policy'?90:60,wholeRunSeconds:480,openaiBackendRequests:scenario==='policy'?40:24,jevRequests:scenario==='policy'?96:32},sources:[],providerRequests:{openai:0,jev:0},models:{tutor:env.LUNA_TUTOR_MODEL||env.LUNA_API_MODEL||'gpt-6-luna',gptLive:'gpt-live-1',stt:'scribe_v2_realtime',tts:env.ELEVENLABS_REALTIME_MODEL_ID||'eleven_v4_turbo'}};
  let usage,activeProbe,activePipeline;
  const runAbort=new AbortController();
  const runTimer=setTimeout(()=>{runAbort.abort();activeProbe?.close();void activePipeline?.close();},report.ceilings.wholeRunSeconds*1000);
  runTimer.unref?.();
  report.timingEnvironment={inputChunkMs:100,continuousSilenceChunkMs:100,browserMicrophoneBatchingTested:false,maxEventLoopLagMs:0,valid:true};
  let lastTick=performance.now();
  const clockGuard=setInterval(()=>{
    const now=performance.now(),lag=Math.max(0,now-lastTick-1000);lastTick=now;
    report.timingEnvironment.maxEventLoopLagMs=Math.max(report.timingEnvironment.maxEventLoopLagMs,Math.round(lag));
    if(lag>5000){report.timingEnvironment.valid=false;report.timingEnvironment.reason='Host/process paused for more than5seconds; latency cohort aborted.';runAbort.abort();activeProbe?.close();void activePipeline?.close();}
  },1000);clockGuard.unref?.();
  const save=async()=>{await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');};
  const boundedFetch=async(url,init={})=>{
    if(runAbort.signal.aborted)throw Error('Comparison whole-run duration ceiling reached.');
    const target=String(url),provider=target==='https://api.openai.com/v1/responses'?'openai':target==='https://api.typesafe.ai/v1/systemone'?'jev':null;
    if(!provider)throw Error('Unexpected benchmark provider endpoint.');
    const ceiling=provider==='openai'?report.ceilings.openaiBackendRequests:report.ceilings.jevRequests;
    if(report.providerRequests[provider]>=ceiling)throw Error('Comparison provider request ceiling reached.');
    report.providerRequests[provider]++;
    return fetch(url,{...init,redirect:'error',signal:AbortSignal.any([runAbort.signal,...(init.signal?[init.signal]:[]),AbortSignal.timeout(30_000)])});
  };
  try{
    usage=await createUsageBudget({name:'gpt-live-compare',maxRequests:24,sttSessionMaxSeconds:report.ceilings.sessionSeconds,ttsModels:[report.models.tts,SOURCE_MODEL],env,fetchImpl:(url,init)=>fetch(url,{...init,signal:AbortSignal.any([runAbort.signal,...(init.signal?[init.signal]:[])])})});
    const voice=env.ELEVENLABS_VOICE_ID?.trim()||'JBFqnCBsd6RMkjVDRZzb';
    const clips=new Map();
    for(const action of script){
      const generated=await usage.fetchTts(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_16000`,{method:'POST',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({text:action.text,model_id:SOURCE_MODEL,seed:12345,language_code:'en'}),signal:AbortSignal.timeout(15_000)});
      if(!generated.ok){await generated.body?.cancel();throw Error(`Synthetic voice request failed (HTTP ${generated.status}).`);}
      const pcm=Buffer.from(await generated.arrayBuffer());
      if(!pcm.length||pcm.length%2||pcm.length>32000*12)throw Error('Synthetic input is invalid or exceeds 12 seconds.');
      clips.set(action.id,pcm);report.sources.push({id:action.id,model:SOURCE_MODEL,pcmBytes:pcm.length,sha256:hash(pcm),durationMs:pcm.length/32,energySpeechEndMs:speechEnergyEnd(pcm)/32,generationCharacters:[...action.text].length});
    }
    const order=sessions===1?['gpt-live']:sessions===2?['eleven','gpt-live']:['eleven','gpt-live','gpt-live','eleven'];
    for(const [index,arm] of order.entries()){
      const testId=randomUUID(),ledger=createUsageLedger({file:null});
      const diagnostics=[],debug={record:(id,event)=>{diagnostics.push({testId:id,...event});}};
      const organizer=createOpenAIOrganizer({env,usageLedger:ledger,diagnostics:debug,fetchImpl:boundedFetch});
      const bank=createQuestionBank({organizer:fixtureBankOrganizer(),idleDelayMs:0});
      const masteryStore=createMasteryStore({path:join(directory,`${index}-mastery.json`),shared:false});
      const server=createServer((_,res)=>{res.writeHead(404);res.end();});
      const options={env:{...env,LUNA_ORGANIZER:'openai-api',LIVE_APIS:'true'},cliOrganizer:organizer,questionBank:bank,masteryStore,usageLedger:ledger,diagnostics:debug,
        createLunaFastImpl:options=>{
          const responder=createOpenAILuna({...options,fetchImpl:boundedFetch});
          return {...responder,async respond(...args){try{return await responder.respond(...args);}catch(error){debug.record(testId,{type:'benchmark.backend-error',message:String(error.message).slice(0,500)});throw error;}}};
        },createMaterialRetrievalImpl:options=>createMaterialRetrieval({...options,fetchImpl:boundedFetch}),
        canvasRouter:createJevCanvasRouter({env,usageLedger:ledger,fetchImpl:boundedFetch}),intentRouter:createJevIntentRouter({env,usageLedger:ledger,fetchImpl:boundedFetch}),tutorIntentRouter:createJevTutorIntentRouter({env,usageLedger:ledger,fetchImpl:boundedFetch})};
      const pipeline=arm==='gpt-live'?attachLiveVoice(server,{...options,socketPath:'/api/gpt-live',createVoiceTransport:createGptLiveTransport}):attachLiveVoice(server,{...options,WebSocketImpl:usage.WebSocket,createSpeechStreamImpl:options=>createSpeechStream({...options,WebSocketImpl:usage.WebSocket})});
      activePipeline=pipeline;
      let probe;const session={arm,index:index+1,testId,status:'running',diagnostics};report.sessions.push(session);await save();
      try{
        const start=setup(testId,scenario);
        if(!bank.schedule(start,{topics:start.topics}))throw Error('Fixture bank could not be prepared.');
        for(let attempt=0;attempt<100&&bank.context(start)?.topics.flatMap(topic=>topic.questions).length!==start.topics.length*3;attempt++)await sleep(10);
        const prepared=bank.context(start)?.topics.flatMap(topic=>topic.questions).length||0;
        if(prepared!==start.topics.length*3)throw Error('Fixture bank did not finish before session start.');
        session.preparedBankQuestions=prepared;
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
        const origin=`http://127.0.0.1:${server.address().port}`;
        probe=await createAudioProbe({origin,path:arm==='gpt-live'?'/api/gpt-live':'/api/live-voice',start,timeoutMs:report.ceilings.sessionSeconds*1000});
        activeProbe=probe;
        session.probe=probe.record;
        await probe.drainGreeting({waitMs:20_000});
        onProgress({arm,index:index+1,stage:'startup-complete'});
        const requireFidelity=()=>{if(arm==='gpt-live'&&auditSpokenFidelity(probe.record.events,fidelityOptions).some(item=>item.approvedBodyMatch===false))throw Error('Native voice/backend text mismatch: stopped for manual fidelity review.');};
        requireFidelity();
        for(const action of script){
          const trial=await probe.utterance({...action,pcm:clips.get(action.id),replyTimeoutMs:20_000});
          session.status=trial.status;
          onProgress({arm,index:index+1,scenario:action.id,stage:trial.status,energySpeechEndToFirstAudioMs:trial.energySpeechEndToFirstAudioMs,energySpeechEndToFirstTextMs:trial.energySpeechEndToFirstTextMs});
          if(trial.status!=='complete')break;
          requireFidelity();
          if(action!==script.at(-1))await probe.drainPlayback();
        }
      }catch(error){session.status='failed';session.error=String(error.message).replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,500);}
      finally{
        probe?.close();await pipeline.close();bank.close();await masteryStore.flush();
        // Final GPT-Live usage arrives during explicit provider teardown.
        await sleep(1200);session.usage=await ledger.snapshot(testId);await ledger.close();
        session.spokenFidelity=arm==='gpt-live'?auditSpokenFidelity(probe?.record.events||[],fidelityOptions):[];
        session.qualityStatus=arm==='gpt-live'&&session.spokenFidelity.some(item=>item.approvedBodyMatch===false)?'voice-text-mismatch-requires-review':'not-semantically-reviewed';
        await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
        activeProbe=null;activePipeline=null;
        await save();
      }
      if(session.status!=='complete'){report.stoppedEarly='Stopped on the first failed session. No automatic paid retry.';break;}
    }
    report.summary=['eleven','gpt-live'].map(arm=>{const sessions=report.sessions.filter(session=>session.arm===arm),trials=sessions.flatMap(session=>session.probe?.trials||[]);return{arm,sessions:sessions.length,completed:sessions.filter(session=>session.status==='complete').length,firstAudio:summarizeLatencies(trials),firstText:summarizeLatencies(trials,'energySpeechEndToFirstTextMs'),estimatedUsd:sessions.reduce((sum,session)=>sum+(session.usage?.totals.estimatedUsd||0),0),usageComplete:sessions.every(session=>session.usage?.totals.estimateComplete)}});
    report.status=report.sessions.length===sessions&&report.sessions.every(session=>session.status==='complete')?'completed':'incomplete';
  }catch(error){report.status='failed';report.error=String(error.message).replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,500);}
  finally{clearTimeout(runTimer);clearInterval(clockGuard);if(usage)report.elevenBudget=await usage.finish();report.finishedAt=new Date().toISOString();await save();await rm(directory,{recursive:true,force:true});}
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!process.argv.includes('--live'))throw Error('This runner requires explicit --live; import the probe for offline tests.');
  const sessions=Number(process.argv.find(arg=>arg.startsWith('--sessions='))?.slice(11)||2);
  const scenario=process.argv.find(arg=>arg.startsWith('--scenario='))?.slice(11)||'smoke';
  const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||`benchmarks/gpt-live-results-${Date.now()}.json`;
  const report=await runComparison({output,sessions,scenario,onProgress:value=>console.log(JSON.stringify(value))});
  console.log(JSON.stringify({output,status:report.status,summary:report.summary,error:report.error,stoppedEarly:report.stoppedEarly}));
  if(report.status!=='completed')process.exitCode=1;
}
