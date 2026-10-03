// Explicit opt-in: real providers incur usage. Reuses the same synthetic clip.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
if(!process.argv.includes('--live'))throw new Error('Pass --live to make paid provider requests.');
const browser=await chromium.launch();const page=await browser.newPage();
await page.addInitScript(()=>{
  window.testStreams=[];
  navigator.mediaDevices.getUserMedia=async()=>{const ctx=new AudioContext();const dest=ctx.createMediaStreamDestination();window.testStreams.push(dest.stream);return dest.stream;};
});
await page.goto('http://localhost:5196');
const wav=[...await fs.readFile('voice-lab/test-results/probe.wav')];
const results=[];
for(const provider of ['eleven','local','eleven','local']){
  const result=await page.evaluate(async({provider,wav})=>{
    const {VoiceSession}=await import('/audio.mjs');
    const events=[];let measured=false;const start=performance.now();
    return new Promise(resolve=>{
      let finishing=false;const finish=()=>{if(finishing)return;finishing=true;clearTimeout(timeout);voice.stop();resolve({provider,events,totalMs:performance.now()-start,tracksLive:window.testStreams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length});};
      const timeout=setTimeout(()=>{events.push({type:'error',message:'90s test deadline'});finish();},90000);
      const voice=new VoiceSession({provider,keys:{},config:{llm:'codex'},onEvent:m=>{
        if(!['level','load'].includes(m.type))events.push(m);
        if(m.type==='ready')voice.replay(new File([new Uint8Array(wav)],'same-question.wav',{type:'audio/wav'}));
        if(m.type==='measurement'){measured=true;setTimeout(finish,6500);}
        if(m.type==='error')finish();
      }});
      voice.start().catch(e=>{events.push({type:'error',message:e.message});finish();});
    });
  },{provider,wav});
  results.push(result);console.log(JSON.stringify({provider,timing:result.events.filter(e=>['measurement','timing','warmup'].includes(e.type)),transcript:result.events.filter(e=>e.type==='transcript'),errors:result.events.filter(e=>e.type==='error'),tracksLive:result.tracksLive}));
}
await fs.writeFile('voice-lab/research/live-comparison.json',JSON.stringify({at:new Date().toISOString(),clip:'What is the difference between mitosis and meiosis? Keep it brief.',note:'Synthetic replay in headless Chromium. Scheduled PCM, not hardware output. Two trials per option. Different text models; no controlled STT-only conclusion.',results},null,2));
await browser.close();
