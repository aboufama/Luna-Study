// Bounded synthetic benchmark. Text only; never opens or plays audio.
import { writeFile } from 'node:fs/promises';
import { createLunaFast } from '../server/luna-fast.mjs';
import { input } from './luna-text-latency.mjs';

const session=createLunaFast();
const results=[];
const coldStart=performance.now();
try{
  await session.ready();
  const startupMs=Math.round(performance.now()-coldStart);
  for(let index=0;index<3;index++){
    const start=performance.now();let firstDeltaMs=null,firstSentenceMs=null,reply='';
    const result=await session.respond(input,{timeoutMs:30000,onText(delta){reply+=delta;firstDeltaMs??=Math.round(performance.now()-start);if(/[.!?](?:\s|$)/.test(reply))firstSentenceMs??=Math.round(performance.now()-start);}});
    const sample={transport:'app-server',effort:'low',index,startupMs:index===0?startupMs:0,firstDeltaMs,firstSentenceMs,totalMs:Math.round(performance.now()-start),reply:result.reply};results.push(sample);console.log(JSON.stringify(sample));
  }
  await writeFile('benchmarks/luna-stream-results.json',JSON.stringify({recordedAt:new Date().toISOString(),model:session.model,synthetic:true,results},null,2)+'\n');
}finally{await session.close();}
