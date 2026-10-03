import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const input=process.argv[2],output=process.argv[3];
if(!input||!output)throw Error('Usage: node benchmarks/tutor-quality-transcript.mjs <saved-results.json> <new-transcript.md>');
try{await readFile(output);throw Error('Refusing to overwrite a saved transcript.');}catch(error){if(error.code!=='ENOENT')throw error;}
const raw=await readFile(input,'utf8'),report=JSON.parse(raw),session=report.session||report;
const quote=value=>String(value).split('\n').map(line=>`> ${line}`).join('\n');
const stamp=value=>`${Math.floor(value/60_000)}:${String(Math.floor(value%60_000/1000)).padStart(2,'0')}`;
const lines=['# Saved synthetic tutor-session transcript','',`Source: \`${input}\``, `SHA-256: \`${createHash('sha256').update(raw).digest('hex')}\``,'','This is an offline projection of an immutable real-provider trace. Times are virtual; student speech and ElevenLabs transport were simulated. Quoted tutor wording is unchanged. Review decisions are separate from recognized attempts and scoring events.',''];
for(const reply of session.messages.filter(item=>item.stepId==='welcome'&&item.type==='transcript'&&item.role==='assistant'&&item.final))lines.push('## 0:00 · Welcome','',quote(reply.text),'');
for(const step of session.steps){
  lines.push(`## ${stamp(step.virtualMs)} · ${step.id}`,'',typeof step.input==='string'?`Student: ${step.input}`:`Control: \`${JSON.stringify(step.input)}\``,'');
  if(step.adaptation)lines.push(`Adaptive target recognized: ${step.adaptation.fixtureMatched}.`,'');
  for(const reply of step.replies||[])lines.push(quote(reply),'');
  if(step.hintState)lines.push(`Hint state after turn: ${step.hintState.reason}; remaining ${step.hintState.remaining}; question \`${step.hintState.questionId||'none'}\`.`,'');
  for(const review of session.gradeResults.filter(item=>item.stepId===step.id))lines.push(`Review: \`${JSON.stringify(review.grade)}\`.`,'');
  for(const attempt of session.problems.filter(item=>item.stepId===step.id&&item.type==='attempt'))lines.push(`Recognized attempt: ${attempt.attempt} for \`${attempt.questionId}\`.`,'');
  if(step.mastery)lines.push(`Progress: ${step.mastery.topics.map(item=>`${item.title} ${item.score}${item.mastered?' (mastered)':''}`).join('; ')}. Overall ${step.mastery.overall}.`,'');
}
await writeFile(output,lines.join('\n')+'\n');
console.log(JSON.stringify({output,steps:session.steps.length}));
