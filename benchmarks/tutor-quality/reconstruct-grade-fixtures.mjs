// Offline reconstruction from immutable synthetic session evidence. No providers.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {equations,materials as fixedMaterials} from '../tutor-quality-fixtures.mjs';
import {buildGradeCitations,resolveGradeCitations} from '../../server/grade-citations.mjs';
const root=new URL('./',import.meta.url),sourceFile='live-adaptive-repaired.session.json',raw=await readFile(new URL(sourceFile,root),'utf8'),data=JSON.parse(raw),sha=value=>createHash('sha256').update(value).digest('hex');
assert.equal(data.messages.filter(m=>m.type==='canvas').length,0);
assert.equal(data.diagnostics.filter(d=>d.type==='whiteboard.shown').length,0);
const materials=data.sources.map(({id,name,text})=>({id,name,text}));assert.deepEqual(materials,fixedMaterials);
const base={};
for(const [key,step] of [['z','independent-equation'],['w','third-equation']]){
 const grade=data.gradeResults.find(g=>g.stepId===step),asked=data.problems.find(p=>p.type==='asked'&&p.questionId===grade.questionId),fixture=equations.find(q=>q.question===asked.question);
 assert.ok(grade&&asked&&fixture);
 const question={difficulty:asked.difficulty,question:asked.question,answer:fixture.answer,sourceIds:['equation-notes'],id:asked.questionId,topicId:asked.topicId,topicTitle:asked.topicTitle};
 const end=data.messages.findIndex(m=>m.stepId===step&&m.type==='transcript'&&m.role==='user'&&m.final===true);
 const transcript=data.messages.slice(0,end+1).filter(m=>m.type==='transcript'&&m.final===true).map(m=>({role:m.role,content:m.text}));
 assert.equal(transcript.at(-1).content,grade.answer);
 const promptIndex=transcript.findLastIndex(m=>m.role==='assistant'&&m.content.includes(question.question));assert.ok(promptIndex>=0);
 const firstTargetIndex=transcript.findIndex(m=>m.role==='assistant'&&m.content.includes(question.question));assert.equal(firstTargetIndex,promptIndex,'No earlier same-target tutoring may be omitted');
 const catalog=buildGradeCitations(question,grade.answer,materials);assert.ok(catalog);
 const originals=data.requests.filter(r=>r.stepId===step&&r.kind==='grading').map(r=>r.structuredOutput);
 const providerInput={question,studentAnswer:grade.answer,answerExcerpts:catalog.answerExcerpts,materials:catalog.materials,conversation:transcript};
 originals.forEach(result=>assert.ok(resolveGradeCitations(result,providerInput),'Actual citation IDs must resolve against reconstructed source and answer'));
 base[key]={input:{question,answer:grade.answer,materials,conversation:transcript},targetScopedConversation:transcript.slice(promptIndex),originalResults:originals,checks:{exactSourceText:true,exactReferenceFromFrozenFixture:true,exactSubmission:true,originalCitationIdsResolve:true,priorSameTargetTurnsAbsent:true,conversationEntries:transcript.length},stepId:step};
}
const cases=[{id:'z-original',...base.z},{id:'z-empty',input:{...base.z.input,conversation:[]},manipulation:'Remove conversation only.'},{id:'z-target-scoped',input:{...base.z.input,conversation:base.z.targetScopedConversation},manipulation:'Keep exact first/only canonical z prompt and current submission. No earlier same-target help exists.'},{id:'w-original',...base.w},{id:'w-empty',input:{...base.w.input,conversation:[]},manipulation:'Remove conversation only.'},{id:'w-with-z-history',input:{...base.w.input,conversation:[...base.z.input.conversation.slice(0,-1),{role:'user',content:base.w.input.answer}]},manipulation:'Counterfactual deliberately retains z canonical prompt and all its prior dialogue; replaces only current user submission with w answer. This is not a coherent natural w lesson.'}];
const codeHashes={};for(const file of ['server/live-voice.mjs','server/mastery.mjs','server/grade-citations.mjs','benchmarks/tutor-quality-fixtures.mjs','benchmarks/tutor-quality/reconstruct-grade-fixtures.mjs'])codeHashes[file]=sha(await readFile(new URL('../../'+file,root)));
const result={finishedAt:new Date().toISOString(),providerCalls:0,sourceFile,sourceSha256:sha(raw),codeHashes,method:'Reconstructed checkedGrade arguments, not byte-exact captured provider requests. Question identity/difficulty/topic from actual asked record; private reference from fixed bank fixture; original materials from artifact, asserted equal to fixture. History uses ordered final transcript messages through current user submission, before its feedback. Production captureAnswer appends current user once before capture. This session has zero canvas packets and zero whiteboard.shown events, so no shown/current board evidence was added. Current answer is separately supplied as answer and also remains once at end of conversation, matching production.',limitations:['Prior requests stored input summaries, not full grading inputs; exact byte serialization and all future implementation changes cannot be reconstructed.','Empty and target-scoped histories are controlled counterfactuals, not new student outcomes.','The w-with-z-history condition changes history only, but deliberately retains an incompatible most-recent z prompt; interpret as an adversarial history-context probe, not proof of a natural causal mechanism.','Target-scoped history is safe here because z has one first canonical prompt with no earlier occurrence or help; do not generalize by dropping prior same-target assistance in other lessons.'],cases};
await writeFile(new URL('grade-replay-fixtures.json',root),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({cases:cases.map(c=>({id:c.id,history:c.input.conversation.length})),sourceSha256:result.sourceSha256}));
