import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir,writeFile,rm,access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
async function port(){const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const number=probe.address().port;await new Promise(resolve=>probe.close(resolve));return number;}
for(const production of [false,true])test(`actual ${production?'production':'development'} server routes screenshot imports and denies private image bytes`,{timeout:20000},async t=>{
 if(production){try{await access(path.join(root,'dist/index.html'));}catch{t.skip('Production build not present; development privacy still tested.');return;}}
 const testId=randomUUID(),dir=path.join(root,'data/material-images',testId),marker=`PRIVATE-IMAGE-FIXTURE-${randomUUID()}`;
 await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'fixture.image'),marker);await writeFile(path.join(dir,'fixture.json'),JSON.stringify({marker}));
 const p=await port(),origin=`http://127.0.0.1:${p}`;
 const child=spawn(process.execPath,['server/index.mjs',...(production?['--production']:[])],{cwd:root,env:{...process.env,PORT:String(p),LIVE_APIS:'false',LUNA_ORGANIZER:'disabled'},stdio:['ignore','pipe','pipe']});
 let finished=false;child.on('exit',()=>{finished=true;});child.stdout.resume();child.stderr.resume();
 t.after(async()=>{if(!finished){child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},1500);child.once('exit',()=>{clearTimeout(timer);resolve();});});}await rm(dir,{recursive:true,force:true});});
 let ready=false;const deadline=Date.now()+10000;
 while(Date.now()<deadline&&!finished){try{const res=await fetch(`${origin}/api/status`);if(res.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,25));}
 assert.equal(ready,true,'isolated no-provider server starts');
 const imported=await fetch(`${origin}/api/material-images?testId=${testId}&name=fixture.png`,{method:'POST',headers:{Origin:origin,'Content-Type':'image/png'},body:new Uint8Array([1,2,3])});
 assert.equal(imported.status,503,'real screenshot handler returns live-vision-unavailable, not Vite fallback or method guard');
 assert.match((await imported.json()).error,/screenshot|OpenAI|live/i);
 const foreign=await fetch(`${origin}/api/material-images?testId=${testId}&name=fixture.png`,{method:'POST',headers:{Origin:'https://unrelated.example','Content-Type':'image/png'},body:new Uint8Array([1])});assert.equal(foreign.status,403);
 for(const suffix of [`/data/material-images/${testId}/fixture.image`,`/data/material-images/${testId}/fixture.json?raw`,`/@fs${dir}/fixture.image`,`/@fs${dir}/fixture.json?raw`,`/%64ata/material-images/${testId}/fixture.image`,`/DaTa/material-images/${testId}/fixture.image`,`/data%2fmaterial-images%2f${testId}%2ffixture.image`]){
   const response=await fetch(origin+suffix);const text=await response.text();assert.ok([403,404].includes(response.status),`${suffix}: private route must be denied`);assert.equal(text.includes(marker),false);
 }
 const home=await fetch(origin+'/');assert.equal(home.status,200,'static app remains available');
});
