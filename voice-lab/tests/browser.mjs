import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>{
  window.testStreams=[];
  navigator.mediaDevices.getUserMedia=async()=>{await new Promise(r=>setTimeout(r,100));const ctx=new AudioContext();const dest=ctx.createMediaStreamDestination();window.testStreams.push(dest.stream);for(const t of dest.stream.getTracks())t.addEventListener('ended',()=>ctx.close());return dest.stream;};
});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:5196');await page.getByRole('button',{name:/Connections/}).click();await page.getByRole('button',{name:'Done'}).click();
assert.equal(await page.locator('.provider').count(),6);
await page.getByRole('button',{name:/Gemini Live/}).click();await page.getByRole('button',{name:'Connect to try'}).click();assert.equal(await page.getByRole('dialog').count(),1);await page.getByRole('button',{name:'Done'}).click();
await page.getByRole('button',{name:/OpenAI Realtime/}).click();await page.getByRole('button',{name:'Start a conversation'}).click();await page.getByRole('alert').waitFor({timeout:35000});assert.match(await page.getByRole('alert').innerText(),/account_deactivated|invalid_api_key|401|credentials|access|configuration/i);
assert.equal(await page.evaluate(()=>window.testStreams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length),0);
await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.screenshot({path:'voice-lab/test-results/mobile.png',fullPage:true});
assert.deepEqual(errors,[]);await browser.close();console.log('PASS: six options, configuration drawer, missing-key route, real auth failure cleanup, mobile overflow, no browser errors.');
