import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {imageMimeType,pastedImageFiles,readImageMaterial,MATERIAL_ACCEPT} from '../src/image-imports.mjs';
import {readMaterial} from '../src/imports.js';
import {prepareMaterials} from '../src/prepare-materials.mjs';
import {fingerprintUpload} from '../src/material-dedup.mjs';
import {MAX_FILE_BYTES} from '../src/study.js';

const testId='11111111-1111-4111-8111-111111111111';
const png=()=>new File([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])],'screen.png',{type:'image/png'});
async function successful(file,overrides={}){
  const fingerprint=await fingerprintUpload(await file.arrayBuffer());
  return {material:{id:`img-${fingerprint}`,name:file.name,text:'Visible equation: x + 2 = 5. A labelled diagram is shown.',type:'png',size:file.size,fingerprint,extraction:{kind:'vision',textOrigin:'model-derived'},...overrides}};
}
const reply=body=>({ok:true,json:async()=>body});

test('image import sends exact bytes with query metadata and keeps the original as a Blob',async()=>{
  const file=png(),bytes=await file.arrayBuffer(),body=await successful(file);let calls=0;
  file.arrayBuffer=()=>{throw Error('Must reuse fingerprinted bytes');};
  const result=await readMaterial(file,{arrayBuffer:bytes,testId,fingerprint:body.material.fingerprint,fetchImpl:async(url,request)=>{
    calls++;const parsed=new URL(url,'http://local');assert.equal(parsed.pathname,'/api/material-images');assert.equal(parsed.searchParams.get('testId'),testId);assert.equal(parsed.searchParams.get('name'),file.name);
    assert.equal(request.headers['Content-Type'],'image/png');assert.equal(request.method,'POST');assert.deepEqual(new Uint8Array(request.body),new Uint8Array(bytes));return reply(body);
  }});
  assert.equal(calls,1);assert.equal(result.id,body.material.id);assert.ok(result.originalImage instanceof Blob);assert.equal(result.originalImage.type,'image/png');assert.deepEqual(await result.originalImage.arrayBuffer(),bytes);assert.equal(result.text,body.material.text);
});

test('PNG, JPEG and WebP detection supports file picker names and clipboard MIME without adding SVG/GIF',()=>{
  for(const [name,type,mime] of [['one.PNG','','image/png'],['two.jpeg','','image/jpeg'],['three.jpg','','image/jpeg'],['four.WEBP','','image/webp'],['clipboard','image/png','image/png']])assert.equal(imageMimeType({name,type}),mime);
  assert.equal(imageMimeType({name:'vector.svg',type:'image/svg+xml'}),null);assert.equal(imageMimeType({name:'animation.gif',type:'image/gif'}),null);
  for(const suffix of ['.png','.jpg','.jpeg','.webp'])assert.ok(MATERIAL_ACCEPT.includes(suffix));
});

test('oversized, empty, contextless and already-canceled images never start a request',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('Forbidden');};
  await assert.rejects(readImageMaterial({name:'large.png',size:MAX_FILE_BYTES+1},{testId,fetchImpl}),/20 MB/);
  await assert.rejects(readImageMaterial(new File([],'empty.png'),{testId,fetchImpl}),/empty/);
  await assert.rejects(readImageMaterial(png(),{fetchImpl}),/Open a test/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readImageMaterial(png(),{testId,fetchImpl,signal:controller.signal}),error=>error.name==='AbortError');assert.equal(calls,0);
});

test('unavailable vision and corrupt responses never produce fake material',async()=>{
  const file=png();
  await assert.rejects(readImageMaterial(file,{testId,fetchImpl:async()=>({ok:false,json:async()=>({error:'Image reading requires a connected model.'})})}),/connected model/);
  await assert.rejects(readImageMaterial(file,{testId,fetchImpl:async()=>{throw Error('network');}}),/local server/);
  const body=await successful(file);
  for(const override of [{fingerprint:'foreign'},{id:'foreign-id'},{text:''},{size:900},{extraction:{kind:'vision',textOrigin:'original'}}]){
    await assert.rejects(readImageMaterial(file,{testId,fetchImpl:async()=>reply({material:{...body.material,...override}})}),/invalid reading/);
  }
  await assert.rejects(readMaterial(new File(['gif'],'unsupported.gif',{type:'image/gif'}),{testId}),/PNG, JPEG, or WebP/);
});

test('same-batch concurrent copies share one extraction before a paid request and retain input names',async()=>{
  const first=png(),copy=new File([first],'renamed.png',{type:'image/png'});let calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const pending=prepareMaterials([first,copy,first],{testId,readMaterialImpl:async(file,options)=>{
    calls++;assert.equal(options.testId,testId);assert.equal(options.fingerprint,await fingerprintUpload(options.arrayBuffer));await gate;
    return readImageMaterial(file,{...options,fetchImpl:async()=>reply(await successful(file))});
  }});
  for(let i=0;i<50&&calls<1;i++)await setImmediate();assert.equal(calls,1);release();
  const results=await pending;assert.equal(calls,1);assert.deepEqual(results.map(value=>value.material.name),['screen.png','renamed.png','screen.png']);
  assert.equal(new Set(results.map(value=>value.material.id)).size,1);assert.ok(results.every(value=>value.material.originalImage instanceof Blob));
  let repeatCalls=0;const repeated=await prepareMaterials([copy],{testId,existing:[results[0].material],readMaterialImpl:async()=>{repeatCalls++;throw Error('No request expected');}});
  assert.equal(repeated[0].duplicate,true);assert.equal(repeatCalls,0);
});

test('hash completion order does not rename the earliest accepted copy, and failed vision remains retryable',async()=>{
  const bytes=await png().arrayBuffer(),first=new File([bytes],'first.png',{type:'image/png'}),second=new File([bytes],'second.png',{type:'image/png'});
  let release,reads=0;
  first.arrayBuffer=()=>new Promise(resolve=>{release=()=>resolve(bytes);});
  const pending=prepareMaterials([first,second],{testId,readMaterialImpl:async file=>{reads++;return (await successful(file)).material;}});
  for(let i=0;i<50&&reads<1;i++)await setImmediate();release();
  const values=await pending;assert.equal(reads,1);assert.equal(values[0].material.name,'first.png');assert.equal(values[1].material.name,'second.png');
  let attempts=0;
  const retry=await prepareMaterials([second,second],{testId,concurrency:1,readMaterialImpl:async file=>{if(++attempts===1)throw Error('Temporary vision failure');return(await successful(file)).material;}});
  assert.equal(attempts,2);assert.match(retry[0].error.message,/Temporary/);assert.equal(retry[1].material.name,'second.png');
});

test('pasting is explicit, names unnamed screenshots, ignores editable targets and text-only clipboard data',()=>{
  const file=new File([png()],'image.png',{type:'image/png'}),event={target:{closest:()=>null},clipboardData:{items:[{kind:'file',type:'image/png',getAsFile:()=>file}]}};
  const result=pastedImageFiles(event,{now:new Date('2026-10-02T12:00:00Z')});assert.equal(result.length,1);assert.equal(result[0].name,'Screenshot 2026-10-02T12-00-00-000Z.png');assert.equal(result[0].type,'image/png');assert.equal(result[0].size,file.size);
  assert.deepEqual(pastedImageFiles({...event,target:{closest:()=>({tagName:'INPUT'})}}),[]);
  assert.deepEqual(pastedImageFiles({target:event.target,clipboardData:{items:[{kind:'string',type:'text/plain'}]}}),[]);
  const fallback=pastedImageFiles({target:event.target,clipboardData:{files:[file]}});assert.equal(fallback.length,1);
});
