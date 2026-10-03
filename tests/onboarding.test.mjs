import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVoiceSetup, validDate, tutorCalendar, greeting, materialAcknowledgment, parseSpokenDate, isSetupDateReply, isExamDeadlineStatement, completenessReply, isStudyReady, readinessPrompt } from '../server/onboarding.mjs';
import { validateMaterials } from '../server/api.mjs';

const base = { title: 'Biology', date: '', difficulty: 'final', localToday: '2026-10-01', materials: [], indexStatus: 'empty', topics: [] };
test('only voice setup accepts zero materials, while bounded source validation is preserved', () => {
  assert.deepEqual(validateVoiceSetup(base), base);
  assert.throws(() => validateMaterials(base), /between 1 and 100/);
  assert.throws(() => validateVoiceSetup({ ...base, title: 'x'.repeat(201) }), /200/);
  assert.throws(() => validateVoiceSetup({ ...base, difficulty: 'extreme' }), /quiz, test, or final/);
  assert.throws(() => validateVoiceSetup({ ...base, indexStatus: 'complete' }), /Indexing status/);
  assert.throws(() => validateVoiceSetup({ ...base, date: '2026-02-30' }), /valid test date/);
  assert.throws(() => validateVoiceSetup({ ...base, localToday: '10/01/2026' }), /local date/);
  assert.throws(() => validateVoiceSetup({ ...base, materials: [{ id: 'a', name: 'Blank', text: '' }] }), /readable text/);
  assert.equal(validateVoiceSetup({ date: '2026-10-15' }, base).difficulty, 'final');
});
test('greeting confirms an existing date and invites material without asking for it again', () => {
  assert.match(greeting(base), /Add your notes/);
  const ready = { ...base, date: '2026-10-15' };
  assert.match(greeting(ready), /October 15.*Add your notes/);
  assert.doesNotMatch(greeting(ready), /When is/);
  assert.match(greeting(ready), /notes, readings, or slides/);
  assert.match(materialAcknowledgment({ ...ready, materials: [{}, {}], indexStatus: 'indexing' }), /2 sources.*indexing/);
  assert.match(materialAcknowledgment(ready), /empty now/);
});
test('persisted test IDs and public indexed topics are bounded and source-bound', () => {
  const testId = '18e2ced5-fab7-4b23-ae07-abc99c94a110';
  const source = { id: 'notes', name: 'Notes', text: 'Diffusion moves particles down a concentration gradient.' };
  const topic = { title: 'Diffusion', summary: source.text, sourceIds: ['notes', 'notes'], privateQuestionBank: 'must not survive' };
  const input = { ...base, testId, materials: [source], topics: [topic] };
  assert.deepEqual(validateVoiceSetup(input).topics, [{ title: topic.title, summary: topic.summary, sourceIds: ['notes'] }]);
  for (const invalidId of ['not-a-uuid', [testId], null]) assert.throws(() => validateVoiceSetup({ ...input, testId: invalidId }), /test ID/);
  for (const topics of [[{ ...topic, sourceIds: ['removed'] }], Array(13).fill(topic), [{ ...topic, summary: 'x'.repeat(2001) }]]) assert.throws(() => validateVoiceSetup({ ...input, topics }), /indexed topics/);
});
test('readiness requires indexed sources, while the exam deadline is optional planning metadata', () => {
  const ready = { ...base, date: '2026-10-15', materials: [{}], indexStatus: 'ready' };
  assert.equal(isStudyReady(ready), true);
  assert.equal(isStudyReady({ ...ready, date: '' }), true);
  for (const patch of [{ materials: [] }, { indexStatus: 'indexing' }, { indexStatus: 'error' }, { indexStatus: 'empty' }]) assert.equal(isStudyReady({ ...ready, ...patch }), false);
  assert.equal(readinessPrompt(ready), 'What would you like to work on?');
  assert.equal(readinessPrompt({ ...ready, date: '' }), 'What would you like to work on?');
  assert.equal(greeting({ ...ready, date: '' }), 'What would you like to work on?');
  assert.match(readinessPrompt({ ...ready, indexStatus: 'error' }), /retry in Library/);
  assert.match(readinessPrompt({ ...ready, date: '', indexStatus: 'error' }), /retry in Library/);
});
test('calendar distinguishes the local session day from known and unknown exam deadlines', () => {
  const now = () => Date.parse('2026-10-02T03:30:00Z');
  assert.deepEqual(tutorCalendar(base, { now }), { today: '2026-10-01', sessionDate: '2026-10-01', examDate: null });
  assert.deepEqual(tutorCalendar({ ...base, date: '2026-10-15' }, { now }), { today: '2026-10-01', sessionDate: '2026-10-01', examDate: '2026-10-15' });
  assert.deepEqual(tutorCalendar({ ...base, localToday: '' }, { now }), { today: '2026-10-02', sessionDate: '2026-10-02', examDate: null });
  assert.deepEqual(tutorCalendar({ localToday: '2026-02-30', date: '' }, { now: new Date('2026-12-31T23:00:00-05:00') }), { today: '2027-01-01', sessionDate: '2027-01-01', examDate: null });
  assert.equal(tutorCalendar({ ...base, date: '2026-02-30' }, { now }).examDate, null);
  assert.equal(tutorCalendar(base, { now: () => { throw Error('Local day needs no server fallback'); } }).today, base.localToday);
});
test('legacy completeness helpers retain compatibility but do not change readiness prompts', () => {
  for (const phrase of ['Yes.', "Yes, that's everything!", 'I am ready', 'All set', 'Yeah, those are all the notes I have for now.', 'Sure, that should be enough', 'Okay', 'I think so', 'quiz me', 'Can we just start?', 'Explain diffusion.', 'What is diffusion?', 'Why does active transport need more energy?', "No, that's all.", "No more materials to add.", 'Yes, diffusion moves particles.']) assert.equal(completenessReply(phrase), 'confirm', phrase);
  for (const phrase of ['No', 'Not yet.', 'I have more to add', 'Yes, but wait, I still have another chapter.', "Don't start yet", 'I am not ready to study', 'I think so, but there is another chapter', 'I need more notes', 'I need to add more']) assert.equal(completenessReply(phrase), 'more', phrase);
  for (const phrase of ['Ready means prepared.', 'Hmm', '', null]) assert.equal(completenessReply(phrase), null, phrase);
  const ready = { ...base, date: '2026-10-15', materials: [{}], indexStatus: 'ready' };
  assert.equal(readinessPrompt(ready, { askCompleteness: false }), 'What would you like to work on?');
  assert.match(readinessPrompt({ ...ready, indexStatus: 'indexing' }, { askCompleteness: false }), /still indexing/);
});
test('relative dates use the supplied local calendar day, including year and leap transitions', () => {
  for (const [phrase, today, expected] of [
    ['today','2026-10-01','2026-10-01'], ['Tomorrow','2026-12-31','2027-01-01'],
    ['in two weeks','2026-10-01','2026-10-15'], ['in 3 days','2028-02-27','2028-03-01'],
    ['next Monday','2026-10-01','2026-10-05'], ['next Thursday','2026-10-01','2026-10-08'],
    ['October 15th','2026-10-01','2026-10-15'], ['Oct. 15, 2027','2026-10-01','2027-10-15'],
    ['2026-10-15','','2026-10-15'],
  ]) assert.deepEqual(parseSpokenDate(phrase, today), { date: expected, ambiguous: false }, phrase);
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
});
test('ambiguous or invalid spoken dates require clarification rather than a guess', () => {
  for (const phrase of ['tomorrow or today','not tomorrow','maybe October 15','next week','Friday','10/11','September 15','February 30','2026-02-30']) {
    assert.deepEqual(parseSpokenDate(phrase, base.localToday), { date: null, ambiguous: true }, phrase);
  }
  assert.deepEqual(parseSpokenDate('tomorrow'), { date: null, ambiguous: true });
  assert.deepEqual(parseSpokenDate('explain diffusion', base.localToday), { date: null, ambiguous: false });
});
test('source facts cannot incidentally reset the test date', () => {
  assert.equal(isSetupDateReply('Cells divide in two days.', base), false);
  assert.equal(isSetupDateReply('in two days', base), true);
  assert.equal(isSetupDateReply('my test is tomorrow', { ...base, date: '2026-10-15' }), true);
  assert.equal(isSetupDateReply('Tomorrow the cells divide.', { ...base, date: '2026-10-15' }), false);
  assert.equal(isSetupDateReply('Tomorrow the cells divide.', base), false);
  assert.equal(isSetupDateReply('No, tomorrow.', { ...base, date: '2026-10-15' }), true);
});
test('calendar and session-date questions never become exam-date updates', () => {
  for (const phrase of ["What's today's date?", 'What is today’s date?', "Today's date is October 1.", 'The current date is 2026-10-01.', 'What date is today?', 'Which day is today?', 'Is this session for today?', 'Our study session is today.', 'The session date is today.']) {
    assert.equal(isSetupDateReply(phrase, base), false, phrase);
    assert.deepEqual(parseSpokenDate(phrase, base.localToday), { date: null, ambiguous: false }, phrase);
  }
  for (const phrase of ['today', 'my test is today', 'My exam date is today.']) {
    assert.equal(isSetupDateReply(phrase, base), true, phrase);
    assert.deepEqual(parseSpokenDate(phrase, base.localToday), { date: base.localToday, ambiguous: false }, phrase);
  }
});

