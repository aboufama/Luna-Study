// Post-run audit only: reads saved public benchmark traces, no API calls.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalizeGptLiveSpeechText,compareGptLiveSpeech} from '../server/gpt-live-transport.mjs';
import {auditSpokenFidelity,summarizeLatencies} from './gpt-live-audio-probe.mjs';

export async function auditComparison(path){
  const raw=await readFile(path,'utf8'),report=JSON.parse(raw);
  let environment=null;
  try{environment=JSON.parse(await readFile(path.replace(/\.json$/,'-environment.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const phases=report.sessions.map(session=>({
    arm:session.arm,index:session.index,status:session.status,error:session.error,
    trialFailures:session.probe?.trials.filter(trial=>trial.status!=='complete').map(({id,error})=>({id,error}))||[],
    fidelity:session.arm==='gpt-live'?auditSpokenFidelity(session.probe?.events||[],{normalize:normalizeGptLiveSpeechText,matchApprovedBody:(expected,actual)=>compareGptLiveSpeech(expected,actual).matched,normalization:'number-and-operator-preserving plus one finite neutral prefix'}).map(phase=>({...phase,comparison:compareGptLiveSpeech(phase.approved,phase.transcriptWhileDeliveryActive)})):[],
    spokenFidelityEvents:session.probe?.events.filter(event=>event.type==='voice-debug'&&event.eventType==='live-speech-fidelity').map(({atMs,phase,matched,audioBinding})=>({atMs,phase,matched,audioBinding}))||[],
    applicationFallbacks:session.probe?.events.filter(event=>event.type==='voice-debug'&&event.eventType==='live-delegation'&&event.reason==='transcript-idle-fallback').map(({atMs,phase,transcriptCharacters})=>({atMs,phase,transcriptCharacters}))||[],
    modelDelegations:session.probe?.events.filter(event=>event.type==='voice-debug'&&event.eventType==='live-delegation'&&event.reason!=='transcript-idle-fallback').length||0,
    finalHints:session.probe?.events.findLast(event=>event.type==='hint-state'),
    finalMastery:session.probe?.events.findLast(event=>event.type==='mastery'),
    finalPractice:session.probe?.events.findLast(event=>event.type==='practice-state'),
    boards:session.probe?.events.filter(event=>event.type==='canvas').map(({phase,atMs,visible,board})=>({phase,atMs,visible,title:board?.title,board})),
    deliveredWords:session.probe?.events.filter(event=>event.type==='transcript'&&event.role==='assistant'&&event.final).map(({phase,text,source,turnId,atMs})=>({phase,text,source:source||'approved-backend',turnId,atMs})),
    recognizedWords:session.probe?.events.filter(event=>event.type==='transcript'&&event.role==='user'&&event.final).map(({phase,text,turnId,atMs})=>({phase,text,turnId,atMs})),
    sessionElapsedMs:session.probe?.sessionElapsedMs,
    costEstimateUsd:session.usage?.totals.estimatedUsd,estimateComplete:session.usage?.totals.estimateComplete,missingUsageRequests:session.usage?.totals.missingUsageRequests,
    liveProviderSeconds:(session.usage?.totals.units.sessionDurationMs??0)/1000,
  }));
  const ids=[...new Set(report.sessions.flatMap(session=>session.probe?.trials.map(trial=>trial.id)||[]))];
  const byScenario=ids.map(id=>({id,arms:['eleven','gpt-live'].map(arm=>{
    const trials=report.sessions.filter(session=>session.arm===arm).flatMap(session=>session.probe?.trials||[]).filter(trial=>trial.id===id);
    return {arm,attempted:trials.length,complete:trials.filter(trial=>trial.status==='complete').length,firstAudioMs:summarizeLatencies(trials),firstTextMs:summarizeLatencies(trials,'energySpeechEndToFirstTextMs'),commitToAudioMs:summarizeLatencies(trials,'commitToFirstAudioMs')};
  })}));
  return {source:path,sourceSha256:createHash('sha256').update(raw).digest('hex'),status:report.status,environment,timingEnvironment:report.timingEnvironment,validForComparativeLatency:environment===null&&report.timingEnvironment?.valid!==false&&report.status==='completed',
    method:{inputPcmSampleRate:16000,inputChunkMs:100,continuousSilenceChunkMs:100,simulatedPlaybackDrain:true,browserMicrophoneBatchingTested:false,physicalPlaybackTested:false,firstUsefulAudioMeasured:false,pairedPcm:'One in-memory synthetic clip per scenario reused across all arms within this report; original per-scenario hashes are in the source report.',normalizerSha256:createHash('sha256').update(await readFile(new URL('../server/gpt-live-transport.mjs',import.meta.url))).digest('hex')},
    requestedSessions:report.ceilings.sessions,completedSessions:phases.filter(session=>session.status==='complete').length,
    phases,byScenario,
    limitations:['Tiny exploratory sample; no stable p95, no learning-outcome claim.','Comparative latency requires successful paired trials and reviewed spoken fidelity; failures stay in the denominator.','Backend captions and native spoken transcripts are separate evidence.','A normalizer match is not an independent semantic quality score; public text remains reviewable.','Application cost estimates exclude unpriced source-synthesis requests and any missing provider counters; they are not billed account charges.'],
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const path=process.argv[2];if(!path)throw Error('Supply an existing comparison JSON path.');
  const output=process.argv[3]||path.replace(/\.json$/,'.audit.json');
  try{await readFile(output);throw Error('Refusing to overwrite existing audit.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const result=await auditComparison(path);await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({output,status:result.status,completed:result.completedSessions,requested:result.requestedSessions,byScenario:result.byScenario}));
}
