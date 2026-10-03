import test from 'node:test';
import assert from 'node:assert/strict';
import { createJevIntentRouter } from '../server/jev-intent.mjs';
import { createUsageLedger } from '../server/usage-ledger.mjs';

const env = { TYPESAFE_API_KEY: 'intent-test-secret' };
const answers = (help = .01, attempt = .99, deadline = .01) => ({ answers: {
  requests_help: { type: 'noul', noul: help },
  answer_attempt: { type: 'noul', noul: attempt },
  exam_deadline: { type: 'noul', noul: deadline },
} });
const response = body => ({ ok: true, json: async () => body });
const decisions = value => ({ requestsHelp: value.requestsHelp, answerAttempt: value.answerAttempt, examDeadline: value.examDeadline });
const unknown = { requestsHelp: null, answerAttempt: null, examDeadline: null };

test('intent usage keeps the resolved provider model and ignores empty or unsafe metadata', async () => {
  const updates = [];
  for (const model of ['jev-2026-10', '', 'unsafe\nmetadata']) {
    const router = createJevIntentRouter({ env, usageLedger: { start() { return { update: value => updates.push(value), finish() {} }; } }, fetchImpl: async () => response({ ...answers(), model, usage: { input_tokens: 3 }, secret: 'never-forward' }) });
    await router.classify('That is my answer.', {}, { testId: 'mock' });
  }
  assert.deepEqual(updates, [{ units: { inputTokens: 3 }, model: 'jev-2026-10' }, { units: { inputTokens: 3 } }, { units: { inputTokens: 3 } }]);
});

test('student intent uses the official typed endpoint and only bounded public context', async () => {
  let sent;
  const router = createJevIntentRouter({ env: { TYPESAFE_API_KEY: ' intent-test-secret ', TYPESAFE_MODEL: ' jev-custom ' }, fetchImpl: async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) }; return response(answers());
  } });
  const conversation = [
    { role: 'system', content: 'PRIVATE_SYSTEM' },
    { role: 'tool', content: 'PRIVATE_TOOL' },
    ...Array.from({ length: 9 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `${index}: ${'a'.repeat(2000)}`, referenceAnswer: 'PRIVATE_TURN_ANSWER' })),
    { role: 'tool', content: 'PRIVATE_LAST_TOOL' },
    { role: 'user', content: null },
  ];
  const result = await router.classify(`  ${'u'.repeat(4100)}  `, {
    previousAssistant: 'q'.repeat(2000), activeQuestion: 'a'.repeat(500), examDate: '2026-10-08-extra', conversation,
    materials: [{ text: 'PRIVATE_SOURCE' }], privateQuestionBank: [{ answer: 'PRIVATE_BANK_ANSWER' }],
    masteryContext: { private: 'PRIVATE_MASTERY' }, referenceAnswer: 'PRIVATE_REFERENCE_ANSWER',
  });
  assert.equal(sent.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(sent.options.method, 'POST'); assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.headers.Authorization, 'Bearer intent-test-secret');
  assert.equal(sent.options.headers['Content-Type'], 'application/json');
  assert.ok(sent.options.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(sent.body).sort(), ['model', 'questions', 'state']);
  assert.equal(sent.body.model, 'jev-custom');
  assert.deepEqual(Object.keys(sent.body.questions).sort(), ['answer_attempt', 'exam_deadline', 'requests_help', 'setup_clarification']);
  for (const question of Object.values(sent.body.questions)) {
    assert.equal(question.type, 'noul');
    assert.deepEqual(Object.keys(question).sort(), ['criteria', 'instructions', 'type']);
    assert.deepEqual(Object.keys(question.criteria).sort(), ['false', 'true']);
    assert.ok(question.instructions.length > 0);
    assert.ok(Object.values(question.criteria).every(value => typeof value === 'string' && value.length));
  }
  assert.deepEqual(Object.keys(sent.body.state).sort(), ['active_question', 'conversation', 'exam_date', 'previous_assistant', 'student_utterance']);
  assert.equal(sent.body.state.student_utterance.length, 4000);
  assert.equal(sent.body.state.previous_assistant.length, 1800);
  assert.equal(sent.body.state.active_question.length, 400);
  assert.equal(sent.body.state.exam_date, '2026-10-08');
  assert.equal(sent.body.state.conversation.length, 6);
  assert.ok(sent.body.state.conversation[0].content.startsWith('3: '));
  assert.ok(sent.body.state.conversation.every(turn => turn.content.length === 1800 && Object.keys(turn).sort().join(',') === 'content,role'));
  assert.equal(JSON.stringify(sent.body).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(sent.body).includes('intent-test-secret'), false);
  assert.equal(result.source, 'jev');
});

