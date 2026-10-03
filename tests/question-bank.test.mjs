import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createQuestionBank,questionBankRevision,questionBatchSchema,validateQuestionBatch} from '../server/question-bank.mjs';
import {createApiHandler} from '../server/api.mjs';

const input={title:'Biology',materials:[{id:'source-a',name:'Notes',text:'Mitochondria make ATP. Ribosomes make proteins.'}]};
const guide={overview:'Cell structures.',topics:[{title:'Mitochondria',summary:'Mitochondria make ATP.',sourceIds:['source-a']},{title:'Ribosomes',summary:'Ribosomes make proteins.',sourceIds:['source-a']}],questions:[{question:'What do mitochondria make?',answer:'ATP.',sourceIds:['source-a']}],script:'Mitochondria make ATP.'};
const waitFor=async predicate=>{const deadline=Date.now()+1500;while(!predicate()){if(Date.now()>deadline)throw Error('Question bank test timed out.');await new Promise(resolve=>setTimeout(resolve,5));}};
const generated=(request,version=1)=>({questions:request.slots.map(slot=>({slotId:slot.slotId,difficulty:slot.difficulty,question:`For ${slot.topicTitle}, what is the ${slot.difficulty} recall point in version ${version}?`,answer:'The fact stated in the supplied notes.',sourceIds:[slot.sourceIds[0]]}))});
function mockOrganizer(){const calls=[];let active=0,maxActive=0;return {available:true,calls,get maxActive(){return maxActive;},async organize(request,options){calls.push({request,options});active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return generated(request,calls.length);}};}

test('background preparation is bounded and serial, with one easy/medium/hard slot per topic',async()=>{
  const organizer=mockOrganizer(),bank=createQuestionBank({organizer,idleDelayMs:0,batchSize:3});
  try{
    assert.equal(bank.schedule(input,guide),true);assert.equal(organizer.calls.length,0,'schedule never starts provider inline');
    await waitFor(()=>bank.context(input)?.topics.length===2);
    const context=bank.context(input);assert.equal(organizer.maxActive,1);assert.equal(organizer.calls.length,2);
    assert.deepEqual(bank.topics(input),context.topics.map(topic=>({id:topic.topicId,title:topic.title})));
    for(const topic of context.topics){assert.deepEqual(topic.questions.map(q=>q.difficulty),['easy','medium','hard']);assert.ok(topic.topicId);for(const question of topic.questions){assert.match(question.id,/^[0-9a-f-]{36}$/);assert.equal(question.topicId,topic.topicId);assert.deepEqual(question.sourceIds,['source-a']);}}
    context.topics[0].questions[0].sourceIds.push('invalid');assert.deepEqual(bank.context(input).topics[0].questions[0].sourceIds,['source-a'],'private context is a copy');
    assert.ok(organizer.calls.every(call=>call.options.schema.additionalProperties===false&&call.options.signal instanceof AbortSignal));
    bank.schedule(input,guide);await new Promise(resolve=>setTimeout(resolve,15));assert.equal(organizer.calls.length,2,'ready cache is reused');
  }finally{bank.close();}
});

test('asking an exact queued question consumes only its slot and refills with a distinct ID',async()=>{
  const organizer=mockOrganizer(),bank=createQuestionBank({organizer,idleDelayMs:0});
  try{
    bank.schedule(input,guide);await waitFor(()=>bank.context(input)?.topics.length===2);
    const original=bank.context(input).topics[0].questions[0];
    assert.deepEqual(bank.consume(input,'What is a different question?'),[]);
    assert.deepEqual(bank.consume(input,original.question.replace('?',' in greater detail?')),[],'longer question is not the queued wording');
    const consumed=bank.consume(input,`Let us try this. ${original.question.toUpperCase()}`);
    assert.equal(consumed.length,1);assert.equal(consumed[0].id,original.id);assert.equal(consumed[0].topicTitle,'Mitochondria');
    assert.deepEqual(bank.consume(input,original.question),[],'cannot consume the same slot twice');
    await waitFor(()=>bank.context(input)?.topics[0]?.questions.length===3);
    const next=bank.context(input).topics[0].questions[0];assert.notEqual(next.id,original.id);assert.notEqual(next.question,original.question);assert.equal(next.topicId,original.topicId);
    assert.equal(organizer.calls[1].request.slots.length,1);assert.ok(organizer.calls[1].request.excludedQuestions.includes(original.question));
  }finally{bank.close();}
});

