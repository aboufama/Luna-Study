import test from 'node:test';
import {buildGradeCitations} from '../server/grade-citations.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMasteryEvent, emptyTestMastery, publicMastery, masteryScopeContext, questionKey, createMasteryStore, validateGrade, checkedGrade } from '../server/mastery.mjs';

const testId = '18e2ced5-fab7-4b23-ae07-abc99c94a110';
let sequence = 0;
function event(overrides = {}) {
  const n = ++sequence;
  const value = { id: `event-${n}`, questionId: `question-${n}`, questionKey: questionKey({ topicId: 'transport', question: `Explain transport scenario ${n}?` }), attempt: 1, topicId: 'transport', topicTitle: 'Transport', difficulty: 'hard', verdict: 'correct', firstAttempt: true, unassisted: true, checked: true, ...overrides };
  return value;
}

test('three distinct hard, first-attempt, unassisted correct questions alone unlock mastery', () => {
  const state = emptyTestMastery();
  for (const score of [30, 60]) { const result = applyMasteryEvent(state, event()); assert.equal(result.mastery.overall, score); assert.equal(result.topicMastered, null); }
  const mastered = applyMasteryEvent(state, event());
  assert.equal(mastered.mastery.overall, 100);
  assert.deepEqual(mastered.topicMastered, { id: 'transport', title: 'Transport' });
  const later = applyMasteryEvent(state, event());
  assert.equal(later.topicMastered, null);
  assert.equal(later.mastery.topics[0].mastered, true);
});

test('easy and medium success are fixed increments and cannot bypass the90 cap', () => {
  const state = emptyTestMastery();
  assert.equal(applyMasteryEvent(state, event({ difficulty: 'easy' })).mastery.overall, 10);
  assert.equal(applyMasteryEvent(state, event({ difficulty: 'medium' })).mastery.overall, 30);
  for (let i = 0; i < 10; i++) applyMasteryEvent(state, event({ difficulty: 'medium' }));
  assert.equal(publicMastery(state).overall, 90);
  assert.equal(publicMastery(state).topics[0].mastered, false);
  assert.equal(applyMasteryEvent(state, event({ verdict: 'incorrect' })).mastery.overall, 85);
  assert.equal(applyMasteryEvent(state, event({ verdict: 'partial' })).mastery.overall, 88);
});

test('help, retries, repeated wording, and reused IDs cannot manufacture hard wins', () => {
  const state = emptyTestMastery();
  for (let i = 0; i < 4; i++) applyMasteryEvent(state, event({ unassisted: false }));
  for (let i = 0; i < 4; i++) applyMasteryEvent(state, event({ attempt: 2, firstAttempt: false }));
  const repeated = event(); applyMasteryEvent(state, repeated);
  applyMasteryEvent(state, event({ questionKey: repeated.questionKey }));
  applyMasteryEvent(state, event({ questionId: repeated.questionId, attempt: 2, firstAttempt: true }));
  assert.equal(state.topics.transport.hardWins.length, 1);
  assert.equal(publicMastery(state).overall, 90);
  assert.equal(publicMastery(state).topics[0].mastered, false);
});

test('event and attempt deduplication preserve score; unchecked and unclear updates are rejected', () => {
  const state = emptyTestMastery(), first = event({ difficulty: 'easy' });
  applyMasteryEvent(state, first);
  assert.equal(applyMasteryEvent(state, first).applied, false);
  assert.equal(applyMasteryEvent(state, { ...first, id: 'duplicate-attempt' }).applied, false);
  assert.equal(publicMastery(state).overall, 10);
  assert.throws(() => applyMasteryEvent(state, event({ checked: false })), /Invalid/);
  assert.throws(() => applyMasteryEvent(state, event({ verdict: 'unclear' })), /Invalid/);
  const low = emptyTestMastery();
  assert.equal(applyMasteryEvent(low, event({ verdict: 'incorrect' })).mastery.overall, 0);
});

