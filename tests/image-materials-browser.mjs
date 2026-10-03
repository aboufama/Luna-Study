// Local browser regression. All APIs are mocked and microphone access is denied.
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';

const origin=process.env.LUNA_TEST_URL||'http://127.0.0.1:5188',testId='22222222-2222-4222-8222-222222222222';
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[],vision=[],indexing=[];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw new DOMException('Test microphone remains off','NotAllowedError');}}});
  window.__imageUrls={created:[],revoked:[]};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=blob=>{const url=create(blob);window.__imageUrls.created.push(url);return url;};
  URL.revokeObjectURL=url=>{window.__imageUrls.revoked.push(url);return revoke(url);};
});
await page.routeWebSocket('**/api/live-voice',socket=>socket.close());
await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/material-images'){
    const bytes=request.postDataBuffer(),name=url.searchParams.get('name'),fingerprint=createHash('sha256').update(bytes).digest('hex');
    vision.push({name,size:bytes.length,testId:url.searchParams.get('testId'),fingerprint,mime:request.headers()['content-type']});
    if(name==='unavailable.png')return route.fulfill({status:503,json:{error:'Image reading is unavailable. Connect the vision model and try again.'}});
    return route.fulfill({json:{material:{id:`img-${fingerprint}`,name,text:'Cell membrane surrounds the cell. The nucleus is inside the cell.',type:'png',size:bytes.length,fingerprint,extraction:{kind:'vision',textOrigin:'model-derived',width:512,height:320}}}});
  }
  if(url.pathname==='/api/organize'){
    const input=request.postDataJSON();indexing.push(input);assert.ok(input.materials.every(material=>Object.keys(material).sort().join(',')==='id,name,text'));
    return route.fulfill({json:{guide:{overview:'Cell biology.',topics:[{title:'Cell structure',summary:'The image shows a cell membrane and nucleus.',sourceIds:input.materials.map(item=>item.id)}]}}});
  }
  return route.fulfill({json:{}});
});

