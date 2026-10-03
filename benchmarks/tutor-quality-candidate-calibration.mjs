import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createJevCanvasRouter} from '../server/jev.mjs';
import {candidateBoardContext} from '../server/board-routing-context.mjs';
import {validateBoard} from '../server/tutor-output.mjs';
import {blockHasVisualContent} from '../shared/retained-scene.mjs';
import {estimateUsage} from '../server/usage-pricing.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
import {calibrationFixtures} from './tutor-quality/candidate-calibration-fixtures.mjs';

const live=process.argv.includes('--live');
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||'benchmarks/tutor-quality/live-candidate-calibration.json';
try{await readFile(output);throw Error('Refusing to overwrite a calibration artifact.');}catch(error){if(error.code!=='ENOENT')throw error;}
const sha=value=>createHash('sha256').update(value).digest('hex');
const paths=['server/jev.mjs','server/board-routing-context.mjs','server/tutor-output.mjs','shared/retained-scene.mjs','benchmarks/tutor-quality/candidate-calibration-fixtures.mjs','benchmarks/tutor-quality-candidate-calibration.mjs'];
const report={method:'Fixed labeled cross-subject development/held-out scenes, decided and independently reviewed before provider calls. Same unchanged production validator, shape/text projection and router for every case. Offline comparison of .70/.85/.90 display thresholds only; production .90 unchanged. No label, split, expected outcome or label rationale is sent to the classifier. This small stress set is not population calibration or a deployment accuracy estimate.',prespecifiedSelection:'After12 development calls and before any held-out call, select the threshold with highest positive recall among .70/.85/.90 that displays zero wrong/mixed and zero incomplete candidates. Break ties toward the higher threshold; if none qualifies, select none. Do not retune on held-out results. Incomplete scenes are insufficiently specific, not necessarily semantically wrong. Report their abstention separately.',live,limits:{openai:0,jev:24},counts:{openai:0,jev:0},fixtureSha256:sha(JSON.stringify(calibrationFixtures)),fixtures:calibrationFixtures,codeHashes:{},runs:[],requests:[],usage:[]};
for(const path of paths)report.codeHashes[path]=sha(await readFile(path));
for(const fixture of calibrationFixtures)if(!validateBoard(fixture.board))throw Error(`Invalid board: ${fixture.id}`);
// Save the complete split and labels before the first paid request.
await writeFile(output,JSON.stringify(report,null,2)+'\n');
const observers=[];
const usageLedger={start(testId,metadata){const event={testId,...metadata,status:'pending',units:{}};report.usage.push(event);return{update(value={}){Object.assign(event.units,value.units);if(value.model)event.model=value.model;},finish(value={}){this.update(value);event.status=value.status||'completed';event.estimatedCost=estimateUsage(event);}};}};
const fetchImpl=async(url,options)=>{
  if(String(url)!=='https://api.typesafe.ai/v1/systemone')throw Error('Unexpected provider.');
  if(!live||report.counts.jev>=24)throw Error('Provider call not allowed or24-call limit reached.');
  report.counts.jev++;
  const request={payload:JSON.parse(options.body),status:'pending'};report.requests.push(request);
  try{const response=await fetch(url,options);observers.push(response.clone().json().then(body=>{request.body=body;request.status=response.ok?'completed':'http-error';}).catch(error=>{request.status='observation-incomplete';request.observationError=error.name;}));return response;}
  catch(error){request.status='failed';request.error=error.name;throw error;}
};
const router=createJevCanvasRouter({env:process.env,fetchImpl,usageLedger});
function comparisons(){
  return ['development','held-out','all'].flatMap(split=>[.70,.85,.90].map(threshold=>{
    const result={split,threshold,n:0,positiveCases:0,wrongOrMixedCases:0,incompleteCases:0,truePositive:0,falsePositive:0,displayedIncomplete:0,withheldPositive:0,safelyWithheldWrongOrMixed:0,incompleteAbstentions:0,incompleteConfidentRejections:0,abstentions:0,unavailable:0};
    for(const item of report.runs.filter(run=>split==='all'||run.split===split)){
      result.n++;if(item.expectedDisplay)result.positiveCases++;else if(item.kind==='incomplete')result.incompleteCases++;else result.wrongOrMixedCases++;
      const probability=item.decision?.candidateMatchProbability;
      if(!Number.isFinite(probability)){result.unavailable++;continue;}
      const show=probability>=threshold;
      if(probability>.1&&!show)result.abstentions++;
      if(item.expectedDisplay){if(show)result.truePositive++;else result.withheldPositive++;}
      else if(item.kind==='incomplete'){if(show)result.displayedIncomplete++;else if(probability>.1)result.incompleteAbstentions++;else result.incompleteConfidentRejections++;}
      else if(show)result.falsePositive++;else result.safelyWithheldWrongOrMixed++;
    }
    return result;
  }));
}
const run=async()=>{
  report.startedAt=new Date().toISOString();
  for(const fixture of calibrationFixtures){
    if(fixture.split==='held-out'&&!Object.hasOwn(report,'developmentSelection')){
      const eligible=comparisons().filter(result=>result.split==='development'&&result.unavailable===0&&result.falsePositive===0&&result.displayedIncomplete===0).sort((a,b)=>b.truePositive-a.truePositive||b.threshold-a.threshold);
      report.developmentSelection={recordedBeforeHeldOutCalls:report.counts.jev===12||!live,threshold:eligible[0]?.threshold??null,developmentComparisons:comparisons().filter(result=>result.split==='development')};
      await writeFile(output,JSON.stringify(report,null,2)+'\n');
    }
    const board=validateBoard(fixture.board),candidate=candidateBoardContext(board);
    const context={title:'Current study problem',phase:'study',boardVisible:false,hasBoardUpdate:true,candidateTextOnly:!board.blocks.some(blockHasVisualContent),currentQuestion:{id:'current-question',question:fixture.question},candidateBoard:candidate};
    const began=performance.now();const decision=live?await router.classify(`${fixture.question}${candidate.text?'\n'+candidate.text:''}`,context,{testId:randomUUID()}):null;
    report.runs.push({id:fixture.id,split:fixture.split,subject:fixture.subject,kind:fixture.kind,expectedDisplay:fixture.expectedDisplay,context,decision,latencyMs:Math.round(performance.now()-began)});
    await Promise.allSettled(observers);await writeFile(output,JSON.stringify(report,null,2)+'\n');
  }
  report.finishedAt=new Date().toISOString();report.comparisons=comparisons();report.estimatedUsd=report.usage.reduce((sum,event)=>sum+(event.estimatedCost?.usd||0),0);
  report.codeUnchangedDuringRun=(await Promise.all(paths.map(async path=>sha(await readFile(path))===report.codeHashes[path]))).every(Boolean);
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,counts:report.counts,estimatedUsd:report.estimatedUsd,codeUnchanged:report.codeUnchangedDuringRun,comparisons:report.comparisons}));
};
if(live)await withProviderSlot(run);else await run();
