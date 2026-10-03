import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {lunaInstructions} from '../server/luna-fast.mjs';
import {runQualitySession} from './tutor-quality-sessions.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
import {summarizeSession} from './tutor-quality-accounting.mjs';

const live=process.argv.includes('--live');
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||`benchmarks/tutor-quality/${live?'live':'offline'}-hint-grant-repair.json`;
try{await readFile(output);throw Error('Refusing to overwrite a prior hint checkpoint.');}catch(error){if(error.code!=='ENOENT')throw error;}
const providerBudget={limits:{openai:5,jev:8},counts:{openai:0,jev:0}};
const script=[
  {id:'choose-without-calculator',at:15_000,text:'Please ask the hard question about 2x + 3 = 11 without solving it. I have no calculator, and I want to do the operations myself.'},
  {id:'hint-one',at:75_000,packet:{type:'hint'}},
  {id:'hint-cooldown',at:76_000,packet:{type:'hint'}},
  {id:'hint-two',at:135_000,packet:{type:'hint'}},
  {id:'hint-three',at:195_000,packet:{type:'hint'}},
  {id:'hint-cap',at:255_000,packet:{type:'hint'}},
];
const run=async()=>{
  const instructionsOverride=lunaInstructions('voice'),codeHashes={};
  for(const path of ['server/hint-policy.mjs','server/tutor-turn-task.mjs','server/live-voice.mjs','server/diagnostics.mjs','server/board-routing-context.mjs','server/luna-fast.mjs','server/openai-luna.mjs','server/tutor-output.mjs','server/tutor-context.mjs','server/question-bank.mjs','server/mastery.mjs','server/jev.mjs','server/jev-intent.mjs','benchmarks/tutor-quality-sessions.mjs','benchmarks/tutor-quality-hints.mjs'])codeHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
  const session=await runQualitySession({arm:'current',live,script,virtualDurationMs:270_000,semanticProbes:false,providerBudget,instructionsOverride,artifactPath:output.replace(/\.json$/,'.session.json'),onProgress:value=>console.log(JSON.stringify(value))});
  const report={method:'Targeted three-current-grant checkpoint. Same original equation and fixed production bank; actual button packets have no fabricated student utterance. Prior no-calculator preference remains in conversation. Immediate repeat and fourth request exercise cooldown/cap. Real providers only with --live; no paid ElevenLabs. Separate5 OpenAI/8 Jev cap.',codeHashes,providerBudget,session,accounting:summarizeSession(session)};
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,status:session.status,counts:providerBudget.counts,errors:session.errors}));
};
if(live)await withProviderSlot(run);else await run();
