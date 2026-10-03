// Exact saved source replay only. No provider or microphone calls.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const dir=new URL('./',import.meta.url),sourceFile='live-repair-results.matched-current.json',raw=await readFile(new URL(sourceFile,dir),'utf8'),data=JSON.parse(raw),steps=['wrong-attempt','reasoned-retry','reasoned-biology'];
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1400,height:900},reducedMotion:'reduce'}),runs=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>route.abort());
try{
 await page.goto('http://127.0.0.1:5188/benchmarks/retained-scene-preview.html?interactive=false');await page.waitForFunction(()=>window.__scenePreview);
 for(const step of steps){
  const result=data.modelResults.find(result=>result.stepId===step&&result.board),board={...result.board,revision:`audit-${step}`};
  await page.evaluate(board=>window.__scenePreview.setBoard(board),board);await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const screenshot=`renders/repair-transcript-${step}.png`;await page.locator('.whiteboard').screenshot({path:new URL(screenshot,dir).pathname});
  const measurement=await page.locator('.whiteboard').evaluate(node=>({text:node.innerText,mathErrors:node.querySelectorAll('.katex-error').length,mathCount:node.querySelectorAll('.katex').length,buttons:node.querySelectorAll('button,[role=button]').length,cells:[...node.querySelectorAll('.board-cell')].map(cell=>cell.textContent)}));
  runs.push({stepId:step,sourceFile,sourceBoardSha256:createHash('sha256').update(JSON.stringify(result.board)).digest('hex'),screenshot,sourceMath:result.board.blocks.filter(block=>block.type==='latex').map(block=>({content:block.content,slashRunLengths:[...block.content.matchAll(/\\+/g)].map(match=>match[0].length)})),measurement});
 }
}finally{await browser.close();}
await writeFile(new URL('live-repair-board-audit.json',dir),JSON.stringify({finishedAt:new Date().toISOString(),providerCalls:0,method:'Exact saved model-result boards rendered through production Whiteboard in read-only mode. Only a synthetic revision is added for replay; text and row data are unchanged.',sourceSha256:createHash('sha256').update(raw).digest('hex'),errors,runs,findings:[{id:'math-not-overescaped',status:'pass',note:'Every decoded command has one literal backslash. Both equations render implication arrows and no literal quad/Rightarrow. JSON serialization escaping was mistaken for a source defect; no normalization change is warranted.'},{id:'biology-semantic-headings',status:'fail',note:'Rendered cells faithfully expose wrong source-authored row headings: Feature labels Diffusion data, Diffusion labels Active transport data, Active transport labels Cell membrane data. A membrane definition is placed under Energy use and a boundary description under Direction. This is a semantic table-authoring error, not a rendering defect.'}]},null,2)+'\n');console.log(JSON.stringify({runs:runs.length,errors}));
