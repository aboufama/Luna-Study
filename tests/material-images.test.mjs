import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createCanvas } from '@napi-rs/canvas';
import { createMaterialImageStore, createMaterialImageImporter, inspectMaterialImage, IMAGE_BYTES_LIMIT } from '../server/material-images.mjs';
import { createMaterialImageHandler } from '../server/material-image-api.mjs';

const testId='12345678-1234-4234-9234-123456789abc';
const otherTest='12345678-1234-4234-9234-123456789abd';
const extraction={transcription:'A → B',visualDescription:'An arrow points from A to B.',uncertainties:''};
function bitmap(index=0,mimeType='image/png'){
  const canvas=createCanvas(120,80),ctx=canvas.getContext('2d');
  ctx.fillStyle=`rgb(${index*20%255},40,200)`;ctx.fillRect(0,0,120,80);
  ctx.fillStyle='white';ctx.font='18px sans-serif';ctx.fillText('A → B',10,40);
  return canvas.toBuffer(mimeType);
}
async function fixture(t){
  const directory=await mkdtemp(path.join(tmpdir(),'luna-image-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return {directory,store:createMaterialImageStore({directory})};
}
const waitUntil=async(fn)=>{const end=Date.now()+3000;while(!fn()){assert.ok(Date.now()<end,'condition should settle');await new Promise(resolve=>setTimeout(resolve,5));}};

test('PNG, JPEG and WebP use verified pixels, stable content IDs and dimensions',async()=>{
  for(const mime of ['image/png','image/jpeg','image/webp']){
    const info=await inspectMaterialImage(bitmap(0,mime),mime);
    assert.match(info.id,/^img-[a-f0-9]{64}$/);assert.equal(info.fingerprint,info.id.slice(4));
    assert.equal(info.width,120);assert.equal(info.height,80);assert.equal(info.mimeType,mime);
  }
  const a=await inspectMaterialImage(bitmap(1),'image/png'),b=await inspectMaterialImage(bitmap(2),'image/png');
  assert.notEqual(a.id,b.id,'changed pixels invalidate source identity even when derived text is unchanged');
});

test('invalid, mislabeled, animated, oversized and decompression-bomb images fail before model calls',async()=>{
  await assert.rejects(inspectMaterialImage(Buffer.from('<svg onload="alert(1)"/>'),'image/png'),{status:415});
  await assert.rejects(inspectMaterialImage(bitmap(),'image/jpeg'),{status:415});
  await assert.rejects(inspectMaterialImage(Buffer.alloc(IMAGE_BYTES_LIMIT+1),'image/png'),{status:413});
  await assert.rejects(inspectMaterialImage(bitmap().subarray(0,40),'image/png'),{status:400});
  const bomb=Buffer.from(bitmap());bomb.writeUInt32BE(100000,16);
  await assert.rejects(inspectMaterialImage(bomb,'image/png'),{status:413});
  const apng=Buffer.concat([bitmap().subarray(0,33),Buffer.from([0,0,0,0,97,99,84,76,0,0,0,0]),bitmap().subarray(33)]);
  await assert.rejects(inspectMaterialImage(apng,'image/png'),{status:415});
});

test('original assets survive restart, stay private per test, and reject altered bytes and forged IDs',async t=>{
  const {directory,store}=await fixture(t),bytes=bitmap();
  const source=await store.put({testId,name:'diagram.png',bytes,mimeType:'image/png'});
  assert.equal((await stat(path.join(directory,testId,source.id+'.image'))).mode&0o777,0o600);
  assert.equal(await store.material({testId,sourceId:source.id}),null);
  const restored=createMaterialImageStore({directory});
  const [resolved]=await restored.resolve({testId,sourceIds:['text-source',source.id,source.id]});
  assert.equal(resolved.dataUrl,`data:image/png;base64,${bytes.toString('base64')}`);
  await assert.rejects(restored.resolve({testId:otherTest,sourceIds:[source.id]}),{status:409});
  await assert.rejects(restored.resolve({testId,sourceIds:['img-../../secret']}),{status:400});
  await assert.rejects(restored.resolve({sourceIds:[source.id]}),{status:400});
  await writeFile(path.join(directory,testId,source.id+'.image'),bitmap(3));
  await assert.rejects(restored.resolve({testId,sourceIds:[source.id]}),{status:409});
});

test('vision imports cache derived notes, keep originals separate and account every paid call to its test',async t=>{
  const {store,directory}=await fixture(t),calls=[],events=[];
  const importer=createMaterialImageImporter({imageStore:store,organizer:{available:true,model:'gpt-6-luna',async organize(input,options){calls.push({input,options});return extraction;}},diagnostics:{record:(id,event)=>events.push({id,event})}});
  t.after(()=>importer.close());
  const input={testId,name:'diagram.png',bytes:bitmap(),mimeType:'image/png'};
  const material=await importer.import(input),again=await importer.import({...input,name:'renamed.png'});
  assert.equal(calls.length,1);assert.equal(again.name,'renamed.png');assert.equal(again.id,material.id);
  assert.equal(material.extraction.textOrigin,'model-derived');assert.match(material.text,/original screenshot is authoritative/);
  assert.deepEqual(calls[0].options.usageContext,{testId,operation:'image-extract'});
  assert.match(calls[0].options.images[0].dataUrl,/^data:image\/png;base64,/);
  assert.equal(calls[0].options.images[0].sourceId,material.id);
  assert.deepEqual(events.map(x=>x.event.type),['image.started','image.ready','image.cached']);
  assert.ok(events.every(x=>x.id===testId));
  assert.equal(JSON.stringify(events).includes('base64'),false);
  assert.equal(JSON.stringify(events).includes(extraction.transcription),false);
  const meta=await readFile(path.join(directory,testId,material.id+'.json'),'utf8');
  assert.equal(meta.includes('base64'),false);
  assert.equal(JSON.stringify(material).includes('data:image'),false);
});

test('same-test simultaneous duplicate images share one vision read and cancel independently',async t=>{
  const {store}=await fixture(t);let calls=0,complete;
  const importer=createMaterialImageImporter({imageStore:store,organizer:{available:true,model:'mock',async organize(){calls++;return new Promise(resolve=>{complete=resolve;});}}});
  t.after(()=>importer.close());
  const input={testId,name:'a.png',bytes:bitmap(),mimeType:'image/png'},abort=new AbortController();
  const canceled=importer.import({...input,signal:abort.signal});
  const other=importer.import({...input,name:'b.png'});
  await waitUntil(()=>calls===1);abort.abort();
  await assert.rejects(canceled,{status:499});
  complete(extraction);assert.equal((await other).name,'b.png');assert.equal(calls,1);
});

test('at most five image interpretation calls run concurrently; every file completes',async t=>{
  const {store}=await fixture(t);let active=0,peak=0,calls=0;const complete=[];
  const importer=createMaterialImageImporter({imageStore:store,organizer:{available:true,model:'mock',async organize(){calls++;active++;peak=Math.max(active,peak);await new Promise(resolve=>complete.push(resolve));active--;return extraction;}}});
  t.after(()=>importer.close());
  const jobs=Array.from({length:7},(_,i)=>importer.import({testId,name:`image-${i}.png`,bytes:bitmap(i),mimeType:'image/png'}));
  await waitUntil(()=>calls===5);assert.equal(peak,5);
  complete.splice(0).forEach(resolve=>resolve());
  await waitUntil(()=>calls===7);complete.splice(0).forEach(resolve=>resolve());
  const results=await Promise.all(jobs);assert.equal(new Set(results.map(x=>x.id)).size,7);assert.equal(peak,5);
});

test('failed vision reads remain retryable and never create cached successful material',async t=>{
  const {store}=await fixture(t);let calls=0;
  const importer=createMaterialImageImporter({imageStore:store,organizer:{available:true,model:'mock',async organize(){calls++;return calls===1?{...extraction,transcription:'',visualDescription:''}:extraction;}}});
  t.after(()=>importer.close());
  const input={testId,name:'a.png',bytes:bitmap(),mimeType:'image/png'};
  await assert.rejects(importer.import(input),{status:502});
  assert.ok((await importer.import(input)).text);assert.equal(calls,2);
  const disabled=createMaterialImageImporter({imageStore:store});
  await assert.rejects(disabled.import(input),{status:503});
});

test('binary upload endpoint enforces same origin, MIME, valid test and clear service errors',async t=>{
  const {store}=await fixture(t);
  const importer=createMaterialImageImporter({imageStore:store,organizer:{available:true,model:'mock',async organize(){return extraction;}}});
  const handler=createMaterialImageHandler({importer});
  const server=createServer(async(req,res)=>{if(!await handler(req,res)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{importer.close();server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`,route=`${origin}/api/material-images?testId=${testId}&name=image.png`;
  const upload=(headers={},url=route)=>fetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'image/png',...headers},body:bitmap()});
  const response=await upload();assert.equal(response.status,200);
  assert.match((await response.json()).material.id,/^img-/);
  assert.equal((await upload({Origin:'https://outside.example'})).status,403);
  assert.equal((await upload({'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await upload({'Content-Type':'image/svg+xml'})).status,415);
  assert.equal((await upload({},`${origin}/api/material-images?testId=../../x&name=x.png`)).status,400);
  assert.equal((await fetch(route)).status,405);
});
