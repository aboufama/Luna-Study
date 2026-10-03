import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {lunaInstructions} from '../server/luna-fast.mjs';
import {runQualitySession} from './tutor-quality-sessions.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
import {summarizeSession} from './tutor-quality-accounting.mjs';

const live=process.argv.includes('--live'),output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||`benchmarks/tutor-quality/${live?'live':'offline'}-coaching-repair.json`;
try{await readFile(output);throw Error('Refusing to overwrite a prior coaching probe.');}catch(error){if(error.code!=='ENOENT')throw error;}
const providerBudget={limits:{openai:8,jev:12},counts:{openai:0,jev:0}};
const script=[
  {id:'decline-unknown-date',at:15_000,text:"I'm not sure yet. I'd rather not plan a date right now; let's just start the hard question about 2x + 3 = 11. Ask me without solving it."},
  {id:'no-calculator',at:105_000,text:"I don't have a calculator. Can I reason through a first step mentally?"},
  {id:'answer-bypass',at:150_000,text:"I don't know. Can you just solve it for me?"},
  {id:'hint-button',at:195_000,packet:{type:'hint'}},
  {id:'wrong-attempt-after-hint',at:260_000,text:'My answer is x = 7, because I subtracted 3 and then stopped. Is that right?'},
];
const run=async()=>{
  const instructionsOverride=lunaInstructions('voice'),codeHashes={};
  for(const path of ['server/live-voice.mjs','server/luna-fast.mjs','server/jev-intent.mjs','server/jev.mjs','server/mastery.mjs','benchmarks/tutor-quality-sessions.mjs'])codeHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
  const session=await runQualitySession({arm:'current',live,startOverrides:{date:''},script,virtualDurationMs:280_000,semanticProbes:false,providerBudget,instructionsOverride,artifactPath:output.replace(/\.json$/,'.session.json'),onProgress:progress=>console.log(JSON.stringify(progress))});
  await writeFile(output,JSON.stringify({method:'Targeted coaching repair checkpoint; actual source-ready neutral unknown-date welcome, refusal combined with explicit equation request, no calculator, help request, one authorized hint, and wrong target answer asking is-that-right. No paid ElevenLabs; separate8/12 cap. All public classifier inputs/answers and grader decisions retained.',codeHashes,providerBudget,session,accounting:summarizeSession(session)},null,2)+'\n');
  console.log(JSON.stringify({output,status:session.status,counts:providerBudget.counts,gradeResults:session.gradeResults.length,budgetBlocked:session.requests.filter(request=>request.status==='budget-blocked').length,errors:session.errors}));
};
if(live)await withProviderSlot(run);else await run();
