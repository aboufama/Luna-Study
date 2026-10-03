// Scripted fixture UI only. No real audio, model, or API calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {demoSubjects,demoBoard,patchDemoBoard,demoAnnotation} from '../src/board-demo-data.mjs';
const origin=process.env.DEMO_ORIGIN||'http://127.0.0.1:5188',out=new URL('../artifacts/board-demo/',import.meta.url);
await mkdir(out,{recursive:true});const checks=[],errors=[],forbidden=[];
for(const subject of demoSubjects)for(const example of subject.examples){const board=demoBoard(example,'initial');patchDemoBoard(patchDemoBoard(board,example.updates,'patch'),[demoAnnotation(example)],'note');}
checks.push('All eight fixtures and both updates pass shared validation');
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{const url=route.request().url();if(!url.startsWith(origin)||new URL(url).pathname.startsWith('/api/')){forbidden.push(url);return route.abort();}return route.continue();});
try{
 await page.goto(`${origin}/board-demo.html`);await page.getByRole('button',{name:'Move the nucleus',exact:true}).waitFor();
 assert.equal(await page.locator('.whiteboard [data-board-zone],.whiteboard .scene-tools,.demo-selected').count(),0);
 assert.equal(await page.locator('.whiteboard button,.whiteboard [role=button]').count(),1);
 assert.doesNotMatch(await page.locator('body').innerText(),/Click a part|Alt-drag|select the exact|Drag to select/i);
 await page.evaluate(()=>window.__demoMembrane=document.querySelector('[data-scene-object="membrane"]'));
 const camera=await page.locator('.teaching-scene-world').getAttribute('viewBox');
 await page.locator('[data-scene-object="nucleus"]').click();await page.keyboard.press('+');
 assert.equal(await page.locator('.teaching-scene-world').getAttribute('viewBox'),camera);
 checks.push('Reading mode has no selection, pan, zoom or selectable role buttons; clicking does not change the board');
 await page.getByRole('button',{name:'Move the nucleus',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__demoMembrane===document.querySelector('[data-scene-object="membrane"]')),true);
 assert.equal(await page.locator('.teaching-scene-world').getAttribute('viewBox'),camera);
 checks.push('Scripted patch preserves untouched object DOM and scene view');
 await page.getByRole('button',{name:'Hide',exact:true}).click();assert.equal(await page.locator('.teaching-scene').count(),0);
 await page.getByRole('button',{name:'Reopen the board',exact:true}).click();
 assert.equal(await page.locator('.teaching-scene-world').getAttribute('viewBox'),camera);
 checks.push('Hide and reopen retain the same scene');
 await page.getByRole('button',{name:'Add a note',exact:true}).click();assert.equal(await page.locator('[data-scene-object="teaching-note"]').count(),1);
 await page.getByRole('button',{name:'Reset current example',exact:true}).click();assert.equal(await page.locator('[data-scene-object="teaching-note"]').count(),0);
 await page.screenshot({path:new URL('desktop.png',out).pathname,fullPage:true});checks.push('Add note and reset work outside the read-only board');
 await page.getByRole('button',{name:'Algebra',exact:true}).click();await page.getByRole('button',{name:'Show the next step',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('[data-scene-object="next-step"]').count(),1);checks.push('External next-step controls are keyboard operable');
 for(const subject of demoSubjects){
  await page.getByRole('button',{name:subject.label,exact:true}).click();
  for(let index=0;index<2;index++){
   const example=subject.examples[index];await page.getByRole('button',{name:example.action,exact:true}).click();await page.getByRole('button',{name:'Add a note',exact:true}).click();
   const sizes=await page.locator('.scene-writing-fit').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.textFit)));
   assert.ok(sizes.every(size=>size>=.75));assert.equal(await page.locator('.katex-error').count(),0);assert.equal(await page.locator('.whiteboard [data-board-zone],.scene-tools').count(),0);
   await page.screenshot({path:new URL(`${subject.id}-${index}.png`,out).pathname,fullPage:true});if(index===0)await page.locator('.demo-next').click();
  }
 }
 checks.push('All eight updated examples stay read-only, render math and avoid severe text shrinking');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Biology',exact:true}).click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const canvas=page.locator('.teaching-scene');assert.equal(await canvas.evaluate(node=>node.scrollWidth>node.clientWidth),true);
 await canvas.evaluate(node=>node.scrollLeft=node.scrollWidth);assert.ok(await canvas.evaluate(node=>node.scrollLeft)>0);
 await page.getByRole('button',{name:'Hide',exact:true}).click();await page.getByRole('button',{name:'Reopen the board',exact:true}).click();await page.getByRole('button',{name:'Reset current example',exact:true}).click();
 await page.screenshot({path:new URL('mobile.png',out).pathname,fullPage:true});checks.push('Mobile page fits the viewport; reading overflow scrolls and external lifecycle controls work');
 assert.equal(await page.getByRole('link',{name:'Open live tutor',exact:true}).getAttribute('href'),'/');assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);
 checks.push('No browser errors, remote assets, microphone session or API requests; clear scripted label and real tutor link');
 await writeFile(new URL('checks.json',out),JSON.stringify({finishedAt:new Date().toISOString(),url:`${origin}/board-demo.html`,providerCalls:0,checks,errors,forbidden},null,2));console.log(JSON.stringify({passed:checks.length,artifact:new URL('checks.json',out).pathname}));
}finally{await browser.close();}
