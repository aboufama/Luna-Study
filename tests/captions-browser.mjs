// All speech, microphone and provider traffic is mocked. PCM is never played.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {captionCues} from '../src/caption-timing.mjs';
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],packets=[],results={layouts:[],providerCalls:0,microphoneUsed:false,speakersUsed:false};let socket;
page.on('pageerror',error=>errors.push(error.message));await mkdir('artifacts',{recursive:true});
await page.addInitScript(()=>{
 const node=()=>({connect(){},disconnect(){}});
 class SilentContext{
  constructor(){this.currentTime=0;this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{}};window.__captionAudio=this;}
  getOutputTimestamp(){return {contextTime:this.currentTime,performanceTime:performance.now()};}
  async resume(){this.state='running';}async close(){this.state='closed';}
  createMediaStreamSource(){return node();}createGain(){return {...node(),gain:{value:1}};}
  createBuffer(_channels,length,rate){return {duration:length/rate,getChannelData:()=>new Float32Array(length)};}
  createBufferSource(){return {...node(),start(){},stop(){}};}
 }
 window.AudioContext=SilentContext;window.webkitAudioContext=SilentContext;
 window.AudioWorkletNode=class{constructor(){Object.assign(this,node());this.port={};}};
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
});
await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/status'?route.fulfill({json:{mode:'live',organizer:'gpt-5.6-luna',voice:'elevenlabs'}}):route.abort('blockedbyclient'));
await page.routeWebSocket('**/api/live-voice',value=>{socket=value;socket.onMessage(data=>{const packet=JSON.parse(data.toString());packets.push(packet);if(packet.type==='start')socket.send(JSON.stringify({type:'ready',sampleRate:16000}));});});
const send=value=>socket.send(JSON.stringify(value));
const shown=()=>page.locator('.assistant-captions-visible').innerText();
async function advance(seconds){await page.evaluate(time=>{window.__captionAudio.currentTime=time;},seconds);await page.waitForTimeout(100);}
async function capacity(){return page.locator('.assistant-captions-visible').evaluate(element=>Math.min(76,Math.max(32,Math.floor(element.clientWidth/8.5)*2)));}
async function layout(name){
 const metrics=await page.evaluate(()=>{
  const caption=document.querySelector('.assistant-captions'),words=caption.querySelector('.assistant-captions-visible'),dock=document.querySelector('.study-dock'),canvas=document.querySelector('.voice-canvas');
  const c=caption.getBoundingClientRect(),d=dock.getBoundingClientRect(),r=canvas.getBoundingClientRect(),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let bottom=0;for(let y=canvas.height-1;y>=0;y--){let found=false;for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4+3]>40){bottom=y;found=true;break;}if(found)break;}
  return {captionTop:c.top,captionBottom:c.bottom,dockTop:d.top,frameBottom:r.top+(bottom+1)*r.height/canvas.height,gap:c.top-(r.top+(bottom+1)*r.height/canvas.height),font:getComputedStyle(caption).fontFamily,color:getComputedStyle(caption).color,wordScrollHeight:words.scrollHeight,wordHeight:words.clientHeight,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth};
 });
 assert.ok(metrics.gap>=8,`${name}: below border ${JSON.stringify(metrics)}`);assert.ok(metrics.captionBottom<=metrics.dockTop,`${name}: caption above dock`);
 assert.ok(metrics.wordScrollHeight<=metrics.wordHeight+1,`${name}: phrase must not be clipped`);assert.ok(metrics.documentWidth<=metrics.viewport);
 results.layouts.push({name,...metrics});await page.screenshot({path:`artifacts/captions-${name}.png`});
}
try{
 await page.goto('http://127.0.0.1:5188');await page.getByRole('button',{name:'New test',exact:true}).click();await page.getByLabel('Class',{exact:true}).fill('Caption timing QA');await page.getByRole('button',{name:'Create',exact:true}).click();
 await page.getByRole('button',{name:'Stop microphone',exact:true}).waitFor();await page.mouse.move(1,1);
 const text='Compare both available choices for the first player. Then consider which response is best for the other player. Finally identify where both choices agree.';
 send({type:'transcript',role:'assistant',turnId:1,text,final:true});await page.waitForTimeout(120);assert.equal(await shown(),'','generated final text does not display');
 const duration=text.length*.08;
 send({type:'audio',turnId:1,sampleRate:24000,audio:Buffer.alloc(Math.ceil(duration*24000)*2).toString('base64'),alignment:{chars:[...text],startsMs:[...text].map((_,i)=>i*80),durationsMs:[...text].map(()=>80)}});
 send({type:'audio-end',turnId:1});await page.waitForTimeout(120);assert.equal(await shown(),'','audio-end cannot advance the clock');
 await advance(.04);let cues=captionCues(text,await capacity());assert.equal(await shown(),cues[0].text);const first=await shown();
 await advance(.8);assert.equal(await shown(),first,'phrase remains unchanged while its words play');
 send({type:'transcript',role:'assistant',turnId:1,text,final:true});await page.waitForTimeout(100);assert.equal(await shown(),first,'duplicate final does not jump');
 const orbBefore=await page.getByRole('button',{name:'Pause voice session',exact:true}).boundingBox();
 await advance(.025+cues[1].start*.08+.02);assert.equal(await shown(),cues[1].text);assert.notEqual(await shown(),cues.at(-1).text);
 const orbAfter=await page.getByRole('button',{name:'Pause voice session',exact:true}).boundingBox();assert.deepEqual(orbAfter,orbBefore,'different cue lengths leave orb layout stable');
 send({type:'canvas',visible:true,board:{revision:'caption-board',blocks:[{id:'matrix',type:'matrix',rows:[['3, 3','0, 5'],['5, 0','1, 1']],rowLabels:['Cooperate','Defect'],columnLabels:['Cooperate','Defect'],zones:[]}]}});
 await page.getByRole('region',{name:'Study whiteboard'}).waitFor();await page.waitForTimeout(1100);await layout('desktop');
 await page.getByRole('button',{name:'Hide subtitles',exact:true}).click();assert.equal(await page.locator('.assistant-captions').getAttribute('aria-hidden'),'true');
 await page.getByRole('button',{name:'Show subtitles',exact:true}).click();assert.equal(await page.locator('.assistant-captions').getAttribute('aria-hidden'),'false');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);await layout('mobile');
 await page.evaluate(()=>{window.__captionAudio.state='suspended';});const paused=await shown();await advance(8);assert.equal(await shown(),paused,'suspended output holds cue');
 await page.evaluate(()=>{window.__captionAudio.state='running';window.__captionAudio.onstatechange?.();});await page.waitForTimeout(80);
 assert.ok((await shown()).length<text.length);
 send({type:'interrupt'});await page.waitForTimeout(100);assert.equal(await shown(),'','barge-in clears cue');
 send({type:'transcript',role:'assistant',turnId:1,text:'Late stale words.',final:true});await page.waitForTimeout(80);assert.equal(await shown(),'');
 send({type:'transcript',role:'assistant',turnId:2,text:'Why?',final:true});send({type:'audio',turnId:2,sampleRate:24000,audio:Buffer.alloc(24000).toString('base64'),alignment:{chars:['W','h','y','?'],startsMs:[0,80,160,240],durationsMs:[80,80,80,80]}});send({type:'audio-end',turnId:2});await page.waitForTimeout(80);assert.equal(await shown(),'');
 await advance(8.1);assert.equal(await shown(),'Why?');await layout('mobile-short');
 assert.deepEqual(errors,[]);assert.equal(packets.filter(packet=>packet.type==='audio').length,0);results.result='PASS';
}finally{await writeFile('artifacts/captions-browser-results.json',JSON.stringify({...results,errors},null,2));await browser.close();}
console.log(JSON.stringify({...results,errors},null,2));