test('semantic decisions override misleading assistance and date words without lexical fallbacks', async () => {
  const cases = [
    ['Membrane proteins help transport substances.', [.01, .99, .01], { requestsHelp: false, answerAttempt: true, examDeadline: false }],
    ['The theory can explain why gases expand.', [.01, .99, .01], { requestsHelp: false, answerAttempt: true, examDeadline: false }],
    ['October 31.', [.01, .99, .01], { requestsHelp: false, answerAttempt: true, examDeadline: false }],
    ['Could I get a nudge?', [.99, .01, .01], { requestsHelp: true, answerAttempt: false, examDeadline: false }],
    ['It is eight days from now.', [.01, .01, .99], { requestsHelp: false, answerAttempt: false, examDeadline: true }],
    ['Yes, thanks.', [.01, .01, .01], { requestsHelp: false, answerAttempt: false, examDeadline: false }],
    ['I think it is seven, but could you walk me through it?', [.99, .99, .01], { requestsHelp: true, answerAttempt: true, examDeadline: false }],
  ];
  for (const [utterance, probabilities, expected] of cases) {
    let calls = 0;
    const router = createJevIntentRouter({ env, fetchImpl: async () => { calls++; return response(answers(...probabilities)); } });
    assert.deepEqual(decisions(await router.classify(utterance, { previousAssistant: 'What date is Halloween?', activeQuestion: 'A public academic question?' })), expected, utterance);
    assert.equal(calls, 1);
  }
});

test('uncertain and malformed per-dimension outputs remain unknown rather than infer intent', async () => {
  for (const value of [null, undefined, {}, { type: 'choice', noul: 1 }, { type: 'noul', noul: '1' }, { type: 'noul', noul: true },
    ...[NaN, Infinity, -Infinity, -.01, 1.01, .21, .5, .79].map(noul => ({ type: 'noul', noul }))]) {
    const router = createJevIntentRouter({ env, fetchImpl: async () => response({ answers: { requests_help: value, answer_attempt: value, exam_deadline: value } }) });
    assert.deepEqual(decisions(await router.classify('Help me. My exam is tomorrow. Explain the answer.')), unknown);
  }
  for (const body of [undefined, null, {}, { answers: null }, { answers: [] }, { answers: { other: { type: 'noul', noul: 1 } } }]) {
    assert.deepEqual(decisions(await createJevIntentRouter({ env, fetchImpl: async () => response(body) }).classify('Help. Exam tomorrow.')), unknown);
  }
  const mixed = createJevIntentRouter({ env, fetchImpl: async () => response(answers(.8, .2, .5)) });
  assert.deepEqual(decisions(await mixed.classify('A contextual utterance.')), { requestsHelp: true, answerAttempt: false, examDeadline: null });
});

test('missing credentials and already canceled work avoid all requests and accounting', async () => {
  let calls = 0, starts = 0;
  const options = { fetchImpl: async () => { calls++; throw Error('Unexpected fetch'); }, usageLedger: { start() { starts++; } } };
  for (const missingEnv of [{}, { TYPESAFE_API_KEY: '' }, { TYPESAFE_API_KEY: '   ' }]) {
    const result = await createJevIntentRouter({ ...options, env: missingEnv }).classify('Help. My test is tomorrow.');
    assert.deepEqual(decisions(result), unknown); assert.equal(result.reason, 'missing-key');
  }
  const controller = new AbortController(); controller.abort();
  const canceled = await createJevIntentRouter({ ...options, env }).classify('An answer.', {}, { signal: controller.signal });
  assert.deepEqual(decisions(canceled), unknown); assert.equal(canceled.reason, 'canceled');
  assert.equal(calls, 0); assert.equal(starts, 0);
});

