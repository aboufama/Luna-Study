// Silent integration QA. No real microphone, playback, or provider requests.
import { chromium } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],packets=[],organizeCalls=[];let voiceSocket;
page.on('pageerror',error=>errors.push(error.message));
await mkdir('artifacts',{recursive:true});
await page.addInitScript(()=>{
  window.__audioMock={microphoneRequests:0,tracksStopped:0};
  const node=()=>({connect(){},disconnect(){}});
  class SilentContext {
    constructor(){this.currentTime=0;this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{}};window.__captionAudio=this;}
    getOutputTimestamp(){return {contextTime:this.currentTime,performanceTime:performance.now()};}
    async resume(){this.state='running';} async close(){this.state='closed';} createMediaStreamSource(){return node();}
    createGain(){return {...node(),gain:{value:1}};}
    createBuffer(_channels,length,sampleRate){const data=new Float32Array(length);return {getChannelData:()=>data,duration:length/sampleRate};}
    createBufferSource(){return {...node(),start(){},stop(){}};}
  }
  window.AudioContext=SilentContext;window.webkitAudioContext=SilentContext;
  window.AudioWorkletNode=class {constructor(){Object.assign(this,node());this.port={};}};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
    window.__audioMock.microphoneRequests++;return {getTracks:()=>[{stop(){window.__audioMock.tracksStopped++;}}]};
  }}});
});
await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/organize'){
    const body=route.request().postDataJSON();organizeCalls.push(body);const sourceIds=body.materials.map(item=>item.id);
    await route.fulfill({json:{guide:{overview:'Synthetic biology overview.',topics:[{title:'Cells and transport',summary:'Mitochondria produce ATP.',sourceIds}],questions:[{question:'What do mitochondria produce?',answer:'ATP.',sourceIds}],script:'Mitochondria produce ATP.'}}});
  }else if(url.pathname==='/api/status')await route.fulfill({json:{mode:'live',organizer:'gpt-6-luna',voice:'elevenlabs'}});
  else await route.abort('blockedbyclient');
});
let captionTurn=0;
const mockSpeech=(text,socket=voiceSocket)=>{
  const turnId=++captionTurn,chars=[...text],durationMs=chars.length*70;
  socket.send(JSON.stringify({type:'transcript',role:'assistant',text,final:true,turnId}));
  socket.send(JSON.stringify({type:'audio',turnId,sampleRate:24000,audio:Buffer.alloc(durationMs*48).toString('base64'),alignment:{chars,startsMs:chars.map((_,i)=>i*70),durationsMs:chars.map(()=>70)}}));
  socket.send(JSON.stringify({type:'audio-end',turnId}));
};
const advanceCaption=async()=>{
  // Queue silent mocked PCM, then advance only its synthetic output clock.
  await page.waitForTimeout(60);
  await page.evaluate(()=>{window.__captionAudio.currentTime+=.1;});
  await page.waitForTimeout(80);
};
await page.routeWebSocket('**/api/live-voice',socket=>{
  voiceSocket=socket;socket.onMessage(data=>{
    const packet=JSON.parse(data.toString());packets.push(packet);
    if(packet.type==='start'){
      socket.send(JSON.stringify({type:'ready',sampleRate:16000}));
      mockSpeech('Welcome. When is your test?',socket);
    }
    if(packet.type==='materials')mockSpeech('Your material is ready to study.',socket);
  });
});
const waitFor=async predicate=>{const deadline=Date.now()+15000;while(!predicate()){if(Date.now()>deadline)throw Error('Timed out waiting for mocked integration event.');await new Promise(resolve=>setTimeout(resolve,25));}};
const captureBoard=async(name)=>{
  const geometry=await page.evaluate(()=>{
    const screen=document.querySelector('.study-screen'),style=getComputedStyle(screen),frame=screen.getBoundingClientRect(),close=document.querySelector('.board-close').getBoundingClientRect(),content=document.querySelector('.board-content');
    const top=parseFloat(style.getPropertyValue('--board-inner-top')),side=parseFloat(style.getPropertyValue('--board-inner-side')),bottom=parseFloat(style.getPropertyValue('--board-inner-bottom'));
    return {top,side,bottomGap:frame.bottom-bottom-content.getBoundingClientRect().bottom,topGap:close.top-frame.top-top,rightGap:frame.right-side-close.right,overflow:content.scrollWidth>content.clientWidth+1,clip:{x:Math.max(0,close.right-200),y:Math.max(0,close.top-65),width:Math.min(220,innerWidth-Math.max(0,close.right-200)),height:155}};
  });
  assert.ok(Number.isFinite(geometry.top)&&Number.isFinite(geometry.side),'frame exposes measured inner geometry');
  assert.ok(geometry.topGap>=11.5&&geometry.rightGap>=11.5,`close control has at least 12px inset: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.overflow,false,'whiteboard content has no horizontal overflow');
  assert.ok(geometry.bottomGap>=15.5,'scrolling content remains at least 16px inside the bottom frame');
  await page.screenshot({path:`artifacts/board-corner-${name}.png`,clip:geometry.clip});
  return geometry;
};
try{
  await page.goto('http://127.0.0.1:5188');
  await page.getByRole('button',{name:'New test',exact:true}).waitFor();
  await page.waitForFunction(()=>{
    const canvas=document.querySelector('canvas.study-hero');if(!canvas||canvas.width<100)return false;
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let black=0,white=0;for(let i=0;i<data.length;i+=4){if(data[i]===0&&data[i+3]===255)black++;if(data[i]===255&&data[i+3]===255)white++;}return black>100&&white>100;
  });
  const dither=await page.locator('canvas.study-hero').evaluate(canvas=>{
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let invalid=0,black=0,white=0;
    for(let i=0;i<data.length;i+=4){if(data[i]===0)black++;else if(data[i]===255)white++;else invalid++;if(data[i]!==data[i+1]||data[i]!==data[i+2]||data[i+3]!==255)invalid++;}return {invalid,black,white};
  });
  assert.equal(dither.invalid,0,'actual binary black/white pixels');
  await page.screenshot({path:'artifacts/design-board.png',fullPage:true});
  await page.getByRole('button',{name:'New test',exact:true}).click();
  await page.getByLabel('Class',{exact:true}).fill('QA Biology 101');
  assert.equal(await page.getByRole('button',{name:/^Date:/}).count(),0,'date is collected by voice, not the form');
  await page.getByLabel('Difficulty',{exact:true}).focus();await page.keyboard.press('End');
  assert.equal(await page.getByLabel('Difficulty',{exact:true}).getAttribute('aria-valuetext'),'final');
  await page.screenshot({path:'artifacts/design-create.png',fullPage:true});
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByRole('button',{name:'Pause voice session',exact:true}).waitFor();
  await waitFor(()=>packets.some(packet=>packet.type==='start'));
  const start=packets.find(packet=>packet.type==='start');
  assert.equal(start.title,'QA Biology 101');assert.equal(start.difficulty,'final');assert.deepEqual(start.materials,[]);assert.equal(start.indexStatus,'empty');assert.equal(start.date,'');assert.match(start.localToday,/^\d{4}-\d{2}-\d{2}$/);
  await page.getByRole('button',{name:'Hide subtitles',exact:true}).waitFor();
  assert.equal(await page.locator('.assistant-captions-visible').innerText(),'','generation and audio-end do not reveal captions before playback');
  await advanceCaption();
  assert.equal(await page.locator('.assistant-captions:not(.is-hidden)').count(),1,'captions default on once playback begins');
  await page.locator('.assistant-captions-visible').filter({hasText:'Welcome. When is your test?'}).waitFor();
  voiceSocket.send(JSON.stringify({type:'transcript',role:'user',text:'PRIVATE USER TRANSCRIPT',final:true}));
  await page.waitForTimeout(50);assert.equal(await page.getByText('PRIVATE USER TRANSCRIPT',{exact:true}).count(),0,'student speech stays hidden');
  await page.getByRole('button',{name:'Hide subtitles',exact:true}).click();assert.equal(await page.locator('.assistant-captions.is-hidden').count(),1);
  await page.getByRole('button',{name:'Show subtitles',exact:true}).click();
  const uploads=await Promise.all(['cell-notes.md','mitochondria.pdf','diffusion.docx'].map(async name=>({name,data:Array.from(await readFile(path.resolve('tests/fixtures',name)))})));
  const dragged=await page.evaluateHandle(files=>{const transfer=new DataTransfer();for(const file of files)transfer.items.add(new File([new Uint8Array(file.data)],file.name));return transfer;},[...uploads,{...uploads[0],name:'renamed-cell-notes.md'}]);
  await page.locator('.study-screen').dispatchEvent('dragover',{dataTransfer:dragged,clientX:1080,clientY:320});
  await page.locator('.voice-visual.reaching').waitFor();
  await page.locator('.study-screen').dispatchEvent('drop',{dataTransfer:dragged,clientX:1080,clientY:320});
  await page.locator('.particle-intake').waitFor();
  await page.waitForTimeout(120);
  await page.screenshot({path:'artifacts/design-intake.png',fullPage:true});
  await page.locator('.particle-intake').waitFor({state:'detached'});
  await waitFor(()=>organizeCalls.length===1&&packets.some(packet=>packet.type==='materials'&&packet.materials.length===3));
  await waitFor(()=>packets.some(packet=>packet.type==='index-status'&&packet.status==='ready'));
  const uploaded=packets.find(packet=>packet.type==='materials'&&packet.materials.length===3);
  assert.equal(uploaded.indexStatus,'indexing');assert.equal(packets.find(packet=>packet.type==='index-status'&&packet.status==='ready').revision,uploaded.materials.map(item=>item.id).join('|'));
  assert.equal(organizeCalls[0].materials.length,3);assert.ok(organizeCalls[0].materials.every(item=>item.text.trim().length>20));
  await page.getByRole('button',{name:/^Library/}).click();await page.getByText('3 sources · Indexed',{exact:true}).waitFor();
  assert.equal(await page.locator('.library-file').count(),3);
  await page.getByRole('button',{name:/^mitochondria\.pdf/}).click();assert.match(await page.locator('.source-preview pre').innerText(),/Mitochondria produce ATP during cellular respiration/);
  await page.getByRole('button',{name:'Close library',exact:true}).click();
  // Identical content is deduplicated inside a batch and across renamed drops.
  assert.equal(uploaded.materials.filter(item=>item.name==='cell-notes.md').length,1);
  assert.equal(uploaded.materials.some(item=>item.name==='renamed-cell-notes.md'),false);
  for(const name of ['notes-copy-one.md','notes-copy-two.md']){
    const dismiss=page.getByRole('button',{name:'Dismiss message',exact:true});if(await dismiss.count())await dismiss.click();
    const duplicate=await page.evaluateHandle(file=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(file.data)],file.name));return transfer;},{...uploads[0],name});
    await page.locator('.study-screen').dispatchEvent('drop',{dataTransfer:duplicate,clientX:1080,clientY:320});
    await page.getByText('1 duplicate file skipped.',{exact:true}).waitFor();
    await duplicate.dispose();
    assert.equal(organizeCalls.length,1,'renamed duplicate never reindexes');
    assert.equal(packets.filter(packet=>packet.type==='materials').length,1,'renamed duplicate does not update source list');
  }
  await page.getByRole('button',{name:'Dismiss message',exact:true}).click();
  await page.getByRole('button',{name:/^Library/}).click();
  assert.equal(await page.locator('.library-file').count(),3,'each source appears once after repeated renamed drops');
  await page.getByRole('button',{name:'Close library',exact:true}).click();
  const spokenDate='2030-10-15';voiceSocket.send(JSON.stringify({type:'setup-date',date:spokenDate}));
  mockSpeech('Your test date is October fifteenth.');await advanceCaption();
  await page.locator('.assistant-captions-visible').filter({hasText:'Your test date is October fifteenth.'}).waitFor();
  // Canonical server scenes persist through speech; legacy zone data stays read-only.
  const board={title:'Harder Nash equilibrium practice',revision:'scene-one',blocks:[
    {id:'payoffs',type:'matrix',label:'Payoff matrix',rowLabels:['Up','Down'],columnLabels:['Left','Right'],rows:[['3, 2','0, 1'],['1, 0','2, 3']],zones:[
      {id:'first-payoff',label:'First player payoff',anchor:{kind:'cell',row:0,col:0,quote:'3'}},
      {id:'up-choice',label:'Up choice',anchor:{kind:'row-label',index:0}},
      {id:'right-choice',label:'Right choice',anchor:{kind:'column-label',index:1}}
    ]},
    {id:'equation',type:'latex',content:String.raw`u_1(a,b) = 3`,zones:[{id:'utility',label:'Utility expression',anchor:{kind:'content',quote:'u_1(a,b)'}}]},
    {id:'game-array',type:'latex',content:String.raw`\begin{array}{c|cc}&L&R\\\hline U&(5,10)&(12,9)\\D&(2,9)&(11,10)\end{array}`,zones:[
      {id:'upper-right-payoff',label:'Upper right row payoff',anchor:{kind:'content',quote:'12'}},
      {id:'lower-right-pair',label:'Lower right payoff pair',anchor:{kind:'content',quote:'(11,10)'}}
    ]},
    {id:'diagram',type:'diagram',elements:[{type:'arrow',x1:30,y1:70,x2:70,y2:30},{type:'text',x:50,y:20,text:'v'}],zones:[
      {id:'vector',label:'Vector arrow',anchor:{kind:'element',index:0}},
      {id:'vector-label',label:'Vector label',anchor:{kind:'element',index:1,quote:'v'}}
    ]}
  ]};
  voiceSocket.send(JSON.stringify({type:'canvas',visible:true,board}));
  await page.getByRole('region',{name:'Study whiteboard'}).waitFor();
  await page.locator('.katex').first().waitFor();assert.equal(await page.locator('.voice-stage.board-mode').count(),1);
  assert.equal(await page.locator('.katex-error').count(),0,'LaTeX matrix renders');
  assert.equal(await page.getByText(board.title,{exact:true}).count(),0,'internal scene title is never rendered');
  assert.equal(await page.getByText('Whiteboard',{exact:true}).count(),0,'no whiteboard label');
  assert.equal(await page.getByRole('button',{name:'Pen',exact:true}).count(),0,'drawing menu removed');
  assert.equal(await page.locator('.drawing-canvas').count(),0,'no drawing interception layer');
  assert.equal(await page.locator('[data-board-part]').count(),0,'unrequested glyphs are not automatic targets');
  assert.equal(await page.locator('[data-board-zone]').count(),0,'legacy authored zones have no interactive targets');
  assert.equal(await page.locator('.board-content [role="button"], .board-content [tabindex="0"]').count(),0,'content has no keyboard selection targets');
  await page.locator('.katex').first().click();
  await page.locator('.whiteboard').click({position:{x:20,y:160}});
  await page.keyboard.press('Escape');
  assert.equal(packets.filter(packet=>packet.type==='canvas-select').length,0,'pointer and keyboard do not send selection events');

  mockSpeech('Compare the choices in that column.');await advanceCaption();
  await page.locator('.assistant-captions-visible').filter({hasText:'Compare the choices in that column.'}).waitFor({state:'attached'});
  assert.equal(await page.getByRole('table',{name:'Payoff matrix'}).count(),1,'spoken hint preserves matrix');
  assert.equal(await page.locator('.board-content').getByText('Compare the choices in that column.',{exact:true}).count(),0,'speech never becomes board prose');
  await page.getByRole('button',{name:'Close whiteboard',exact:true}).click();await page.getByRole('button',{name:'Open whiteboard',exact:true}).click();
  assert.equal(await page.getByRole('table',{name:'Payoff matrix'}).count(),1,'read-only scene remains when reopened');
  const nextBoard={...board,revision:'scene-two',blocks:[...board.blocks,{id:'hint',type:'latex',content:String.raw`\max_a u_1(a,b)`,zones:[]}]};
  voiceSocket.send(JSON.stringify({type:'canvas',visible:true,board:nextBoard}));
  await page.waitForFunction(()=>document.querySelectorAll('.board-block').length===3);
  assert.equal(await page.getByRole('table',{name:'Payoff matrix'}).count(),1,'merged update preserves matrix');
  assert.equal(await page.locator('[data-board-zone]').count(),0,'new revision remains read-only');
  assert.equal(packets.filter(packet=>packet.type==='canvas-select').length,0);
  voiceSocket.send(JSON.stringify({type:'mastery',mastery:{overall:30,topics:[{id:'cells',title:'Cells',score:30,mastered:false}]}}));
  await page.getByRole('progressbar',{name:'Overall mastery'}).waitFor();await page.waitForFunction(()=>document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')==='30');
  await page.locator('.board-content').evaluate(element=>{element.scrollTop=0;element.scrollLeft=0;});
  await page.waitForTimeout(1600); // Let the circle-to-frame morph settle before visual capture.
  const desktopCorner=await captureBoard('desktop');
  await page.screenshot({path:'artifacts/design-whiteboard.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.locator('.board-content').evaluate(element=>{element.scrollTop=0;element.scrollLeft=0;});
  await page.waitForTimeout(1600);
  const mobileCorner=await captureBoard('mobile');
  await page.screenshot({path:'artifacts/design-whiteboard-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile whiteboard has no overflow');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Close whiteboard',exact:true}).click();
  await page.getByRole('button',{name:'Hide subtitles',exact:true}).click();
  await page.locator('.assistant-captions').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished)));
  await page.waitForTimeout(1600); // Let the frame return fully to the central circle.
  await page.screenshot({path:'artifacts/design-study.png',fullPage:true});
  await page.getByRole('button',{name:'Back to tests',exact:true}).click();await page.getByRole('heading',{name:'QA Biology 101'}).waitFor();
  assert.match(await page.locator('.test-tile').innerText(),/Oct 15, 2030/);await waitFor(()=>packets.some(packet=>packet.type==='stop'));
  assert.equal(await page.evaluate(()=>window.__audioMock.tracksStopped),1);
  await page.reload();await page.getByRole('heading',{name:'QA Biology 101'}).waitFor();assert.match(await page.locator('.test-tile').innerText(),/Oct 15, 2030/);
  await page.locator('.test-tile').click();await page.getByRole('button',{name:'Pause voice session',exact:true}).waitFor();
  await waitFor(()=>packets.filter(packet=>packet.type==='start').length===2);
  const restored=packets.filter(packet=>packet.type==='start')[1];assert.equal(restored.date,spokenDate);assert.equal(restored.materials.length,3);assert.equal(restored.indexStatus,'ready');assert.equal(restored.whiteboardVisible,false,'closed whiteboard stays closed on reconnect');assert.deepEqual(restored.whiteboard,nextBoard,'full scene survives reload and is sent for server validation');assert.ok(!restored.whiteboardSelection?.targets?.length,'reconnect carries no selected target');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/design-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile study has no overflow');
  await page.getByRole('button',{name:/^Library/}).click();await page.getByText('3 sources · Indexed',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile library has no overflow');
  await page.getByRole('button',{name:'Close library',exact:true}).click();await page.getByRole('button',{name:'Back to tests',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile board has no overflow');
  assert.deepEqual(errors,[],'no browser runtime errors');
  console.log(JSON.stringify({result:'PASS',dither,desktopCorner,mobileCorner,autoIndexRequests:organizeCalls.length,voiceStarts:packets.filter(packet=>packet.type==='start').length,checks:['binary dither','class/difficulty form','voice date collection','automatic voice start','captions default on','captions follow mocked PCM playhead','assistant-only subtitles','PDF/DOCX/MD import','automatic indexing','same-batch and renamed duplicate uploads','voice material update','source preview','spoken date persistence','reload persistence','mobile overflow','LaTeX and matrix whiteboard','no titles or drawing tools','legacy zones render read-only','no pointer or keyboard selection packets','read-only state survives revision and reconnect','speech preserves scene','scene reload persistence','mastery arc','dragged material pixel intake'],microphoneUsed:false,speakersUsed:false,providerCalls:0,screenshots:['board','create','study','mobile'].map(name=>`artifacts/design-${name}.png`)},null,2));
}finally{await browser.close();}
