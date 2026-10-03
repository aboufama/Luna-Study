import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch();const page=await browser.newPage();const activeSockets=new Set();
await page.routeWebSocket('**/session',socket=>{
  activeSockets.add(socket);socket.onClose(()=>activeSockets.delete(socket));
  socket.onMessage(raw=>{const m=JSON.parse(raw);if(m.type==='start')socket.send(JSON.stringify({type:'ready',inputRate:16000}));if(m.type==='stop')socket.close();});
});
await page.addInitScript(()=>{
  window.streams=[];window.micResolvers=[];
  navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.micResolvers.push(()=>{
    const ctx=new AudioContext();const destination=ctx.createMediaStreamDestination();window.streams.push(destination.stream);resolve(destination.stream);
  }));
});
await page.goto('http://localhost:5196');
await page.evaluate(async()=>{const {VoiceSession}=await import('/audio.mjs');window.voice=new VoiceSession({provider:'openai',keys:{},config:{},onEvent:()=>{}});await window.voice.start();});
await page.waitForFunction(()=>window.micResolvers.length===1);
await page.evaluate(()=>{window.voice.stop();window.micResolvers.shift()();});
await page.waitForFunction(()=>window.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
await page.evaluate(async()=>{const {VoiceSession}=await import('/audio.mjs');window.events=[];window.voice=new VoiceSession({provider:'openai',keys:{},config:{},onEvent:e=>window.events.push(e)});await window.voice.start();});
await page.waitForFunction(()=>window.micResolvers.length===1);await page.evaluate(()=>window.micResolvers.shift()());
await page.waitForFunction(()=>window.events.some(e=>e.type==='ready'));
await page.evaluate(()=>{window.voice.error('Forced provider failure');});
assert.equal(await page.evaluate(()=>window.streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length),0);
await page.waitForTimeout(100);assert.equal(activeSockets.size,0);
assert.equal(await page.evaluate(()=>window.voice.context.state),'closed');
await browser.close();console.log('PASS: stop while microphone permission is pending, late stream disposal, active failure cleanup, closed audio context, no remaining sockets.');