test('network, HTTP and body failures return unknown without retrying or exposing provider errors', async () => {
  for (const implementation of [
    async () => { throw Error('PRIVATE_ERROR'); },
    async () => ({ ok: false, status: 429, json: async () => { throw Error('Should not read error body'); } }),
    async () => ({ ok: true, json: async () => { throw Error('PRIVATE_BODY_ERROR'); } }),
  ]) {
    let calls = 0;
    const router = createJevIntentRouter({ env, fetchImpl: (...args) => { calls++; return implementation(...args); } });
    const result = await router.classify('Please help. My test is tomorrow.');
    assert.deepEqual(decisions(result), unknown); assert.equal(result.source, 'unavailable'); assert.equal(result.reason, 'unavailable');
    assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(result).includes('intent-test-secret'), false);
  }
});

test('one deadline bounds stalled headers and complete body reads and aborts the request', async () => {
  for (const slowBody of [false, true]) {
    let signal, calls = 0;
    const router = createJevIntentRouter({ env, timeoutMs: 10, fetchImpl: async (_, options) => {
      calls++; signal = options.signal;
      return slowBody ? { ok: true, json: () => new Promise(() => {}) } : new Promise(() => {});
    } });
    const started = performance.now(), result = await router.classify('Help. My test is tomorrow.');
    assert.deepEqual(decisions(result), unknown); assert.equal(result.reason, 'timeout'); assert.equal(signal.aborted, true);
    assert.equal(calls, 1); assert.ok(performance.now() - started < 1000);
  }
});

test('external cancellation aborts both response stages and ignores late semantic results', async () => {
  for (const bodyStarted of [false, true]) {
    let signal, release;
    const controller = new AbortController();
    const router = createJevIntentRouter({ env, timeoutMs: 1000, fetchImpl: async (_, options) => {
      signal = options.signal;
      if (!bodyStarted) return new Promise(resolve => { release = () => resolve(response(answers(1, 1, 1))); });
      return { ok: true, json: () => new Promise(resolve => { release = () => resolve(answers(1, 1, 1)); }) };
    } });
    const pending = router.classify('My exam is tomorrow.', {}, { signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve)); controller.abort();
    const result = await pending;
    assert.deepEqual(decisions(result), unknown); assert.equal(result.reason, 'canceled'); assert.equal(signal.aborted, true);
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(decisions(result), unknown, 'late provider success cannot replace a canceled decision');
  }
});

test('cancellation during request setup is observed even before the listener is installed', async () => {
  const controller = new AbortController(); let downstreamSignal;
  const router = createJevIntentRouter({ env, fetchImpl: async (_, options) => {
    downstreamSignal = options.signal; controller.abort(); return new Promise(() => {});
  } });
  const result = await router.classify('An answer.', {}, { signal: controller.signal });
  assert.equal(result.reason, 'canceled'); assert.deepEqual(decisions(result), unknown); assert.equal(downstreamSignal.aborted, true);
});

test('usage accounting records actual attempts and returned tokens even for unknown decisions', async t => {
  const ledger = createUsageLedger({ file: null }); t.after(() => ledger.close());
  const success = createJevIntentRouter({ env, usageLedger: ledger, fetchImpl: async () => response({ ...answers(), usage: { input_tokens: 22, output_tokens: 8 } }) });
  await success.classify('Five.', {}, { testId: 'test-a' });
  const malformed = createJevIntentRouter({ env, usageLedger: ledger, fetchImpl: async () => response({ answers: {}, usage: { input_tokens: 10, output_tokens: 4 } }) });
  assert.deepEqual(decisions(await malformed.classify('Help.', {}, { testId: 'test-a' })), unknown);
  const unavailable = createJevIntentRouter({ env, usageLedger: ledger, fetchImpl: async () => { throw Error('offline'); } });
  await unavailable.classify('Help.', {}, { testId: 'test-a' });
  const snapshot = await ledger.snapshot('test-a');
  assert.equal(snapshot.totals.requests, 3); assert.deepEqual(snapshot.totals.units, { inputTokens: 32, outputTokens: 12 });
  assert.equal(snapshot.totals.exactUsd, null);
  assert.equal((await ledger.snapshot('test-b')).totals.requests, 0);
  const absent = createJevIntentRouter({ env: {}, usageLedger: ledger });
  await absent.classify('Help.', {}, { testId: 'test-a' });
  assert.equal((await ledger.snapshot('test-a')).totals.requests, 3);
});

