// Avoid concurrent provider load contaminating the expanded timing arms.
import {mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const lock=join(tmpdir(),'luna-whiteboard-provider-slot');
export async function withProviderSlot(work){
 const until=Date.now()+180000;
 while(true){try{await mkdir(lock);break;}catch(error){if(error.code!=='EEXIST'||Date.now()>until)throw Error('Benchmark provider slot unavailable');await new Promise(done=>setTimeout(done,100));}}
 try{return await work();}finally{await rm(lock,{recursive:true,force:true});}
}
