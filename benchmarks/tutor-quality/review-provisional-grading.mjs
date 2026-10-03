// Read-only production review. Synthetic inputs, temporary store, no provider calls.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkedGrade, createMasteryStore, questionKey } from '../../server/mastery.mjs';
const dir=fileURLToPath(new URL('.',import.meta.url));
const root=fileURLToPath(new URL('../../',import.meta.url));
const testId='18e2ced5-fab7-4b23-ae07-abc99c94a110';
const question={id:'q',topicId:'topic',topicTitle:'Algebra',difficulty:'hard',question:'Solve 2x + 3 = 11 and explain why?',answer:'x = 4',sourceIds:['source']};
const key=questionKey(question),cases=[];
for(const [id,outputs,expected] of [
  ['target-agrees-grade-disagrees',[{targetAttempt:true,verdict:'correct'},{targetAttempt:true,verdict:'incorrect'}],{checked:false,targetAttempt:true}],
  ['target-agrees-grade-unclear',[{targetAttempt:true,verdict:'unclear'},{targetAttempt:true,verdict:'unclear'}],{checked:false,targetAttempt:true}],
  ['scaffold-rejected-by-both',[{targetAttempt:false,verdict:'unclear'},{targetAttempt:false,verdict:'unclear'}],{checked:false,targetAttempt:false}],
  ['target-judgments-disagree',[{targetAttempt:true,verdict:'correct'},{targetAttempt:false,verdict:'unclear'}],null],
  ['target-identity-unknown',[{targetAttempt:null,verdict:'unclear'},{targetAttempt:true,verdict:'correct'}],null],
  ['contradictory-nonattempt-correct',[{targetAttempt:false,verdict:'correct'}],null],
  ['foreign-source-citation',[{targetAttempt:true,verdict:'correct',sourceCitationIds:['foreign-id']}],null],
  ['missing-target-judgment',[{verdict:'correct'}],null],
]){
  let requests=0;
  const organizer={organize:async input=>({questionId:question.id,topicId:question.topicId,sourceIds:question.sourceIds,reasoningSufficient:true,assistanceUsed:false,assistanceCitationIds:[],answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:[input.materials[0].excerpts[0].id],...outputs[requests++]})};
  const actual=await checkedGrade({organizer,question,answer:'x = 4 because subtracting 3 gives 2x = 8 and dividing by 2 gives 4.',materials:[{id:'source',text:'Equal operations preserve equality. Subtract 3 from both sides of 2x + 3 = 11, then divide both sides by 2.'}],attemptContext:{provisional:true,latestPromptIsCanonical:false,previousAssistant:'What would you try first?'}});
  assert.deepEqual(actual,expected,id);cases.push({id,passed:true,organizerDoubleCalls:requests,expected,actual});
}
const directory=await mkdtemp(join(tmpdir(),'luna-independent-review-'));
try{
  const path=join(directory,'mastery.json');let store=createMasteryStore({path,shared:false});
  await store.beginCandidate(testId,{id:'scaffold',questionId:'q',questionKey:key,provisional:true});
  await store.beginCandidate(testId,{id:'real',questionId:'q',questionKey:key,provisional:false});
  await store.resolveCandidate(testId,{id:'scaffold',targetAttempt:false});
  const first=await store.resolveCandidate(testId,{id:'real',targetAttempt:true});assert.deepEqual(first,{targetAttempt:true,attempt:1,firstAttempt:true});
  cases.push({id:'dismissed-scaffold-does-not-consume-first-attempt',passed:true,actual:first});
  const key2=questionKey({...question,question:'Another equation?'});
  await store.beginCandidate(testId,{id:'unknown',questionId:'q2',questionKey:key2,provisional:true});await store.flush();
  store=createMasteryStore({path,shared:false});
  await store.beginCandidate(testId,{id:'later',questionId:'new-q2',questionKey:key2,provisional:false});
  const later=await store.resolveCandidate(testId,{id:'later',targetAttempt:true});assert.deepEqual(later,{targetAttempt:true,attempt:1,firstAttempt:false});
  cases.push({id:'unresolved-key-survives-reopen-and-blocks-false-firstness',passed:true,actual:later});
  await store.beginCandidate(testId,{id:'canceled',questionId:'q3',questionKey:key2,provisional:true});
  assert.equal(await store.resolveCandidate(testId,{id:'canceled',targetAttempt:false},{isCurrent:()=>false}),null);
  assert.ok(JSON.parse(await readFile(path)).tests[testId].pendingCandidates.canceled);
  cases.push({id:'canceled-resolution-retains-pending-marker',passed:true});
  const event={id:'canceled-event',questionId:'q3',questionKey:key2,topicId:'topic',topicTitle:'Algebra',difficulty:'hard',verdict:'correct',attempt:1,firstAttempt:true,unassisted:true,checked:true};
  assert.equal((await store.record(testId,event,{isCurrent:()=>false})).applied,false);
  assert.equal(JSON.parse(await readFile(path)).tests[testId].events['canceled-event'],undefined);
  cases.push({id:'canceled-store-record-does-not-score',passed:true});
}finally{await rm(directory,{recursive:true,force:true});}
const files=['server/mastery.mjs','server/live-voice.mjs','server/grade-citations.mjs','server/jev-intent.mjs','benchmarks/tutor-quality/review-provisional-grading.mjs'];
const codeHashes=Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(join(root,path))).digest('hex')])));
const report={finishedAt:new Date().toISOString(),reviewer:'independent relevance_design agent',method:'Read-only production audit plus deterministic synthetic organizer responses and temporary persistence. No model inference, live speech, user history, or existing store writes.',command:'node benchmarks/tutor-quality/review-provisional-grading.mjs',workingDirectory:root,providerCalls:0,productionEdits:0,codeHashes,cases,counts:{passed:cases.length,total:cases.length},manualReview:['Jev thresholds remain 0.80 for canonical prompts and 0.90 for target attempts after scaffolds. Only a finite Jev abstention-band probability enters provisional review; outages, explicit no, clear help/setup and deadlines do not.','Every job snapshots question identity, original materials, public conversation, source epoch and assistance before its feedback. The grader schema fixes question/topic/source IDs and resolves immutable citation IDs.','Confirmed and provisional jobs enter one FIFO. Valid agreed target recognition allocates an attempt even when no grade can be agreed. Valid agreed non-attempts remove only their own pending marker.','Source changes and cleanup abort active review. Store guards run inside the serial queue and before atomic rename; committed historical results are not rolled back. Hint results remain scoped to the old question identity when the current question changes.'],limits:['These 12 checks do not replace WebSocket integration tests or live-provider teaching evaluation. Assistance timing and loopback source-change races require the separate integration suite.','An unresolved candidate conservatively suppresses later first-attempt eligibility for that same question key across reconnect; it adds no attempt or score itself. There is no automatic reconciliation of permanently unresolved markers.','At 1,024 unresolved markers per test, a persistent overflow hold blocks additional registrations and first-attempt qualification rather than evicting uncertainty. This exceptional fallback is broader than the ordinary per-key hold.','The atomic rename invocation is the persistence commit boundary. Cancellation after commit does not undo a previously committed score.','This audit records exact code hashes. Re-run if relevant implementation changes.']};
await writeFile(join(dir,'provisional-grading-review.json'),JSON.stringify(report,null,2)+'\n');
const md='# Independent provisional-grading review\n\n'+`**${cases.length}/${cases.length} deterministic checks passed.** This review made zero provider calls and changed no production files. It used a fake organizer and a disposable store.\n\nReproduce from the project root:\n\n\`\`\`sh\n${report.command}\n\`\`\`\n\n`+'The companion JSON records SHA-256 hashes of all reviewed code, every assertion outcome and the review timestamp.\n\n## Checked outcomes\n\n'+cases.map(c=>'- '+c.id.replaceAll('-',' ')+'.').join('\n')+'\n\n## Integration reviewed\n\n'+report.manualReview.map(x=>'- '+x).join('\n')+'\n\n## Limits\n\n'+report.limits.map(x=>'- '+x).join('\n')+'\n';
await writeFile(join(dir,'provisional-grading-review.md'),md);
console.log(JSON.stringify({passed:cases.length,total:cases.length,providerCalls:0,report:'benchmarks/tutor-quality/provisional-grading-review.json'}));
