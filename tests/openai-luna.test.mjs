import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIOrganizer, createOpenAILuna } from '../server/openai-luna.mjs';
import { createUsageLedger } from '../server/usage-ledger.mjs';
import { questionBatchSchema } from '../server/question-bank.mjs';
import { sessionReviewSchema } from '../server/session-history.mjs';
import { createMaterialRetrieval, MATERIAL_RETRIEVAL_TOOLS } from '../server/material-retrieval.mjs';

const env = { OPENAI_API_KEY: 'test-only-secret' };
const schema = { type: 'object', additionalProperties: false, required: ['reply'], properties: { reply: { type: 'string' } } };
const body = (text, usage = { input_tokens: 40, output_tokens: 10, input_tokens_details: { cached_tokens: 15 }, output_tokens_details: { reasoning_tokens: 3 } }) => ({ status: 'completed', usage, output: [{ type: 'reasoning', summary: [{ text: 'Private reasoning must never be shown.' }] }, { type: 'message', content: [{ type: 'output_text', text }] }] });
const complete = text => ({ type: 'response.completed', response: body(text) });
function stream(events, { chunkBytes = 29, terminated = true } = {}) {
  const data = events.map(event => `event: ${event.type || 'data'}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('');
  const bytes = new TextEncoder().encode(terminated ? data : data.trimEnd());
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += chunkBytes) controller.enqueue(bytes.slice(i, i + chunkBytes)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
const delta = text => ({ type: 'response.output_text.delta', delta: text });
const toolCall = (id, name = 'search_materials', args = { query: 'Nash', sourceIds: null, sourceRevision: 'revision' }) => ({ type: 'function_call', id: `fc-${id}`, call_id: id, name, arguments: JSON.stringify(args) });
const toolResponse = (calls, extra = {}) => ({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 40, output_tokens: 10 }, output: calls, ...extra } });
const retrievalStub = execute => ({ tools: MATERIAL_RETRIEVAL_TOOLS, execute });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('source retrieval replays encrypted reasoning and exact original passages privately, with usage per model request', async t => {
  const original = 'A Nash equilibrium is an action profile where no player can gain by changing only their own action.';
  const source = { id: 'notes', name: 'Game notes', text: original };
  const retrieval = createMaterialRetrieval({ materials: [source], env: {} });
  const revision = retrieval.snapshot().sourceRevision;
  const requests = [], spoken = [], usage = [], meters = [];
  const ledger = createUsageLedger({ file: null });
  t.after(async () => { retrieval.close(); await ledger.close(); });
  const board = { title: 'Game', blocks: [{ type: 'matrix', rows: [['', ''], ['', '']] }] };
  const full = `<say>Which player could improve by changing their action?</say><board>${JSON.stringify(board)}</board>`;
  const reason = { type: 'reasoning', id: 'rs-private', encrypted_content: 'OPAQUE-ENCRYPTED-REASONING', summary: [] };
  const luna = createOpenAILuna({ env, fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body); requests.push(request);
    const round = requests.length - 1;
    if (round === 0) {
      const call = toolCall('search-1', 'search_materials', { query: 'Nash', sourceIds: null, sourceRevision: revision });
      return stream([{ type: 'response.output_item.added', item: { ...call, arguments: '' } }, { type: 'response.function_call_arguments.delta', delta: call.arguments }, toolResponse([reason, call])]);
    }
    if (round === 1) {
      assert.deepEqual(request.input[1], reason);
      const evidence = JSON.parse(request.input.at(-1).output);
      assert.equal(evidence.passages[0].text, original);
      assert.equal(evidence.passages[0].sourceId, source.id);
      assert.equal(evidence.materials, undefined, 'each original passage appears once in tool output');
      return stream([toolResponse([toolCall('read-1', 'read_materials', { chunkIds: [evidence.passages[0].chunkId], sourceRevision: revision })], { usage: { input_tokens: 50, output_tokens: 12 } })]);
    }
    assert.deepEqual(request.tools, []); assert.equal(request.tool_choice, 'none');
    assert.equal(request.input.filter(item => item.type === 'function_call_output').length, 2);
    assert.equal(JSON.parse(request.input.at(-1).output).passages[0].text, original);
    return stream([delta(full), { type: 'response.completed', response: body(full, { input_tokens: 60, output_tokens: 14 }) }]);
  } });
  t.after(() => luna.close());
  const result = await luna.respond({ materials: [], sourceRevision: revision }, {
    retrieval: { ...retrieval, tools: MATERIAL_RETRIEVAL_TOOLS },
    onText: text => spoken.push(text), onUsage: (value, detail) => usage.push({ ...value, ...detail }),
    onRequestStart({ round }) {
      const handle = ledger.start('study', { category: 'llm', provider: 'openai', operation: 'tutor', model: 'gpt-6-luna' });
      const recorded = { round, finishes: [] }; meters.push(recorded);
      return { update: value => handle.update(value), finish: value => { recorded.finishes.push(value.status); handle.finish(value); } };
    },
  });
  assert.equal(result.reply, 'Which player could improve by changing their action?');
  assert.equal(spoken.join(''), result.reply); assert.deepEqual(result.board, board);
  assert.equal(result.timings.retrievalCalls, 2); assert.equal(result.timings.modelRequests, 3);
  assert.deepEqual(meters.map(meter => meter.finishes), [['completed'], ['completed'], ['completed']]);
  assert.deepEqual(usage.map(item => item.round), [0, 1, 2]);
  assert.ok(requests.every(request => request.store === false && request.include.includes('reasoning.encrypted_content')));
  assert.doesNotMatch(JSON.stringify({ result, spoken, usage, meters }), /OPAQUE-ENCRYPTED|Private reasoning|test-only-secret/);
  const snapshot = await ledger.snapshot('study');
  assert.equal(snapshot.totals.requests, 3); assert.equal(snapshot.totals.units.inputTokens, 150); assert.equal(snapshot.totals.units.outputTokens, 36);
  assert.deepEqual(snapshot.totals.statusCounts, { completed: 3 });
});

test('unknown, malformed and duplicate tool calls reject the entire batch before any local read', async t => {
  const valid = toolCall('one');
  for (const [name, calls] of [
    ['unknown tool', [toolCall('one', 'run_shell')]],
    ['malformed JSON', [{ ...valid, arguments: '{private broken' }]],
    ['array arguments', [{ ...valid, arguments: '[]' }]],
    ['null arguments', [{ ...valid, arguments: 'null' }]],
    ['missing call ID', [{ ...valid, call_id: '' }]],
    ['oversized arguments', [{ ...valid, arguments: 'x'.repeat(8001) }]],
    ['duplicate call IDs', [valid, { ...valid }]],
    ['valid then invalid', [valid, toolCall('two', 'write_materials')]],
    ['over budget', Array.from({ length: 6 }, (_, index) => toolCall(`c${index}`))],
  ]) await t.test(name, async () => {
    let reads = 0, requests = 0;
    const luna = createOpenAILuna({ env, fetchImpl: async () => { requests++; return stream([toolResponse(calls)]); } });
    try {
      await assert.rejects(luna.respond({}, { retrieval: retrievalStub(() => { reads++; return {}; }) }), error => error.status === 502 && !/private broken|run_shell/.test(error.message));
      assert.equal(reads, 0); assert.equal(requests, 1);
    } finally { await luna.close(); }
  });
});

test('five calls across two retrieval rounds lead to exactly one tools-disabled answer request', async () => {
  const requests = [], executed = [];
  const luna = createOpenAILuna({ env, fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const round = requests.length - 1;
    if (round < 2) return stream([toolResponse(Array.from({ length: round ? 2 : 3 }, (_, i) => toolCall(`${round}-${i}`)))]);
    return stream([delta('<say>Use the source definition.</say>'), complete('<say>Use the source definition.</say>')]);
  } });
  try {
    const result = await luna.respond({}, { retrieval: retrievalStub((name, args) => { executed.push({ name, args }); return { passages: [] }; }) });
    assert.equal(executed.length, 5); assert.equal(requests.length, 3);
    assert.deepEqual(requests.map(request => request.tools.length), [2, 2, 0]);
    assert.equal(requests[2].tool_choice, 'none'); assert.equal(result.timings.retrievalCalls, 5);
  } finally { await luna.close(); }
});

test('retrieval round and cumulative call ceilings also hold for malformed terminal-only responses', async t => {
  for (const [name, batches, expectedReads, expectedRequests] of [
    ['second batch exceeds five', [[toolCall('a'), toolCall('b'), toolCall('c')], [toolCall('d'), toolCall('e'), toolCall('f')]], 3, 2],
    ['third tool round', [[toolCall('a')], [toolCall('b')], [toolCall('c')]], 2, 3],
    ['reused ID in later round', [[toolCall('a')], [toolCall('a')]], 1, 2],
  ]) await t.test(name, async () => {
    let reads = 0, requests = 0;
    const luna = createOpenAILuna({ env, fetchImpl: async () => stream([toolResponse(batches[requests++])]) });
    try {
      await assert.rejects(luna.respond({}, { retrieval: retrievalStub(() => { reads++; return {}; }) }), error => error.status === 502);
      assert.equal(reads, expectedReads); assert.equal(requests, expectedRequests);
    } finally { await luna.close(); }
  });
});

test('a later failed request does not reclassify earlier completed model requests', async () => {
  const meters = []; let requests = 0;
  const luna = createOpenAILuna({ env, fetchImpl: async () => ++requests === 1 ? stream([toolResponse([toolCall('one')])]) : new Response('private provider error', { status: 500 }) });
  try {
    await assert.rejects(luna.respond({}, {
      retrieval: retrievalStub(() => ({ passages: [] })),
      onRequestStart() { const states = []; meters.push(states); return { update() {}, finish({ status }) { states.push(status); } }; },
    }), error => error.status === 502);
    assert.deepEqual(meters, [['completed'], ['failed']]);
  } finally { await luna.close(); }
});

test('accounting callback failures cannot change output or leave the next turn reserved', async () => {
  const luna = createOpenAILuna({ env, fetchImpl: async () => stream([delta('<say>Ready.</say>'), complete('<say>Ready.</say>')]) });
  let updates = 0, finishes = 0;
  try {
    const result = await luna.respond({}, { onUsage() { updates++; throw Error('observer'); }, onRequestStart() { return { update() { throw Error('meter'); }, finish() { finishes++; throw Error('finish'); } }; } });
    assert.equal(result.reply, 'Ready.'); assert.equal(updates, 1); assert.equal(finishes, 1);
    assert.equal((await luna.respond({})).reply, 'Ready.');
  } finally { await luna.close(); }
});

test('cancellation during the first local read prevents later tools in the batch from starting', async () => {
  let reads = 0, requests = 0; const controller = new AbortController();
  const luna = createOpenAILuna({ env, fetchImpl: async () => { requests++; return stream([toolResponse([toolCall('a'), toolCall('b')])]); } });
  try {
    await assert.rejects(luna.respond({}, { signal: controller.signal, retrieval: retrievalStub(() => { reads++; controller.abort(); return {}; }) }), error => error.status === 499);
    assert.equal(reads, 1); assert.equal(requests, 1);
  } finally { await luna.close(); }
});

test('a shared deadline or cancellation prevents late local results from starting another model request', async t => {
  for (const cancel of [false, true]) await t.test(cancel ? 'cancel' : 'deadline', async () => {
    let release, began, requests = 0; const started = new Promise(resolve => { began = resolve; });
    const spoken = [], controller = new AbortController();
    const luna = createOpenAILuna({ env, fetchImpl: async () => { requests++; return stream([toolResponse([toolCall('a')])]); } });
    try {
      const pending = luna.respond({}, { timeoutMs: cancel ? 1000 : 15, signal: controller.signal, onText: text => spoken.push(text), retrieval: retrievalStub(() => new Promise(resolve => { release = resolve; began(); })) });
      const rejected = assert.rejects(pending, error => error.status === (cancel ? 499 : 504));
      await started; if (cancel) controller.abort(); await rejected;
      release({ passages: [{ text: 'Late source content.' }] }); await tick();
      assert.equal(requests, 1); assert.deepEqual(spoken, []);
    } finally { await luna.close(); }
  });
});

test('canceled fetches cannot execute tools from a late completed response', async () => {
  let release, reads = 0; const controller = new AbortController();
  const luna = createOpenAILuna({ env, fetchImpl: () => new Promise(resolve => { release = resolve; }) });
  try {
    const pending = luna.respond({}, { signal: controller.signal, retrieval: retrievalStub(() => { reads++; return {}; }) });
    await tick(); controller.abort(); await assert.rejects(pending, error => error.status === 499);
    release(stream([toolResponse([toolCall('late')])])); await tick();
    assert.equal(reads, 0);
  } finally { await luna.close(); }
});

test('mixed speech and retrieval never executes a tool or starts a second spoken answer', async () => {
  let requests = 0, reads = 0; const spoken = [], full = '<say>Let me check.</say>';
  const luna = createOpenAILuna({ env, fetchImpl: async () => { requests++; return stream([delta(full), toolResponse([...body(full).output, toolCall('one')])]); } });
  try {
    await assert.rejects(luna.respond({}, { onText: text => spoken.push(text), retrieval: retrievalStub(() => { reads++; return {}; }) }), error => error.status === 502);
    assert.equal(requests, 1); assert.equal(reads, 0); assert.equal(spoken.join(''), 'Let me check.');
  } finally { await luna.close(); }
});

test('provider model and service tier accompany reported usage without forwarding unrelated response fields', async () => {
  const full = '<say>Ready.</say>', updates = [];
  const response = { ...body(full), model: 'gpt-6-luna-2026-10-01', service_tier: 'priority', authorization: 'never-forward' };
  const luna = createOpenAILuna({ env, fetchImpl: async () => stream([delta(full), { type: 'response.completed', response }]) });
  await luna.respond({}, { onUsage: value => updates.push(value) });
  assert.deepEqual(Object.keys(updates[0]).sort(), ['model', 'serviceTier', 'units']);
  assert.equal(updates[0].model, response.model); assert.equal(updates[0].serviceTier, 'priority');
  await luna.close();
  const meters = [], organizer = createOpenAIOrganizer({ env, usageLedger: { start() { return { update: value => meters.push(value), finish() {} }; } }, fetchImpl: async () => Response.json({ ...response, ...body('{"reply":"Ready."}', undefined), usage: undefined }) });
  await organizer.organize({}, { schema, instructions: 'JSON.' });
  assert.deepEqual(meters, [{ units: {}, model: response.model, serviceTier: 'priority' }], 'metadata never fabricates missing token usage');
});

test('OpenAI voice streams only spoken text, preserves board output and reports provider counters', async () => {
  const board = { title: 'Equation', blocks: [{ type: 'latex', content: 'x+1=3' }] };
  const full = `<say>Café: solve this.</say><board>${JSON.stringify(board)}</board>`;
  const spoken = [], usage = [], order = []; let request;
  const luna = createOpenAILuna({ env, fetchImpl: async (url, options) => {
    request = { url, ...options, body: JSON.parse(options.body) };
    return stream([{ type: 'response.reasoning_text.delta', delta: 'Do not expose this.' }, ...[full.slice(0, 4), full.slice(4, 19), full.slice(19)].map(delta), complete(full)]);
  } });
  await luna.ready();
  const result = await luna.respond({ title: 'Algebra', materials: [] }, { onText: value => spoken.push(value), onSpeechEnd: () => order.push('speech-end'), onUsage: value => usage.push(value) });
  assert.equal(spoken.join(''), 'Café: solve this.'); assert.equal(result.reply, 'Café: solve this.'); assert.deepEqual(result.board, board); assert.equal(result.boardStatus, 'valid');
  assert.deepEqual(order, ['speech-end']); assert.deepEqual(usage, [{ units: { inputTokens: 40, outputTokens: 10, cachedInputTokens: 15, reasoningTokens: 3 } }]);
  assert.equal(request.url, 'https://api.openai.com/v1/responses'); assert.equal(request.redirect, 'error'); assert.equal(request.headers.Authorization, 'Bearer test-only-secret');
  assert.equal(request.body.model, 'gpt-6-luna'); assert.equal(request.body.store, false); assert.equal(request.body.stream, true); assert.deepEqual(request.body.tools, []); assert.equal(request.body.reasoning.effort, 'low');
  assert.equal(JSON.stringify(result).includes('Private reasoning'), false); assert.ok(result.timings.totalMs >= 0); await luna.close();
});

test('planner retains high effort, plain-text output, custom model and complete SSE final frame without newline', async () => {
  let payload;
  const luna = createOpenAILuna({ env: { ...env, LUNA_API_MODEL: 'gpt-6-luna' }, mode: 'planner', fetchImpl: async (_, options) => { payload = JSON.parse(options.body); return stream([delta('Check the misconception.'), complete('Check the misconception.')], { terminated: false }); } });
  const result = await luna.respond({ materials: [] }, { effort: 'high' });
  assert.equal(result.reply, 'Check the misconception.'); assert.equal(payload.reasoning.effort, 'high'); assert.equal(payload.max_output_tokens, 4000); assert.match(payload.instructions, /brief teaching hint/); assert.equal(Object.hasOwn(result, 'board'), false); await luna.close();
});

test('organizer preserves strict schemas, attributes usage, and requires completed valid JSON', async () => {
  const ledger = createUsageLedger({ file: null }); const requests = [];
  const organizer = createOpenAIOrganizer({ env, usageLedger: ledger, fetchImpl: async (_, options) => { requests.push(JSON.parse(options.body)); return Response.json(body(JSON.stringify({ reply: 'Grounded answer.' }))); } });
  assert.equal(organizer.available, true); assert.equal(organizer.model, 'gpt-6-luna');
  for (const chosen of [schema, questionBatchSchema([{ slotId: '1', difficulty: 'easy', sourceIds: ['a'] }]), sessionReviewSchema]) {
    assert.deepEqual(await organizer.organize({ materials: [{ id: 'a', text: 'Fact.' }] }, { schema: chosen, instructions: 'Return grounded JSON.', usageContext: { testId: 'a', operation: 'question-bank' } }), { reply: 'Grounded answer.' });
    assert.deepEqual(requests.at(-1).text.format.schema, chosen); assert.equal(requests.at(-1).text.format.strict, true);
  }
  const snapshot = await ledger.snapshot('a'); assert.equal(snapshot.totals.requests, 3); assert.equal(snapshot.totals.units.inputTokens, 120); assert.equal(snapshot.totals.exactUsd, null); await ledger.close();
});

test('organizer output budgets are configurable and bounded for parallel indexing stages',async()=>{
  const budgets=[];const organizer=createOpenAIOrganizer({env,fetchImpl:async(_,options)=>{budgets.push(JSON.parse(options.body).max_output_tokens);return Response.json(body('{"reply":"Ready."}'));}});
  for(const maxOutputTokens of [2100,5000,200000,1,NaN])await organizer.organize({},{schema,instructions:'JSON.',maxOutputTokens});
  assert.deepEqual(budgets,[2100,5000,10000,256,10000]);
});

test('failed or incomplete organizer responses retain reported usage but never leak provider contents', async () => {
  for (const response of [{ ...body('{}'), status: 'incomplete' }, body('not JSON'), body('[]'), body('null'), { ...body('{}'), output: [{ type: 'function_call', name: 'unsafe' }] }]) {
    const ledger = createUsageLedger({ file: null });
    const organizer = createOpenAIOrganizer({ env, usageLedger: ledger, fetchImpl: async () => Response.json(response) });
    await assert.rejects(organizer.organize({ testId: 'a' }, { schema, instructions: 'JSON.' }), error => error.status === 502 && !error.message.includes('not JSON'));
    const snapshot = await ledger.snapshot('a'); assert.equal(snapshot.totals.requests, 1); assert.equal(snapshot.totals.units.inputTokens, 40); assert.equal(snapshot.totals.pendingRequests, 0); await ledger.close();
  }
});

test('voice rejects tool calls, refusal, incomplete streams, mismatched final text and excessive output', async () => {
  const cases = [
    [{ type: 'response.output_item.added', item: { type: 'function_call' } }],
    [{ type: 'response.refusal.delta', delta: 'private refusal' }],
    [delta('<say>Hello.</say>')],
    [delta('Hello.'), complete('Different.')],
    [{ type: 'response.failed', response: { error: { message: 'server-secret' } } }],
    [delta('<say>' + 'a'.repeat(1801) + '</say>')],
  ];
  for (const events of cases) {
    const luna = createOpenAILuna({ env, fetchImpl: async () => stream(events) });
    await assert.rejects(luna.respond({}), error => error.status === 502 && !/server-secret|private refusal/.test(error.message)); await luna.close();
  }
});

test('authorization/network errors are sanitized; missing keys and canceled inputs make no calls', async () => {
  let calls = 0;
  const missing = createOpenAILuna({ env: {}, fetchImpl: () => { calls++; } });
  await assert.rejects(missing.respond({}), error => error.status === 503); assert.equal(calls, 0);
  const canceled = new AbortController(); canceled.abort();
  const organizer = createOpenAIOrganizer({ env, fetchImpl: () => { calls++; } });
  await assert.rejects(organizer.organize({}, { signal: canceled.signal, schema, instructions: 'JSON.' }), error => error.status === 499); assert.equal(calls, 0);
  for (const code of [401, 403, 429, 500]) {
    const luna = createOpenAILuna({ env, fetchImpl: async () => new Response('test-only-secret private provider body', { status: code }) });
    await assert.rejects(luna.respond({}), error => error.status === (code === 429 ? 429 : 502) && !/test-only-secret|private provider/.test(error.message)); await luna.close();
  }
  const offline = createOpenAILuna({ env, fetchImpl: async () => { throw Error('test-only-secret'); } });
  await assert.rejects(offline.respond({}), error => error.status === 502 && !error.message.includes('test-only-secret')); await offline.close();
});

test('full deadlines cover stalled headers and bodies even when a fetch mock ignores abort', async () => {
  for (const fetchImpl of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'text/event-stream' } })]) {
    const luna = createOpenAILuna({ env, fetchImpl });
    await assert.rejects(luna.respond({}, { timeoutMs: 10 }), error => error.status === 504); await luna.close();
  }
});

test('only one live response runs at once; session close cancels in-flight work without late output', async () => {
  let called;
  const began = new Promise(resolve => { called = resolve; });
  const luna = createOpenAILuna({ env, fetchImpl: async () => { called(); return new Promise(() => {}); } });
  const pending = luna.respond({}); await began;
  await assert.rejects(luna.respond({}), error => error.status === 409);
  await luna.close(); await assert.rejects(pending, error => error.status === 499);
  await assert.rejects(luna.ready(), error => error.status === 499);
});

test('abort immediately admits a replacement and old cleanup cannot release the new response', async () => {
  const requests = [], oldText = [], newText = [];
  const luna = createOpenAILuna({ env, fetchImpl: (_, options) => new Promise(resolve => { requests.push({ options, resolve }); }) });
  const controller = new AbortController();
  try {
    const old = luna.respond({}, { signal: controller.signal, onText: value => oldText.push(value) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1);
    controller.abort();
    const next = luna.respond({}, { onText: value => newText.push(value) });
    const outcome = next.then(value => ({ value }), error => ({ error }));
    await assert.rejects(old, error => error.status === 499);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 2, 'replacement starts without waiting for the canceled fetch');
    assert.equal(requests[0].options.signal.aborted, true);
    await assert.rejects(luna.respond({}), error => error.status === 409, 'old finally cannot unlock an active replacement');
    requests[0].resolve(stream([delta('Stale answer.'), complete('Stale answer.')]));
    requests[1].resolve(stream([delta('Fresh answer.'), complete('Fresh answer.')]));
    const result = await outcome;
    assert.ifError(result.error); assert.equal(result.value.reply, 'Fresh answer.');
    assert.deepEqual(oldText, []); assert.equal(newText.join(''), 'Fresh answer.');
  } finally { await luna.close(); }
});

test('request and response bytes are bounded before content can reach downstream callbacks', async () => {
  let calls = 0;
  const oversizedInput = createOpenAILuna({ env, fetchImpl: async () => { calls++; } });
  await assert.rejects(oversizedInput.respond({ text: 'x'.repeat(2 * 1024 * 1024) }), error => error.status === 400); assert.equal(calls, 0);
  const oversizedOutput = createOpenAILuna({ env, fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'text/event-stream' } }) });
  await assert.rejects(oversizedOutput.respond({}), error => error.status === 502); await oversizedOutput.close(); await oversizedInput.close();
});

test('queued asks stream canonical public wording and carry identity through the OpenAI adapter',async()=>{
  const question='In an 8-by-10 game, what is the maximum number of strict Nash equilibria?';
  const full='<ask>q-grid</ask>';
  const spoken=[],requests=[];
  const luna=createOpenAILuna({env:{...env,LUNA_TUTOR_MODEL:'gpt-5.6-terra'},fetchImpl:async(_,options)=>{requests.push(JSON.parse(options.body));return stream([...full.split('').map(delta),complete(full)]);}});
  const result=await luna.respond({privateQuestionBank:{topics:[{questions:[{id:'q-grid',question,answer:'Private key'}]}]}},{onText:value=>spoken.push(value),resolveQuestion:id=>id==='q-grid'?question:null});
  assert.equal(result.reply,question);assert.equal(result.questionId,'q-grid');assert.equal(spoken.join(''),question);assert.equal(requests[0].model,'gpt-5.6-terra');
  assert.doesNotMatch(spoken.join(''),/q-grid|Private key/);await luna.close();
});

test('queued references outside the offered snapshot or invalidated by the live bank are rejected before speech',async()=>{
  const input={privateQuestionBank:{topics:[{questions:[{id:'offered',question:'What is the value?'}]}]}};
  for(const id of ['unoffered','offered']){
    const full=`<ask>${id}</ask>`,spoken=[];
    const luna=createOpenAILuna({env,fetchImpl:async()=>stream([delta(full),complete(full)])});
    await assert.rejects(luna.respond(input,{onText:value=>spoken.push(value),resolveQuestion:()=>null}));assert.deepEqual(spoken,[]);await luna.close();
  }
});

test('OpenAI restates a consumed working question through retrieval while rejecting changed or callback-only IDs',async()=>{
 const question='Why is the membrane selective?',id='consumed';
 for(const kind of ['valid','changed','unoffered']){
  let count=0;const spoken=[],full=`<ask>${kind==='unoffered'?'callback-only':id}</ask>`;
  const luna=createOpenAILuna({env,fetchImpl:async()=>++count===1?stream([toolResponse([toolCall('read')])]):stream([delta(full),complete(full)])});
  const input={workingProblem:{id,question},activeQuestion:null,privateQuestionBank:{topics:[{questions:[{id:'refill',question:'Where is DNA?'}]}]}};
  try{
   const pending=luna.respond(input,{onText:value=>spoken.push(value),resolveQuestion:()=>kind==='changed'?'Different wording?':question,retrieval:retrievalStub(()=>({passages:[]}))});
   if(kind==='valid'){const result=await pending;assert.equal(result.questionId,id);assert.equal(result.reply,question);assert.equal(count,2);assert.deepEqual(spoken,[question]);}
   else{await assert.rejects(pending);assert.deepEqual(spoken,[]);}
  }finally{await luna.close();}
 }
});

test('the speaking model override never changes planner, visual recovery, or organizer models',async()=>{
  const configured={...env,LUNA_API_MODEL:'gpt-6-luna',LUNA_TUTOR_MODEL:'gpt-5.6-terra'};
  for(const mode of ['voice','planner','visual']){
    const responder=createOpenAILuna({env:configured,mode});assert.equal(responder.model,mode==='voice'?'gpt-5.6-terra':'gpt-6-luna');await responder.close();
  }
});
