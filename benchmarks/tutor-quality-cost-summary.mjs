// Offline accounting only. Preserve every experiment's raw artifact.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {tokenUsage} from '../server/usage-ledger.mjs';
import {estimateUsage} from '../server/usage-pricing.mjs';

const rows=[];
async function source(file){
  const raw=await readFile(new URL(file,import.meta.url),'utf8');
  return {file,sha256:createHash('sha256').update(raw).digest('hex'),data:JSON.parse(raw)};
}
const boards=await source('tutor-quality/boards-summary.json');
rows.push({name:'Visual cohorts',sources:[{file:boards.file,sha256:boards.sha256}],openaiRequests:boards.data.cohorts.reduce((n,c)=>n+c.paidRequests,0),jevRequests:0,estimatedLlmUsd:boards.data.cohorts.reduce((n,c)=>n+c.estimatedUsd,0),estimatedJevUsd:0,allPaidRequestsHaveUsage:boards.data.cohorts.every(c=>c.estimatedRequests===c.paidRequests&&c.partialRequests===0)});

const images=await source('screenshot-vision/results.json');
assert.equal(images.data.passed,true,'Screenshot evidence must be the completed successful fixture run');
const imageEstimates=images.data.requests.map(request=>{
  const usage=request.usage?{units:tokenUsage(request.usage),model:request.model,serviceTier:request.serviceTier}:images.data.tutorUsage;
  assert.ok(usage?.units?.inputTokens&&Number.isSafeInteger(usage.units.outputTokens),'Every image request must have measured usage');
  const estimate=estimateUsage({provider:'openai',...usage,status:'completed',startedAt:request.startedAt});
  assert.ok(estimate&&!estimate.partial,'Each image request must have a complete price estimate');
  return estimate.usd;
});
rows.push({name:'Original screenshot evidence',sources:[{file:images.file,sha256:images.sha256}],openaiRequests:images.data.requests.length,jevRequests:0,estimatedLlmUsd:imageEstimates.reduce((a,b)=>a+b,0),estimatedJevUsd:0,allPaidRequestsHaveUsage:true});

const files=process.argv.slice(2).length?process.argv.slice(2):[
  'tutor-quality/initial-live-audit.json',
  'tutor-quality/live-repair-results.json',
  'tutor-quality/live-coaching-repair.json',
  'tutor-quality/live-provisional-coaching.json',
  'tutor-quality/live-adaptive-results.json',
  'tutor-quality/live-hint-grant-repair.json',
  'tutor-quality/live-adaptive-repaired.json',
  'tutor-quality/live-board-match-structure.json',
  'tutor-quality/live-candidate-calibration.json',
  'tutor-quality/grade-replay-results.json',
  'tutor-quality/grade-effort-results.json',
  'tutor-quality/live-adaptive-final.json',
  'tutor-quality/grade-restatement-results.json',
  'tutor-quality/grade-assistance-evidence-results.json',
  'tutor-quality/grade-assistance-terra-results.json',
  'screenshot-vision/image-grading-terra-results.json',
  'tutor-quality/live-adaptive-final-verified.json',
  'tutor-quality/live-adaptive-release.json',
  'tutor-quality/live-planning-release.json',
];
for(const file of files){
  const artifact=await source(file);
  if(Array.isArray(artifact.data.cases)&&Number.isSafeInteger(artifact.data.providerCalls)){
    const requests=artifact.data.cases.flatMap(item=>item.requests||[]);
    assert.equal(requests.length,artifact.data.providerCalls,'Every controlled grader call must be represented');
    const complete=requests.every(request=>Number.isFinite(request.usage?.inputTokens)&&Number.isFinite(request.usage?.outputTokens)&&Number.isFinite(request.estimatedCost?.usd)&&!request.estimatedCost.partial);
    assert.ok(complete,'Controlled grading costs require complete observed usage and price estimates');
    rows.push({name:file.replace('tutor-quality/','').replace('.json',''),sources:[{file,sha256:artifact.sha256}],openaiRequests:requests.length,jevRequests:0,estimatedLlmUsd:requests.reduce((n,r)=>n+r.estimatedCost.usd,0),estimatedJevUsd:0,allPaidRequestsHaveUsage:true});
    continue;
  }
  if(Array.isArray(artifact.data.runs)&&Array.isArray(artifact.data.usage)&&artifact.data.counts){
    const {usage,counts}=artifact.data;
    assert.equal(counts.openai,0,'Structure probe is Jev-only');
    assert.equal(usage.length,counts.jev,'Every structure request must have an accounting record');
    rows.push({name:file.replace('tutor-quality/','').replace('.json',''),sources:[{file,sha256:artifact.sha256}],openaiRequests:0,jevRequests:counts.jev,estimatedLlmUsd:0,estimatedJevUsd:usage.reduce((n,event)=>n+(event.estimatedCost?.usd||0),0),allPaidRequestsHaveUsage:usage.every(event=>Number.isFinite(event.units?.inputTokens)&&Number.isFinite(event.units?.outputTokens)&&Number.isFinite(event.estimatedCost?.usd)&&!event.estimatedCost.partial)});
    continue;
  }
  const accounts=Array.isArray(artifact.data.accounting)?artifact.data.accounting:artifact.data.accounting?[artifact.data.accounting]:artifact.data.sessions;
  assert.ok(Array.isArray(accounts)&&accounts.length,'Expected explicit session accounting');
  const groups=accounts.flatMap(account=>account.tokenGroups);
  assert.ok(groups.every(Boolean),'Use audited accounting, never incomplete raw request subtotals');
  rows.push({name:file.replace('tutor-quality/','').replace('.json',''),sources:[{file,sha256:artifact.sha256}],openaiRequests:accounts.reduce((n,a)=>n+a.paidRequests.openai,0),jevRequests:accounts.reduce((n,a)=>n+a.paidRequests.jev,0),estimatedLlmUsd:groups.filter(g=>g.provider==='openai').reduce((n,g)=>n+g.estimatedUsd,0),estimatedJevUsd:groups.filter(g=>g.provider==='typesafe').reduce((n,g)=>n+g.estimatedUsd,0),allPaidRequestsHaveUsage:accounts.every(a=>a.allPaidRequestsHaveUsage)});
}
const totals=Object.fromEntries(['openaiRequests','jevRequests','estimatedLlmUsd','estimatedJevUsd'].map(key=>[key,rows.reduce((n,row)=>n+row[key],0)]));
const result={generatedAt:new Date().toISOString(),scope:'Only the explicitly listed tutor-quality and screenshot experiments, including failed runs. Earlier model/format/voice experiments and this development conversation are excluded. List-price estimates from observed token usage are not provider bills. All voice in these session experiments was simulated; no paid ElevenLabs call is included.',rows,totals:{...totals,estimatedTotalUsd:totals.estimatedLlmUsd+totals.estimatedJevUsd},allPaidRequestsHaveUsage:rows.every(row=>row.allPaidRequestsHaveUsage)};
await writeFile(new URL('tutor-quality/cost-summary.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({rows:rows.length,...result.totals,allPaidRequestsHaveUsage:result.allPaidRequestsHaveUsage}));
