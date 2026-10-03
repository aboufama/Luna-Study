import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {checkedGrade} from '../../server/mastery.mjs';
const output='benchmarks/tutor-quality/grade-restatement-fixtures.json';
try{await readFile(output);throw Error('Refusing to replace frozen restatement fixtures.');}catch(error){if(error.code!=='ENOENT')throw error;}
const path='benchmarks/tutor-quality/live-adaptive-final.json',raw=await readFile(path,'utf8'),session=JSON.parse(raw).session,sha=x=>createHash('sha256').update(x).digest('hex');
const w=structuredClone(session.gradeResults.find(g=>g.stepId==='third-equation').checkedGradeInput),y=structuredClone(session.gradeResults.find(g=>g.stepId==='fourth-equation').checkedGradeInput);
let beforeInstructions;
try{await checkedGrade({...w,organizer:{organize:async(_input,options)=>{beforeInstructions=options.instructions;throw Error('Captured without provider call.');}}});}catch{if(!beforeInstructions)throw Error('Could not capture grader instructions.');}
const beforeHash=session.requests.find(r=>r.kind==='grading'&&r.stepId==='third-equation').instructionSha256;
if(sha(beforeInstructions)!==beforeHash)throw Error('Current instructions differ from frozen final cohort.');
const expected=assisted=>({verdict:'correct',reasoningSufficient:true,assistanceUsed:assisted});
function insertBeforeAnswer(input,text){const result=structuredClone(input),at=result.conversation.findLastIndex(t=>t.role==='user'&&t.content===result.answer);if(at<0)throw Error('Missing submitted answer');result.conversation.splice(at,0,{role:'assistant',content:text});return result;}
const hint=insertBeforeAnswer(w,'For this exact equation 5w - 10 = 20, start by adding 10 to both sides to undo the subtracted constant.');
const renamed=structuredClone(hint);renamed.question.id='a8757f1b-13a7-42d9-bab2-cab6b6962cb1';
const unrelated={...structuredClone(w),conversation:[{role:'assistant',content:'For the earlier problem 2x + 3 = 11, subtract 3 from both sides to get 2x = 8, then divide both sides by 2 to get x = 4. Equal operations preserve equality.'},{role:'user',content:'Let me try a different equation.'},{role:'assistant',content:w.question.question},{role:'user',content:w.answer}]};
const worked={...structuredClone(w),conversation:[{role:'assistant',content:`Here is the worked solution to this exact problem: ${w.question.answer}`},{role:'user',content:'Please repeat just the question.'},{role:'assistant',content:w.question.question},{role:'user',content:w.answer}]};
const cases=[
 {id:'before-neutral-w',instructionVersion:'before',input:w,expected:expected(false),rationale:'Exact captured w input: earlier canonical ask, skip, later restatement and unsolved equation only; no w solution/hint.'},
 {id:'before-neutral-y',instructionVersion:'before',input:y,expected:expected(false),rationale:'Exact captured y first-answer input after a skipped question is restated; no prior y solution/hint.'},
 {id:'after-neutral-w',instructionVersion:'after',input:structuredClone(w),expected:expected(false),rationale:'Same w request input; only grading instruction changes.'},
 {id:'after-neutral-y',instructionVersion:'after',input:structuredClone(y),expected:expected(false),rationale:'Same y request input; only grading instruction changes.'},
 {id:'after-same-id-hint',instructionVersion:'after',input:hint,expected:expected(true),rationale:'A concrete first-operation hint for the exact target counts as assistance.'},
 {id:'after-renamed-target-hint',instructionVersion:'after',input:renamed,expected:expected(true),rationale:'The same target and prior concrete hint retain assistance despite a changed question ID.'},
 {id:'after-unrelated-teaching',instructionVersion:'after',input:unrelated,expected:expected(false),rationale:'Teaching a different equation does not itself mean help was supplied for this independent target.'},
 {id:'after-worked-then-restated',instructionVersion:'after',input:worked,expected:expected(true),rationale:'Repeating the question never erases an earlier worked solution to that same target.'},
];
await writeFile(output,JSON.stringify({createdAt:new Date().toISOString(),method:'Eight predeclared independent grading pairs at low effort; exact captured final w/y inputs repeated with original then clarified instructions, followed by same-target hint, renamed-target hint, unrelated teaching, and worked-then-restated controls. No score writes.',source:path,sourceSha256:sha(raw),beforeInstructions,beforeInstructionSha256:sha(beforeInstructions),beforeMasterySha256:sha(await readFile('server/mastery.mjs')),cases},null,2)+'\n');
console.log(JSON.stringify({output,cases:cases.length,beforeInstructionSha256:sha(beforeInstructions)}));