test('canonical ID lookup returns only copied public fields without consuming or changing the private context',async()=>{
  const bank=createQuestionBank({organizer:mockOrganizer(),idleDelayMs:0});
  try{
    bank.schedule(input,guide);await waitFor(()=>bank.context(input)?.topics.length===2);
    const context=bank.context(input),before=JSON.stringify(context),question=context.topics[0].questions[0];
    const resolved=bank.resolve(input,question.id);
    assert.deepEqual(Object.keys(resolved).sort(),['difficulty','id','question','sourceIds','topicId','topicTitle']);
    assert.equal(resolved.question,question.question);assert.equal(resolved.id,question.id);
    assert.equal(Object.hasOwn(resolved,'answer'),false);assert.equal(Object.hasOwn(resolved,'slotId'),false);
    resolved.sourceIds.push('forged');resolved.question='A different question?';
    assert.equal(JSON.stringify(bank.context(input)),before);
    assert.equal(bank.resolve(input,question.id).question,question.question);
    assert.deepEqual(bank.resolve(input,question.id).sourceIds,['source-a']);
    for(const id of ['unknown',null,{},question.id+' ',['id']])assert.equal(bank.resolve(input,id),null);
  }finally{bank.close();}
});

test('consumeById requires the matching exact spoken question and refuses ambiguous or guessed identity',async()=>{
  const bank=createQuestionBank({organizer:mockOrganizer(),idleDelayMs:0});
  try{
    bank.schedule(input,guide);await waitFor(()=>bank.context(input)?.topics.length===2);bank.setForegroundBusy(true);
    const [question,other]=bank.context(input).topics[0].questions;
    for(const [id,reply] of [
      ['unknown',question.question],
      [other.id,question.question],
      [question.id,'Let us use that question.'],
      [question.id,question.question.replace('?',' in more detail?')],
      [question.id,`${question.question} ${other.question}`],
      [question.id,null],
    ])assert.deepEqual(bank.consumeById(input,id,reply),[]);
    assert.ok(bank.resolve(input,question.id));assert.ok(bank.resolve(input,other.id));
    const consumed=bank.consumeById(input,question.id,`Try this. ${question.question}`);
    assert.deepEqual(consumed,[question]);
    assert.equal(bank.resolve(input,question.id),null);
    assert.deepEqual(bank.consumeById(input,question.id,question.question),[]);
    assert.ok(bank.resolve(input,other.id),'unrelated ready slot remains available');
  }finally{bank.close();}
});

test('IDs survive unrelated slot refill and consumed IDs cannot resolve or consume their replacement',async()=>{
  const organizer=mockOrganizer(),bank=createQuestionBank({organizer,idleDelayMs:0});
  try{
    bank.schedule(input,guide);await waitFor(()=>bank.context(input)?.topics.length===2);
    const [consumed,pending]=bank.context(input).topics[0].questions;
    const publicSnapshot=bank.resolve(input,pending.id);
    assert.equal(bank.consumeById(input,consumed.id,consumed.question)[0].id,consumed.id);
    await waitFor(()=>bank.context(input)?.topics[0]?.questions.length===3);
    assert.deepEqual(bank.resolve(input,pending.id),publicSnapshot);
    const replacement=bank.context(input).topics[0].questions[0];
    assert.notEqual(replacement.id,consumed.id);assert.notEqual(replacement.question,consumed.question);
    assert.deepEqual(bank.consumeById(input,consumed.id,replacement.question),[]);
    assert.equal(bank.resolve(input,consumed.id),null);
    assert.ok(organizer.calls.at(-1).request.excludedQuestions.includes(consumed.question));
    assert.equal(bank.consumeById(input,pending.id,pending.question)[0].id,pending.id);
  }finally{bank.close();}
});

