// A single diagnostic probe of a catalog-unsupported effort. The production
// adapter continues to allow only catalog-supported effort values.
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {createLunaFast} from '../server/luna-fast.mjs';
import {input} from './luna-text-latency.mjs';
let unsupportedEffortError=false;
const session=createLunaFast({spawnImpl(binary,args,options){
  const child=spawn(binary,args,options);
  const originalWrite=child.stdin.write.bind(child.stdin);
  child.stdin.write=(chunk,...rest)=>{
    const message=JSON.parse(chunk.toString());
    if(message.method==='turn/start')message.params.effort='none';
    return originalWrite(`${JSON.stringify(message)}\n`,...rest);
  };
  let buffer='';child.stdout.on('data',chunk=>{buffer+=chunk.toString();const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){let event;try{event=JSON.parse(line);}catch{continue;}if(event.error||event.method==='error'||event.params?.turn?.error)unsupportedEffortError||=/reasoning|effort|not supported/i.test(JSON.stringify(event));}});
  return child;
}});
try{
  await session.ready();
  let result;
  try{const answer=await session.respond(input,{timeoutMs:20000});result={accepted:true,answer};}
  catch(error){result={accepted:false,status:error.status,unsupportedEffortError};}
  const report={recordedAt:new Date().toISOString(),model:session.model,effort:'none',synthetic:true,...result};
  console.log(JSON.stringify(report));await writeFile('benchmarks/luna-none-result.json',JSON.stringify(report,null,2)+'\n');
}finally{await session.close();}
