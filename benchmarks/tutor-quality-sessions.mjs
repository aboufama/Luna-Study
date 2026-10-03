import {EventEmitter,once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {createOpenAILuna,createOpenAIOrganizer} from '../server/openai-luna.mjs';
import {lunaInstructions} from '../server/luna-fast.mjs';
import {createJevIntentRouter} from '../server/jev-intent.mjs';
import {createJevCanvasRouter} from '../server/jev.mjs';
import {createJevTutorIntentRouter} from '../server/jev-tutor-intent.mjs';
import {createQuestionBank} from '../server/question-bank.mjs';
import {createMasteryStore,checkedGrade} from '../server/mastery.mjs';
import {createHintPolicy,createHintPolicyStore} from '../server/hint-policy.mjs';
import {sourceCitationIds} from '../server/grade-citations.mjs';
import {tokenUsage} from '../server/usage-ledger.mjs';
import {estimateUsage} from '../server/usage-pricing.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
import {createVirtualClock,settle,materials,topics,equations,biology,hintTexts,fixtureBankOrganizer,pairedScript} from './tutor-quality-fixtures.mjs';

const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function parseInput(payload){
  if(typeof payload.input==='string')return JSON.parse(payload.input);
  const message=payload.input?.find(item=>item.role==='user'),content=message?.content;
  return JSON.parse(typeof content==='string'?content:content?.find(item=>item.type==='input_text')?.text||'{}');
}
function streamResponse(raw,model){
  const response={status:'completed',model,usage:{input_tokens:0,output_tokens:0},output:[{type:'message',content:[{type:'output_text',text:raw}]}]};
  return new Response(new ReadableStream({start(controller){for(const value of [{type:'response.output_text.delta',delta:raw},{type:'response.completed',response}])controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
}
function fakeResponse(payload,tutorOutputImpl){
  const input=parseInput(payload);
  if(input.studentAnswer){
    const expected=[...equations,biology].find(item=>item.question===input.question.question);
    const verdict=input.studentAnswer.includes('x = 7')?'incorrect':input.studentAnswer.includes('I subtracted 3.')&&input.question.question===equations[0].question?'partial':expected&&input.studentAnswer.includes(expected.answer)?'correct':'unclear';
    const grade={questionId:input.question.id,topicId:input.question.topicId,sourceIds:input.question.sourceIds,verdict,reasoningSufficient:true,assistanceUsed:false,assistanceCitationIds:[],answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:sourceCitationIds(input)};
    if(input.attemptContext?.provisional){grade.targetAttempt=Boolean(expected&&(input.studentAnswer.includes(expected.answer)||input.studentAnswer.includes('x = 7')));if(!grade.targetAttempt)grade.verdict='unclear';}
    return Response.json({status:'completed',model:payload.model,usage:{input_tokens:0,output_tokens:0},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(grade)}]}]});
  }
  const override=tutorOutputImpl?.(input);
  if(typeof override==='string')return streamResponse(override,payload.model);
  const text=input.conversation?.findLast(turn=>turn.role==='user')?.content||'',hints=input.hintContext,working=input.activeQuestion||input.workingProblem;
  let raw;
  if(hints?.hintAllowed)raw=`<say>${hintTexts[hints.hintNumber-1]}</say>`;
  else if(text.startsWith('Please start with the hard equation')&&working?.question===equations[0].question)raw=`<say>${working.question}</say>`;
  else if(/just solve|don't know|tell me the answer/i.test(text))raw='<say>The answer is x = 4. Subtract 3 and divide by 2.</say>';
  else if(text.startsWith('My answer is'))raw='<say>We can check that reasoning against the original notes.</say>';
  else if(text.includes("don't have a calculator"))raw='<say>You can work through these integer operations mentally. Tell me one operation you can justify.</say>';
  else if(/which problem/.test(text)&&working)raw=`<say>We are working on ${working.question}</say>`;
  else if(/stop for a bit/.test(text))raw='<say>Of course. Take a break; we can continue when you return.</say>';
  else {
    const available=input.privateQuestionBank?.topics?.flatMap(topic=>topic.questions)||[];
    const candidates=available.filter(q=>q.difficulty==='hard');
    const selected=candidates.find(q=>/membrane/.test(text)?q.sourceIds.includes('biology-notes'):q.sourceIds.includes('equation-notes'))||candidates[0];
    raw=selected?`<say>Let's try one question.</say><ask>${selected.id}</ask>`:'<say>Welcome. We can practice from your original notes.</say>';
  }
  return streamResponse(raw,payload.model);
}

export async function runQualitySession({arm='current',live=false,script=pairedScript,virtualDurationMs=30*60_000,onProgress=()=>{},artifactPath,startOverrides={},providerBudget,semanticProbes=live&&arm==='current',tutorOutputImpl,intentRouterImpl,canvasRouterImpl,instructionsOverride}={}){
  const {attachLiveVoice}=await import(arm==='before'?'./tutor-quality/before-live-voice.mjs':'../server/live-voice.mjs');
  const baseline=await readFile(new URL('./tutor-quality/before-instructions.txt',import.meta.url),'utf8');
  const frozenInstructions=instructionsOverride??(arm==='before'?baseline:lunaInstructions('voice'));
  const directory=await mkdtemp(join(tmpdir(),'luna-quality-session-')),clock=createVirtualClock(),originVirtual=clock.now(),began=performance.now();
  const record={arm,live,status:'running',startedAt:new Date().toISOString(),virtualDurationMs,voiceInstructions:{sha256:sha(frozenInstructions),characters:frozenInstructions.length,text:frozenInstructions},method:'Real production loopback voice orchestration, canonical question bank and persisted mastery. Virtual interaction/absence clock. Synthetic ElevenLabs transport; original synthetic sources. Live mode uses actual tutor, Jev decisions and two independent graders. Fixed bank preparation isolates tutoring/policy behavior from question-generator variation.',sources:materials.map(source=>({id:source.id,name:source.name,text:source.text,sha256:sha(source.text)})),steps:[],messages:[],diagnostics:[],requests:[],usage:[],modelResults:[],gradeResults:[],problems:[],errors:[],providerCounts:{openai:0,jev:0},ceilings:{openai:24,jev:24}};
  if(providerBudget)record.ceilings={...providerBudget.limits,scope:'shared-across-scenarios'};
  const observers=[],changes=new EventEmitter();let pending=0,currentMode='voice',stepId='welcome',stt=null,closed=false;
  const notify=()=>changes.emit('change');
  const at=()=>({virtualMs:clock.now()-originVirtual,wallMs:Math.round(performance.now()-began),stepId});
  const save=async()=>{if(artifactPath){await mkdir(resolve(artifactPath,'..'),{recursive:true});await writeFile(artifactPath,JSON.stringify(record,null,2)+'\n');}};
  const fetchImpl=async(url,init={})=>{
    const target=String(url),provider=target==='https://api.openai.com/v1/responses'?'openai':target==='https://api.typesafe.ai/v1/systemone'?'jev':null;
    if(!provider)throw Error('Unexpected benchmark provider destination.');
    const payload=JSON.parse(init.body||'{}');
    if(provider==='openai'&&payload.stream&&currentMode==='voice')payload.instructions=frozenInstructions;
    const input=provider==='openai'?parseInput(payload):null;
    const request={...at(),provider,model:payload.model,kind:provider==='jev'?Object.keys(payload.questions||{}).join(','):input.studentAnswer?'grading':currentMode==='visual'?'recovery':'tutor',instructionSha256:provider==='openai'?sha(payload.instructions||''):undefined,inputSummary:input?{sourceIds:input.materials?.map(source=>source.id)||[],activeQuestionId:input.activeQuestion?.id||null,hintContext:input.hintContext||null,bankQuestions:input.privateQuestionBank?.topics?.flatMap(topic=>topic.questions.map(q=>({id:q.id,hasReferenceAnswer:Object.hasOwn(q,'answer')})))||[]}:undefined,status:'pending'};
    if(input&&request.inputSummary){
      request.inputSummary.workingProblem=input.workingProblem||null;
      request.inputSummary.gradingContext=input.gradingContext||null;
      request.inputSummary.turnTask=input.turnTask||null;
      request.inputSummary.encounteredQuestions=(Array.isArray(input.encounteredQuestions)?input.encounteredQuestions:[]).map(({id,topicId,topicTitle,difficulty,question,sourceIds,attempts,assisted})=>({id,topicId,topicTitle,difficulty,question,sourceIds,attempts,assisted}));
      if(input.attemptContext)request.inputSummary.attemptContext=input.attemptContext;
      // These are benchmark-owned synthetic originals and public grading
      // evidence, not provider reasoning. Preserve the exact future input so
      // independent replays need not reconstruct its conversation from events.
      if(input.studentAnswer)request.gradingInput=structuredClone(input);
    }
    if(provider==='jev')request.classificationState=payload.state;
    record.requests.push(request);pending++;notify();
    try{
      if(live){const counts=providerBudget?.counts||record.providerCounts,limits=providerBudget?.limits||record.ceilings;if(counts[provider]>=limits[provider]){request.status='budget-blocked';throw Error('Provider request ceiling reached.');}if(providerBudget)counts[provider]++;record.providerCounts[provider]++;}
      const response=live?await fetch(target,{...init,body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.any([...(init.signal?[init.signal]:[]),AbortSignal.timeout(60_000)])}):fakeResponse(payload,tutorOutputImpl);
      request.httpStatus=response.status;
      const observing=(async()=>{
        try{
          // The production adapter deliberately stops reading at completed.
          // Retain observed frames even if its final abort cancels this clone.
          const reader=response.clone().body.getReader(),decoder=new TextDecoder();let raw='',readError=null,result;
          try{while(true){const part=await reader.read();if(part.done)break;raw+=decoder.decode(part.value,{stream:true});}}catch(error){readError=error.name;}finally{raw+=decoder.decode();reader.releaseLock();}
          if(payload.stream){const events=raw.split('\n').filter(line=>line.startsWith('data: ')&&line!=='data: [DONE]').flatMap(line=>{try{return[JSON.parse(line.slice(6))];}catch{return[];}});request.publicOutput=events.filter(event=>event.type==='response.output_text.delta').map(event=>event.delta||'').join('');result=events.findLast(event=>event.type==='response.completed')?.response;}
          else {result=JSON.parse(raw);if(provider==='openai'){request.publicOutput=(result.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text||'').join('');try{request.structuredOutput=JSON.parse(request.publicOutput);}catch{/* A nonstructured response remains available as public output. */}}}
          if(result){if(provider==='jev')request.classificationAnswers=result.answers;request.usage=tokenUsage(result.usage);request.resolvedModel=result.model||payload.model;request.serviceTier=result.service_tier;request.estimatedCost=live?estimateUsage({provider:provider==='jev'?'typesafe':'openai',model:request.resolvedModel,status:'completed',units:request.usage,serviceTier:request.serviceTier}):null;}
          request.status=result?(response.ok?'completed':'http-error'):'observation-incomplete';
          if(readError)request.observationReadError=readError;
        }catch{request.status='observation-incomplete';}
        finally{request.durationMs=Math.round(performance.now()-began-request.wallMs);pending--;notify();}
      })();observers.push(observing);return response;
    }catch(error){request.status=request.status==='budget-blocked'?request.status:init.signal?.aborted?'canceled':'failed';pending--;notify();throw error;}
  };
  const env={...process.env,LIVE_APIS:'true',LUNA_ORGANIZER:'openai-api',LUNA_API_MODEL:'gpt-6-luna',LUNA_TUTOR_MODEL:'gpt-5.6-terra',LUNA_VOICE_PLANNER:'false',LUNA_SESSION_MAX_MINUTES:'60',ELEVENLABS_API_KEY:'synthetic-no-network',OPENAI_API_KEY:live?process.env.OPENAI_API_KEY:'synthetic-no-network',TYPESAFE_API_KEY:live?process.env.TYPESAFE_API_KEY:'synthetic-no-network'};
  const usageLedger={start(_testId,metadata){const event={...at(),...metadata,status:'pending',units:{}};record.usage.push(event);return{update(value={}){Object.assign(event.units,value.units);if(value.model)event.model=value.model;if(value.serviceTier)event.serviceTier=value.serviceTier;},finish(value={}){this.update(value);event.status=value.status||'completed';notify();}};}};
  const organizer=createOpenAIOrganizer({env,fetchImpl,usageLedger});
  const bank=createQuestionBank({organizer:fixtureBankOrganizer(),idleDelayMs:0,batchSize:12,maxContextChars:24000});
  const start={testId:randomUUID(),title:'Algebra and cell biology quiz practice',date:'2026-10-14',localToday:'2026-10-02',difficulty:'test',indexStatus:'ready',materials,topics,...startOverrides};
  bank.schedule(start,{topics});
  while((bank.context(start)?.topics.length||0)<2)await sleep(2);
  const masteryStore=createMasteryStore({path:join(directory,'mastery.json'),shared:false});
  const hintStore=createHintPolicyStore({now:clock.now});
  class FakeStt extends EventEmitter{
    static OPEN=1;
    constructor(){super();stt=this;this.readyState=1;this.bufferedAmount=0;queueMicrotask(()=>this.receive({message_type:'session_started'}));}
    receive(value){if(this.readyState===1)this.emit('message',Buffer.from(JSON.stringify(value)));}
    send(_,callback){callback?.();}
    terminate(){if(this.readyState!==3){this.readyState=3;this.emit('close');}}
  }
  function createSpeechStreamImpl(options){let canceled=false,delivered=false;return {write(text){if(canceled)return;record.messages.push({...at(),type:'synthetic-speech',text});if(!delivered){delivered=true;queueMicrotask(()=>{if(!canceled)options.onAudio(Buffer.alloc(480).toString('base64'));});}},finish(){queueMicrotask(()=>{if(!canceled)options.onEnd();});},cancel(){canceled=true;}};}
  const realIntent=createJevIntentRouter({env,fetchImpl,usageLedger}),realCanvas=createJevCanvasRouter({env,fetchImpl,usageLedger});
  const server=createServer((_,res)=>res.writeHead(404).end());
  const pipeline=attachLiveVoice(server,{env,cliOrganizer:organizer,questionBank:bank,masteryStore,usageLedger,WebSocketImpl:FakeStt,createSpeechStreamImpl,createMaterialRetrievalImpl:()=>null,
    sessionTiming:{...clock,idleMs:60_000,checkInMs:30_000,settleMs:300},createHintPolicyImpl:()=>createHintPolicy({store:hintStore}),
    createLunaFastImpl:options=>{const actual=createOpenAILuna({...options,fetchImpl});return {...actual,async respond(input,opts){pending++;currentMode=options.mode||'voice';notify();try{const result=await actual.respond(input,opts);record.modelResults.push({...at(),mode:currentMode,reply:result.reply,board:result.board||null,boardStatus:result.boardStatus,questionId:result.questionId});return result;}finally{pending--;notify();}}};},
    intentRouter:intentRouterImpl||(live?realIntent:{classify(text,context){return{source:'fixture',requestsHelp:["I don't know. Can you just solve it for me?",'Please give me another hint.','Just tell me the answer.'].includes(text),answerAttempt:Boolean(context.activeQuestion)&&text.startsWith('My answer is'),examDeadline:false,shouldCloseBoard:/change topics/.test(text)};}}),
    canvasRouter:canvasRouterImpl||(live?realCanvas:{classify:async()=>({needsCanvas:false,continuesWorkingProblem:true})}),tutorIntentRouter:live?createJevTutorIntentRouter({env,fetchImpl,usageLedger}):{classify:async()=>({acknowledgesMastery:false})},
    gradeAnswerImpl:async args=>{pending++;notify();try{const grade=await checkedGrade({...args,organizer});record.gradeResults.push({...at(),questionId:args.question.id,question:args.question.question,answer:args.answer,checkedGradeInput:structuredClone({testId:args.testId,question:args.question,answer:args.answer,materials:args.materials,conversation:args.conversation,...(args.attemptContext?{attemptContext:args.attemptContext}:{})}),grade});return grade;}finally{pending--;notify();}},
    sessionHistory:{start:()=>randomUUID(),context:async()=>null,problem:(_id,value)=>{record.problems.push({...at(),...value});notify();}},
    diagnostics:{record:(_id,event)=>{record.diagnostics.push({...at(),...event});notify();}},
  });
  let client,audioHeartbeat;
  async function quiet(timeoutMs=75_000){const until=performance.now()+timeoutMs;let stable=0;while(performance.now()<until){await settle();const n=record.messages.length+record.diagnostics.length+record.requests.length;if(pending===0){await sleep(live?60:5);if(pending===0&&n===record.messages.length+record.diagnostics.length+record.requests.length){if(++stable>=2)return;continue;}}stable=0;await sleep(10);}throw Error('Session did not settle before deadline.');}
  async function packet(value){if(client.readyState!==WebSocket.OPEN)throw Error('Loopback client is closed.');client.send(JSON.stringify(value));const pong=once(client,'pong');client.ping();let timer;try{await Promise.race([pong,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Loopback control packet was not acknowledged.')),3000);})]);}finally{clearTimeout(timer);}await settle();}
  async function advanceTo(elapsed,{active=true}={}){
    const target=originVirtual+elapsed;
    while(clock.now()<target){const step=Math.min(20_000,target-clock.now());if(active&&arm==='current')await packet({type:'activity'});await clock.advance(step);await quiet();}
  }
  try{
    await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
    client=new WebSocket(`${origin.replace('http:','ws:')}/api/live-voice`,{origin});
    client.on('message',bytes=>{const value=JSON.parse(bytes);record.messages.push({...at(),...value,...(value.audio?{audio:undefined,audioBytes:Buffer.from(value.audio,'base64').length}:{})});if(process.env.QUALITY_DEBUG==='1')console.log(JSON.stringify({arm,event:value.type,state:value.state,pending}));notify();});
    client.on('close',(code)=>{if(!closed)record.errors.push({code:'client-closed',closeCode:code});notify();});
    await once(client,'open');await packet({type:'start',...start});
    audioHeartbeat=setInterval(()=>{if(client.readyState===WebSocket.OPEN&&stt?.readyState===1)client.send(JSON.stringify({type:'audio',audio:Buffer.alloc(320).toString('base64')}));},1000);
    await quiet();
    for(const descriptor of script){
      stepId=descriptor.id;await advanceTo(descriptor.at,{active:descriptor.id!=='resume'});
      const action={...descriptor,...(typeof descriptor.adapt==='function'?await descriptor.adapt(record):{})};
      const snapshot={id:action.id,virtualMs:clock.now()-originVirtual,input:action.text||action.packet,...(action.adaptation?{adaptation:action.adaptation}:{}),requestsBefore:record.requests.length,messagesBefore:record.messages.length};record.steps.push(snapshot);
      if(action.index){
        const nextMaterials=action.index.materials,nextTopics=action.index.topics;
        await packet({type:'materials',materials:nextMaterials,indexStatus:'indexing'});
        const indexed={...start,materials:nextMaterials};bank.schedule(indexed,{topics:nextTopics});
        while(!bank.context(indexed))await sleep(2);
        await packet({type:'index-status',status:'ready',revision:nextMaterials.map(item=>item.id).join('|')});
      }
      else if(action.text){if(stt?.readyState!==1){snapshot.skipped='STT paused/unavailable';}else stt.receive({message_type:'committed_transcript',text:action.text});}
      else if(arm==='before'&&['hint','resume','pause','activity'].includes(action.packet?.type))snapshot.featureUnavailable='This control did not exist in the baseline UI/protocol; no unsupported packet was sent.';
      else await packet(action.packet);
      await quiet();await clock.advance(500);await quiet();
      snapshot.replies=record.messages.slice(snapshot.messagesBefore).filter(message=>message.type==='transcript'&&message.role==='assistant'&&message.final).map(message=>message.text);
      snapshot.hintState=record.messages.findLast(message=>message.type==='hint-state')||null;snapshot.requests=record.requests.length-snapshot.requestsBefore;
      snapshot.mastery=record.messages.findLast(message=>message.type==='mastery')?.mastery||null;
      await save();onProgress({arm,step:action.id,requests:record.providerCounts,replies:snapshot.replies.length});
    }
    stepId='end';await advanceTo(virtualDurationMs);await quiet();await masteryStore.flush();
    if(semanticProbes){
      record.semanticProbes=[];
      for(const activeQuestion of ['What does Q mean in Q = mcΔT?','Calculate the heat transferred using Q = mcΔT from the supplied numbers.']){
        const text='What does Q mean?',result=await realIntent.classify(text,{activeQuestion,previousAssistant:activeQuestion,conversation:[{role:'assistant',content:activeQuestion}]},{testId:start.testId});
        record.semanticProbes.push({text,activeQuestion,result});
      }
    }
    try{record.masteryLedger=JSON.parse(await readFile(join(directory,'mastery.json'),'utf8')).tests[start.testId];}catch{record.masteryLedger=null;}
    record.status='completed';
  }catch(error){record.status='failed';record.errors.push({code:error.message==='Provider request ceiling reached.'?'request-cap':'harness-or-runtime-failure',message:error.message});}
  finally{closed=true;clearInterval(audioHeartbeat);client?.terminate();await pipeline.close();bank.close();await masteryStore.flush();await new Promise(done=>server.close(done));await Promise.allSettled(observers);await rm(directory,{recursive:true,force:true});record.finishedAt=new Date().toISOString();record.actualWallMs=Math.round(performance.now()-began);record.simulatedMinutes=(clock.now()-originVirtual)/60_000;record.costEstimateUsd=record.requests.reduce((sum,item)=>sum+(item.estimatedCost?.usd||0),0);record.usageMissingFor=record.requests.filter(item=>live&&item.status!=='budget-blocked'&&!item.usage).length;if(providerBudget)record.sharedBudget={limits:{...providerBudget.limits},countsAtFinish:{...providerBudget.counts}};await save();}
  return record;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const live=process.argv.includes('--live'),requested=process.argv.find(arg=>arg.startsWith('--arm='))?.split('=')[1]||'current';
  const arms=requested==='both'?['before','current']:[requested];if(arms.some(arm=>!['before','current'].includes(arm)))throw Error('Unknown benchmark arm.');
  const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||`benchmarks/tutor-quality/${live?'live':'offline'}-results.json`;
  try{await readFile(output);throw Error('Refusing to overwrite prior benchmark results.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const report={live,startedAt:new Date().toISOString(),scope:'Virtual30-minute timeline, not30minutes of human study or measured learning gain. No paid ElevenLabs calls. Shared complete synthetic sources with solutions intentionally present to test withholding. Original-source retrieval prefetch disabled in both arms to isolate tutor policy. Fixed original question-bank fixtures; real bank identity/consumption. Before snapshots orchestration+voice instructions; shared adapters/grading dependencies remain current.',sessions:[]};
  const run=async()=>{for(const arm of arms){const session=await runQualitySession({arm,live,artifactPath:output.replace(/\.json$/,`.${arm}.json`),onProgress:value=>console.log(JSON.stringify(value))});report.sessions.push(session);await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2)+'\n');};
  if(live)await withProviderSlot(run);else await run();
  console.log(JSON.stringify({output,results:report.sessions.map(session=>({arm:session.arm,status:session.status,simulatedMinutes:session.simulatedMinutes,requests:session.providerCounts,errors:session.errors}))}));
}