test('canonical resolution and consumption reject changed, replaced, expired, and closed source revisions',async()=>{
  let now=100;const bank=createQuestionBank({organizer:mockOrganizer(),idleDelayMs:0,now:()=>now,ttlMs:100});
  try{
    bank.schedule(input,guide);await waitFor(()=>bank.context(input));
    const question=bank.context(input).topics[0].questions[0],changed={...input,materials:[{...input.materials[0],text:'Different source facts.'}]};
    assert.equal(bank.resolve(changed,question.id),null);assert.deepEqual(bank.consumeById(changed,question.id,question.question),[]);
    bank.schedule(changed,guide);await waitFor(()=>bank.context(changed));
    assert.equal(bank.resolve(input,question.id),null);assert.deepEqual(bank.consumeById(input,question.id,question.question),[]);
    const current=bank.context(changed).topics[0].questions[0];now=201;
    assert.equal(bank.resolve(changed,current.id),null);assert.deepEqual(bank.consumeById(changed,current.id,current.question),[]);
    bank.close();assert.equal(bank.resolve(changed,current.id),null);assert.deepEqual(bank.consumeById(changed,current.id,current.question),[]);
  }finally{bank.close();}
});

test('schema and runtime validation reject wrong slots, repeated questions and invented citations',()=>{
  const slots=[{slotId:'0:easy',difficulty:'easy',topicTitle:'Cells',sourceIds:['source-a']}];
  const valid=generated({slots});assert.equal(validateQuestionBatch(valid,slots).length,1);
  assert.deepEqual(questionBatchSchema(slots).properties.questions.items.properties.sourceIds.items.enum,['source-a']);
  for(const patch of [{sourceIds:['foreign']},{difficulty:'hard'},{slotId:'foreign'},{question:'Not a question'},{answer:'x'.repeat(801)},{extra:'hidden'}])assert.throws(()=>validateQuestionBatch({questions:[{...valid.questions[0],...patch}]},slots));
  assert.throws(()=>validateQuestionBatch(valid,slots,[valid.questions[0].question]));
  assert.throws(()=>validateQuestionBatch({questions:[]},slots));
});

test('a different mathematical operator cannot consume a queued question',async()=>{
  const organizer={available:true,async organize(request){const value=generated(request);value.questions[0].question='If x + 2 = 5, what is x?';value.questions[0].answer='3';return value;}};
  const bank=createQuestionBank({organizer,idleDelayMs:0});
  try{
    bank.schedule(input,{topics:guide.topics.slice(0,1)});await waitFor(()=>bank.context(input));
    const original=bank.context(input).topics[0].questions[0];
    for(const question of ['If x - 2 = 5, what is x?','If x * 2 = 5, what is x?','If x / 2 = 5, what is x?'])assert.deepEqual(bank.consume(input,question),[],question);
    const consumed=bank.consume(input,'Let us try this. IF X+2=5, WHAT IS X？');
    assert.equal(consumed.length,1);assert.equal(consumed[0].id,original.id);assert.equal(consumed[0].answer,'3');
  }finally{bank.close();}
});

test('batch deduplication keeps mathematical variants distinct but rejects formatting repeats',()=>{
  const slots=[{slotId:'0:easy',difficulty:'easy',sourceIds:['source-a']},{slotId:'0:hard',difficulty:'hard',sourceIds:['source-a']}];
  const questions=slots.map((slot,index)=>({...slot,question:`If x ${index?'-':'+'} 2 = 5, what is x?`,answer:index?'7':'3'}));
  assert.equal(validateQuestionBatch({questions},slots).length,2);
  assert.equal(validateQuestionBatch({questions:[questions[1]]},[slots[1]],[questions[0].question]).length,1);
  assert.throws(()=>validateQuestionBatch({questions:[questions[0]]},[slots[0]],['  IF X+2=5, WHAT IS X？ ']),/Repeated question/);
});

