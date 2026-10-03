// Offline replay: existing public boards only; no model, microphone or provider calls.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const dir=new URL('./',import.meta.url),read=async name=>JSON.parse(await readFile(new URL(name,dir),'utf8'));
const initial=await read('boards-results.json'),repaired=await read('boards-repaired-results.json'),final=await read('boards-final-results.json');
const names=[...new Set(initial.runs.map(run=>run.scenario))];
const selected=names.map(name=>{for(const [source,data] of [['boards-final-results.json',final],['boards-repaired-results.json',repaired],['boards-results.json',initial]]){const found=data.runs.find(run=>run.scenario===name&&run.id.endsWith('-current')&&run.board);if(found)return{...found,source};}throw Error(`Missing ${name}`);});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1400,height:900},reducedMotion:'reduce'}),errors=[],results=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/**',route=>route.abort());
try{
 await page.goto('http://127.0.0.1:5188/benchmarks/retained-scene-preview.html?interactive=false');await page.waitForFunction(()=>window.__scenePreview);
 for(const run of selected){
  await page.evaluate(board=>window.__scenePreview.setBoard(board),run.board);await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const measured=await page.evaluate(()=>{
   const board=document.querySelector('.whiteboard'),close=board.querySelector('.board-close').getBoundingClientRect(),icon=board.querySelector('.board-close svg').getBoundingClientRect();
   return{buttons:board.querySelectorAll('button,[role=button]').length,selectionTargets:board.querySelectorAll('[data-board-zone],.scene-tools,.board-selection-glass').length,mathErrors:board.querySelectorAll('.katex-error').length,closeCenterError:Math.hypot(close.x+close.width/2-icon.x-icon.width/2,close.y+close.height/2-icon.y-icon.height/2),text:board.innerText};
  });
  const screenshot=`renders/audit-latest-${run.scenario}.png`;await page.locator('.whiteboard').screenshot({path:new URL(screenshot,dir).pathname});
  results.push({scenario:run.scenario,source:run.source,sourceRun:run.id,boardSha256:createHash('sha256').update(JSON.stringify(run.board)).digest('hex'),screenshot,screenshotSha256:createHash('sha256').update(await readFile(new URL(screenshot,dir))).digest('hex'),measured});
 }
}finally{await browser.close();}
await writeFile(new URL('independent-browser-audit.json',dir),JSON.stringify({finishedAt:new Date().toISOString(),method:'Offline replay of selected existing model outputs through current production read-only renderer. Mixed final/repaired/initial-current artifacts; not ten fresh model successes and not a matched latency comparison.',providerCalls:0,errors,results},null,2));
console.log(JSON.stringify({captured:results.length,errors,invalid:results.filter(run=>run.measured.buttons!==1||run.measured.selectionTargets||run.measured.mathErrors||run.measured.closeCenterError>=.5).map(run=>run.scenario)}));