test('current-day discussion with final-review wording cannot overwrite an existing exam deadline', () => {
  const input = { ...base, date: '2026-10-15' };
  for (const text of [
    'Today’s date is October 1, and I want final review.',
    'The current date is 2026-10-01; let’s practice for the exam.',
    'The session date is today, before our quiz review.',
    'Today is October 1. The final review is today.',
  ]) {
    assert.equal(isExamDeadlineStatement(text), false, text);
    assert.equal(isSetupDateReply(text, input), false, text);
    assert.deepEqual(parseSpokenDate(text, input.localToday), { date: null, ambiguous: false }, text);
    const proposed = isSetupDateReply(text, input) ? parseSpokenDate(text, input.localToday).date : null;
    assert.equal(proposed || input.date, '2026-10-15');
  }
});

test('actual deadline predicates retain explicit dates despite nearby calendar language', () => {
  for (const text of [
    'My exam date is today.',
    'The final is on October 1.',
    'My quiz will be on October 1.',
    'The test is scheduled for today.',
    'I rescheduled my exam to October 1.',
    'Today’s date is October 1, and my exam is today.',
  ]) {
    assert.equal(isExamDeadlineStatement(text), true, text);
    assert.equal(isSetupDateReply(text, base), true, text);
    assert.deepEqual(parseSpokenDate(text, base.localToday), { date: '2026-10-01', ambiguous: false }, text);
  }
});

test('short dates inherit current-day context without disabling actual exam-date shorthand', () => {
  const input = { ...base, date: '2026-10-15' };
  for (const previousAssistant of [
    'What date should I use for this study session?',
    'Today is October 1. What would you like to study?',
    'It is October 1. What date would you like to use for this session?',
  ]) {
    for (const text of ['Today.', 'Yes, today.', 'October 1st.']) {
      assert.equal(isSetupDateReply(text, input, { previousAssistant }), false, `${previousAssistant} / ${text}`);
    }
    assert.equal(isSetupDateReply('My exam is tomorrow.', input, { previousAssistant }), true);
    assert.equal(isSetupDateReply('Yep.', input, { previousAssistant }), false);
  }
  for (const previousAssistant of ['When is your exam?', 'Today is October 1. What date is your final?']) {
    assert.equal(isSetupDateReply('Tomorrow.', input, { previousAssistant }), true);
    assert.equal(isSetupDateReply('October 15.', input, { previousAssistant }), true);
  }
  assert.equal(isSetupDateReply('Tomorrow.', input), true, 'existing callers retain direct shorthand');
});