test('overall mastery uses all active topics, including topics with no answers yet', () => {
  const state = emptyTestMastery();
  state.activeTopics = [{ id: 'transport', title: 'Transport' }, { id: 'enzymes', title: 'Enzymes' }];
  applyMasteryEvent(state, event({ difficulty: 'easy' }));
  assert.equal(publicMastery(state).overall, 5);
  applyMasteryEvent(state, event({ topicId: 'enzymes', topicTitle: 'Enzymes', difficulty: 'medium' }));
  assert.equal(publicMastery(state).overall, 15);
});
test('course scope uses nonempty current mastered topics, never a rounded overall score or an old source revision', () => {
  const mastered = { id: 'transport', title: 'Transport', score: 100, mastered: true };
  assert.deepEqual(masteryScopeContext({ overall: 100, topics: [mastered] }), { basis: 'current-indexed-topics', courseCoverage: 'unverified', allCurrentTopicsMastered: true });
  for (const topics of [[], [{ ...mastered, score: 90 }], [{ ...mastered, mastered: false }], [mastered, { id: 'enzymes', score: 99, mastered: false }]]) {
    assert.equal(masteryScopeContext({ overall: 100, topics }).allCurrentTopicsMastered, false);
  }
  const progress = { overall: 100, topics: [mastered] };
  assert.equal(masteryScopeContext(progress, [{ id: 'new-source-topic' }]).allCurrentTopicsMastered, false);
  assert.equal(masteryScopeContext(progress, []).allCurrentTopicsMastered, false);
  assert.equal(masteryScopeContext(progress, [{ id: 'transport' }]).allCurrentTopicsMastered, true);
  assert.equal(progress.topics[0].mastered, true, 'scope review never changes earned topic mastery');
});

test('atomic persistence retains scores, deduplication, first attempts and one-time notices across restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'luna-mastery-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'data', 'mastery.json'), store = createMasteryStore({ path, shared: false });
  await store.setTopics(testId, [{ id: 'transport', title: 'Transport' }]);
  const first = event();
  assert.equal((await store.reserveAttempt(testId, { questionId: first.questionId, questionKey: first.questionKey, attempt: 1 })).firstAttempt, true);
  await store.record(testId, first);
  await Promise.all([store.record(testId, event()), store.record(testId, event())]);
  const reopened = createMasteryStore({ path, shared: false });
  assert.equal((await reopened.load(testId)).overall, 100);
  assert.equal((await reopened.record(testId, first)).applied, false);
  assert.equal((await reopened.reserveAttempt(testId, { questionId: 'different-id', questionKey: first.questionKey, attempt: 1 })).firstAttempt, false);
  assert.deepEqual(await reopened.pendingNotices(testId), [{ id: 'transport', title: 'Transport' }]);
  await reopened.acknowledgeNotice(testId, 'transport');
  assert.deepEqual(await reopened.pendingNotices(testId), []);
  const disk = await readFile(path, 'utf8');
  assert.equal(disk.includes('studentAnswer'), false);
  assert.equal(disk.includes('sourceQuotes'), false);
  assert.equal(disk.includes('referenceAnswer'), false);
});

test('a corrupt existing ledger is preserved rather than overwritten', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'luna-mastery-corrupt-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'mastery.json'); await writeFile(path, 'not JSON');
  const store = createMasteryStore({ path, shared: false });
  await assert.rejects(store.record(testId, event()));
  assert.equal(await readFile(path, 'utf8'), 'not JSON');
});

const question = { id: 'question-one', topicId: 'transport', topicTitle: 'Transport', difficulty: 'hard', question: 'Why can active transport oppose a gradient?', answer: 'It uses energy.', sourceIds: ['notes'] };
const answer = 'Active transport uses energy to move against the gradient.';
const materials = [{ id: 'notes', name: 'Notes', text: 'Active transport uses energy to move against a concentration gradient.' }];
const grade = () => ({ questionId: question.id, topicId: question.topicId, sourceIds: ['notes'], verdict: 'correct', reasoningSufficient: true, assistanceUsed: false, answerQuotes: ['uses energy to move against the gradient'], sourceQuotes: [{ sourceId: 'notes', quote: 'uses energy to move against a concentration gradient' }] });
const citationGrade=(input,patch={})=>{const{answerQuotes,sourceQuotes,...metadata}=grade();return{...metadata,assistanceCitationIds:[],answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:input.materials.map(source=>source.excerpts[0].id),...patch};};

test('grade validation binds question, topic, sources, and exact quoted answer/source evidence', () => {
  assert.ok(validateGrade(grade(), question, answer, materials));
  for (const patch of [{ questionId: 'wrong' }, { topicId: 'wrong' }, { sourceIds: ['other'] }, { answerQuotes: ['an invented answer'] }, { sourceQuotes: [{ sourceId: 'notes', quote: 'invented source evidence' }] }, { reasoningSufficient: false }, { verdict: 'unclear' }]) assert.equal(validateGrade({ ...grade(), ...patch }, question, answer, materials), null);
});

