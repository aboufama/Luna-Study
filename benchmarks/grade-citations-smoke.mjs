// Six paid requests maximum. Strict original-evidence grading; no voice.
import {readFile,writeFile} from 'node:fs/promises';
import {createOpenAIOrganizer} from '../server/openai-luna.mjs';
import {checkedGrade} from '../server/mastery.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
if(!process.argv.includes('--live'))throw Error('Explicit --live required.');
const fixture=JSON.parse(await readFile(new URL('./tutor-context-fixture.json',import.meta.url),'utf8'));
const materials=[{id:'econ2801-pset3',name:fixture.source.name,text:fixture.pages.map(page=>`[PDF page ${page.page}]\n${page.text}`).join('\n\n')}];
const question={id:'citation-payoffs',topicId:'payoffs',topicTitle:'Three-player game',difficulty:'easy',sourceIds:['econ2801-pset3'],question:'What are the payoffs when player1 chooses U, player2 chooses R, and player3 chooses B?',answer:'The payoffs are (1, 6, 1).'};
const report={startedAt:new Date().toISOString(),maximumRequests:6,requests:[],cases:[],model:'gpt-6-luna'};
const organizer=createOpenAIOrganizer({env:{...process.env,LUNA_API_MODEL:'gpt-6-luna'},fetchImpl:async(url,options)=>{
  if(url!=='https://api.openai.com/v1/responses'||report.requests.length>=6)throw Error('Request ceiling or unexpected destination');
  const record={};report.requests.push(record);const start=performance.now(),response=await fetch(url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(20000)].filter(Boolean))});record.status=response.status;
  if(response.ok){const body=await response.clone().json();record.model=body.model;record.usage=body.usage;const text=body.output?.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');try{record.publicStructuredGrade=JSON.parse(text);}catch{record.invalidStructuredOutput=true;}}
  record.elapsedMs=Math.round((performance.now()-start)*10)/10;return response;
}});
for(const [name,answer,expected]of [['correct','The payoffs are (1, 6, 1).','correct'],['incorrect','The payoffs are (7, 7, 1).','incorrect'],['assisted','The payoffs are (1, 6, 1).','correct']]){
 const item={name,expected,decisions:[]};
 try{await withProviderSlot(async()=>{item.grade=await checkedGrade({organizer,question,answer,materials,conversation:[{role:'assistant',content:question.question},...(name==='assisted'?[{role:'assistant',content:'The source gives one, six, one for exactly those choices. Use that answer.'}]:[])],onDecision:event=>item.decisions.push(event)});});item.pass=item.grade?.checked===true&&item.grade.verdict===expected&&item.grade.unassisted===(name!=='assisted');}
 catch(error){item.pass=false;item.failure={name:error.name,status:error.providerStatus||error.status||null};}
 report.cases.push(item);await writeFile(new URL('./grade-citations-smoke-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(item));
}
report.finishedAt=new Date().toISOString();report.passed=report.cases.every(x=>x.pass);await writeFile(new URL('./grade-citations-smoke-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
