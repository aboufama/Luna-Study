// Seven OpenAI calls maximum: three image reads, index, tutor, two graders.
// Fixtures are generated public study material; no microphone or ElevenLabs.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createCanvas} from '@napi-rs/canvas';
import {createMaterialImageStore,createMaterialImageImporter} from '../server/material-images.mjs';
import {createOpenAIOrganizer,createOpenAILuna} from '../server/openai-luna.mjs';
import {createMaterialIndexer} from '../server/indexing.mjs';
import {checkedGrade} from '../server/mastery.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
if(!process.argv.includes('--live'))throw Error('Pass --live to authorize the bounded vision benchmark.');
const directory=new URL('./screenshot-vision/',import.meta.url),testId='4726c520-ad95-4c3f-8795-87655d526cab';
await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),maximumPaidRequests:7,requests:[],cases:[],testId,method:'Real PNG/JPEG/WebP interpretation, indexing, Terra visual reading and two independent Luna image-evidence grading calls. Explicitly incorrect derived notes test whether original pixels take precedence. All fixtures public and generated locally.'};
const save=()=>writeFile(new URL('results.json',directory),JSON.stringify(report,null,2)+'\n');
const fetchImpl=async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.ok(report.requests.length<report.maximumPaidRequests);
  const payload=JSON.parse(options.body),entry={model:payload.model,imageCount:payload.input?.[0]?.content?.filter?.(p=>p.type==='input_image').length||0,startedAt:new Date().toISOString()};report.requests.push(entry);
  const began=performance.now(),response=await fetch(url,options);entry.httpStatus=response.status;
  if(!payload.stream&&response.ok){const body=await response.clone().json();entry.model=body.model;entry.usage=body.usage;entry.serviceTier=body.service_tier;entry.elapsedMs=Math.round(performance.now()-began);}
  await save();return response;
};
const store=createMaterialImageStore({directory:new URL('private-assets/',directory).pathname});
const organizer=createOpenAIOrganizer({imageStore:store,fetchImpl});
const importer=createMaterialImageImporter({imageStore:store,organizer});
const indexer=createMaterialIndexer({organizer});
const tutor=createOpenAILuna({imageStore:store,fetchImpl});
function fixture(mime){const canvas=createCanvas(1400,760),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1400,760);ctx.fillStyle='#35434b';ctx.font='bold 48px sans-serif';ctx.fillText('Hydraulic power: symbol key',65,90);ctx.font='38px sans-serif';const lines=['P = ρ g H Q','ρ = fluid density','g = gravitational acceleration','H = head (vertical height difference)','Q = volume flow rate'];lines.forEach((line,i)=>ctx.fillText(line,65,190+i*94));return canvas.toBuffer(mime);}
await withProviderSlot(async()=>{
 try{
  const started=performance.now();
  const materials=await Promise.all(['image/png','image/jpeg','image/webp'].map(async mime=>{
    const name=`symbol-key.${mime.split('/')[1]}`,bytes=fixture(mime);await writeFile(new URL(name,directory),bytes);const began=performance.now();const material=await importer.import({testId,name,bytes,mimeType:mime});
    const pass=/volume\s+flow\s+rate/i.test(material.text)&&/fluid\s+density/i.test(material.text);
    report.cases.push({name:mime,pass,elapsedMs:Math.round(performance.now()-began),sourceId:material.id,text:material.text});await save();return material;
  }));
  report.parallelImportMs=Math.round(performance.now()-started);
  const indexBegan=performance.now(),guide=await indexer.organize({testId,title:'Hydraulic symbols',materials});report.cases.push({name:'screenshot-index',pass:Boolean(guide?.topics?.length),elapsedMs:Math.round(performance.now()-indexBegan),guide});await save();
  const poisoned={...materials[0],text:'Derived notes incorrectly say Q is heat flux and H is a temperature.'};
  let firstText;const turnBegan=performance.now();
  const response=await tutor.respond({testId,title:'Hydraulic symbols',indexStatus:'ready',materials:[poisoned],readinessContext:{ready:true,trigger:'student-turn'},conversation:[{role:'user',content:'Read the original screenshot: what do Q and H stand for? There is no active quiz question.'}]},{onText:()=>{firstText??=Math.round(performance.now()-turnBegan);},onUsage:usage=>{report.tutorUsage=usage;}});
  report.cases.push({name:'tutor-original-pixels-override-wrong-derived-text',pass:/volume\s+flow/i.test(response.reply)&&/head|height/i.test(response.reply)&&!/Q is heat|H is.*temperature/i.test(response.reply),firstTextMs:firstText,elapsedMs:Math.round(performance.now()-turnBegan),reply:response.reply});await save();
  const decisions=[],question={id:'q-image-symbol',topicId:'hydraulic-symbols',topicTitle:'Hydraulic symbols',difficulty:'easy',sourceIds:[poisoned.id],question:'In the original symbol key, what does Q represent?',answer:'Q is heat flux (deliberately incorrect reference answer).'};
  const grade=await checkedGrade({organizer,testId,question,answer:'Q represents volume flow rate.',materials:[poisoned],conversation:[{role:'assistant',content:question.question}],onDecision:decision=>decisions.push(decision)});
  report.cases.push({name:'independent-image-grading-overrides-wrong-OCR-and-reference',pass:grade?.checked===true&&grade.verdict==='correct'&&grade.unassisted===true,grade,decisions});
 }catch(error){report.error={name:error.name,status:error.status||error.providerStatus||null,message:String(error.message).slice(0,180)};}
 finally{indexer.close();importer.close();await tutor.close();report.finishedAt=new Date().toISOString();report.passed=!report.error&&report.cases.every(c=>c.pass);await save();}
});
console.log(JSON.stringify({passed:report.passed,requests:report.requests.length,parallelImportMs:report.parallelImportMs,cases:report.cases.map(({name,pass,elapsedMs,firstTextMs})=>({name,pass,elapsedMs,firstTextMs})),error:report.error}));