test('two independent agreeing checks are required; disagreement or invalid evidence yields no score', async () => {
  const calls = [];
  const organizer = { async organize(input) { calls.push(structuredClone(input)); return citationGrade(input); } };
  assert.deepEqual(await checkedGrade({ organizer, question, answer, materials }), { verdict: 'correct', unassisted: true, checked: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(Object.hasOwn(calls[1], 'previousVerdict'), false);
  let n = 0;
  assert.equal(await checkedGrade({ organizer: { async organize(input) { return citationGrade(input, ++n === 1 ? {} : {verdict:'partial'}); } }, question, answer, materials }), null);
  let invalidCalls = 0;
  assert.equal(await checkedGrade({ organizer: { async organize(input) { invalidCalls++; return citationGrade(input,{answerCitationIds:['fake']}); } }, question, answer, materials }), null);
  assert.equal(invalidCalls, 1);
});

test('mastery identities preserve mathematical distinctions and harmless formatting', () => {
  const key = question => questionKey({ topicId: 'algebra', question });
  for (const [left, right] of [
    ['If x + 2 = 5, what is x?', 'If x - 2 = 5, what is x?'],
    ['What is x²?', 'What is x2?'],
    ['What is H₂?', 'What is H2?'],
    ['What is (x + 2) * 5?', 'What is x + 2 * 5?'],
    ['What is 1.5?', 'What is 1 5?'],
    ['What is 3!?', 'What is 3?'],
  ]) assert.notEqual(key(left), key(right), `${left} must remain distinct from ${right}`);
  assert.equal(key('What is ATP?'), key('  WHAT  IS ATP？  '));
  assert.equal(key('If x − 2 = 5, what is x?'), key('If x-2=5, what is x?'));
  assert.equal(key('What is café?'), key('What is cafe\u0301?'));

  const state = emptyTestMastery();
  for (const operator of ['+', '-', '*']) applyMasteryEvent(state, event({ questionKey: key(`If x ${operator} 2 = 5, what is x?`) }));
  assert.equal(publicMastery(state).overall, 100, 'distinct mathematical problems retain distinct hard wins');
});

test('PDF whitespace may vary in evidence quotes but words, numbers, signs and source membership remain exact',()=>{
  const pdf=[{...materials[0],text:'Active transport uses energy\n to move   against a concentration gradient.'}];
  assert.ok(validateGrade(grade(),question,answer,pdf));
  for(const quote of ['uses NO energy to move against a concentration gradient','uses energy to move WITH a concentration gradient','USES energy to move against a concentration gradient'])assert.equal(validateGrade({...grade(),sourceQuotes:[{sourceId:'notes',quote}]},question,answer,pdf),null);
  assert.equal(validateGrade({...grade(),sourceIds:['notes','notes']},question,answer,pdf),null);
  for(const [source,quote] of [['x - 2 = 5','x + 2 = 5'],['(1, 6, 1)','(1, 8, 1)'],['x²','x2']])assert.equal(validateGrade({...grade(),sourceQuotes:[{sourceId:'notes',quote}]},question,answer,[{...materials[0],text:source}]),null);
});

test('grading diagnostics explain rejection without quotes, answers, or hidden reasoning',async()=>{
  const decisions=[];
  assert.equal(await checkedGrade({organizer:{organize:async input=>citationGrade(input,{sourceCitationIds:['unknown-source']})},question,answer,materials,onDecision:value=>decisions.push(value)}),null);
  assert.deepEqual(decisions,[{reason:'source-citation-mismatch',stage:'first-check'}]);
  assert.deepEqual(await checkedGrade({organizer:{organize:async input=>citationGrade(input)},question,answer,materials,onDecision(){throw Error('observer');}}),{verdict:'correct',unassisted:true,checked:true});
});

test('both grader requests constrain question/topic/source identity without mutating the shared schema',async()=>{
  const schemas=[];
  await checkedGrade({organizer:{async organize(input,options){schemas.push(options.schema);return citationGrade(input);}},question,answer,materials});
  assert.equal(schemas.length,2);
  for(const schema of schemas){
    assert.deepEqual(schema.properties.questionId.enum,[question.id]);assert.deepEqual(schema.properties.topicId.enum,[question.topicId]);
    assert.deepEqual(schema.properties.sourceIds.items.enum,question.sourceIds);assert.equal(schema.properties.sourceIds.minItems,question.sourceIds.length);assert.equal(schema.properties.sourceIds.maxItems,question.sourceIds.length);
    assert.deepEqual(schema.properties.sourceCitationIds.items.enum,buildGradeCitations(question,answer,materials).materials.flatMap(source=>source.excerpts.map(item=>item.id)));
    assert.deepEqual(schema.properties.answerCitationIds.items.enum,buildGradeCitations(question,answer,materials).answerExcerpts.map(item=>item.id));
    assert.equal(schema.properties.sourceQuotes,undefined);
  }
  const {GRADE_SCHEMA}=await import('../server/mastery.mjs');assert.equal(GRADE_SCHEMA.properties.questionId.enum,undefined);
});