test('accounting finishes once with the outcome of success, timeout and cancellation', async () => {
  for (const mode of ['success', 'timeout', 'canceled']) {
    const controller = new AbortController(), starts = [], finishes = [], updates = [];
    const usageLedger = { start(...args) { starts.push(args); return { update: value => updates.push(value), finish: value => finishes.push(value) }; } };
    const router = createJevIntentRouter({ env, usageLedger, timeoutMs: 10, fetchImpl: async () => {
      if (mode === 'success') return response({ ...answers(), usage: { input_tokens: 3, output_tokens: 2 } });
      return new Promise(() => {});
    } });
    const pending = router.classify('An answer.', {}, { testId: 'test-accounting', signal: controller.signal });
    if (mode === 'canceled') controller.abort();
    await pending;
    assert.deepEqual(starts, [['test-accounting', { category: 'jev', provider: 'typesafe', operation: 'student-intent', model: 'jev-latest' }]]);
    assert.deepEqual(finishes, [{ status: { success: 'completed', timeout: 'failed', canceled: 'canceled' }[mode] }]);
    assert.deepEqual(updates, mode === 'success' ? [{ units: { inputTokens: 3, outputTokens: 2 } }] : []);
  }
});

// Provider decisions are mocked here; real semantic quality is measured separately.
test('setup clarification uses conservative independent confidence and never keyword inference', async () => {
  for (const [value, expected] of [[.99,true],[.9,true],[.89,null],[.5,null],[.1,false],[0,false],['1',null],[null,null]]) {
    const body=answers(.99,.01,.01);body.answers.setup_clarification={type:'noul',noul:value};
    let requests=0;const router=createJevIntentRouter({env,fetchImpl:async()=>{requests++;return response(body);}});
    const result=await router.classify('Which problem are we doing?',{activeQuestion:'What does Q mean?'});
    assert.equal(result.setupClarification,expected);assert.equal(result.requestsHelp,true);assert.equal(requests,1);
  }
  const missing=await createJevIntentRouter({env,fetchImpl:async()=>response(answers())}).classify('Which problem?');assert.equal(missing.setupClarification,null);
});

test('a noncanonical latest prompt requires a high-confidence whole-target attempt in the same request',async()=>{
 for(const [probability,expected]of [[.99,true],[.9,true],[.89,null],[.1,false]]){
  let sent;const router=createJevIntentRouter({env,fetchImpl:async(_url,request)=>{sent=JSON.parse(request.body);return response(answers(.01,probability,.01));}});const result=await router.classify('Subtract three.',{activeQuestion:'Solve the whole equation and explain why.',latestPromptIsCanonical:false});assert.equal(result.answerAttempt,expected);assert.equal(sent.state.latest_prompt_is_canonical,false);assert.match(sent.questions.answer_attempt.instructions,/ORIGINAL target/);assert.match(sent.questions.answer_attempt.criteria.true,/wrong or incomplete/);assert.equal(result.answerAttemptProbability,probability);assert.equal(result.answerAttemptThreshold,.9);
 }
});

test('attempt and help request contracts separate target identity, completeness, practical preferences and checking submitted work',async()=>{
 const sent=[];const router=createJevIntentRouter({env,fetchImpl:async(_url,request)=>{sent.push(JSON.parse(request.body));return response(answers(.01,.95,.01));}});
 await router.classify('x = 7, is that right?',{activeQuestion:'Solve the equation and explain why.',latestPromptIsCanonical:false});
 await router.classify('I do not have a calculator.',{activeQuestion:'Solve the equation and explain why.',latestPromptIsCanonical:true});
 assert.equal(sent.length,2,'one request per student utterance');
 assert.deepEqual(Object.keys(sent[0].questions).sort(),Object.keys(sent[1].questions).sort(),'no additional classifier hop or dimension');
 const narrow=sent[0].questions.answer_attempt,canonical=sent[1].questions.answer_attempt;
 assert.notDeepEqual(narrow,canonical);
 assert.match(narrow.instructions,/never correctness or completeness/);assert.match(narrow.instructions,/x = 7 and x = 4 with no explanation both qualify/);assert.match(narrow.instructions,/Merely proposing subtract 3/);
 assert.match(canonical.instructions,/wrong, incomplete, or lack reasoning/);
 assert.match(sent[0].questions.requests_help.instructions,/no calculator/);assert.match(sent[0].questions.requests_help.instructions,/check it is feedback on an attempt/);
});
