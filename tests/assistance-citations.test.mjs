import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGradeCitations,resolveGradeCitations,assistanceCitationIds} from '../server/grade-citations.mjs';
import {checkedGrade} from '../server/mastery.mjs';

const question={id:'q',topicId:'algebra',question:'Solve 5w - 10 = 20 and explain why.',sourceIds:['notes']};
const answer='Add 10 to both sides, then divide both sides by 5. w=6; equal operations preserve equality.';
const materials=[{id:'notes',text:'5w - 10 = 20 has solution w=6. Equal operations preserve equality.'}];
const hint='For this equation, add 10 to both sides first.';
const conversation=[{role:'assistant',content:question.question},{role:'user',content:'Could I get a hint?'},{role:'assistant',content:hint},{role:'user',content:answer}];
const catalog=buildGradeCitations(question,answer,materials,conversation);
const raw=(input=catalog,patch={})=>({questionId:'q',topicId:'algebra',sourceIds:['notes'],verdict:'correct',reasoningSufficient:true,assistanceUsed:false,assistanceCitationIds:[],answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:[input.materials[0].excerpts[0].id],...patch});

test('assistant citations retain original Unicode and full-history indices without minting student or private evidence',()=>{
 const text=' '.repeat(4)+('Evidence 😺 x² − x₂.\n'.repeat(150)),history=[...conversation,{role:'assistant',content:text}];
 const built=buildGradeCitations(question,answer,materials,history);
 assert.deepEqual(built.assistanceEvidence.map(turn=>turn.turnIndex),[0,2,4]);
 assert.equal(built.assistanceEvidence.at(-1).excerpts.map(item=>item.text).join(''),text);
 assert.ok(built.assistanceEvidence.at(-1).excerpts.every(item=>item.text.length<=1000&&!/[\uD800-\uDBFF]$/.test(item.text)));
 assert.ok(Object.isFrozen(built.assistanceEvidence)&&Object.isFrozen(built.assistanceEvidence[0].excerpts[0]));
 assert.equal(built.assistanceEvidence[0].assistanceEligible,false);
 assert.equal(JSON.stringify(built.assistanceEvidence).includes(answer),false);
 assert.equal(JSON.stringify(built.assistanceEvidence).includes(materials[0].text),false);
 const changed=buildGradeCitations(question,answer,materials,[...history.slice(0,4),{role:'assistant',content:text+'!'}]);
 assert.notEqual(changed.assistanceEvidence.at(-1).id,built.assistanceEvidence.at(-1).id);
 const shifted=buildGradeCitations(question,answer,materials,[{role:'user',content:'Earlier'},...history]);
 assert.notEqual(shifted.assistanceEvidence[1].id,built.assistanceEvidence[1].id);
});

test('assistance requires eligible distinct assistant IDs, and unassisted responses require no IDs',()=>{
 const valid=assistanceCitationIds(catalog)[0],neutral=catalog.assistanceEvidence[0].excerpts[0].id;
 const foreign=assistanceCitationIds(buildGradeCitations(question,answer,materials,[{role:'assistant',content:'Altered words.'}]))[0];
 for(const ids of [[],[neutral],['unknown'],[foreign],[catalog.answerExcerpts[0].id],[catalog.materials[0].excerpts[0].id],[valid,valid],[{id:valid,quote:'fabricated'}],[valid,valid,valid,valid,valid]]){
  assert.equal(resolveGradeCitations(raw(catalog,{assistanceUsed:true,assistanceCitationIds:ids}),catalog,{assistanceReview:true}).grade,null);
 }
 assert.equal(resolveGradeCitations(raw(catalog,{assistanceCitationIds:[valid]}),catalog,{assistanceReview:true}).grade,null);
 const missing=raw();delete missing.assistanceCitationIds;
 assert.equal(resolveGradeCitations(missing,catalog,{assistanceReview:true}).reason,'invalid-citation-response');
 const resolved=resolveGradeCitations(raw(catalog,{assistanceUsed:true,assistanceCitationIds:[valid]}),catalog,{assistanceReview:true});
 assert.deepEqual(resolved.grade.assistanceEvidence,[{id:valid,turnIndex:2,turnId:catalog.assistanceEvidence[1].id,quote:hint}]);
});

test('production schema and resolver cannot accept assistance from exact canonical restatement alone',async()=>{
 const seen=[],decisions=[];
 const result=await checkedGrade({question,answer,materials,conversation:[{role:'assistant',content:question.question}],onDecision:d=>decisions.push(d),organizer:{organize:async(input,options)=>{
  seen.push(options.schema);return raw(input,{assistanceUsed:true});
 }}});
 assert.equal(result,null);assert.equal(seen.length,1);
 assert.ok(seen[0].required.includes('assistanceCitationIds'));
 assert.equal(seen[0].properties.assistanceCitationIds.maxItems,0);
 assert.equal(decisions.at(-1).reason,'assistance-citation-mismatch');
});

test('two graders get unchanged complete history and diagnostics resolve public help, never model-written quotes',async()=>{
 const calls=[],decisions=[];
 const result=await checkedGrade({question,answer,materials,conversation,onDecision:d=>decisions.push(d),organizer:{organize:async(input,options)=>{
  calls.push(structuredClone({input,options:{schema:options.schema}}));
  return raw(input,{assistanceUsed:true,assistanceCitationIds:assistanceCitationIds(input)});
 }}});
 assert.deepEqual(result,{checked:true,verdict:'correct',unassisted:false});
 assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
 assert.deepEqual(calls[0].input.conversation,conversation);
 assert.deepEqual(decisions.filter(d=>d.reason==='assistance-evidence').map(d=>d.assistanceEvidence[0].quote),[hint,hint]);
 assert.equal(decisions.at(-1).reason,'validated-agreement');
});

test('authentic quotation membership cannot erase independent semantic assistance disagreement',async()=>{
 const history=[{role:'assistant',content:'For the different problem 2x+3=11, subtract 3 first.'},{role:'assistant',content:question.question},{role:'user',content:answer}];
 let calls=0;const decisions=[];
 const result=await checkedGrade({question,answer,materials,conversation:history,onDecision:d=>decisions.push(d),organizer:{organize:async input=>{
  const assisted=++calls===1;return raw(input,{assistanceUsed:assisted,assistanceCitationIds:assisted?assistanceCitationIds(input):[]});
 }}});
 assert.equal(calls,2);assert.equal(result,null);assert.equal(decisions.at(-1).reason,'independent-checks-disagree');
 assert.equal(decisions[0].assistanceEvidence[0].quote,history[0].content,'membership authenticates text; it is not a deterministic target-relevance oracle');
});
