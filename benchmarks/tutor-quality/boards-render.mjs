import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const final=process.argv.includes('--final'),replay=process.argv.includes('--replay'),repair=process.argv.includes('--repair');
const dir=new URL('./',import.meta.url),input=JSON.parse(await readFile(new URL(final?'boards-final-results.json':replay?'boards-replay-results.json':repair?'boards-repaired-results.json':'boards-results.json',dir),'utf8'));
const prefix=final?'final-':replay?'replay-':repair?'repaired-':'';
await mkdir(new URL('renders/',dir),{recursive:true});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[],runs=[];
page.on('pageerror',error=>errors.push(error.message));
const special={title:'Hydraulic legend regression',revision:'exact-user-repro',blocks:[{id:'equation',type:'latex',content:String.raw`\dot E=\rho gHQ`},{id:'legend',type:'text',content:String.raw`\(\rho\): fluid density · \(g\): gravity · \(H\): head · \(Q\): volume flow rate`}]};
try{
 await page.goto('http://127.0.0.1:5188/benchmarks/retained-scene-preview.html?interactive=false');await page.waitForFunction(()=>window.__scenePreview);
 for(const record of [...input.runs.filter(r=>r.board),{id:'reported-latex-regression',board:special}]){
  await page.evaluate(board=>window.__scenePreview.setBoard(board),record.board);await page.waitForFunction(revision=>window.__scenePreview.board.revision===revision,record.board.revision);
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));document.querySelector('.board-content').scrollTop=0;});
  const measurement=await page.evaluate(()=>{
   const board=document.querySelector('.whiteboard'),close=board.querySelector('.board-close').getBoundingClientRect(),icon=board.querySelector('.board-close svg').getBoundingClientRect(),content=board.querySelector('.board-content');
   return {buttons:board.querySelectorAll('button,[role=button]').length,selectable:board.querySelectorAll('[data-board-zone],.board-selection-glass,.scene-tools').length,katexErrors:[...board.querySelectorAll('.katex-error')].map(e=>e.textContent),renderedMath:board.querySelectorAll('.katex').length,closeCenterError:Math.hypot(close.x+close.width/2-icon.x-icon.width/2,close.y+close.height/2-icon.y-icon.height/2),content:{scrollHeight:content.scrollHeight,height:content.clientHeight,scrollWidth:content.scrollWidth,width:content.clientWidth},text:board.innerText,writing:[...board.querySelectorAll('.scene-writing-fit')].map(e=>({text:e.textContent,fit:Number(e.dataset.textFit),fontPx:parseFloat(getComputedStyle(e.firstElementChild).fontSize),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))};
  });
  const screenshot=`renders/${prefix}${record.id}.png`;await page.locator('.whiteboard').screenshot({path:new URL(screenshot,dir).pathname});
  let bottom;
  if(measurement.content.scrollHeight>measurement.content.height+10){await page.locator('.board-content').evaluate(e=>e.scrollTop=e.scrollHeight);bottom=`renders/${prefix}${record.id}-bottom.png`;await page.locator('.whiteboard').screenshot({path:new URL(bottom,dir).pathname});}
  const before=await page.evaluate(()=>window.__scenePreview.selection);await page.locator('.board-content').click({position:{x:35,y:35}});const after=await page.evaluate(()=>window.__scenePreview.selection);
  runs.push({id:record.id,screenshot,bottom,measurement,checks:{readonly:measurement.buttons===1&&measurement.selectable===0,closeConcentric:measurement.closeCenterError<.5,noMathErrors:measurement.katexErrors.length===0,noClickSelection:JSON.stringify(before)===JSON.stringify(after),...(record.id==='reported-latex-regression'?{allFiveMathSpans:measurement.renderedMath===5,noRawMathDelimiters:!measurement.text.includes('\\(')}:{})}});
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(board=>window.__scenePreview.setBoard(board),special);await page.evaluate(()=>document.fonts.ready);await page.locator('.whiteboard').screenshot({path:new URL('renders/reported-latex-mobile.png',dir).pathname});
}finally{await browser.close();await writeFile(new URL(final?'boards-final-browser.json':replay?'boards-replay-browser.json':repair?'boards-repaired-browser.json':'boards-browser.json',dir),JSON.stringify({method:'Actual production React renderer, readonly site mode, desktop1400x900 plus exact-regression mobile390x844. Before/current refer to model prompt snapshots; all saved boards use the current renderer. Scroll capture recorded when necessary. No API or microphone requests.',errors,runs},null,2)+'\n');}
console.log(JSON.stringify({runs:runs.length,errors,failed:runs.filter(run=>Object.values(run.checks).some(value=>!value)).map(run=>({id:run.id,checks:run.checks}))}));
