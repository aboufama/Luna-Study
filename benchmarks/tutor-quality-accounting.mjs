import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {estimateUsage} from '../server/usage-pricing.mjs';

const median=values=>{const ordered=[...values].sort((a,b)=>a-b);return ordered.length?(ordered[Math.floor((ordered.length-1)/2)]+ordered[Math.ceil((ordered.length-1)/2)])/2:null;};

export function summarizeSession(session){
  const measured=session.usage.filter(event=>['openai','typesafe'].includes(event.provider)&&Number.isSafeInteger(event.units?.inputTokens)&&Number.isSafeInteger(event.units?.outputTokens));
  const groups={};
  for(const event of measured){
    const key=`${event.provider}:${event.model}:${event.operation}`,group=groups[key]??={provider:event.provider,model:event.model,operation:event.operation,requests:0,inputTokens:0,outputTokens:0,cachedInputTokens:0,cacheWriteTokens:0,reasoningTokens:0,estimatedUsd:0,unpriced:0};
    group.requests++;
    for(const name of ['inputTokens','outputTokens','cachedInputTokens','cacheWriteTokens','reasoningTokens'])group[name]+=event.units[name]||0;
    const estimated=estimateUsage(event);if(estimated)group.estimatedUsd+=estimated.usd;else group.unpriced++;
  }
  const counts={openai:measured.filter(event=>event.provider==='openai').length,jev:measured.filter(event=>event.provider==='typesafe').length};
  const byStage=stage=>session.messages.filter(message=>message.type==='latency'&&message.stage===stage).map(message=>message.ms);
  const afterStudent=kind=>session.messages.filter(message=>message.type==='transcript'&&message.role==='user').flatMap(student=>{
    const reply=session.messages.find(message=>message.stepId===student.stepId&&message.wallMs>=student.wallMs&&(kind==='text'?message.type==='transcript'&&message.role==='assistant'&&Boolean(message.text?.trim()):message.type==='audio'));
    return reply?[reply.wallMs-student.wallMs]:[];
  });
  return {
    arm:session.arm,status:session.status,voiceInstructionSha256:session.voiceInstructions.sha256,
    simulatedMinutes:session.simulatedMinutes,actualWallMs:session.actualWallMs,paidRequests:session.providerCounts,
    requestsWithMeasuredUsage:counts,allPaidRequestsHaveUsage:counts.openai===session.providerCounts.openai&&counts.jev===session.providerCounts.jev,
    tokenGroups:Object.values(groups),estimatedTotalUsd:Object.values(groups).reduce((sum,group)=>sum+group.estimatedUsd,0),
    estimateBasis:'Observed production-ledger units and repository verified public rates; excludes synthetic ElevenLabs, credits, taxes and account-specific billing. Reasoning is already included in output tokens.',
    observationCorrection:session.requests.some(request=>request.provider==='openai'&&request.kind==='tutor'&&request.status==='observation-incomplete'&&!request.usage)?'Initial cloned SSE whole-body reads aborted after production had completed. The immutable raw request cost subtotal omitted streaming tutoring. This sidecar recomputes from the captured production usage callbacks, without altering raw results.':'Totals use the captured production usage callbacks; successful streamed completion frames are also retained by the request observer. No missing-stream subtotal correction is applied to this run.',
    firstTextMs:{count:byStage('first-text').length,median:median(byStage('first-text'))},
    firstSyntheticAudioMs:{count:byStage('first-audio').length,median:median(byStage('first-audio'))},
    committedStudentToFirstTextMs:{count:afterStudent('text').length,median:median(afterStudent('text'))},
    committedStudentToSyntheticAudioMs:{count:afterStudent('audio').length,median:median(afterStudent('audio'))},
    timingBoundary:'firstTextMs is measured from tutor-turn generation start, after incoming intent classification. committedStudentToFirstTextMs includes that semantic-routing time but starts after synthetic STT commitment, excluding real recognition and speaking duration.',
    syntheticAudioCaveat:'Fake TTS returns a tiny PCM packet immediately when the speech chunk is submitted. This measures the speech pipeline boundary, not ElevenLabs or human playback latency.',
    grades:{
      reviewJobs:session.gradeResults.length,
      providerRequests:session.requests.filter(request=>request.kind==='grading'&&request.status!=='budget-blocked').length,
      recognizedAttempts:new Set(session.problems.filter(problem=>problem.type==='attempt').map(problem=>`${problem.questionId}:${problem.attempt}`)).size,
      acceptedCheckedGrades:session.gradeResults.filter(item=>item.grade?.checked).length,
      rejectedReviews:session.gradeResults.filter(item=>!item.grade?.checked).length,
      targetRejectedReviews:session.gradeResults.filter(item=>item.grade?.targetAttempt===false).length,
      persistedGradeEvents:Object.values(session.masteryLedger?.events||{}).filter(event=>event?.checked===true).length,
    },
    assistantReplies:session.messages.filter(message=>message.type==='transcript'&&message.role==='assistant'&&message.final).map(({stepId,text})=>({stepId,text})),
    hintStates:session.steps.map(step=>({step:step.id,questionId:step.hintState?.questionId||null,remaining:step.hintState?.remaining??null,reason:step.hintState?.reason||null})),
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const input=process.argv[2]||'benchmarks/tutor-quality/live-paired-results.json',output=process.argv[3]||'benchmarks/tutor-quality/initial-live-audit.json';
  const raw=await readFile(input,'utf8'),report=JSON.parse(raw);
  const audit={source:input,sourceSha256:createHash('sha256').update(raw).digest('hex'),auditedAt:new Date().toISOString(),sessions:(report.sessions||[report]).map(summarizeSession)};
  await writeFile(output,JSON.stringify(audit,null,2)+'\n');
  console.log(JSON.stringify({output,sessions:audit.sessions.map(({arm,paidRequests,allPaidRequestsHaveUsage,estimatedTotalUsd,firstTextMs,firstSyntheticAudioMs,grades})=>({arm,paidRequests,allPaidRequestsHaveUsage,estimatedTotalUsd,firstTextMs,firstSyntheticAudioMs,grades}))}));
}
