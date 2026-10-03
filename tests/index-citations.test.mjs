import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIndexCitations,selectableIndexCitations} from '../server/index-citations.mjs';
import {validateChunkAnalyses,expandVerifiedQuotes,createMaterialIndexer,splitSource} from '../server/indexing.mjs';

const chunk=(text,extra={})=>({chunkId:'original-chunk',sourceId:'source-a',start:0,end:text.length,text,...extra});
const response=(original,ids,titles)=>({chunkId:original.chunkId,topics:ids.map((id,index)=>({title:titles?.[index]||`Topic ${index+1}`,citationIds:[id]}))});
const validate=(original,ids)=>validateChunkAnalyses({chunks:[response(original,ids)]},[original]).get(original.chunkId);
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('catalog is immutable, lossless, and preserves original Unicode, whitespace, CRLF and mathematics',()=>{
  const original=chunk('\t \r\n'+('Résumé: α² + β² = γ². 😀 e\u0301 \nEquation: \\frac{a}{b} = 7.\r\n\r\n').repeat(43)+'\r\n  ');
  const catalog=buildIndexCitations(original);
  assert.equal(catalog.map(excerpt=>excerpt.text).join(''),original.text);
  assert.deepEqual(buildIndexCitations(original),catalog);
  assert.ok(Object.isFrozen(catalog));
  let cursor=0;
  for(const excerpt of catalog){
    assert.ok(Object.isFrozen(excerpt));assert.equal(excerpt.start,cursor);assert.equal(excerpt.text,original.text.slice(excerpt.start,excerpt.end));
    assert.ok(excerpt.text.length<=600);assert.ok(!/[\uD800-\uDBFF]$/.test(excerpt.text));assert.ok(!/^[\uDC00-\uDFFF]/.test(excerpt.text));
    if(excerpt.text.trim())assert.ok(excerpt.text.length>=256);
    cursor=excerpt.end;
  }
  assert.equal(cursor,original.text.length);
  assert.throws(()=>{catalog[0].text='changed';},TypeError);
});

test('balanced partitions never leave a tiny selectable tail, including exact-limit surrogate boundaries',()=>{
  for(const size of [601,602,700,855,1100,1199,1200,1201,1799,1800,1801,18001]){
    let text='a'.repeat(size);
    if(size>=1200)text=text.slice(0,599)+'😀'+text.slice(601);
    const original=chunk(text),catalog=buildIndexCitations(original);
    assert.equal(catalog.map(item=>item.text).join(''),text);
    assert.ok(catalog.every(item=>item.text.length>=256&&item.text.length<=600));
    for(const item of catalog){assert.ok(!/[\uD800-\uDBFF]$/.test(item.text));validate(original,[item.id]);}
  }
});

test('short readable chunks select the complete original readable span, even with long edge whitespace',()=>{
  for(const text of ['x = 3.','\r\n  Full short fact: 😀 x² = 4.\r\n ',' '.repeat(900)+'All of this short passage stays intact.\nα = 2.'+'\t'.repeat(1300)]){
    const original=chunk(text),catalog=buildIndexCitations(original),readable=selectableIndexCitations(catalog);
    assert.equal(catalog.map(item=>item.text).join(''),text);assert.equal(readable.length,1);assert.equal(readable[0].text,text.trim());
    const resolved=validate(original,[readable[0].id]);assert.deepEqual(resolved.quotes,[text.trim()]);
    const whitespace=catalog.find(item=>!item.text.trim());if(whitespace)assert.throws(()=>validate(original,[whitespace.id]),error=>error.status===502);
  }
});

test('foreign, cross-chunk, stale-content and changed-offset IDs fail closed without fuzzy matching',()=>{
  const original=chunk('Unmodified factual passage. '.repeat(50));
  const id=selectableIndexCitations(buildIndexCitations(original))[0].id;
  const alternates=[
    {...original,chunkId:'other-chunk'},
    {...original,sourceId:'other-source'},
    {...original,start:700,end:700+original.text.length},
    {...original,text:original.text.replace('factual','fictional')},
    {...original,text:original.text.replace(' ', '\t')},
  ];
  for(const other of alternates){
    assert.notEqual(buildIndexCitations(other)[0].id,id);
    assert.throws(()=>validate(other,[id]),error=>error.status===502);
  }
  assert.throws(()=>validate(original,[id+'-invented']),error=>error.status===502);
  assert.throws(()=>validateChunkAnalyses({chunks:[{chunkId:original.chunkId,topics:[{title:'Guess',citationIds:[id],quotes:[original.text.slice(0,600)]}]}]},[original]),error=>error.status===502);
});

test('six topics have at most 3600 authentic evidence characters; shared citations deduplicate',()=>{
  const original=chunk('abcdef'.repeat(600)),catalog=buildIndexCitations(original);
  assert.equal(catalog.length,6);
  const resolved=validate(original,catalog.map(item=>item.id));
  assert.equal(resolved.excerpts.reduce((sum,item)=>sum+item.quote.length,0),3600);
  const shared=validate(original,Array(6).fill(catalog[0].id));assert.equal(shared.excerpts.length,1);assert.equal(shared.topics.length,6);
  assert.throws(()=>validate(original,Array(7).fill(catalog[0].id)),error=>error.status===502);
  assert.throws(()=>validateChunkAnalyses({chunks:[{chunkId:original.chunkId,topics:[{title:'Two',citationIds:catalog.slice(0,2).map(item=>item.id)}]}]},[original]),error=>error.status===502);
});

