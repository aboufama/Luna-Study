import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {lunaInstructions} from '../server/luna-fast.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
import {runQualitySession} from './tutor-quality-sessions.mjs';
import {summarizeSession} from './tutor-quality-accounting.mjs';

const live=process.argv.includes('--live');
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||`benchmarks/tutor-quality/${live?'live':'offline'}-repair-results.json`;
try{await readFile(output);throw Error('Refusing to overwrite an earlier experiment.');}catch(error){if(error.code!=='ENOENT')throw error;}
const providerBudget={limits:{openai:30,jev:30},counts:{openai:0,jev:0}};
const report={startedAt:new Date().toISOString(),live,authorization:'Separate repair validation: maximum30 OpenAI and30 Jev calls total across all scenarios. No paid ElevenLabs.',method:'Preserves the initial before/current failures. Current repair repeats the same spoken script, plus a separate source-ready neutral welcome with unknown date and one refusal/uncertainty response. Virtual timeline; no human learning-gain claim.',providerBudget,sessions:[]};
const save=async()=>{await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');};
const run=async()=>{
  const instructionsOverride=lunaInstructions('voice');
  report.frozenInstructions={sha256:createHash('sha256').update(instructionsOverride).digest('hex'),characters:instructionsOverride.length};
  report.codeHashes={};
  for(const path of ['server/live-voice.mjs','server/luna-fast.mjs','server/jev-intent.mjs','server/jev.mjs','server/hint-policy.mjs','server/mastery.mjs','benchmarks/tutor-quality-sessions.mjs'])report.codeHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
  const scenarios=[
    {id:'unknown-date',startOverrides:{date:''},virtualDurationMs:25_000,semanticProbes:live,script:[{id:'decline-unknown-date',at:15_000,text:"I'm not sure yet. I'd rather not plan a date right now; let's just start studying."}]},
    {id:'matched-current',semanticProbes:false},
  ];
  for(const scenario of scenarios){
    const {id,...options}=scenario;
    const session=await runQualitySession({...options,arm:'current',live,providerBudget,instructionsOverride,artifactPath:output.replace(/\.json$/,`.${id}.json`),onProgress:progress=>console.log(JSON.stringify({scenario:id,...progress,sharedCounts:providerBudget.counts}))});
    report.sessions.push({...session,scenario:id});await save();
  }
  report.accounting=report.sessions.map(summarizeSession);
  report.finishedAt=new Date().toISOString();
  report.budgetBlockedRequests=report.sessions.flatMap(session=>session.requests).filter(request=>request.status==='budget-blocked').length;
  await save();
};
if(live)await withProviderSlot(run);else await run();
console.log(JSON.stringify({output,providerBudget,status:report.sessions.map(session=>({scenario:session.scenario,status:session.status})),budgetBlocked:report.budgetBlockedRequests}));
