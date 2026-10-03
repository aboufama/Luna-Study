// Silent debug-viewer QA: all API requests and voice sockets are mocked.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const makeEntry=(id,role,text,category,{status='classified',proposal='not_applicable',expressed='not_expressed',checked=false}={})=>({
 id,sessionId:id.startsWith('old')?'older':'current',transcriptId:`${id}:turn`,turnId:2,sentenceIndex:0,start:0,end:text.length,text,role,at:'2026-10-02T05:00:00Z',status,
 classification:status==='classified'?{source:'jev',category:{label:category,confidence:.87},expressedConfidence:{label:role==='assistant'?'not_applicable':expressed,confidence:.8},proposedCorrectness:{label:proposal,confidence:.7,authoritative:false}}:null,
 checkedGrades:checked?[{scope:'turn',turnId:2,questionId:'synthetic-question',attempt:1,verdict:'correct',checked:true,at:'2026-10-02T05:01:00Z'}]:[],
 ...(status==='unclassified'?{failure:'timeout'}:{}),
});
const entries=[
 makeEntry('old-question','assistant','Which direction does diffusion follow?','question'),
 makeEntry('old-answer','user','Maybe toward the higher concentration.','answer_attempt',{proposal:'appears_incorrect',expressed:'tentative'}),
 makeEntry('old-feedback','assistant','Compare the two concentrations before deciding.','feedback'),
 makeEntry('current-answer','user','Particles move down the concentration gradient.','answer_attempt',{proposal:'appears_incorrect',expressed:'confident',checked:true}),
 makeEntry('current-unclassified','assistant','We can discuss the membrane next.','planning',{status:'unclassified'}),
];
let refreshed=false,traceRequests=0,apiRequests=[];
const fixture=()=>({sessions:[{id:'current',startedAt:'2026-10-02T05:00:00Z',endedAt:null,entries:[...entries.slice(3),...(refreshed?[makeEntry('current-refresh','user','I would like to review transport tomorrow.','planning')]:[])]},{id:'older',startedAt:'2026-10-01T20:00:00Z',endedAt:'2026-10-01T20:05:00Z',entries:entries.slice(0,3)}],summary:{sentences:refreshed?6:5,classified:refreshed?5:4,queued:0,classifying:0,unclassified:1},worker:{queuedBatches:0,active:false,closed:false,automaticRetries:0},measurement:'Synthetic final spoken transcripts; generated audio is not confirmed playback.'});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await mkdir('artifacts',{recursive:true});
await page.addInitScript(()=>{
 const node=()=>({connect(){},disconnect(){}});
 class SilentContext {
  constructor(){this.currentTime=0;this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{}};}
  async resume(){this.state='running';}async close(){this.state='closed';}createMediaStreamSource(){return node();}createGain(){return{...node(),gain:{value:1}};}
  createBuffer(_channels,length,sampleRate){const data=new Float32Array(length);return{getChannelData:()=>data,duration:length/sampleRate};}createBufferSource(){return{...node(),start(){},stop(){}};}
 }
 window.AudioContext=SilentContext;window.webkitAudioContext=SilentContext;
 window.AudioWorkletNode=class{constructor(){Object.assign(this,node());this.port={};}};
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
});
await page.route('**/api/**',async route=>{
 const name=new URL(route.request().url()).pathname;apiRequests.push(name);
 if(name==='/api/debug/learning-trace'){
  assert.equal(route.request().method(),'POST');assert.match(route.request().postDataJSON().testId,/^[0-9a-f-]{36}$/i);traceRequests++;
  return route.fulfill({json:fixture()});
 }
 if(name==='/api/status')return route.fulfill({json:{mode:'live',organizer:'gpt-5.6-luna',voice:'elevenlabs'}});
 return route.abort('blockedbyclient');
});
await page.routeWebSocket('**/api/live-voice',socket=>socket.onMessage(data=>{
 const packet=JSON.parse(data.toString());
 if(packet.type==='start'){
  socket.send(JSON.stringify({type:'ready',sampleRate:16000}));
  socket.send(JSON.stringify({type:'transcript',role:'assistant',text:'This is the normal spoken caption.',final:true}));
 }
}));
try{
 await page.goto('http://127.0.0.1:5188');
 await page.getByRole('button',{name:'New test',exact:true}).click();
 await page.getByLabel('Class',{exact:true}).fill('Trace QA');
 await page.getByRole('button',{name:'Create',exact:true}).click();
 await page.getByRole('button',{name:'Learning trace (debug)',exact:true}).waitFor();
 const showCaptions=page.getByRole('button',{name:'Show subtitles',exact:true});if(await showCaptions.count())await showCaptions.click();
 await page.locator('.assistant-captions-visible').filter({hasText:'This is the normal spoken caption.'}).waitFor();
 assert.equal(traceRequests,0,'drawer is opt-in and does not poll before opening');
 assert.equal(await page.getByText(entries[1].text,{exact:true}).count(),0);
 await page.getByRole('button',{name:'Learning trace (debug)',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'Learning trace debug',exact:true});await drawer.waitFor();
 await drawer.getByText('5 sentences',{exact:true}).waitFor();
 assert.equal(await drawer.locator('.trace-session').count(),2);assert.equal(await drawer.locator('.trace-entry').count(),5);
 await drawer.getByText('Provisional: appears incorrect',{exact:true}).waitFor();
 await drawer.getByText('Checked: correct',{exact:true}).waitFor();
 const checked=drawer.locator('.trace-entry').filter({hasText:entries[3].text});
 assert.equal(await checked.getByText('Provisional: appears incorrect',{exact:true}).count(),0,'checked grade is not presented as Jev proposal');
 assert.equal(await drawer.locator('.trace-entry-meta>span').filter({hasText:'unclassified'}).count(),1);
 assert.match(await drawer.getByText('Expressed tentative',{exact:true}).getAttribute('title'),/classifier score 80%/);
 await checked.getByText('Details',{exact:true}).click();
 assert.match(await checked.locator('pre').innerText(),/"authoritative": false/);
 assert.match(await checked.locator('pre').innerText(),/"checked": true/);
 assert.match(await checked.locator('pre').innerText(),/"scope": "turn"/);
 await checked.getByText('Details',{exact:true}).click();
 await drawer.getByLabel('Filter speaker').selectOption('user');assert.equal(await drawer.locator('.trace-entry').count(),2);
 await drawer.getByLabel('Filter speaker').selectOption('assistant');assert.equal(await drawer.locator('.trace-entry').count(),3);
 await drawer.getByLabel('Filter speaker').selectOption('all');
 await drawer.getByLabel('Search learning trace').fill('gradient');assert.equal(await drawer.locator('.trace-entry').count(),1);
 await drawer.getByLabel('Search learning trace').fill('answer attempt');assert.equal(await drawer.locator('.trace-entry').count(),2,'human-readable category search');
 await drawer.getByLabel('Search learning trace').fill('');
 refreshed=true;const prior=traceRequests;await drawer.getByRole('button',{name:'Refresh learning trace',exact:true}).click();
 await drawer.getByText('6 sentences',{exact:true}).waitFor();assert.ok(traceRequests>prior);
 await page.screenshot({path:'artifacts/learning-trace-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 const mobileChecked=drawer.locator('.trace-entry').filter({hasText:entries[3].text});await mobileChecked.getByText('Details',{exact:true}).click();
 const geometry=await drawer.evaluate(element=>({scroll:element.scrollWidth,width:element.clientWidth,rect:element.getBoundingClientRect().width,viewport:innerWidth,body:document.documentElement.scrollWidth}));
 assert.ok(geometry.scroll<=geometry.width+1,`drawer overflow: ${JSON.stringify(geometry)}`);assert.ok(geometry.rect<=geometry.viewport+1);assert.ok(geometry.body<=geometry.viewport+1);
 await page.screenshot({path:'artifacts/learning-trace-mobile-details.png',fullPage:true});
 await drawer.evaluate(element=>{element.scrollTop=0;});
 await page.screenshot({path:'artifacts/learning-trace-mobile.png',fullPage:true});
 assert.equal(await page.locator('.assistant-captions-visible').innerText(),'This is the normal spoken caption.','debug classifications never replace normal captions');
 await drawer.getByRole('button',{name:'Close learning trace',exact:true}).click();await drawer.waitFor({state:'detached'});
 assert.equal(await page.getByText(entries[1].text,{exact:true}).count(),0,'private transcript disappears with the debug drawer');
 const requestsAfterClose=traceRequests;await page.waitForTimeout(3200);assert.equal(traceRequests,requestsAfterClose,'closing stops polling');
 assert.deepEqual(errors,[]);assert.ok(apiRequests.every(name=>['/api/status','/api/debug/learning-trace'].includes(name)));
 console.log(JSON.stringify({ok:true,traceRequests,checks:['opt-in','two sessions','speaker filter','text/category search','refresh','provisional versus checked','details','mobile overflow','caption isolation','close stops polling'],screenshots:['artifacts/learning-trace-desktop.png','artifacts/learning-trace-mobile.png'],providerCalls:0,realMicrophone:false,realPlayback:false}));
}finally{await browser.close();}
