// Offline replay of exact saved canonical canvas packets; no provider calls.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const dir=new URL('./',import.meta.url),sourceFile='live-adaptive-results.json',raw=await readFile(new URL(sourceFile,dir),'utf8'),data=JSON.parse(raw).session;
const boards=data.messages.filter(message=>message.type==='canvas'&&message.visible===true&&message.board);
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1400,height:900},reducedMotion:'reduce'}),runs=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>route.abort());
try{
 await page.goto('http://127.0.0.1:5188/benchmarks/retained-scene-preview.html?interactive=false');await page.waitForFunction(()=>window.__scenePreview);
 for(const packet of boards){
  await page.evaluate(board=>window.__scenePreview.setBoard(board),packet.board);await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const screenshot=`renders/adaptive-${packet.stepId}.png`;await page.locator('.whiteboard').screenshot({path:new URL(screenshot,dir).pathname});
  const measurement=await page.locator('.whiteboard').evaluate(node=>({text:node.innerText,mathErrors:node.querySelectorAll('.katex-error').length,mathCount:node.querySelectorAll('.katex').length,buttons:[...node.querySelectorAll('button,[role=button]')].map(el=>el.getAttribute('aria-label')||el.textContent),cells:[...node.querySelectorAll('.board-cell')].map(cell=>cell.textContent),box:{width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}}));
  runs.push({stepId:packet.stepId,sourceFile,sourceBoardSha256:createHash('sha256').update(JSON.stringify(packet.board)).digest('hex'),screenshot,measurement});
 }
}finally{await browser.close();}
await writeFile(new URL('adaptive-board-audit.json',dir),JSON.stringify({finishedAt:new Date().toISOString(),providerCalls:0,sourceSha256:createHash('sha256').update(raw).digest('hex'),method:'Exact canonical canvas packets accepted by the live server, rendered through production Whiteboard in read-only mode. No source values or revisions changed. Captures are component replay, not a second live session.',errors,runs},null,2)+'\n');console.log(JSON.stringify({runs:runs.length,errors}));