test('every chunk must resolve once, and repeated text retains its exact occurrence for paragraph expansion',()=>{
  const repeated='Shared statement. '.repeat(20),first='First setup. '+repeated+' First qualification.',second='Second setup. '+repeated+' Second qualification.';
  const sourceText=first+'\n\n'+second,original=chunk(repeated,{start:first.length+2+'Second setup. '.length,end:first.length+2+'Second setup. '.length+repeated.length});
  const id=selectableIndexCitations(buildIndexCitations(original))[0].id,resolved=validate(original,[id]);
  assert.deepEqual(expandVerifiedQuotes(sourceText,resolved.excerpts),[second]);
  assert.throws(()=>expandVerifiedQuotes(sourceText,[{...resolved.excerpts[0],end:resolved.excerpts[0].end-1}]),error=>error.status===502);
  assert.throws(()=>expandVerifiedQuotes('Exact original.',[{quote:'Exact original.',start:0,end:999}]),error=>error.status===502);
  const other=chunk('Another source fact. '.repeat(30),{chunkId:'second',sourceId:'source-b'}),otherId=selectableIndexCitations(buildIndexCitations(other))[0].id;
  for(const chunks of [[response(original,[id])],[response(original,[id]),response(original,[id])],[response(original,[otherId]),response(other,[id])]]){
    assert.throws(()=>validateChunkAnalyses({chunks},[original,other]),error=>error.status===502);
  }
  assert.equal(validateChunkAnalyses({chunks:[response(other,[otherId]),response(original,[id])]},[original,other]).size,2);
});

test('map schema binds each chunk to its catalog, full originals reach the model, and the merge receives exact spans only',async()=>{
  const materials=[{id:'one',name:'Original one',text:'\r\n'+('Exact first source: π = 3.14159. 😀 \\sqrt{x}.\n').repeat(35)},{id:'two',name:'Original two',text:('Other original evidence remains untouched.\n').repeat(35)}];
  const calls=[],events=[];
  const provider={available:true,model:'test',async organize(request,options){
    calls.push({request,options});
    if(request.chunks){
      assert.equal(Object.hasOwn(request,'maxQuoteCharsPerChunk'),false);
      for(const [index,wire] of request.chunks.entries()){
        assert.equal(Object.hasOwn(wire,'text'),false,'original text is sent once, via ordered excerpts');
        const original=materials.find(item=>item.id===wire.sourceId);
        assert.ok(splitSource(original,1000).some(part=>part.text===wire.excerpts.map(item=>item.text).join('')));
        const schema=options.schema.properties.chunks.items.anyOf[index];
        assert.deepEqual(schema.properties.chunkId.enum,[wire.chunkId]);
        assert.equal(schema.properties.topics.maxItems,6);assert.equal(schema.properties.topics.items.properties.citationIds.maxItems,1);
        assert.deepEqual(schema.properties.topics.items.properties.citationIds.items.enum,wire.excerpts.filter(item=>item.text.trim()).map(item=>item.id));
      }
      return {chunks:request.chunks.map(wire=>response(wire,[wire.excerpts.find(item=>item.text.trim()).id]))};
    }
    for(const material of request.materials)for(const exact of material.text.split('\n\n'))assert.ok(materials.find(item=>item.id===material.id).text.includes(exact));
    return {overview:'Organized original evidence.',topics:request.materials.map(item=>({title:item.name,summary:'Source-backed concepts.',sourceIds:[item.id]}))};
  }};
  const indexer=createMaterialIndexer({organizer:provider,directChars:0,chunkChars:1000,diagnostics:{record:(_id,event)=>events.push(event)}});
  try{
    await indexer.organize({testId:'12345678-1234-4234-9234-123456789abc',title:'Originals',materials});
    assert.equal(calls.at(-1).options.usageContext.operation,'index-merge');assert.ok(events.some(event=>event.type==='index.coverage.ready'));
  }finally{indexer.close();}
});

test('one bad citation prevents map caching, coverage ready, merge, and partial success',async()=>{
  const events=[];let calls=0;
  const provider={available:true,model:'test',async organize(request){calls++;assert.ok(request.chunks);return {chunks:request.chunks.map((wire,index)=>response(wire,[index?'foreign':wire.excerpts.find(item=>item.text.trim()).id]))};}};
  const indexer=createMaterialIndexer({organizer:provider,directChars:0,diagnostics:{record:(_id,event)=>events.push(event)}});
  try{
    await assert.rejects(indexer.organize({testId:'12345678-1234-4234-9234-123456789abc',title:'No partial',materials:[{id:'a',name:'a',text:'Original. '.repeat(100)},{id:'b',name:'b',text:'Second. '.repeat(100)}]}),error=>error.status===502);
    await tick();assert.equal(calls,1);assert.equal(indexer.stats().cacheEntries,0);
    assert.equal(events.some(event=>['index.coverage.ready','index.map.ready','index.merge.started'].includes(event.type)),false);
    assert.equal(events.find(event=>event.type==='index.map.failed').details.reason,'citation-not-in-original-chunk');
    assert.equal(JSON.stringify(events).includes('Original.'),false,'diagnostics identify the failure without source text');
  }finally{indexer.close();}
});
