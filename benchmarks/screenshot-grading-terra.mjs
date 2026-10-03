// Bounded original-pixel grading verification through the production model route.
// No import, tutor, Jev, voice, user store writes, model overrides, or price guesses.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createMaterialImageStore} from '../server/material-images.mjs';
import {createOpenAIOrganizer} from '../server/openai-luna.mjs';
import * as models from '../server/model-config.mjs';
import {checkedGrade} from '../server/mastery.mjs';
import {createUsageLedger,tokenUsage} from '../server/usage-ledger.mjs';
import {estimateUsage} from '../server/usage-pricing.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
const args=process.argv.slice(2),live=args.includes('--live'),option=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
const output=option('--output')||(live?'benchmarks/screenshot-vision/image-grading-terra-results.json':'/tmp/luna-image-grading-terra-dry.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const directory=new URL('./screenshot-vision/',import.meta.url),testId='4726c520-ad95-4c3f-8795-87655d526cab';
const bytes=await readFile(new URL('symbol-key.png',directory)),sourceId=`img-${sha(bytes)}`;
const imageStore=createMaterialImageStore({directory:new URL('private-assets/',directory).pathname});
const saved=await imageStore.material({testId,sourceId});assert.ok(saved,'Existing original-image fixture is required; do not regenerate it.');
const source={...saved,text:'Derived notes incorrectly say Q is heat flux and H is a temperature.'};
const question={id:'q-image-symbol',topicId:'hydraulic-symbols',topicTitle:'Hydraulic symbols',difficulty:'easy',sourceIds:[sourceId],question:'In the original symbol key, what does Q represent?',answer:'Q is heat flux (deliberately incorrect reference answer).'};
const input={testId,question,answer:'Q represents volume flow rate.',materials:[source],conversation:[{role:'assistant',content:question.question}]};
const ledger=createUsageLedger({file:null}),record={id:'original-pixels-over-wrong-derived-and-reference',input,expected:{verdict:'correct',unassisted:true,checked:true},requests:[],decisions:[]};
const report={startedAt:new Date().toISOString(),live,method:'Actual checkedGrade invokes the unmodified production organizer and operation-specific model selector. One original PNG and two independent public grading judgments; the original notes and private reference deliberately contradict the pixels. Same public fixture as the earlier seven-call image benchmark, no model/effort payload override. No mastery score, import, tutoring, Jev, voice, or persistent usage writes.',maximumPaidRequests:2,providerCalls:0,sourceImage:{file:'benchmarks/screenshot-vision/symbol-key.png',sourceId,sha256:sha(bytes),bytes:bytes.length,mimeType:'image/png'},cases:[record],codeHashes:{},billing:{providerReportedUsd:null,exactUsd:null,explanation:'Provider responses expose measured usage, not actual billed dollars.'}};
for(const file of ['server/model-config.mjs','server/openai-luna.mjs','server/mastery.mjs','server/grade-citations.mjs','server/material-images.mjs','server/usage-pricing.mjs','benchmarks/screenshot-grading-terra.mjs'])report.codeHashes[file]=sha(await readFile(new URL('../'+file,import.meta.url)));
assert.equal(typeof models.gradingModelFor,'function','Wait for the production grading model route to be released.');
report.selectedModel=models.gradingModelFor(process.env);
assert.equal(report.selectedModel,'gpt-5.6-terra','This experiment verifies the production Terra grading route, not an override.');
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:live?'wx':'w'});
const save=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');
const organizer=createOpenAIOrganizer({env:live?process.env:{...process.env,OPENAI_API_KEY:'synthetic-no-network'},usageLedger:ledger,imageStore,fetchImpl:async(url,options)=>{
 assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.redirect,'error');
 assert.ok(record.requests.length<2,'Two-request hard ceiling');
 const payload=JSON.parse(options.body);
 assert.equal(payload.model,report.selectedModel);assert.equal(payload.reasoning?.effort,'low');assert.equal(payload.store,false);assert.equal(payload.stream,undefined);assert.deepEqual(payload.tools,[]);
 const parts=payload.input.flatMap(turn=>turn.content||[]),images=parts.filter(part=>part.type==='input_image');
 assert.equal(images.length,1,'Original pixels must be attached to each independent check');
 const sent=images.map(image=>{const match=/^data:(image\/png);base64,(.+)$/.exec(image.image_url);assert.ok(match);const imageBytes=Buffer.from(match[2],'base64');assert.equal(sha(imageBytes),report.sourceImage.sha256);return {sha256:sha(imageBytes),bytes:imageBytes.length,mimeType:match[1],detail:image.detail};});
 const gradingInput=JSON.parse(parts.find(part=>part.type==='input_text').text);
 assert.equal(gradingInput.materials[0].textOrigin,'derived-image-text');assert.deepEqual(gradingInput.materials[0].excerpts,[]);
 const entry={attempt:record.requests.length+1,startedAt:new Date().toISOString(),requestedModel:payload.model,effort:payload.reasoning.effort,operation:'grading',images:sent,input:gradingInput,instructionSha256:sha(payload.instructions),schemaSha256:sha(JSON.stringify(payload.text.format.schema)),status:'pending'};
 record.requests.push(entry);await save();const began=performance.now();
 try{
  let response;
  if(live){report.providerCalls++;await save();response=await fetch(url,options);}
  else{const grade={questionId:question.id,topicId:question.topicId,sourceIds:question.sourceIds,verdict:'correct',reasoningSufficient:true,assistanceUsed:false,assistanceCitationIds:[],answerCitationIds:[gradingInput.answerExcerpts[0].id],sourceCitationIds:[gradingInput.materials[0].imageEvidence.id]};response=new Response(JSON.stringify({status:'completed',model:payload.model,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(grade)}]}]}),{status:200,headers:{'Content-Type':'application/json'}});}
  entry.httpStatus=response.status;
  if(response.ok){const body=await response.clone().json();entry.model=body.model;entry.serviceTier=body.service_tier;entry.status=body.status;entry.usage=tokenUsage(body.usage);entry.rawUsage=body.usage;const text=(body.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text||'').join('');try{entry.structuredOutput=JSON.parse(text);}catch{entry.parseFailed=true;}entry.estimatedCost=live?estimateUsage({provider:'openai',model:entry.model,serviceTier:entry.serviceTier,status:'completed',units:entry.usage}):null;}
  else entry.status='http-error';
  return response;
 }catch(error){entry.status='failed';entry.error={name:error.name,status:error.status||error.providerStatus||null};throw error;}
 finally{entry.durationMs=Math.round(performance.now()-began);await save();}
}});
async function run(){const began=performance.now();try{record.result=await checkedGrade({...input,organizer,onDecision:decision=>record.decisions.push(decision)});record.status='completed';record.pass=JSON.stringify(record.result)===JSON.stringify({verdict:'correct',unassisted:true,checked:true})&&record.requests.length===2&&record.requests.every(r=>r.structuredOutput?.sourceCitationIds?.includes(`image:${sourceId}`));}catch(error){record.status='failed';record.error={name:error.name,status:error.status||error.providerStatus||null};record.pass=false;}finally{record.durationMs=Math.round(performance.now()-began);}}
try{if(live)await withProviderSlot(run);else await run();}
finally{
 await ledger.flush();report.ledger=await ledger.snapshot(testId);await ledger.close();report.finishedAt=new Date().toISOString();
 const group={provider:'openai',model:report.selectedModel,operation:'grading',effort:'low',requests:record.requests.length,estimatedUsd:0,unpriced:0};
 for(const request of record.requests){for(const [key,value]of Object.entries(request.usage||{}))group[key]=(group[key]||0)+value;if(request.estimatedCost)group.estimatedUsd+=request.estimatedCost.usd;else group.unpriced++;}
 report.accounting={paidRequests:{openai:report.providerCalls,jev:0},allPaidRequestsHaveUsage:live&&record.requests.filter(r=>Number.isInteger(r.usage?.inputTokens)&&Number.isInteger(r.usage?.outputTokens)).length===report.providerCalls,tokenGroups:[group],estimatedTotalUsd:live?group.estimatedUsd:null,estimateBasis:'Observed provider usage and verified repository public-rate pricing; actual billed dollars unavailable. No paid voice, Jev, extraction or tutoring.'};
 report.passed=record.pass;report.limits=['One clear synthetic symbol-key image and one two-judgment pair; not a screenshot accuracy estimate.','Wrong derived notes and reference are deliberate; only original pixels can establish the expected Q meaning.','The fixture is read from the existing private image store, without re-importing or mutating it.','Raw images/base64, credentials, hidden reasoning and provider failure bodies are never written into this report.'];await save();
}
console.log(JSON.stringify({output,passed:report.passed,providerCalls:report.providerCalls,model:report.selectedModel,grade:record.result,estimatedUsd:report.accounting.estimatedTotalUsd}));
