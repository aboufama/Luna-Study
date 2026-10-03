// One standalone turn and one concurrent fast/planner pair, text only.
import {writeFile,readFile} from 'node:fs/promises';
import {createLunaFast} from '../server/luna-fast.mjs';
import {input} from './luna-text-latency.mjs';
const fast=createLunaFast(),planner=createLunaFast({mode:'planner'});
try{
  await Promise.all([fast.ready(),planner.ready()]);
  const standalone=await fast.respond(input,{timeoutMs:30000});
  console.log(JSON.stringify({experiment:'standalone-low',...standalone}));
  const startedAt=performance.now();
  const [voice,hint]=await Promise.all([fast.respond(input,{timeoutMs:30000}),planner.respond(input,{effort:'high',timeoutMs:30000})]);
  const concurrent={experiment:'concurrent-low-plus-high',voice,hint,totalMs:Math.round(performance.now()-startedAt)};
  console.log(JSON.stringify(concurrent));
  let previous=[];
  try{const saved=JSON.parse(await readFile('benchmarks/luna-planner-results.json','utf8'));previous=saved.results||[{standalone:saved.standalone,concurrent:saved.concurrent}];}catch{}
  const results=[...previous,{standalone,concurrent}];
  await writeFile('benchmarks/luna-planner-results.json',JSON.stringify({recordedAt:new Date().toISOString(),model:fast.model,synthetic:true,samples:results.length,results},null,2)+'\n');
}finally{await Promise.all([fast.close(),planner.close()]);}
