import test from 'node:test';
import assert from 'node:assert/strict';
import {assistanceCitationIds} from '../server/grade-citations.mjs';
import {checkedGrade} from '../server/mastery.mjs';

const question={id:'new-id',topicId:'algebra',topicTitle:'Algebra',difficulty:'hard',question:'How do you solve 5w - 10 = 20 and why are the steps valid?',answer:'Add10 then divide5; w=6. Equal operations preserve equality.',sourceIds:['notes']};
const answer='Add 10 to both sides to get 5w=30, then divide both sides by5 to get w=6. Equal operations preserve equality.';
const materials=[{id:'notes',name:'Notes',text:'Adding the same amount to both sides preserves equality. From 5w - 10 = 20, add10 then divide5 to obtain w=6.'}];
function response(input,assisted){return{questionId:input.question.id,topicId:input.question.topicId,sourceIds:input.question.sourceIds,verdict:'correct',reasoningSufficient:true,assistanceUsed:assisted,assistanceCitationIds:assisted?assistanceCitationIds(input).slice(0,1):[],answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:[input.materials[0].excerpts[0].id]};}

test('both independent graders retain exact-target help before a renamed/restated question',async()=>{
 const conversation=[{role:'assistant',content:'Earlier question old-id: start 5w - 10 = 20 by adding10 to both sides.'},{role:'user',content:'Skip it for now.'},{role:'assistant',content:question.question},{role:'user',content:answer}],calls=[];
 const grade=await checkedGrade({question,answer,materials,conversation,organizer:{organize:async(input,options)=>{calls.push({input,options});return response(input,true);}}});
 assert.deepEqual(grade,{verdict:'correct',unassisted:false,checked:true});assert.equal(calls.length,2);
 for(const call of calls){assert.deepEqual(call.input.conversation,conversation);assert.equal(call.input.question.id,'new-id');assert.match(call.options.instructions,/Substantive help still counts if this same target is later restated or assigned another question ID/);assert.match(call.options.instructions,/displaying its unsolved equation or diagram alone is not assistance/);assert.match(call.options.instructions,/sourceIds must match the question sourceIds exactly/);}
});

test('restatement clarification does not bypass independent assistance disagreement or source validation',async()=>{
 const conversation=[{role:'assistant',content:'Take your time.'},{role:'assistant',content:question.question},{role:'user',content:'Please repeat the question.'},{role:'assistant',content:question.question},{role:'user',content:answer}];let calls=0;const decisions=[];
 const grade=await checkedGrade({question,answer,materials,conversation,onDecision:d=>decisions.push(d),organizer:{organize:async input=>response(input,calls++===0)}});
 assert.equal(calls,2);assert.equal(grade,null);assert.equal(decisions.at(-1).reason,'independent-checks-disagree');
 const invalid=await checkedGrade({question,answer,materials,conversation,organizer:{organize:async input=>({...response(input,false),sourceCitationIds:['foreign-citation']})}});
 assert.equal(invalid,null);
});
