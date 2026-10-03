// No real microphone, provider calls, or server session: protocol/UI regression.
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1100,height:800},reducedMotion:'reduce'}),errors=[],messages=[];
let socket;
const hint=extra=>({type:'hint-state',questionId:'canonical-q',remaining:3,cooldownUntil:null,retryAfterMs:0,available:true,busy:false,suggested:true,reason:'ready',...extra});
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{
  window.__media={opens:0,stops:0,closes:0,worklets:[]};
  const node=()=>({connect(){},disconnect(){}});
  class AudioContext{
    constructor(){this.state='running';this.currentTime=0;this.destination={};this.audioWorklet={addModule:async()=>{}};}
    async resume(){this.state='running';}
    async close(){this.state='closed';window.__media.closes++;}
    createMediaStreamSource(){return node();}
    createGain(){return {...node(),gain:{value:0}};}
  }
  window.AudioContext=AudioContext;window.AudioWorkletNode=class{constructor(){this.port={onmessage:null};window.__media.worklets.push(this);}connect(){}disconnect(){}};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.__media.opens++;return{getTracks:()=>[{stop:()=>{window.__media.stops++;}}]};}}});
});
await page.route('**/api/**',route=>route.fulfill({json:{}}));
await page.routeWebSocket('**/api/live-voice',server=>{
  socket=server;
  server.onMessage(raw=>{
    const value=JSON.parse(raw);messages.push(value);
    if(value.type==='start'){
      server.send(JSON.stringify({type:'ready'}));server.send(JSON.stringify(hint()));
      server.send(JSON.stringify({type:'practice-state',current:{questionId:'canonical-q',question:'Solve 2x + 4 = 10.',topicTitle:'Equations',attempts:0,assisted:false},recent:[]}));
      server.send(JSON.stringify({type:'canvas',visible:true,board:{title:'Equation',revision:'test-board',blocks:[{id:'equation',type:'latex',content:'2x + 4 = 10'}]},selection:null}));
    }
    if(value.type==='hint')server.send(JSON.stringify(hint({remaining:2,available:false,reason:'cooldown',retryAfterMs:45000,suggested:false})));
    if(value.type==='resume'){server.send(JSON.stringify({type:'state',state:'listening'}));server.send(JSON.stringify({type:'resumed'}));server.send(JSON.stringify(hint({remaining:2,suggested:false})));}
  });
});
try{
  await page.goto(process.env.LUNA_TEST_URL||'http://127.0.0.1:5188');await page.getByRole('button',{name:'New test',exact:true}).waitFor();
  await page.evaluate(async()=>{
    const request=indexedDB.open('keyval-store'),db=await new Promise(resolve=>{request.onsuccess=()=>resolve(request.result);});
    const tx=db.transaction('keyval','readwrite');tx.objectStore('keyval').put([{id:'33333333-3333-4333-8333-333333333333',title:'Hint QA',className:'Hint QA',difficulty:'test',date:'',materials:[{id:'notes',name:'notes.txt',text:'Solve equations by applying the same operation to both sides.',type:'txt'}],guide:{topics:[]},indexStatus:'ready',whiteboardSelection:{boardRevision:'old',targets:[{blockId:'old',zoneId:'answer'}]}}],'study-board-v2');
    await new Promise(resolve=>{tx.oncomplete=resolve;});db.close();
  });
  await page.reload();await page.getByRole('button',{name:/Hint QA/}).click();
  const button=page.getByRole('button',{name:'Request hint',exact:true});await expect(button).toBeEnabled();
  assert.equal(messages.find(message=>message.type==='start').whiteboardSelection,null);
  assert.equal(await page.locator('.whiteboard [data-board-zone]').count(),0,'site whiteboard has no selection targets');
  await expect(button).toHaveClass(/is-suggested/);assert.equal(await button.evaluate(node=>getComputedStyle(node).animationName),'none');
  await page.getByRole('button',{name:'Show practice problems'}).click();await expect(page.getByText('Solve 2x + 4 = 10.',{exact:true})).toBeVisible();
  await button.click();await expect(button).toBeDisabled();assert.deepEqual(messages.filter(message=>message.type==='hint'),[{type:'hint'}]);
  await expect(button.locator('.hint-count')).toHaveText('45s');
  const description=await page.locator(`#${(await button.getAttribute('aria-describedby')).replace(/:/g,'\\:')}`).textContent();
  await page.clock.install();await page.clock.fastForward(45001);await expect(button).toBeDisabled();
  assert.equal(await button.getAttribute('title'),description,'accessible description does not count down every second');
  socket.send(JSON.stringify(hint({remaining:2,suggested:false})));await expect(button).toBeEnabled();
  const inspectLayout=()=>page.evaluate(()=>{
    const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const host=document.querySelector('.study-screen'),css=getComputedStyle(host),close=rect('.board-close'),icon=rect('.board-close svg'),dock=rect('.study-dock'),rail=rect('.practice-trail-toggle'),root=rect('.study-screen');
    const number=name=>parseFloat(css.getPropertyValue(name));
    const frame={x:root.x+number('--stage-board-x'),y:root.y+number('--stage-board-y'),width:number('--stage-board-width'),height:number('--stage-board-height')};
    return {viewport:{width:innerWidth,height:innerHeight},dock,close,rail,frame,readonlyButtons:document.querySelectorAll('.whiteboard button,.whiteboard [role="button"]').length,closeCenterError:Math.hypot(close.x+close.width/2-icon.x-icon.width/2,close.y+close.height/2-icon.y-icon.height/2),closeInsideFrame:close.x>=frame.x&&close.right<=frame.x+frame.width&&close.y>=frame.y&&close.bottom<=frame.y+frame.height};
  });
  const desktopLayout=await inspectLayout();assert.equal(desktopLayout.readonlyButtons,1);assert.ok(desktopLayout.closeCenterError<.5);assert.ok(desktopLayout.closeInsideFrame);
  await mkdir('artifacts/hint-presence',{recursive:true});await page.screenshot({path:'artifacts/hint-presence/hint-desktop.png',fullPage:true});
  socket.send(JSON.stringify({type:'paused',reason:'student-idle',resumable:true}));
  await expect(page.getByRole('dialog',{name:'Session paused'})).toBeVisible();await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeFocused();
  assert.equal(await page.evaluate(()=>window.__media.opens),1);assert.equal(await page.evaluate(()=>window.__media.stops),1);assert.equal(await page.evaluate(()=>window.__media.closes),1);
  assert.equal(await page.evaluate(()=>window.__media.worklets[0].port.onmessage),null);
  assert.equal(messages.some(message=>message.type==='stop'),false);assert.equal(await page.locator('.study-dock').evaluate(node=>node.inert),true);
  await page.screenshot({path:'artifacts/hint-presence/paused-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Resume',exact:true}).click();await expect(page.getByRole('dialog',{name:'Session paused'})).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.__media.opens),2);assert.deepEqual(messages.filter(message=>message.type==='resume'),[{type:'resume'}]);assert.equal(messages.filter(message=>message.type==='start').length,1);
  await expect(button).toBeEnabled();assert.equal(await page.locator('.study-dock').evaluate(node=>node.inert),false);
  await expect(page.getByText('Solve 2x + 4 = 10.',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.clock.runFor(500);await expect(button).toBeVisible();await page.clock.runFor(100);await expect(page.getByRole('button',{name:'Show practice problems'})).toHaveAttribute('aria-expanded','false');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'artifacts/hint-presence/hint-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const mobileLayout=await inspectLayout();assert.ok(mobileLayout.dock.y>=0&&mobileLayout.dock.bottom<=844);assert.ok(mobileLayout.closeCenterError<.5);assert.ok(mobileLayout.closeInsideFrame);assert.ok(mobileLayout.rail.width>=40&&mobileLayout.rail.height>=40);assert.ok(mobileLayout.close.x>=mobileLayout.rail.right||mobileLayout.close.y>=mobileLayout.rail.bottom||mobileLayout.close.bottom<=mobileLayout.rail.y);
  const overlap=await page.evaluate(()=>{const a=document.querySelector('.dock-left').getBoundingClientRect(),b=document.querySelector('.dock-right').getBoundingClientRect();return Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);});assert.equal(overlap,false);
  // Replay the exact accepted public board, rather than a simpler synthetic flow.
  const flowSource=await readFile(new URL('../benchmarks/tutor-quality/live-adaptive-final.json',import.meta.url),'utf8');
  const flowSession=JSON.parse(flowSource).session;
  assert.ok(flowSession.finishedAt,'Only a completed saved session may provide the accepted-board fixture');
  const flowPacket=flowSession.messages.find(message=>message.type==='canvas'&&message.visible===true&&message.stepId==='biology-full');
  assert.ok(flowPacket?.board);
  socket.send(JSON.stringify({type:'canvas',visible:true,board:flowPacket.board,selection:null}));
  await expect(page.locator('.board-flow-diagram')).toBeVisible();await page.clock.runFor(1000);
  await page.evaluate(async()=>{await document.fonts.ready;});await page.clock.runFor(100);
  const mobileFlow=await page.evaluate(()=>{
    const pack=r=>({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom});
    const content=document.querySelector('.board-content'),scene=content.querySelector('.teaching-scene'),svg=scene.querySelector('svg'),scale=svg.getBoundingClientRect().width/svg.viewBox.baseVal.width;
    return {content:pack(content.getBoundingClientRect()),contentWidth:content.clientWidth,contentScrollWidth:content.scrollWidth,contentHeight:content.clientHeight,contentScrollHeight:content.scrollHeight,sceneWidth:scene.clientWidth,sceneScrollWidth:scene.scrollWidth,overflowY:getComputedStyle(content).overflowY,texts:[...scene.querySelectorAll('.scene-writing')].map(node=>{const range=document.createRange();range.selectNodeContents(node);return {id:node.closest('[data-scene-object]').dataset.sceneObject,text:node.textContent,bounds:pack(range.getBoundingClientRect()),effectiveFontSize:parseFloat(getComputedStyle(node).fontSize)*Number(node.parentElement.dataset.textFit)*scale};})};
  });
  await writeFile('artifacts/hint-presence/mobile-flow-measurement.json',JSON.stringify(mobileFlow,null,2));
  await page.screenshot({path:'artifacts/hint-presence/flow-mobile-before-assert.png',fullPage:true});
  assert.equal(mobileFlow.texts.length,5,'All three concepts and both relationship labels are present');
  assert.ok(mobileFlow.contentScrollWidth<=mobileFlow.contentWidth+1,'Actual app board must not horizontally crop the accepted flow');
  assert.ok(mobileFlow.sceneScrollWidth<=mobileFlow.sceneWidth+1,'Both branches fit without hidden scene panning');
  assert.match(mobileFlow.overflowY,/auto|scroll/,'Normal vertical board scrolling remains available');
  for(const text of mobileFlow.texts){
    assert.ok(text.bounds.x>=Math.max(0,mobileFlow.content.x)-1&&text.bounds.right<=Math.min(390,mobileFlow.content.right)+1,`Entire label is horizontally available: ${text.text}`);
    assert.ok(text.effectiveFontSize>=14,`Readable effective font: ${JSON.stringify(text)}`);
  }
  await page.screenshot({path:'artifacts/hint-presence/flow-mobile-top.png',fullPage:true});
  mobileFlow.scrolledLabels=[];
  for(const id of mobileFlow.texts.map(text=>text.id)){
    const bounds=await page.evaluate(id=>{
      const content=document.querySelector('.board-content'),node=[...content.querySelectorAll('[data-scene-object]')].find(node=>node.dataset.sceneObject===id).querySelector('.scene-writing');
      const range=document.createRange();range.selectNodeContents(node);let text=range.getBoundingClientRect(),frame=content.getBoundingClientRect();
      content.scrollTop+=text.top-frame.top-(frame.height-text.height)/2;
      text=range.getBoundingClientRect();frame=content.getBoundingClientRect();
      return {id,top:text.top,bottom:text.bottom,frameTop:frame.top,frameBottom:frame.bottom,scrollTop:content.scrollTop};
    },id);
    assert.ok(bounds.top>=bounds.frameTop-1&&bounds.bottom<=bounds.frameBottom+1,`Whole label readable using normal board scroll: ${id}`);
    mobileFlow.scrolledLabels.push(bounds);
  }
  mobileFlow.layout=await inspectLayout();assert.ok(mobileFlow.layout.closeInsideFrame&&mobileFlow.layout.closeCenterError<.5);assert.ok(mobileFlow.layout.dock.y>=0&&mobileFlow.layout.dock.bottom<=844);
  mobileFlow.controls=await page.evaluate(()=>['.board-close','.hint-button'].map(selector=>{const node=document.querySelector(selector),r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {selector,reachable:node===hit||node.contains(hit),top:r.top,bottom:r.bottom};}));
  for(const control of mobileFlow.controls)assert.ok(control.reachable&&control.top>=0&&control.bottom<=844,`Control stays reachable: ${control.selector}`);
  mobileFlow.sourceFile='benchmarks/tutor-quality/live-adaptive-final.json';mobileFlow.sourceSha256=createHash('sha256').update(flowSource).digest('hex');mobileFlow.sourceBoardSha256=createHash('sha256').update(JSON.stringify(flowPacket.board)).digest('hex');
  await page.screenshot({path:'artifacts/hint-presence/flow-mobile-scrolled.png',fullPage:true});
  const matrixSource=await readFile(new URL('../benchmarks/tutor-quality/live-adaptive-final-verified.json',import.meta.url),'utf8'),matrixSession=JSON.parse(matrixSource).session;
  assert.ok(matrixSession.finishedAt);
  const matrixPackets=matrixSession.messages.filter(message=>message.type==='canvas'&&message.visible===true&&message.board?.blocks.some(block=>block.type==='matrix'));
  assert.equal(matrixPackets.length,4,'Replay all four accepted comparison tables');
  const matrixRegressions={sourceSha256:createHash('sha256').update(matrixSource).digest('hex'),runs:[]};
  for(const packet of matrixPackets){
    socket.send(JSON.stringify({type:'canvas',visible:true,board:packet.board,selection:null}));await expect(page.locator('.board-matrix')).toHaveCount(1);await page.clock.runFor(700);
    const region=page.getByRole('region',{name:'Table. Scroll horizontally to read every column.'});await expect(region).toBeVisible();
    const initial=await region.evaluate(node=>{
      const content=node.closest('.board-content'),cells=[...node.querySelectorAll('td .board-cell')];
      const words=cells.flatMap(cell=>{const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT),items=[];while(walker.nextNode()){const text=walker.currentNode;if(text.parentElement.closest('.katex'))continue;for(const match of text.textContent.matchAll(/\p{L}{2,}/gu)){const range=document.createRange();range.setStart(text,match.index);range.setEnd(text,match.index+match[0].length);items.push({word:match[0],fragments:range.getClientRects().length});}}return items;});
      return {width:node.clientWidth,scrollWidth:node.scrollWidth,contentWidth:content.clientWidth,contentScrollWidth:content.scrollWidth,texts:cells.map(cell=>cell.textContent),headers:[...node.querySelectorAll('th')].map(th=>th.textContent),cells:cells.map(cell=>({prose:cell.closest('td').classList.contains('is-prose-column'),width:cell.getBoundingClientRect().width,height:cell.getBoundingClientRect().height,fontSize:parseFloat(getComputedStyle(cell.querySelector('.board-label')).fontSize)})),words};
    });
    assert.ok(initial.contentWidth<=260&&initial.contentWidth>=250,'Uses the actual narrow mosaic frame');
    assert.ok(initial.contentScrollWidth<=initial.contentWidth+1,'Scroll belongs to the table, not a cropped outer board');
    assert.deepEqual(initial.texts,packet.board.blocks.find(block=>block.type==='matrix').rows.flat(),'Every original cell is retained exactly');
    assert.ok(initial.cells.every(cell=>cell.width>=(cell.prose?179:58)&&cell.fontSize>=16));assert.ok(initial.words.every(word=>word.fragments===1),'Ordinary prose words stay whole');
    await region.focus();await page.keyboard.press('ArrowRight');await page.clock.runFor(250);await expect.poll(()=>region.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
    const reachability=await region.evaluate(node=>[...node.querySelectorAll('td .board-cell')].map(cell=>{const content=node.closest('.board-content');let box=cell.getBoundingClientRect(),frame=node.getBoundingClientRect();node.scrollLeft+=box.x+box.width/2-frame.x-frame.width/2;box=cell.getBoundingClientRect();const view=content.getBoundingClientRect(),dock=document.querySelector('.study-dock').getBoundingClientRect(),bottom=Math.min(view.bottom,dock.top);content.scrollTop+=box.y+box.height/2-view.top-(bottom-view.top)/2;box=cell.getBoundingClientRect();frame=node.getBoundingClientRect();return {text:cell.textContent,horizontal:box.left>=frame.left-1&&box.right<=frame.right+1,vertical:box.top>=view.top-1&&box.bottom<=bottom+1};}));
    assert.ok(reachability.every(cell=>cell.horizontal&&cell.vertical),'Every cell is readable by ordinary nested scroll');
    await region.evaluate(node=>{node.scrollLeft=0;node.closest('.board-content').scrollTop=0;});await page.screenshot({path:`artifacts/hint-presence/matrix-${packet.stepId}-left.png`,fullPage:true});
    await region.evaluate(node=>{node.scrollLeft=node.scrollWidth;});await page.screenshot({path:`artifacts/hint-presence/matrix-${packet.stepId}-right.png`,fullPage:true});
    matrixRegressions.runs.push({stepId:packet.stepId,sourceBoardSha256:createHash('sha256').update(JSON.stringify(packet.board)).digest('hex'),initial,reachability});
  }
  const numeric={title:'Blank game',revision:'numeric-readability-regression',blocks:[{id:'game',type:'matrix',rowLabels:Array.from({length:8},(_,i)=>`r${i+1}`),columnLabels:Array.from({length:10},(_,i)=>`c${i+1}`),rows:Array.from({length:8},()=>Array(10).fill(''))}]};
  socket.send(JSON.stringify({type:'canvas',visible:true,board:numeric,selection:null}));await expect(page.locator('.board-cell')).toHaveCount(80);await page.clock.runFor(700);
  const numericRegion=page.getByRole('region',{name:'Table. Scroll horizontally to read every column.'});await expect(numericRegion).toBeVisible();
  matrixRegressions.numeric=await numericRegion.evaluate(node=>({cells:node.querySelectorAll('.board-cell').length,proseColumns:node.querySelectorAll('.is-prose-column').length,widths:[...node.querySelectorAll('.board-cell')].map(cell=>cell.getBoundingClientRect().width),columnLabels:[...node.querySelectorAll('th[scope=col]')].map(th=>th.textContent),rowLabels:[...node.querySelectorAll('th[scope=row]')].map(th=>th.textContent)}));
  assert.equal(matrixRegressions.numeric.proseColumns,0);assert.ok(matrixRegressions.numeric.widths.every(width=>width>=58&&width<100),'Numeric/blank grid cells keep their prior compact sizing');
  await numericRegion.focus();await page.keyboard.press('ArrowRight');await page.clock.runFor(250);await expect.poll(()=>numericRegion.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
  matrixRegressions.numeric.lastCell=await numericRegion.evaluate(node=>{const cell=node.querySelector('tr:last-child td:last-child .board-cell'),content=node.closest('.board-content');node.scrollLeft=node.scrollWidth;content.scrollTop=content.scrollHeight;const box=cell.getBoundingClientRect(),frame=node.getBoundingClientRect(),view=content.getBoundingClientRect();return {horizontal:box.right<=frame.right+1&&box.left>=frame.left-1,vertical:box.top>=view.top-1&&box.bottom<=view.bottom+1};});
  assert.ok(matrixRegressions.numeric.lastCell.horizontal&&matrixRegressions.numeric.lastCell.vertical);await page.screenshot({path:'artifacts/hint-presence/numeric-grid-scrolled.png',fullPage:true});
  socket.send(JSON.stringify({type:'paused',reason:'student-idle',resumable:true}));await expect(page.getByRole('dialog',{name:'Session paused'})).toBeVisible();await page.screenshot({path:'artifacts/hint-presence/paused-mobile.png',fullPage:true});const resumeBounds=await page.getByRole('button',{name:'Resume',exact:true}).boundingBox();assert.ok(resumeBounds.y>=64&&resumeBounds.y+resumeBounds.height<=844);assert.ok(resumeBounds.width>=40&&resumeBounds.height>=40);
  assert.deepEqual(errors,[]);
  const result={result:'PASS',checks:['hint cue + reduced motion','only hint action sent','server-owned count/cooldown','no local cooldown grant','no second-by-second accessible spam','practice trail current problem','site board selection disabled + old setup cleared','server pause stops all capture without closing WS','resume requires click and new mic permission','resumed ack restores same socket/question/hints','pause focus + inert study controls','mobile dock stays inside viewport without scrolling','mobile Resume centered and reachable','desktop/mobile X centered inside its circular target and mosaic frame','practice rail collapses on mobile entry; toggle minimum40px and no X overlap','exact accepted biology flow fits full mobile study frame at readable size; every label reachable by normal board scroll; dock/X still reachable','four exact accepted prose matrices retain full words/readable text in258px app frame with accessible native scrolling','numeric8x10 retains80compact cells and allheaders; keyboard scroll reaches lastcell'],measurements:{desktopLayout,mobileLayout,mobileFlow,matrixRegressions,resumeBounds},providerCalls:0,realMicrophoneUsed:false};
  await writeFile('artifacts/hint-presence/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
