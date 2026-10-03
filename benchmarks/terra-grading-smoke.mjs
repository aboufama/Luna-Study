// Real independently double-checked grading against the user's imported pset.
// Explicit opt-in, bounded to eight requests; no TTS calls or production writes.
import { readFile, writeFile } from 'node:fs/promises';
import { createOpenAIOrganizer } from '../server/openai-luna.mjs';
import { checkedGrade } from '../server/mastery.mjs';
if(!process.argv.includes('--live'))throw Error('Pass --live to call the configured provider.');
const fixture=JSON.parse(await readFile(new URL('./tutor-context-fixture.json',import.meta.url),'utf8'));
const materials=[{id:'econ2801-pset3',name:fixture.source.name,text:fixture.pages.map(page=>`[PDF page ${page.page}]\n${page.text}`).join('\n\n')}];
const question={id:'grade-payoffs',topicId:'game-payoffs',topicTitle:'Three-player game',difficulty:'easy',sourceIds:[materials[0].id],question:'What are the payoffs when player 1 chooses U, player 2 chooses R, and player 3 chooses B?',answer:'The payoffs are (1, 6, 1).'};
const results={createdAt:new Date().toISOString(),model:process.env.LUNA_API_MODEL||'gpt-6-luna',mainModel:process.env.LUNA_TUTOR_MODEL,cases:[],requests:[]};
let calls=0;
const organizer=createOpenAIOrganizer({fetchImpl:async(url,options)=>{
  if(++calls>8)throw Error('Benchmark call limit reached.');
  const began=performance.now(),response=await fetch(url,options),body=await response.clone().json();
  results.requests.push({status:response.status,elapsedMs:Math.round(performance.now()-began),model:body.model,usage:body.usage,publicGrade:body.output?.filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(part=>part.type==='output_text').map(part=>part.text).join(''),...(!response.ok?{providerError:String(body.error?.message||'error').slice(0,1500)}:{})});
  return response;
}});
for(const [name,answer,expected] of [['correct','The payoffs are (1, 6, 1).','correct'],['incorrect','The payoffs are (7, 7, 1).','incorrect'],['assisted','The payoffs are (1, 6, 1).','correct']]){
  const conversation=[{role:'assistant',content:question.question},...(name==='assisted'?[{role:'assistant',content:'The source gives one, six, one for that exact combination.'}]:[])];
  try{const verdict=await checkedGrade({organizer,question,answer,materials,conversation});results.cases.push({name,expected,verdict,pass:verdict?.checked===true&&verdict.verdict===expected&&verdict.unassisted===(name!=='assisted')});}
  catch(error){results.cases.push({name,expected,pass:false,error:{status:error.status,providerStatus:error.providerStatus,message:error.message}});if(results.requests.some(r=>r.status===400))break;}
}
results.passed=results.cases.length===3&&results.cases.every(c=>c.pass);
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||'benchmarks/terra-grading-smoke.json';
await writeFile(output,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({output,passed:results.passed,cases:results.cases,requests:results.requests.length}));
