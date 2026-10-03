import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOpenAIOrganizer} from '../server/openai-luna.mjs';
import {createUsageLedger} from '../server/usage-ledger.mjs';
import {checkedGrade} from '../server/mastery.mjs';

const schema={type:'object',additionalProperties:false,required:['ok'],properties:{ok:{type:'boolean'}}};
const response=(model,value)=>Response.json({status:'completed',model,usage:{input_tokens:40,output_tokens:10,input_tokens_details:{cached_tokens:5}},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});

test('only server grading operation uses the grading model, with requested and provider-resolved usage attribution',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'luna-grade-model-')),file=join(dir,'usage.json'),ledger=createUsageLedger({file}),requests=[],events=[];
 t.after(async()=>{await ledger.close();await rm(dir,{recursive:true,force:true});});
 const organizer=createOpenAIOrganizer({env:{OPENAI_API_KEY:'test-only',LUNA_API_MODEL:'gpt-6-luna',LUNA_TUTOR_MODEL:'main-model',LUNA_GRADING_MODEL:' gpt-5.6-terra '},usageLedger:ledger,diagnostics:{record:(_,event)=>events.push(event)},fetchImpl:async(_,options)=>{
  const payload=JSON.parse(options.body);requests.push(payload);return response(`${payload.model}-resolved`,{ok:true});
 }});
 const operations=['indexing','question-bank','session-review',undefined,'grading','organize'];
 for(const operation of operations)await organizer.organize({testId:'study',operation:'grading',model:'injected-model'},{schema,instructions:'JSON.',usageContext:{testId:'study',operation}});
 assert.deepEqual(requests.map(r=>r.model),['gpt-6-luna','gpt-6-luna','gpt-6-luna','gpt-6-luna','gpt-5.6-terra','gpt-6-luna']);
 assert.equal(organizer.model,'gpt-6-luna');assert.equal(organizer.gradingModel,'gpt-5.6-terra');
 assert.ok(requests.every(r=>r.reasoning.effort==='low'));
 await ledger.flush();const saved=JSON.parse(await readFile(file,'utf8'));
 assert.deepEqual(saved.events.map(e=>e.model),requests.map(r=>`${r.model}-resolved`));
 assert.ok(saved.events.every(e=>e.status==='completed'&&e.units.inputTokens===40));
 assert.deepEqual(events.filter(e=>e.type==='llm.background-started').map(e=>e.details.model),requests.map(r=>r.model));
});

test('ordinary and provisional independent graders both default to Terra; explicit override is isolated',async()=>{
 const question={id:'q',topicId:'equations',question:'Solve 5w-10=20 and explain.',sourceIds:['notes']},answer='Add10 then divide5. w=6; equal operations preserve equality.',materials=[{id:'notes',text:'Adding the same quantity to both sides preserves equality. 5w-10=20 gives w=6.'}];
 for(const gradingModel of [undefined,'gpt-6-luna']){
  const requests=[];
  const organizer=createOpenAIOrganizer({env:{OPENAI_API_KEY:'test-only',LUNA_API_MODEL:'background-unchanged',LUNA_GRADING_MODEL:gradingModel},fetchImpl:async(_,options)=>{
   const payload=JSON.parse(options.body),input=JSON.parse(payload.input);requests.push(payload);
   return response(payload.model,{questionId:question.id,topicId:question.topicId,sourceIds:question.sourceIds,verdict:'correct',reasoningSufficient:true,assistanceUsed:false,assistanceCitationIds:[],answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:[input.materials[0].excerpts[0].id],...(input.attemptContext?{targetAttempt:true}:{})});
  }});
  for(const provisional of [false,true]){
   const result=await checkedGrade({question,answer,materials,organizer,testId:'study',...(provisional?{attemptContext:{provisional:true,latestPromptIsCanonical:false}}:{})});
   assert.deepEqual(result,{checked:true,verdict:'correct',unassisted:true,...(provisional?{targetAttempt:true}:{})});
  }
  assert.equal(requests.length,4);assert.ok(requests.every(r=>r.model===(gradingModel||'gpt-5.6-terra')));
  assert.equal(organizer.model,'background-unchanged');
 }
});