test('failed generation does not retry forever or leak provider errors',async()=>{
  let calls=0;const bank=createQuestionBank({organizer:{available:true,async organize(){calls++;throw Error('PRIVATE PROVIDER DIAGNOSTIC');}},idleDelayMs:0});
  try{bank.schedule(input,guide);await waitFor(()=>calls===1);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls,1);assert.equal(bank.context(input),null);bank.schedule(input,guide);await waitFor(()=>calls===2);assert.equal(bank.context(input),null);}finally{bank.close();}
});

test('new source revisions cancel stale jobs and cannot accept their eventual result',async()=>{
  let release;const calls=[];
  const organizer={available:true,async organize(request,options){calls.push({request,options});if(calls.length===1)return new Promise(resolve=>{release=()=>resolve(generated(request,1));});return generated(request,2);}};
  const bank=createQuestionBank({organizer,idleDelayMs:0});
  try{
    bank.schedule(input,guide);await waitFor(()=>calls.length===1);
    const changed={...input,materials:[{...input.materials[0],text:'Updated source facts.'}]};bank.schedule(changed,guide);
    assert.equal(calls[0].options.signal.aborted,true);release();await waitFor(()=>bank.context(changed)?.topics.length===2);
    assert.equal(bank.context(input),null);assert.equal(calls.length,2);assert.equal(calls[1].request.materials[0].text,'Updated source facts.');
  }finally{bank.close();}
});

test('foreground work defers new batches; close aborts running jobs',async()=>{
  let aborted=false,calls=0;
  const organizer={available:true,organize(_request,{signal}){calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('Canceled'));},{once:true}));}};
  const bank=createQuestionBank({organizer,idleDelayMs:0});
  bank.setForegroundBusy(true);bank.schedule(input,guide);await new Promise(resolve=>setTimeout(resolve,15));assert.equal(calls,0);
  bank.setForegroundBusy(false);await waitFor(()=>calls===1);bank.close();assert.equal(aborted,true);assert.equal(bank.context(input),null);assert.equal(bank.schedule(input,guide),false);
});

test('source fingerprints ignore conversation/setup and cache TTL/LRU bounds memory',async()=>{
  assert.equal(questionBankRevision(input),questionBankRevision({...input,date:'2030-10-15',conversation:[{role:'user',content:'Hello'}],privateQuestionBank:{invented:true}}));
  assert.notEqual(questionBankRevision(input),questionBankRevision({...input,materials:[{...input.materials[0],text:'Changed'}]}));
  let now=100;const organizer=mockOrganizer(),bank=createQuestionBank({organizer,idleDelayMs:0,now:()=>now,ttlMs:100,maxEntries:1});
  try{
    bank.schedule(input,guide);await waitFor(()=>bank.context(input));now=110;
    const other={title:'Independent class',materials:[{...input.materials[0],id:'source-b'}]},otherGuide={...guide,topics:guide.topics.map(topic=>({...topic,sourceIds:['source-b']}))};
    bank.schedule(other,otherGuide);await waitFor(()=>bank.context(other));assert.equal(bank.context(input),null);
    now=211;assert.equal(bank.context(other),null);assert.equal(organizer.calls.length,2);
  }finally{bank.close();}
});

const imageSourceId=`img-${'a'.repeat(64)}`;
const imageInput={testId:'18e2ced5-fab7-4b23-ae07-abc99c94a110',title:'Diagram study',materials:[{id:imageSourceId,name:'Cell screenshot.png',text:'Derived image description: a cell with labeled structures.'}]};
const imageGuide={topics:[{title:'Cell structures',summary:'Identify cell structures in the image.',sourceIds:[imageSourceId]}]};

