import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {lunaInstructions} from '../server/luna-fast.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
import {runQualitySession} from './tutor-quality-sessions.mjs';
import {equations,biology} from './tutor-quality-fixtures.mjs';
import {summarizeSession} from './tutor-quality-accounting.mjs';

const currentProblem=record=>record.messages.findLast(message=>message.type==='practice-state')?.current||null;
const normalize=text=>String(text||'').normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim();
function adaptiveAnswer(kind){
  return record=>{
    const working=currentProblem(record),fixture=[...equations,biology].find(item=>normalize(item.question)===normalize(working?.question));
    const adaptation={kind,observedQuestionId:working?.questionId||null,observedQuestion:working?.question||null,fixtureMatched:Boolean(fixture)};
    if(!fixture)return {text:'I am not sure which complete problem you want me to answer. Please restate one question from our notes, and let me try it before you explain.',adaptation};
    const biologyTarget=fixture===biology;
    const answer=kind==='correct'?fixture.answer:kind==='partial'?(biologyTarget?'The membrane controls what crosses between the cell and its surroundings. I have not explained the two types of transport yet.':'I would use the same reversible operation on both sides. I have not reached a value for the variable yet.'):(biologyTarget?'Passive transport uses energy to move against the concentration gradient, and active transport moves down it without energy.':'The variable equals 7. I subtracted a number but did not check the remaining coefficient.');
    return {text:`My answer is: ${answer}`,adaptation};
  };
}

// Public current question, never a guessed next bank slot, determines answers.
// Correct replies deliberately use supplied originals: a scripted state/behavior
// test, not a simulated claim that the learner independently discovered them.
const script=[
  {id:'choose-equation',at:30_000,text:'Please start with the hard equation question about 2x + 3 = 11. Ask me without solving it.'},
  {id:'first-uncertainty',at:90_000,text:"I don't know. Could you solve it for me?"},
  {id:'clarify-current',at:150_000,text:'Wait, which complete problem are we working on?'},
  {id:'hint-one',at:210_000,packet:{type:'hint'}},
  {id:'partial-step',at:270_000,adapt:adaptiveAnswer('partial')},
  {id:'without-calculator',at:330_000,text:'I do not have a calculator. Please keep this doable mentally, and let me do the operations myself.'},
  {id:'hint-two',at:390_000,packet:{type:'hint'}},
  {id:'answer-shortcut',at:450_000,text:'Can you just tell me the final answer instead of waiting for me?'},
  {id:'hint-three',at:510_000,packet:{type:'hint'}},
  {id:'incorrect-full-target',at:570_000,adapt:adaptiveAnswer('incorrect')},
  {id:'revised-full-target',at:630_000,adapt:adaptiveAnswer('correct')},
  {id:'next-equation',at:690_000,text:'Choose another hard equation from the notes. Let me solve it before giving feedback.'},
  {id:'independent-equation',at:750_000,adapt:adaptiveAnswer('correct')},
  {id:'switch-biology',at:810_000,text:'Let us switch to the hard membrane and transport question now.'},
  {id:'biology-clarification',at:870_000,text:'Could you restate what the question is asking, without answering it?'},
  {id:'biology-partial',at:930_000,adapt:adaptiveAnswer('partial')},
  {id:'biology-full',at:990_000,adapt:adaptiveAnswer('correct')},
  {id:'break-request',at:1_050_000,text:'I need a short break. Please pause here.'},
  {id:'pause',at:1_060_000,packet:{type:'pause'}},
  {id:'resume',at:1_090_000,packet:{type:'resume'}},
  {id:'resume-study',at:1_110_000,text:'I am back. Ask me a new hard equation, and give me time to try it.'},
  {id:'third-equation',at:1_170_000,adapt:adaptiveAnswer('correct')},
  {id:'ask-next',at:1_230_000,text:'Can we try one more hard equation from the notes before reviewing my reasoning?'},
  {id:'fourth-equation',at:1_290_000,adapt:adaptiveAnswer('correct')},
  {id:'identify-review-target',at:1_410_000,text:'Which problem should I explain back to you? Please state it without showing the solution.'},
  {id:'explain-back',at:1_470_000,adapt:adaptiveAnswer('correct')},
  {id:'method-recap',at:1_530_000,text:'My general method is to identify the unknown, apply the same reversible operation to both sides, justify it, and check my result in the original equation.'},
  {id:'ask-transfer-check',at:1_590_000,text:'Give me one short question to check that I understand the reasoning, rather than telling me the answer.'},
  {id:'transfer-response',at:1_650_000,adapt:adaptiveAnswer('correct')},
  {id:'final-review',at:1_740_000,text:'Before we stop, tell me what I should practice next based on my attempts. Please do not mark a topic complete just because we went through the questions.'},
];

