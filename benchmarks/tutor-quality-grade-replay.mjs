import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createOpenAIOrganizer} from '../server/openai-luna.mjs';
import {checkedGrade} from '../server/mastery.mjs';
import {assistanceCitationIds} from '../server/grade-citations.mjs';
import {tokenUsage} from '../server/usage-ledger.mjs';
import {estimateUsage} from '../server/usage-pricing.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';

const args=process.argv.slice(2),arg=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
const live=args.includes('--live'),effortExperiment=args.includes('--effort-experiment'),restatementExperiment=args.includes('--restatement-experiment'),fixturePath=arg('--fixtures','benchmarks/tutor-quality/grade-replay-fixtures.json');
const benchmarkModel=arg('--model','gpt-6-luna');
if(!['gpt-6-luna','gpt-5.6-terra'].includes(benchmarkModel))throw Error('Unexpected benchmark model.');
const output=arg('--output',live?'benchmarks/tutor-quality/grade-replay-results.json':'/tmp/luna-grade-replay-dry.json');
const fixtureRaw=await readFile(fixturePath,'utf8'),fixtures=JSON.parse(fixtureRaw),sha=value=>createHash('sha256').update(value).digest('hex');
const maxCalls=effortExperiment?24:restatementExperiment?16:12;
if(effortExperiment&&restatementExperiment)throw Error('Choose one controlled experiment.');
if(!Array.isArray(fixtures.cases)||fixtures.cases.length!==(effortExperiment?12:restatementExperiment?8:6))throw Error('Unexpected controlled fixture count.');
if(effortExperiment&&fixtures.cases.some(c=>!['low','medium'].includes(c.effort)))throw Error('Unexpected grader effort.');
if(restatementExperiment&&(typeof fixtures.beforeInstructions!=='string'||sha(fixtures.beforeInstructions)!==fixtures.beforeInstructionSha256||fixtures.cases.some(c=>!['before','after'].includes(c.instructionVersion))))throw Error('Invalid frozen grading instructions.');
const report={startedAt:new Date().toISOString(),live,method:'Controlled synthetic conditions; two fresh independent production organizer calls per condition. checkedGrade uses these same two outputs with its unchanged validation/agreement logic. No conversational generation, Jev, audio, or mastery writes. Fixture metadata identifies whether historical context was reconstructed or captured exactly.',benchmarkModel,benchmarkEffortOverride:effortExperiment,fixturePath,fixtureSha256:sha(fixtureRaw),fixtureMethod:fixtures.method,codeHashes:{},ceiling:{openai:maxCalls,jev:0},providerCalls:0,cases:[],billing:{providerReportedUsd:null,exactUsd:null,explanation:'Provider responses expose usage units, not actual billed dollars.'}};
for(const path of ['server/mastery.mjs','server/grade-citations.mjs','server/openai-luna.mjs','benchmarks/tutor-quality-grade-replay.mjs'])report.codeHashes[path]=sha(await readFile(path));
const save=async()=>{await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');};
await save();
for(const fixture of fixtures.cases){
 const record={id:fixture.id,baseId:fixture.baseId,instructionVersion:fixture.instructionVersion,effort:fixture.effort||'low',expected:fixture.expected,rationale:fixture.rationale,input:fixture.input,inputSha256:sha(JSON.stringify(fixture.input)),notes:fixture.notes||[],requests:[],decisions:[],result:null};report.cases.push(record);
 const work=async()=>{
  const organizer=createOpenAIOrganizer({env:{...process.env,LUNA_API_MODEL:benchmarkModel,LUNA_GRADING_MODEL:benchmarkModel,OPENAI_API_KEY:live?process.env.OPENAI_API_KEY:'synthetic-no-network'},fetchImpl:async(url,options)=>{
   if(url!=='https://api.openai.com/v1/responses')throw Error('Unexpected provider destination.');
   const payload=JSON.parse(options.body);if(payload.model!==benchmarkModel||payload.stream||payload.store!==false||payload.tools.length)throw Error('Unexpected grader configuration.');
   if(effortExperiment)payload.reasoning={effort:fixture.effort};
   if(restatementExperiment&&fixture.instructionVersion==='before')payload.instructions=fixtures.beforeInstructions;
   if(report.providerCalls>=maxCalls)throw Error('Provider request ceiling reached.');
   if(live)report.providerCalls++;
   const entry={attempt:record.requests.length+1,request:payload,instructionSha256:sha(payload.instructions),status:'pending'};record.requests.push(entry);
   const began=performance.now();
   try{
    let response;
    if(live)response=await fetch(url,{...options,body:JSON.stringify(payload),redirect:'error'});
    else{const input=JSON.parse(payload.input),answer={questionId:input.question.id,topicId:input.question.topicId,sourceIds:input.question.sourceIds,verdict:fixture.expected?.verdict||'correct',reasoningSufficient:fixture.expected?.reasoningSufficient??true,assistanceUsed:fixture.expected?.assistanceUsed??false,assistanceCitationIds:fixture.expected?.assistanceUsed?assistanceCitationIds(input).slice(0,1):[],answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:input.materials.map(m=>m.excerpts.find(x=>x.text.trim()).id),...(input.attemptContext?{targetAttempt:fixture.expected?.targetAttempt??true}:{})};response=new Response(JSON.stringify({status:'completed',model:payload.model,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(answer)}]}]}),{status:200,headers:{'Content-Type':'application/json'}});}
    entry.httpStatus=response.status;
    if(response.ok){
     const body=await response.clone().json();entry.model=body.model;entry.serviceTier=body.service_tier;entry.usage=tokenUsage(body.usage);
     entry.publicOutput=(body.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text||'').join('');
     try{entry.structuredOutput=JSON.parse(entry.publicOutput);}catch{entry.parseFailure=true;}
     entry.status=body.status;entry.estimatedCost=live?estimateUsage({provider:'openai',model:entry.model||payload.model,serviceTier:entry.serviceTier,status:'completed',units:entry.usage}):null;
    }else entry.status='http-error';
    return response;
   }catch(error){entry.status='failed';entry.failure={name:error?.name||'Error',status:error?.providerStatus||error?.status||null};throw error;}
   finally{entry.durationMs=Math.round(performance.now()-began);await save();}
  }});
  // Always collect two independent public judgments, including when the first
  // is unclear and production checkedGrade would stop early. Never feed one
  // judgment to the other; checkedGrade still applies its ordinary early exit.
  let results=null,index=0;
  const pair={organize:async(input,options)=>{if(!results){results=[];for(let i=0;i<2;i++)results.push(await organizer.organize(input,options));}return results[index++];}};
  const began=performance.now();
  try{record.result=await checkedGrade({...fixture.input,organizer:pair,onDecision:details=>record.decisions.push(details)});record.status='completed';record.outputsConsumedByCheckedGrade=index;}
  catch(error){record.status='failed';record.failure={name:error?.name||'Error',status:error?.providerStatus||error?.status||null};}
  record.durationMs=Math.round(performance.now()-began);
  if(record.expected)record.expectedJudgmentMatches=record.requests.map(request=>Object.entries(record.expected).filter(([,value])=>value!==null).every(([key,value])=>request.structuredOutput?.[key]===value));
 };
 if(live)await withProviderSlot(work);else await work();
 await save();console.log(JSON.stringify({id:record.id,status:record.status,result:record.result,judgments:record.requests.map(r=>({verdict:r.structuredOutput?.verdict,reasoningSufficient:r.structuredOutput?.reasoningSufficient,assistanceUsed:r.structuredOutput?.assistanceUsed})),providerCalls:report.providerCalls}));
}
report.finishedAt=new Date().toISOString();report.totals={requests:report.cases.reduce((sum,c)=>sum+c.requests.length,0),units:{},estimatedUsd:0};
for(const request of report.cases.flatMap(c=>c.requests)){for(const [key,value]of Object.entries(request.usage||{}))report.totals.units[key]=(report.totals.units[key]||0)+value;report.totals.estimatedUsd+=request.estimatedCost?.usd||0;}
const tokenGroups=[];
for(const effort of [...new Set(report.cases.map(c=>c.effort))]){
 const requests=report.cases.filter(c=>c.effort===effort).flatMap(c=>c.requests),group={provider:'openai',model:benchmarkModel,operation:'grading',effort,requests:requests.length,estimatedUsd:0,unpriced:0};
 for(const request of requests){for(const [key,value]of Object.entries(request.usage||{}))group[key]=(group[key]||0)+value;if(request.estimatedCost)group.estimatedUsd+=request.estimatedCost.usd;else group.unpriced++;}
 tokenGroups.push(group);
}
report.accounting={paidRequests:{openai:report.providerCalls,jev:0},allPaidRequestsHaveUsage:live&&report.cases.flatMap(c=>c.requests).filter(r=>Number.isInteger(r.usage?.inputTokens)&&Number.isInteger(r.usage?.outputTokens)).length===report.providerCalls,tokenGroups,estimatedTotalUsd:report.totals.estimatedUsd,estimateBasis:'Observed provider usage and repository public list rates; not actual billed dollars. No voice or Jev calls.'};
report.limits=['One pair per condition is a diagnostic probe, not a population accuracy estimate.','Empty/scoped history conditions deliberately alter assistance evidence and are never production score updates.','Only public structured answers and provider usage are stored; no hidden reasoning, request credentials, or environment values are captured.','Any history reconstruction mismatch limits a direct causal comparison with the earlier run.'];
await save();console.log(JSON.stringify({output,providerCalls:report.providerCalls,totals:report.totals}));
