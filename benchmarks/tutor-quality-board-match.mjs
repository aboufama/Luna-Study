import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createJevCanvasRouter} from '../server/jev.mjs';
import {candidateBoardContext} from '../server/board-routing-context.mjs';
import {validateBoard} from '../server/tutor-output.mjs';
import {estimateUsage} from '../server/usage-pricing.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';

const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||'benchmarks/tutor-quality/live-board-structure-match.json';
const live=process.argv.includes('--live');
try{await readFile(output);throw Error('Refusing to overwrite a structure probe.');}catch(error){if(error.code!=='ENOENT')throw error;}
const grid=rows=>({title:'Game grid',mode:'replace',blocks:[{id:'grid',type:'matrix',size:[rows,10]}]});
const scene=object=>({title:'Plane figure',mode:'replace',blocks:[{id:'world',type:'scene',width:800,height:500,objects:[object]}]});
const gridQuestion='In an 8-row, 10-column game, which cells could hold strict Nash equilibria? Use the blank grid without inventing any payoffs.';
const triangleQuestion='For this triangle, how would a median connect its top vertex to the opposite side? Inspect the triangle before drawing a median.';
const cases=[
  {id:'grid-eight-by-ten',expected:true,question:gridQuestion,board:grid(8)},
  {id:'grid-seven-by-ten',expected:false,question:gridQuestion,board:grid(7)},
  {id:'unlabeled-triangle',expected:true,question:triangleQuestion,board:scene({id:'outline',type:'polyline',points:[[100,400],[400,100],[700,400],[100,400]]})},
  {id:'ellipse-for-triangle',expected:false,question:triangleQuestion,board:scene({id:'outline',type:'ellipse',x:100,y:100,width:600,height:300})},
];
const report={method:'Four synthetic candidate-target structure cases using the unchanged production validator, candidateBoardContext, and Jev canvas router. Expected labels are recorded only in this artifact and never sent as classifier input. One call per case, no retries, no OpenAI/voice calls. Confidence values are classifier outputs, not calibrated probabilities.',live,limits:{openai:0,jev:4},counts:{openai:0,jev:0},runs:[],usage:[],requests:[],codeHashes:{}};
for(const path of ['server/jev.mjs','server/board-routing-context.mjs','server/tutor-output.mjs','server/live-voice.mjs','server/diagnostics.mjs', 'benchmarks/tutor-quality-board-match.mjs'])report.codeHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const observers=[];
const usageLedger={start(testId,metadata){const event={testId,...metadata,status:'pending',units:{}};report.usage.push(event);return{update(value={}){Object.assign(event.units,value.units);if(value.model)event.model=value.model;},finish(value={}){this.update(value);event.status=value.status||'completed';event.estimatedCost=estimateUsage(event);}};}};
const fetchImpl=async(url,options)=>{
  if(String(url)!=='https://api.typesafe.ai/v1/systemone')throw Error('Unexpected provider destination.');
  if(!live)throw Error('Offline probe does not call a provider.');
  if(report.counts.jev>=4)throw Error('Four-call ceiling reached.');
  report.counts.jev++;
  const request={payload:JSON.parse(options.body),status:'pending'};report.requests.push(request);
  try{
    const response=await fetch(url,options);
    observers.push(response.clone().json().then(body=>{request.status=response.ok?'completed':'http-error';request.body=body;}).catch(error=>{request.status='observation-incomplete';request.observationError=error.name;}));
    return response;
  }catch(error){request.status='failed';request.error=error.name;throw error;}
};
const router=createJevCanvasRouter({env:process.env,fetchImpl,usageLedger});
const run=async()=>{
  report.startedAt=new Date().toISOString();
  for(const fixture of cases){
    const board=validateBoard(fixture.board);if(!board)throw Error(`Invalid probe board: ${fixture.id}`);
    const candidate=candidateBoardContext(board);
    const context={title:'Geometry and game-grid study',phase:'study',boardVisible:false,hasBoardUpdate:true,candidateTextOnly:false,currentQuestion:{id:'current-question',question:fixture.question},candidateBoard:candidate};
    const started=performance.now();
    const decision=live?await router.classify(`${fixture.question}${candidate.text?'\n'+candidate.text:''}`,context,{testId:randomUUID()}):null;
    report.runs.push({...fixture,board,context,decision,latencyMs:Math.round(performance.now()-started),passes:live?decision?.source==='jev'&&decision.candidateMatchesQuestion===fixture.expected:null});
    await Promise.allSettled(observers);await writeFile(output,JSON.stringify(report,null,2)+'\n');
  }
  report.finishedAt=new Date().toISOString();report.estimatedUsd=report.usage.reduce((sum,event)=>sum+(event.estimatedCost?.usd||0),0);
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,counts:report.counts,results:report.runs.map(run=>({id:run.id,probability:run.decision?.candidateMatchProbability,passes:run.passes})),estimatedUsd:report.estimatedUsd}));
};
if(live)await withProviderSlot(run);else await run();
