import {writeFile} from 'node:fs/promises';
import {createLunaFast} from '../server/luna-fast.mjs';
import {input} from './luna-text-latency.mjs';
const results=[];
for(const reuseThread of [false,true]){
  const session=createLunaFast({reuseThread});let conversation=[];
  try{
    await session.ready();
    for(const question of ['What do mitochondria do?','What do ribosomes do?','What does the cell membrane do?']){
      conversation.push({role:'user',content:question});
      const result=await session.respond({...input,conversation},{timeoutMs:30000});
      conversation.push({role:'assistant',content:result.reply});
      const sample={reuseThread,question,...result};results.push(sample);console.log(JSON.stringify(sample));
    }
  }finally{await session.close();}
}
await writeFile('benchmarks/luna-reuse-results.json',JSON.stringify({recordedAt:new Date().toISOString(),synthetic:true,results},null,2)+'\n');