const live=process.argv.includes('--live'),output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||`benchmarks/tutor-quality/${live?'live':'offline'}-adaptive-results.json`;
try{await readFile(output);throw Error('Refusing to overwrite prior adaptive results.');}catch(error){if(error.code!=='ENOENT')throw error;}
const requestLimit=(name,fallback,max)=>{
  const supplied=process.argv.find(arg=>arg.startsWith(`--${name}-limit=`));
  const value=supplied?Number(supplied.split('=')[1]):fallback;
  if(!Number.isInteger(value)||value<1||value>max)throw Error(`Invalid ${name} upfront request limit.`);
  return value;
};
const providerBudget={limits:{openai:requestLimit('openai',50,65),jev:requestLimit('jev',60,70)},counts:{openai:0,jev:0}};
const trackedPaths=['server/live-voice.mjs','server/model-config.mjs','server/question-identity.mjs','server/diagnostics.mjs','server/board-routing-context.mjs','server/luna-fast.mjs','server/openai-luna.mjs','server/tutor-output.mjs','server/tutor-context.mjs','server/question-bank.mjs','server/jev.mjs','server/jev-intent.mjs','server/mastery.mjs','server/grade-citations.mjs','server/hint-policy.mjs','server/tutor-turn-task.mjs','server/whiteboard.mjs','shared/board-parts.mjs','shared/board-rich-text.mjs','shared/equation-chain.mjs','shared/flow-layout.mjs','src/Whiteboard.jsx','src/TeachingScene.jsx','src/TeachingLayouts.jsx','src/BoardRichText.jsx','src/scene-label-layout.mjs','src/scene-camera.mjs','src/board-reading.css','src/teaching-scene.css','benchmarks/tutor-quality-sessions.mjs','benchmarks/tutor-quality-adaptive.mjs'];
const snapshotHashes=async()=>Object.fromEntries(await Promise.all(trackedPaths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const run=async()=>{
  const instructionsOverride=lunaInstructions('voice');
  const codeHashes=await snapshotHashes();
  const result=await runQualitySession({arm:'current',live,script,providerBudget,semanticProbes:false,instructionsOverride,artifactPath:output.replace(/\.json$/,'.session.json'),onProgress:value=>console.log(JSON.stringify(value))});
  const codeHashesAtEnd=await snapshotHashes(),changedPaths=trackedPaths.filter(path=>codeHashes[path]!==codeHashesAtEnd[path]);
  const codeStability={unchanged:changedPaths.length===0,inferenceFilesUnchanged:!changedPaths.some(path=>path.startsWith('server/')),changedPaths,note:'Start/end file hashes detect net changes in the listed files; they do not prove no transient edits or loaded-module equality. The voice instruction string is frozen once per run. Browser renderer files are provenance only: the speech harness does not render UI.'};
  const report={method:'Sustained30-minute virtual session with academic exchanges through minute29 and a30-second controlled pause. Scripted student adapts answers to the actual public canonical working problem; unrecognized targets cause clarification instead of a guessed answer. Correct replies are drawn from original synthetic notes. Real providers only in live mode; no paid ElevenLabs or human learning-gain claim.',codeHashes,codeHashesAtEnd,codeStability,providerBudget,studentUtterances:script.filter(item=>item.text||item.adapt).length,session:result,accounting:summarizeSession(result)};
  await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,status:result.status,counts:providerBudget.counts,errors:result.errors,grades:report.accounting.grades}));
};
if(live)await withProviderSlot(run);else await run();
