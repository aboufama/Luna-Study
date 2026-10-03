import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGradeCitations,resolveGradeCitations,sourceCitationIds,assistanceCitationIds} from '../server/grade-citations.mjs';
import {checkedGrade,validateGrade} from '../server/mastery.mjs';
const question={id:'q',topicId:'algebra',sourceIds:['one','two']};
const answer='Subtract three from both sides. Then divide by two: x = 4.';
const materials=[{id:'one',name:'Original one',text:'2x + 3 = 11.\nSubtract 3 to get 2x = 8.'},{id:'two',name:'Original two',text:'Divide both sides by 2. The result is x = 4.'},{id:'unrelated',text:'Foreign source.'}];
const catalog=buildGradeCitations(question,answer,materials);
const verdict=(input=catalog,patch={})=>({questionId:question.id,topicId:question.topicId,sourceIds:question.sourceIds,verdict:'correct',reasoningSufficient:true,assistanceUsed:false,assistanceCitationIds:patch.assistanceUsed?assistanceCitationIds(input).slice(0,1):[],answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:input.materials.map(source=>source.excerpts[0].id),...patch});

test('citation catalogs preserve every original code unit, include only bound sources, and change identity with altered evidence',()=>{
  const original='   A long source with symbols x² − x₂ and 😺.\n\n'.repeat(1600),spoken='Long student answer. '.repeat(160);
  const large=buildGradeCitations({sourceIds:['one']},spoken,[{id:'one',text:original}]);
  assert.equal(large.materials[0].excerpts.map(p=>p.text).join(''),original);assert.equal(large.answerExcerpts.map(p=>p.text).join(''),spoken);
  assert.ok(large.materials[0].excerpts.every(p=>p.text.length<=1800));assert.ok(large.answerExcerpts.every(p=>p.text.length<=1000));
  assert.ok(Object.isFrozen(large)&&Object.isFrozen(large.materials[0].excerpts[0]));
  assert.deepEqual(catalog.materials.map(source=>source.id),['one','two']);
  assert.deepEqual(buildGradeCitations(question,answer,[...materials].reverse()),catalog);
  assert.notEqual(buildGradeCitations(question,answer+'!',materials).answerExcerpts[0].id,catalog.answerExcerpts[0].id);
  assert.notEqual(buildGradeCitations(question,answer,[{...materials[0],text:materials[0].text.replace('+','−')},materials[1]]).materials[0].excerpts[0].id,catalog.materials[0].excerpts[0].id);
});

test('server resolves IDs to original quotes and strict grade validation still binds identity and complete source membership',()=>{
  const resolved=resolveGradeCitations(verdict(),catalog);assert.equal(resolved.reason,null);
  assert.deepEqual(resolved.grade.answerQuotes,[answer]);assert.deepEqual(resolved.grade.sourceQuotes,materials.slice(0,2).map(s=>({sourceId:s.id,quote:s.text})));
  assert.ok(validateGrade(resolved.grade,question,answer,materials));
  const missing=resolveGradeCitations(verdict(catalog,{sourceCitationIds:[catalog.materials[0].excerpts[0].id]}),catalog);
  assert.equal(validateGrade(missing.grade,question,answer,materials),null,'a valid citation from only one required source cannot award credit');
  const swapped=resolveGradeCitations(verdict(catalog,{sourceIds:['one','foreign']}),catalog);assert.equal(validateGrade(swapped.grade,question,answer,materials),null);
});

test('unknown, foreign, duplicated and model-altered citation evidence never resolves',()=>{
  const foreign=buildGradeCitations({sourceIds:['unrelated']},answer,materials).materials[0].excerpts[0].id;
  for(const patch of [{answerCitationIds:['unknown']},{sourceCitationIds:[foreign]},{answerCitationIds:[catalog.materials[0].excerpts[0].id]},{sourceCitationIds:[catalog.answerExcerpts[0].id]},{answerCitationIds:[catalog.answerExcerpts[0].id,catalog.answerExcerpts[0].id]},{sourceCitationIds:[catalog.materials[0].excerpts[0].id,catalog.materials[0].excerpts[0].id]},{answerQuotes:['model-written alteration']},{sourceCitationIds:[{id:catalog.materials[0].excerpts[0].id,text:'altered'}]}])assert.equal(resolveGradeCitations(verdict(catalog,patch),catalog).grade,null);
});

