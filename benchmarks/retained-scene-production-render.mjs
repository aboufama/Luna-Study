// Render saved, production-validated boards in the actual React whiteboard.
import{readFile,writeFile}from'node:fs/promises';
import{applyBoardUpdate}from'../server/whiteboard.mjs';
import{chromium}from'@playwright/test';
const finalRun=process.argv.includes('--final');
const dir=new URL('./retained-scene/',import.meta.url),report=JSON.parse(await readFile(new URL(finalRun?'production-final-results.json':'production-results.json',dir),'utf8'));
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1100,height:800}}),rows=[],errors=[];
page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
try{for(const record of report.runs.filter(r=>r.board)){
 const originallyStored=record.board;record.board=applyBoardUpdate(record.input.whiteboardContext?.board||null,record.result.board);
 await page.goto('http://127.0.0.1:5188/benchmarks/retained-scene-preview.html');await page.waitForFunction(()=>window.__scenePreview?.setBoard);
 const start=performance.now();await page.evaluate(board=>{window.__scenePreview.setSelection(null);window.__scenePreview.setBoard(board)},record.board);
 await page.waitForFunction(revision=>window.__scenePreview?.board?.revision===revision,record.board.revision);
 await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 const renderMs=Math.round((performance.now()-start)*10)/10;
 const measured=await page.evaluate(()=>({sceneObjectIds:[...document.querySelectorAll('[data-scene-object]')].map(e=>e.dataset.sceneObject),katexErrors:[...document.querySelectorAll('.katex-error')].map(e=>e.textContent),visibleText:document.querySelector('.whiteboard')?.innerText,matrixRows:[...document.querySelectorAll('.board-matrix tbody tr')].map(tr=>tr.querySelectorAll('td').length),cells:[...document.querySelectorAll('.board-cell')].map(e=>({text:e.innerText,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),objects:[...document.querySelectorAll('[data-scene-object]')].map(e=>({id:e.dataset.sceneObject,text:e.textContent,box:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}}))}));
 const screenshot=record.id+'.png';await page.locator('.whiteboard').screenshot({path:new URL(screenshot,dir).pathname});
 let selection=null;
 const target=page.locator('.board-cell [data-board-zone], [data-scene-object][data-board-zone]').first();if(await target.count()){await target.focus();await page.keyboard.press('Enter');selection=await page.evaluate(()=>window.__scenePreview.selection)}
 let lowerScreenshot=null;if(record.scenario==='physics-forces'){await page.locator('[data-board-block="eq-x"]').scrollIntoViewIfNeeded();lowerScreenshot=record.id+'-lower.png';await page.locator('.whiteboard').screenshot({path:new URL(lowerScreenshot,dir).pathname});}
 rows.push({canonicalBoard:record.board,canonicalCorrection:{reason:'Offline application of current production merge (no obsolete visualOnly filter); raw result and original timing preserved.',originalBlockIds:originallyStored.blocks.map(b=>b.id),currentBlockIds:record.board.blocks.map(b=>b.id)},lowerScreenshot,id:record.id,renderMs,screenshot,measured,selection,selectionMethod:'Keyboard focus and Enter; avoids incorrectly demanding the center of a containing shape win over its nested nucleus.',checks:{noKatexErrors:measured.katexErrors.length===0,objectsPresent:record.board.blocks.every(b=>b.type!=='scene'||b.objects.every(o=>measured.sceneObjectIds.includes(o.id))),...(record.scenario==='blank-grid'?{physical8x10:measured.matrixRows.length===8&&measured.matrixRows.every(n=>n===10),blankCells:measured.cells.length===80&&measured.cells.every(c=>!c.text.trim()),visibleCellRegions:measured.cells.every(c=>c.width>5&&c.height>5)}:{})}});
}}finally{await browser.close();await writeFile(new URL(finalRun?'production-final-browser-results.json':'production-browser-results.json',dir),JSON.stringify({providerCalls:0,method:'Offline actual React rendering of saved canonical boards; elapsed browser injection/render time is separate from generation timing.',errors,runs:rows},null,2)+'\n')}
console.log(JSON.stringify({rendered:rows.length,errors,checks:rows.map(r=>({id:r.id,checks:r.checks}))}));
