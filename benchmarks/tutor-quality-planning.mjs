import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {lunaInstructions} from '../server/luna-fast.mjs';
import {runQualitySession} from './tutor-quality-sessions.mjs';
import {summarizeSession} from './tutor-quality-accounting.mjs';
import {biology} from './tutor-quality-fixtures.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';

const live=process.argv.includes('--live');
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||`benchmarks/tutor-quality/${live?'live':'offline'}-planning-release.json`;
try{await readFile(output);throw Error('Refusing to overwrite a prior planning probe.');}catch(error){if(error.code!=='ENOENT')throw error;}
const script=[
 {id:'unknown-date-priority',at:15_000,text:"I don't know when the exam is yet. Cell transport is my weakest topic. Let's practice that now."},
 {id:'decline-more-planning',at:60_000,text:"I'd rather not plan the timing or answer more setup questions. Please let me try the cell transport question."},
];
const providerBudget={limits:{openai:8,jev:12},counts:{openai:0,jev:0}};
const paths=['server/live-voice.mjs','server/luna-fast.mjs','server/tutor-turn-task.mjs','server/model-config.mjs','server/openai-luna.mjs','server/jev-intent.mjs','server/jev.mjs','server/hint-policy.mjs','server/tutor-output.mjs','server/question-bank.mjs','server/mastery.mjs','server/grade-citations.mjs','benchmarks/tutor-quality-sessions.mjs','benchmarks/tutor-quality-fixtures.mjs','benchmarks/tutor-quality-planning.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const run=async()=>{
 const codeHashes=await hashes(),instructionsOverride=lunaInstructions('voice');
 const session=await runQualitySession({arm:'current',live,script,startOverrides:{date:''},virtualDurationMs:75_000,semanticProbes:false,providerBudget,instructionsOverride,artifactPath:output.replace(/\.json$/,'.session.json'),onProgress:value=>console.log(JSON.stringify(value)),
  // The dry tutor is explicitly a plumbing fixture, not a prediction of live
  // conversation. It chooses the public offered biology ID deterministically.
  ...(!live?{tutorOutputImpl:input=>{
   const offered=input.privateQuestionBank?.topics?.flatMap(t=>t.questions)||[];
   const q=offered.find(q=>q.question===biology.question)||input.encounteredQuestions?.find(q=>q.question===biology.question);
   return q?`<say>We can practice cell transport.</say><ask>${q.id}</ask>`:'<say>We can begin with your original notes.</say>';
  }}:{}),
 });
 const codeHashesAtEnd=await hashes(),changedPaths=paths.filter(path=>codeHashes[path]!==codeHashesAtEnd[path]);
 const replies=session.messages.filter(m=>m.type==='transcript'&&m.role==='assistant'&&m.final).map(({stepId,text})=>({stepId,text}));
 const practiceAfterSteps=script.map(step=>{
  const current=session.messages.findLast(m=>m.stepId===step.id&&m.type==='practice-state')?.current;
  return{stepId:step.id,questionId:current?.questionId||null,question:current?.question||null,topicTitle:current?.topicTitle||null};
 });
 const dateWrites=session.messages.filter(m=>['setup-date','setup-updated'].includes(m.type)&&Boolean(m.date));
 const checks={completed:session.status==='completed',codeUnchanged:changedPaths.length===0,noProviderErrors:session.errors.length===0,noCapBlocks:!session.requests.some(r=>r.status==='budget-blocked'),noInventedExamDate:dateWrites.length===0,trackedCellPracticeAfterBothRequests:practiceAfterSteps.every(p=>p.question===biology.question),noGradesFromPlanning:session.gradeResults.length===0};
 const report={method:'Targeted planning smoke, not a sustained session or learning-gain study. Starts with indexed original synthetic sources and no exam date. Two fixed student requests state a weak topic, request practice, and decline further planning. Real tutor/Jev only in live mode; synthetic ElevenLabs, fixed original question bank, no retrieval selector. The optional calculator/topic switch is omitted to keep scope and request bounds explicit.',script,providerBudget,codeHashes,codeHashesAtEnd,codeStability:{unchanged:changedPaths.length===0,changedPaths},checks,manualReview:{status:'pending',criteria:['After the student says the exam date is unknown, do not demand a date or repeat timing/intake questions.','Follow the stated weak cell-transport priority with a canonical practice question.','After the student declines more planning, allow practice without further planning checklist.','Do not supply the answer to the question while inviting the learner to try.'],note:'Mechanical checks establish tracked identity/date events only. Exact public replies below require semantic review; a passing dry fixture does not validate live behavior.'},practiceAfterSteps,dateWrites,replies,session,accounting:summarizeSession(session)};
 await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({output,checks,counts:providerBudget.counts,replies}));
};
if(live)await withProviderSlot(run);else await run();
