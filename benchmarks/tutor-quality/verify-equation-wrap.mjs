// Offline production renderer regression. No API, microphone or provider calls.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {applyBoardUpdate} from '../../server/whiteboard.mjs';
const dir=new URL('./',import.meta.url),source='live-adaptive-repaired.session.json',raw=await readFile(new URL(source,dir),'utf8'),data=JSON.parse(raw),browser=await chromium.launch({headless:true}),results=[],errors=[];
try{
 for(const [name,width,height] of [['desktop',1400,900],['mobile',390,844]]){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>r.abort());await page.goto('http://127.0.0.1:5188/benchmarks/retained-scene-preview.html?interactive=false');await page.waitForFunction(()=>window.__scenePreview);
 for(const step of ['third-equation','fourth-equation','hint-three']){
 const board=applyBoardUpdate(null,data.modelResults.find(m=>m.stepId===step).board);await page.evaluate(board=>window.__scenePreview.setBoard(board),board);await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 const measurement=await page.locator('.board-math').evaluate(node=>({fontSize:parseFloat(getComputedStyle(node).fontSize),mathErrors:node.querySelectorAll('.katex-error').length,parts:[...node.querySelectorAll('.board-equation-step')].map(n=>{const r=n.getBoundingClientRect(),k=n.querySelector('.katex').getBoundingClientRect();return{text:n.textContent,left:r.left,right:r.right,top:r.top,client:n.clientWidth,scroll:n.scrollWidth,mathWidth:k.width};}),text:node.textContent,width:node.clientWidth,scroll:node.scrollWidth}));
 assert.equal(measurement.mathErrors,0);assert.ok(measurement.fontSize>=18);assert.ok(measurement.parts.length>=2);assert.ok(measurement.scroll<=measurement.width+1,JSON.stringify(measurement));for(const p of measurement.parts){assert.ok(p.scroll<=p.client+1,JSON.stringify(measurement));assert.ok(p.left>=0&&p.right<=width+1);}
 if(step==='third-equation')assert.match(measurement.text,/w=6/);
 const screenshot=`renders/equation-wrap-${name}-${step}.png`;await page.locator('.whiteboard').screenshot({path:new URL(screenshot,dir).pathname});results.push({viewport:name,step,screenshot,measurement});
 }
 await page.close();
 }
}finally{await browser.close();}
assert.equal(errors.length,0);const sourceHashes={};for(const file of ['src/Whiteboard.jsx','src/board-reading.css','shared/equation-chain.mjs'])sourceHashes[file]=createHash('sha256').update(await readFile(new URL('../../'+file,dir))).digest('hex');await writeFile(new URL('equation-wrap-verification.json',dir),JSON.stringify({finishedAt:new Date().toISOString(),providerCalls:0,command:'node benchmarks/tutor-quality/verify-equation-wrap.mjs',sourceFile:source,sourceSha256:createHash('sha256').update(raw).digest('hex'),sourceHashes,method:'Exact rejected candidates rendered offline through production Whiteboard. Readonly desktop/mobile fixtures; all math chunks contained at readable fontsize with no horizontal scrolling required. Not accepted live boards.',errors,results},null,2)+'\n');console.log(JSON.stringify({passed:results.length,errors}));