test('citation validity cannot auto-award or erase semantic disagreement, assistance or insufficient reasoning',async()=>{
  const base={question,answer,materials,conversation:[{role:'assistant',content:'Start by subtracting three from both sides.'}]};
  for(const [patch,expected]of [[{verdict:'incorrect'},{checked:true,verdict:'incorrect',unassisted:true}],[{assistanceUsed:true},{checked:true,verdict:'correct',unassisted:false}],[{reasoningSufficient:false},null]]){
    let calls=0;const result=await checkedGrade({...base,organizer:{async organize(input){calls++;return verdict(input,patch);}}});assert.deepEqual(result,expected);assert.equal(calls,expected?2:1);
  }
  let calls=0;assert.equal(await checkedGrade({...base,organizer:{async organize(input){return verdict(input,{verdict:++calls===1?'correct':'partial'});}}}),null);assert.equal(calls,2);
  const seen=[];assert.deepEqual(await checkedGrade({...base,organizer:{async organize(input,options){seen.push(structuredClone({input,options:{schema:options.schema}}));return verdict(input);}}}),{checked:true,verdict:'correct',unassisted:true});
  assert.deepEqual(seen[0],seen[1]);assert.equal(JSON.stringify(seen[1]).includes('previousVerdict'),false);
  assert.equal(seen[0].input.materials[0].text,undefined,'complete excerpt text replaces raw duplicate source payload');
});

const imageId=`img-${'a'.repeat(64)}`,otherImageId=`img-${'b'.repeat(64)}`;
const imageSource={id:imageId,name:'Equation screenshot.png',text:'Derived OCR: x + 2 = 5.'};
const imageQuestion={...question,sourceIds:[imageId]};
const imageVerdict=(input,patch={})=>({...verdict(),answerCitationIds:[input.answerExcerpts[0].id],sourceIds:input.materials.map(source=>source.id),sourceCitationIds:sourceCitationIds(input),assistanceCitationIds:patch.assistanceUsed?assistanceCitationIds(input).slice(0,1):[],...patch});

test('image evidence binds original byte identity and never mints OCR into original text citations',()=>{
  const first=buildGradeCitations(imageQuestion,answer,[imageSource]),image=first.materials[0];
  assert.deepEqual(image.excerpts,[]);
  assert.equal(image.derivedText,imageSource.text);
  assert.equal(image.textOrigin,'derived-image-text');
  assert.deepEqual(image.imageEvidence,{id:`image:${imageId}`,type:'image',sourceId:imageId,sha256:'a'.repeat(64)});
  assert.ok(Object.isFrozen(image.imageEvidence));
  const differentOcr=buildGradeCitations(imageQuestion,answer,[{...imageSource,text:'Different derived description, same original pixels.'}]);
  assert.equal(differentOcr.materials[0].imageEvidence.id,image.imageEvidence.id);
  const differentPixels=buildGradeCitations({...imageQuestion,sourceIds:[otherImageId]},answer,[{...imageSource,id:otherImageId}]);
  assert.notEqual(differentPixels.materials[0].imageEvidence.id,image.imageEvidence.id,'pixel identity changes even when OCR is identical');
  const resolved=resolveGradeCitations(imageVerdict(first),first);
  assert.deepEqual(resolved.grade.sourceQuotes,[]);
  assert.deepEqual(resolved.grade.sourceImages,[{type:'image',sourceId:imageId,sha256:'a'.repeat(64)}]);
  assert.ok(validateGrade(resolved.grade,imageQuestion,answer,[imageSource]));
  assert.equal(validateGrade({...resolved.grade,sourceImages:[],sourceQuotes:[{sourceId:imageId,quote:imageSource.text}]},imageQuestion,answer,[imageSource]),null,'even exact OCR cannot replace original-image evidence');
  for(const id of ['img-invalid',`img-${'A'.repeat(64)}`,`img-${'a'.repeat(63)}`])assert.equal(buildGradeCitations({...imageQuestion,sourceIds:[id]},answer,[{...imageSource,id}]),null);
});

