// Offline render of rejected live candidates, NOT accepted student-visible boards.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {applyBoardUpdate} from '../../server/whiteboard.mjs';
const dir=new URL('./',import.meta.url),sourceFile='live-adaptive-repaired.json',raw=await readFile(new URL(sourceFile,dir),'utf8'),data=JSON.parse(raw).session;
const candidates=data.modelResults.filter(m=>m.board),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1400,height:900},reducedMotion:'reduce'}),runs=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>r.abort());
try{await page.goto('http://127.0.0.1:5188/benchmarks/retained-scene-preview.html?interactive=false');await page.waitForFunction(()=>window.__scenePreview);
 for(const candidate of candidates){const board=applyBoardUpdate(null,candidate.board);if(!board){runs.push({stepId:candidate.stepId,mode:candidate.mode,valid:false});continue;}
 await page.evaluate(board=>window.__scenePreview.setBoard(board),board);await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 const screenshot=`renders/adaptive-repaired-candidate-${candidate.stepId}-${candidate.mode}.png`;await page.locator('.whiteboard').screenshot({path:new URL(screenshot,dir).pathname});
 const measurement=await page.locator('.whiteboard').evaluate(n=>({text:n.innerText,mathErrors:n.querySelectorAll('.katex-error').length,mathCount:n.querySelectorAll('.katex').length,cellTexts:[...n.querySelectorAll('.board-cell')].map(c=>c.textContent),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}));runs.push({stepId:candidate.stepId,mode:candidate.mode,valid:true,screenshot,sourceBoardSha256:createHash('sha256').update(JSON.stringify(candidate.board)).digest('hex'),measurement});}
}finally{await browser.close();}
const audit={finishedAt:new Date().toISOString(),providerCalls:0,sourceFile,sourceSha256:createHash('sha256').update(raw).digest('hex'),method:'Offline component render of exact model-produced candidate content via production applyBoardUpdate and Whiteboard. Canonical revision allocated locally only for rendering. ZERO canvas packets and ZERO whiteboard.shown in source session: these are not actual accepted visuals. Rejected candidates cannot be counted as successful student-facing boards or leaked visual answers.',acceptedCanvasPackets:data.messages.filter(m=>m.type==='canvas').length,acceptedShownEvents:data.diagnostics.filter(d=>d.type==='whiteboard.shown').length,errors,runs};await writeFile(new URL('repaired-candidate-board-audit.json',dir),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify({rendered:runs.length,errors,acceptedCanvasPackets:audit.acceptedCanvasPackets}));
