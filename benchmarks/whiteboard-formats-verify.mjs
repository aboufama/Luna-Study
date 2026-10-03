// Offline local-browser verification only. Does not call providers.
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir=new URL('./whiteboard-formats/',import.meta.url);
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1000}});
page.setDefaultTimeout(5000);const errors=[],externalRequests=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){externalRequests.push(route.request().url());return route.abort()}return route.continue()});
const result={providerCalls:0,externalRequests,checks:{}};
try{
 await page.goto('http://127.0.0.1:8796/comparison.html');
 await page.locator('#scene').selectOption('blank-grid');
 const frame=page.frameLocator('iframe[title="Restricted SVG blank-grid"]');
 const svg=frame.locator('lab-scene');
 const card=page.locator('.card').filter({has:page.getByRole('heading',{name:'Restricted SVG',exact:true})});
 await frame.locator('[id$="-cell-0-0"]').click();
 result.selectedId=await card.locator('.selected').textContent();
 assert.match(result.selectedId,/-cell-0-0$/);result.checks.cellSelection=true;
 const original=await svg.getAttribute('style');
 await card.getByRole('button',{name:'+',exact:true}).click();
 assert.notEqual(await svg.getAttribute('style'),original);result.checks.zoomButton=true;
 await card.getByRole('button',{name:'Reset',exact:true}).click();
 assert.equal(await svg.getAttribute('style'),original);result.checks.cameraReset=true;
 await card.getByTitle('Pan right').click();
 assert.notEqual(await svg.getAttribute('style'),original);result.checks.panButton=true;
 const panned=await svg.getAttribute('style');await card.getByRole('button',{name:'−',exact:true}).click();
 assert.notEqual(await svg.getAttribute('style'),panned);result.checks.zoomOutButton=true;
 assert.equal(await card.locator('.selected').textContent(),result.selectedId);result.checks.cameraPreservesSelection=true;
 await card.getByRole('button',{name:'More space',exact:true}).click();result.checks.worldSpaceButton=true;
 for(const scene of ['payoff-matrix','blank-grid','line-city','game-tree','function-plot','process','patch-city','biology-cell','chemistry-equation','algebra-steps','physics-forces','history-timeline','grammar-annotation','multiseries-chart']){
  await page.locator('#scene').selectOption(scene);
  await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].every(f=>f.contentDocument?.querySelector('lab-scene')));
  await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].every(f=>[...f.contentDocument.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0)));
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await page.screenshot({path:new URL(`screenshots/${scene}.png`,dir).pathname,fullPage:true});
 }
 assert.equal(errors.length,0);assert.equal(externalRequests.length,0);
 result.checks.staticRecordedPreviewsLoaded=true;result.checks.noPageErrors=true;result.checks.noExternalResources=true;result.errors=errors;
 result.note='Local camera and click-ID demonstration only. Does not test production scoring, accessibility, or camera persistence across real scene revisions.';
}finally{await browser.close();await writeFile(new URL('viewer-verification.json',dir),JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify(result));