async function openStudy(){await page.getByRole('button',{name:/Image Source QA/}).click();await expect(page.getByRole('button',{name:'Start microphone',exact:true})).toBeVisible();await page.getByRole('button',{name:/^Library/}).click();}
async function paste(bytes,target='body'){
  return page.locator(target).evaluate((element,base64)=>{
    const buffer=Uint8Array.from(atob(base64),character=>character.charCodeAt(0)),data=new DataTransfer();data.items.add(new File([buffer],'image.png',{type:'image/png'}));
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});return element.dispatchEvent(event);
  },bytes.toString('base64'));
}
try{
  await page.goto(origin);await page.getByRole('button',{name:'New test',exact:true}).waitFor();
  const png=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=320;const context=canvas.getContext('2d');
    context.fillStyle='white';context.fillRect(0,0,512,320);context.strokeStyle='#376959';context.lineWidth=3;
    context.beginPath();context.ellipse(256,174,180,110,0,0,Math.PI*2);context.stroke();context.beginPath();context.ellipse(270,175,62,43,0,0,Math.PI*2);context.stroke();
    context.fillStyle='#243c32';context.font='22px sans-serif';context.fillText('Cell membrane',170,36);context.font='18px sans-serif';context.fillText('Nucleus',238,181);
    return canvas.toDataURL('image/png').split(',')[1];
  }),'base64');
  await page.evaluate(async id=>{
    const request=indexedDB.open('keyval-store'),db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const tx=db.transaction('keyval','readwrite');tx.objectStore('keyval').put([{id,title:'Image Source QA',className:'Image Source QA',difficulty:'test',date:'',materials:[],guide:null,indexStatus:'empty'}],'study-board-v2');
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  },testId);
  await page.reload();await openStudy();
  await expect(page.getByText('Or paste an image into your study session')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles([{name:'cell.png',mimeType:'image/png',buffer:png},{name:'cell-copy.png',mimeType:'image/png',buffer:png}]);
  await expect(page.locator('.library-status')).toContainText('1 source · Indexed');assert.equal(vision.length,1);assert.equal(vision[0].testId,testId);assert.equal(vision[0].mime,'image/png');
  await page.getByRole('button',{name:/cell.png PNG/}).click();
  await expect(page.locator('.source-image img')).toBeVisible();await expect(page.getByText('AI-extracted text and visual notes. Check the original image for details.')).toBeVisible();
  assert.equal(await page.locator('.source-image img').evaluate(image=>image.complete&&image.naturalWidth===512),true);
  const originalUrl=await page.locator('.source-image img').getAttribute('src');assert.ok(originalUrl.startsWith('blob:'));
  await mkdir('artifacts/image-materials',{recursive:true});await page.screenshot({path:'artifacts/image-materials/desktop.png',fullPage:true});
  await page.getByRole('dialog',{name:'Library'}).getByRole('button',{name:'Library',exact:true}).click();
  assert.ok(await page.evaluate(url=>window.__imageUrls.revoked.includes(url),originalUrl));
  await page.getByRole('button',{name:'Close library'}).click();
  // A duplicate pasted image must stop before the endpoint, even after reload.
  await page.reload();await openStudy();await page.getByRole('button',{name:/cell.png PNG/}).click();
  await expect(page.locator('.source-image img')).toBeVisible();assert.equal(await page.locator('.source-image img').evaluate(image=>image.complete&&image.naturalWidth===512),true);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/image-materials/mobile.png',fullPage:true});
  assert.equal(await page.locator('.library-drawer').evaluate(element=>element.scrollWidth>element.clientWidth),false);
  await page.getByRole('dialog',{name:'Library'}).getByRole('button',{name:'Library',exact:true}).click();
  const changed=Buffer.concat([png,Buffer.from('distinct screenshot bytes')]);
  assert.equal(await paste(changed,'input[aria-label="Search material"]'),true,'editable paste is untouched');
  assert.equal(vision.length,1);
  await page.getByRole('button',{name:'Close library'}).click();
  assert.equal(await paste(png,'.study-screen'),false,'image paste is handled');
  await expect(page.locator('.toast')).toContainText('duplicate file skipped');assert.equal(vision.length,1);
  await paste(changed,'.study-screen');await page.getByRole('button',{name:/^Library/}).click();
  await expect(page.locator('.library-status')).toContainText('2 sources · Indexed');assert.equal(vision.length,2);assert.match(vision[1].name,/^Screenshot /);
  await page.locator('input[type=file]').setInputFiles({name:'unavailable.png',mimeType:'image/png',buffer:Buffer.concat([png,Buffer.from('offline')])});
  await expect(page.locator('.toast')).toContainText('Connect the vision model');assert.equal(await page.locator('.library-file').count(),2);
  await page.getByRole('button',{name:'Close library'}).click();
  const dropBytes=Buffer.concat([png,Buffer.from('dropped screenshot bytes')]);
  await page.locator('.study-screen').evaluate((element,base64)=>{
    const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(base64),character=>character.charCodeAt(0))],'dropped.png',{type:'image/png'}));
    element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:100,clientY:180}));
  },dropBytes.toString('base64'));
  await page.getByRole('button',{name:/^Library/}).click();await expect(page.locator('.library-status')).toContainText('3 sources · Indexed');assert.equal(vision.length,4);
  assert.deepEqual(errors,[]);
  const result={result:'PASS',checks:['picker image import','same-batch dedup before endpoint','original Blob persists across reload','original preview + model-derived label','object URL revoked','mobile preview fits','editable paste untouched','saved-byte duplicate paste avoids endpoint','new screenshot paste imports','unavailable vision shows error without fake material','drag-and-drop image imports','index payload omits image bytes'],mockedImageRequests:vision.length,indexRequests:indexing.length,providerCalls:0,microphoneUsed:false};
  await writeFile('artifacts/image-materials/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