test('mixed text and image grades require each original and reject altered, foreign or duplicate image evidence',()=>{
  const mixedMaterials=[materials[0],imageSource],mixedQuestion={...question,sourceIds:['one',imageId]};
  const mixed=buildGradeCitations(mixedQuestion,answer,mixedMaterials),resolved=resolveGradeCitations(imageVerdict(mixed),mixed).grade;
  assert.ok(validateGrade(resolved,mixedQuestion,answer,mixedMaterials));
  assert.deepEqual(resolved.sourceQuotes,[{sourceId:'one',quote:materials[0].text}]);
  for(const patch of [
    {sourceImages:undefined},{sourceImages:[]},{sourceQuotes:[]},
    {sourceImages:[{type:'image',sourceId:imageId,sha256:'b'.repeat(64)}]},
    {sourceImages:[{type:'image',sourceId:otherImageId,sha256:'b'.repeat(64)}]},
    {sourceImages:[{...resolved.sourceImages[0],type:'ocr'}]},
    {sourceImages:[{...resolved.sourceImages[0],quote:imageSource.text}]},
    {sourceImages:[resolved.sourceImages[0],resolved.sourceImages[0]]},
    {sourceQuotes:[...resolved.sourceQuotes,{sourceId:imageId,quote:imageSource.text}]},
  ])assert.equal(validateGrade({...resolved,...patch},mixedQuestion,answer,mixedMaterials),null);
  for(const ids of [[`image:${otherImageId}`],[mixed.materials[0].excerpts[0].id,mixed.materials[0].excerpts[0].id]])assert.equal(resolveGradeCitations(imageVerdict(mixed,{sourceCitationIds:ids}),mixed).grade,null);
  const textOnly=resolveGradeCitations(verdict(),catalog).grade;
  assert.equal(validateGrade({...textOnly,sourceImages:resolved.sourceImages},question,answer,materials),null,'image evidence cannot be attached to unrelated text questions');
});

test('both independent image graders receive the same test-scoped original ID and cannot award on uncertainty or disagreement',async()=>{
  const testId='18e2ced5-fab7-4b23-ae07-abc99c94a110',seen=[];
  const base={question:imageQuestion,answer,materials:[imageSource],testId,conversation:[{role:'assistant',content:'Subtract two from both sides first.'}]};
  const organizer={async organize(input,options){
    seen.push(structuredClone({input,instructions:options.instructions,schema:options.schema,usageContext:options.usageContext}));
    assert.equal(input.materials[0].id,imageId,'adapter resolves pixels by ID, independent of OCR/excerpts');
    assert.deepEqual(options.usageContext,{testId,operation:'grading'});
    assert.deepEqual(options.schema.properties.sourceCitationIds.items.enum,[`image:${imageId}`]);
    assert.match(options.instructions,/original pixels are authoritative/);
    assert.match(options.instructions,/Never grade an image from derivedText/);
    assert.match(options.instructions,/return unclear; unclear earns no credit/);
    return imageVerdict(input);
  }};
  assert.deepEqual(await checkedGrade({...base,organizer}),{checked:true,verdict:'correct',unassisted:true});
  assert.equal(seen.length,2);assert.deepEqual(seen[0],seen[1]);
  assert.equal(Object.hasOwn(seen[1].input,'previousVerdict'),false);
  let calls=0;
  assert.equal(await checkedGrade({...base,organizer:{async organize(input){calls++;return imageVerdict(input,{verdict:'unclear'});}}}),null);assert.equal(calls,1);
  calls=0;assert.equal(await checkedGrade({...base,organizer:{async organize(input){return imageVerdict(input,{verdict:++calls===1?'correct':'incorrect'});}}}),null);assert.equal(calls,2);
  assert.deepEqual(await checkedGrade({...base,organizer:{async organize(input){return imageVerdict(input,{assistanceUsed:true});}}}),{checked:true,verdict:'correct',unassisted:false});
  calls=0;const controller=new AbortController();
  assert.equal(await checkedGrade({...base,signal:controller.signal,organizer:{async organize(input){calls++;controller.abort();return imageVerdict(input);}}}),null);assert.equal(calls,1,'cancellation prevents a second image grade');
});
