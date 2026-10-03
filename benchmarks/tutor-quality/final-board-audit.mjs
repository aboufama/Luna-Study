// Replay exact accepted canvas packets from the completed final saved session.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const dir=new URL('./',import.meta.url),sourceFile=option('--source','live-adaptive-final.json'),prefix=option('--prefix','final');
assert.match(sourceFile,/^[a-z0-9-]+\.json$/);assert.match(prefix,/^[a-z0-9-]+$/);
const raw=await readFile(new URL(sourceFile,dir),'utf8'),data=JSON.parse(raw).session;
if(!data?.finishedAt)throw Error('Final session has not completed; do not audit partial output.');
const packets=data.messages.filter(m=>m.type==='canvas'&&m.visible===true&&m.board),browser=await chromium.launch({headless:true}),runs=[],errors=[];
try{for(const [viewport,width,height] of [['desktop',1400,900],['mobile',390,844]]){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>r.abort());await page.goto('http://127.0.0.1:5188/benchmarks/retained-scene-preview.html?interactive=false');await page.waitForFunction(()=>window.__scenePreview);
 for(const [index,packet]of packets.entries()){
  await page.evaluate(board=>window.__scenePreview.setBoard(board),packet.board);await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  const screenshot=`renders/${prefix}-accepted-${viewport}-${String(index+1).padStart(2,'0')}-${packet.stepId}.png`;await page.locator('.whiteboard').screenshot({path:new URL(screenshot,dir).pathname});
  const measurement=await page.locator('.whiteboard').evaluate(n=>({text:n.innerText,mathErrors:n.querySelectorAll('.katex-error').length,selectableZones:n.querySelectorAll('[data-board-zone]').length,math:[...n.querySelectorAll('.board-math')].map(m=>({text:m.textContent,width:m.clientWidth,scroll:m.scrollWidth,fontSize:getComputedStyle(m).fontSize,parts:[...m.querySelectorAll('.board-equation-step')].map(p=>({width:p.clientWidth,scroll:p.scrollWidth}))})),cells:[...n.querySelectorAll('.board-cell')].map(c=>c.textContent),scenes:[...n.querySelectorAll('.teaching-scene')].map(s=>{const svg=s.querySelector('svg'),scale=svg.getBoundingClientRect().width/svg.viewBox.baseVal.width;return {width:s.clientWidth,scroll:s.scrollWidth,texts:[...s.querySelectorAll('.scene-writing')].map(t=>({text:t.textContent,effectiveFontSize:parseFloat(getComputedStyle(t).fontSize)*Number(t.parentElement.dataset.textFit)*scale})),role:s.getAttribute('role'),tabIndex:s.tabIndex};})}));
  assert.equal(measurement.mathErrors,0);assert.equal(measurement.selectableZones,0);
  for(const math of measurement.math){assert.ok(math.scroll<=math.width+1);for(const part of math.parts)assert.ok(part.scroll<=part.width+1);}
  for(const scene of measurement.scenes){assert.ok(scene.scroll<=scene.width+1,'Accepted flow must fit without horizontal crop');for(const text of scene.texts)assert.ok(text.effectiveFontSize>=14,JSON.stringify(text));}
  runs.push({index:index+1,stepId:packet.stepId,viewport,screenshot,sourceBoardSha256:createHash('sha256').update(JSON.stringify(packet.board)).digest('hex'),measurement});
 }
 if(viewport==='mobile'){
  const fan={title:'Scroll fallback',revision:'offline-fan',blocks:[{id:'fan',type:'flow',nodes:Array.from({length:7},(_,i)=>({id:`n${i}`,label:`Concept ${i}`})),edges:Array.from({length:6},(_,i)=>({from:'n0',to:`n${i+1}`,label:'leads to'}))}]};
  await page.evaluate(b=>window.__scenePreview.setBoard(b),fan);const region=page.getByRole('region',{name:'Teaching diagram. Scroll horizontally to see the full diagram.'});await region.waitFor();await region.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(150);assert.ok(await region.evaluate(n=>n.scrollLeft>0),'Readonly overflow must support keyboard scrolling');
 }
 await page.close();
}}finally{await browser.close();}
const sourceHashes={};for(const file of ['src/Whiteboard.jsx','src/board-reading.css','shared/equation-chain.mjs','shared/flow-layout.mjs','src/TeachingScene.jsx','src/teaching-scene.css'])sourceHashes[file]=createHash('sha256').update(await readFile(new URL('../../'+file,dir))).digest('hex');
await writeFile(new URL(`${prefix}-board-audit.json`,dir),JSON.stringify({finishedAt:new Date().toISOString(),providerCalls:0,sourceFile,sourceSha256:createHash('sha256').update(raw).digest('hex'),sourceHashes,method:'Completed saved session exact accepted canvas packets replayed through production readonly Whiteboard. Desktop and mobile component fixture, no provider or microphone. Original canonical boards and revisions retained. This checks rendering, not a second live conversation or full app camera layout.',acceptedPackets:packets.length,errors,runs},null,2)+'\n');console.log(JSON.stringify({acceptedPackets:packets.length,rendered:runs.length,errors}));