test('image banks retain adapter-resolvable original IDs, scoped to the authorizing test',async()=>{
  const other={...imageInput,testId:'18e2ced5-fab7-4b23-ae07-abc99c94a111'},organizer=mockOrganizer(),bank=createQuestionBank({organizer,idleDelayMs:0});
  try{
    assert.notEqual(questionBankRevision(imageInput),questionBankRevision(other));
    assert.equal(questionBankRevision({...imageInput,testId:undefined}),null);
    assert.equal(questionBankRevision({...imageInput,testId:'not-a-test'}),null);
    assert.equal(questionBankRevision({...imageInput,materials:[{...imageInput.materials[0],id:'img-invalid'}]}),null);
    bank.schedule(imageInput,imageGuide);await waitFor(()=>bank.context(imageInput));
    const first=bank.context(imageInput).topics[0].questions[0];
    assert.equal(bank.context(other),null,'another test cannot read this image bank before preparation');
    assert.equal(bank.resolve(other,first.id),null);
    bank.schedule(other,imageGuide);await waitFor(()=>bank.context(other));bank.setForegroundBusy(true);
    const second=bank.context(other).topics[0].questions[0];
    assert.ok(bank.resolve(imageInput,first.id),'another test cannot evict this bank through a shared content ID');
    assert.notEqual(first.id,second.id);
    assert.deepEqual(bank.consumeById(other,first.id,first.question),[]);
    assert.equal(bank.consumeById(imageInput,first.id,first.question)[0].id,first.id);
    assert.ok(bank.resolve(other,second.id),'consumption is isolated even for byte-identical screenshots');
    assert.deepEqual(organizer.calls.map(call=>call.options.usageContext.testId),[imageInput.testId,other.testId]);
    for(const call of organizer.calls){
      assert.deepEqual(call.request.materials,imageInput.materials);
      assert.equal(call.options.usageContext.operation,'question-bank');
      assert.match(call.options.instructions,/original pixels: they are authoritative/);
      assert.match(call.options.instructions,/fallible derived transcription or description for search only/);
    }
  }finally{bank.close();}
});

test('changed original pixels invalidate the old image bank even if derived text is identical',async()=>{
  let release;const calls=[],organizer={available:true,async organize(request,options){calls.push({request,options});if(calls.length===1)return new Promise(resolve=>{release=()=>resolve(generated(request,1));});return generated(request,2);}};
  const bank=createQuestionBank({organizer,idleDelayMs:0});
  try{
    bank.schedule(imageInput,imageGuide);await waitFor(()=>calls.length===1);
    const id=`img-${'b'.repeat(64)}`,changed={...imageInput,materials:[{...imageInput.materials[0],id}]},changedGuide={topics:imageGuide.topics.map(topic=>({...topic,sourceIds:[id]}))};
    assert.notEqual(questionBankRevision(imageInput),questionBankRevision(changed));
    assert.equal(bank.schedule(changed,changedGuide),true);
    assert.equal(calls[0].options.signal.aborted,true,'test scope cancels old image jobs despite entirely new content IDs');
    release();await waitFor(()=>bank.context(changed));
    assert.equal(bank.context(imageInput),null);
    assert.deepEqual(bank.context(changed).topics[0].questions[0].sourceIds,[id]);
    assert.equal(calls.length,2);assert.equal(calls[1].request.materials[0].id,id);
  }finally{bank.close();}
});

test('private context stays within its configured size and keeps indexed topic order',async()=>{
  const organizer=mockOrganizer(),bank=createQuestionBank({organizer,idleDelayMs:0,maxContextChars:1500});
  try{bank.schedule(input,guide);await waitFor(()=>organizer.calls.length===1);await new Promise(resolve=>setTimeout(resolve,10));const context=bank.context({...input,conversation:[{role:'user',content:'Let us study ribosomes'}]});assert.ok(JSON.stringify(context).length<=1500);assert.equal(context.topics[0].title,'Mitochondria');assert.deepEqual(context,bank.context(input),'conversation keywords cannot select or reorder prepared questions');assert.equal(bank.topics(input).length,2,'all topics remain available for mastery denominator despite truncated private context');}finally{bank.close();}
});

test('successful guide response schedules private preparation without returning or awaiting it',async t=>{
  const scheduled=[];const handler=createApiHandler({env:{LUNA_ORGANIZER:'codex-cli'},cliOrganizer:{available:true,model:'gpt-5.6-luna',async organize(){return guide;}},questionBank:{schedule(...args){scheduled.push(args);return new Promise(()=>{});}}});
  const server=createServer((req,res)=>void handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(`${origin}/api/organize`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(input)});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{mode:'live',model:'gpt-5.6-luna',guide});assert.equal(scheduled.length,1);assert.deepEqual(scheduled[0],[input,guide]);
});
