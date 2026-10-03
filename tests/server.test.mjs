import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { apiStatus, createApiHandler, guideSchema, validateGuide } from '../server/api.mjs';
import { createMaterialIndexer } from '../server/indexing.mjs';
import { createQuestionBank } from '../server/question-bank.mjs';
import { createUsageLedger } from '../server/usage-ledger.mjs';

const source = { id: 'notes-1', name: 'Physics notes.txt', text: 'Momentum is mass times velocity. Total momentum is conserved in an isolated system.' };
const input = { title: 'Physics midterm', materials: [source] };
const guide = {
  overview: 'Review momentum and conservation.',
  topics: [{ title: 'Momentum', summary: 'Momentum is mass times velocity.', sourceIds: ['notes-1'] }],
  questions: [{ question: 'When is momentum conserved?', answer: 'In an isolated system.', sourceIds: ['notes-1'] }],
  script: 'Momentum is mass times velocity. In an isolated system, total momentum is conserved.',
};
const topicGuide = { overview: guide.overview, topics: guide.topics };

test('new indexing schema requests only source-grounded topics while validation accepts complete legacy guides', () => {
  const schema = guideSchema([source.id]);
  assert.deepEqual(schema.required, ['overview', 'topics']);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['overview', 'topics']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(validateGuide(topicGuide, input.materials), topicGuide);
  assert.deepEqual(validateGuide(guide, input.materials), guide);
  for (const invalid of [
    { ...topicGuide, questions: guide.questions },
    { ...topicGuide, script: guide.script },
    { ...topicGuide, extra: true },
    { ...topicGuide, topics: [] },
    { ...topicGuide, topics: [{ ...guide.topics[0], sourceIds: ['invented'] }] },
    { ...guide, questions: [] },
    { ...guide, script: ' ' },
  ]) assert.throws(() => validateGuide(invalid, input.materials), error => error.status === 502);
});

test('topic-only indexing responses succeed through API and CLI organizer transports', async t => {
  for (const transport of ['api', 'cli']) await t.test(transport, async t => {
    const requests = [];
    const app = await fixture(t, transport === 'api' ? {
      env: { LIVE_APIS: 'true', OPENAI_API_KEY: 'mock-only' },
      fetchImpl: async (_url, options) => {
        requests.push(JSON.parse(options.body).text.format.schema);
        return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(topicGuide) }] }] });
      },
    } : {
      env: { LUNA_ORGANIZER: 'codex-cli' },
      cliOrganizer: { available: true, async organize(_input, options) { requests.push(options.schema); return topicGuide; } },
    });
    const result = await app.post('/api/organize', input);
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).guide, topicGuide);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].required, ['overview', 'topics']);
  });
});

test('indexing returns ready while real question preparation is unresolved and remains successful when preparation fails', { timeout: 3000 }, async t => {
  const calls = [], events = [];
  let beginBank, failBank, finishBank, bankSettled = false;
  const bankStarted = new Promise(resolve => { beginBank = resolve; });
  const bankFinished = new Promise(resolve => { finishBank = resolve; });
  const organizer = {
    available: true, model: 'gpt-6-luna',
    async organize(received, options) {
      calls.push(options.usageContext.operation);
      if (!received.slots) {
        assert.deepEqual(options.schema.required, ['overview', 'topics']);
        return topicGuide;
      }
      try {
        await new Promise((_resolve, reject) => {
          failBank = () => reject(new Error('Synthetic question preparation failure'));
          options.signal.addEventListener('abort', failBank, { once: true });
          beginBank();
        });
      } finally { bankSettled = true; finishBank(); }
    },
  };
  const indexer = createMaterialIndexer({ organizer });
  const questionBank = createQuestionBank({ organizer, idleDelayMs: 0 });
  t.after(() => { questionBank.close(); indexer.close(); });
  const app = await fixture(t, {
    env: { LUNA_ORGANIZER: 'codex-cli' }, cliOrganizer: organizer, indexer, questionBank,
    diagnostics: { record(_testId, event) { events.push(event.type); } },
  });
  const pending = app.post('/api/organize', input).then(async response => {
    assert.equal(response.status, 200);
    return response.json();
  });
  const [result] = await Promise.all([pending, bankStarted]);
  assert.deepEqual(result, { mode: 'live', guide: topicGuide });
  assert.equal(bankSettled, false, 'question generation is still pending after the full HTTP response');
  assert.deepEqual(calls, ['index-direct', 'question-bank']);
  assert.deepEqual(events, ['index.request', 'index.ready']);
  assert.equal(questionBank.context(input), null);
  assert.equal(questionBank.topics(input).length, 1);

  failBank();
  await bankFinished;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(questionBank.context(input), null);
  assert.deepEqual(events, ['index.request', 'index.ready']);
  assert.equal(questionBank.topics(input).length, 1);
  assert.deepEqual(validateGuide(result.guide, input.materials), topicGuide);
});

test('fallback organizer preserves returned model and tier for usage pricing without response secrets', async t => {
  const updates = [];
  const usageLedger = { start() { return { update: value => updates.push(value), finish() {} }; } };
  const app = await fixture(t, { usageLedger, env: { LIVE_APIS: 'true', OPENAI_API_KEY: 'mock-only' }, fetchImpl: async () => Response.json({ status: 'completed', model: 'gpt-6-luna-2026-10-01', service_tier: 'priority', usage: { input_tokens: 12, output_tokens: 5 }, secret: 'never-forward', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(guide) }] }] }) });
  assert.equal((await app.post('/api/organize', input)).status, 200);
  assert.deepEqual(updates, [{ units: { inputTokens: 12, outputTokens: 5 }, model: 'gpt-6-luna-2026-10-01', serviceTier: 'priority' }]);
});

test('debug usage is same-origin and development-only; organizer usage stays attached to its test',async t=>{
  const testId='12345678-1234-4234-9234-123456789abc',ledger=createUsageLedger({file:null});
  t.after(()=>ledger.close());
  const app=await fixture(t,{debugEnabled:true,usageLedger:ledger,env:{LIVE_APIS:'true',OPENAI_API_KEY:'test'},fetchImpl:async()=>Response.json({status:'completed',usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:30}},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(guide)}]}]})});
  assert.equal((await app.post('/api/organize',{...input,testId})).status,200);
  const result=await (await app.post('/api/debug/usage',{testId})).json();
  assert.equal(result.totals.requests,1);assert.equal(result.totals.exactUsd,null);assert.equal(result.totals.unpricedRequests,1);
  assert.deepEqual(result.totals.units,{inputTokens:100,outputTokens:20,cachedInputTokens:30});
  assert.equal((await app.post('/api/debug/usage',{testId},{Origin:'https://outside.example'})).status,403);
  assert.equal((await app.get('/api/debug/usage')).status,405);
  assert.equal((await app.post('/api/debug/usage',{testId,arbitrary:'x'})).status,400);
  const production=await fixture(t,{usageLedger:ledger});
  assert.equal((await production.post('/api/debug/usage',{testId})).status,404);
  assert.equal((await app.post('/api/organize',{...input,testId:'invalid'})).status,400);
  assert.equal((await (await app.post('/api/debug/usage',{testId:'another'})).json()).totals.requests,0);
});

test('diagnostic routes gate client events and server indexing records contain no source text',async t=>{
  const recorded=[],client=[];
  const diagnostics={record:(testId,event)=>recorded.push({testId,event}),read:async testId=>({testId,events:recorded}),clientRecord(testId,event){client.push({testId,event});return false;}};
  const testId='12345678-1234-4234-9234-123456789abc';
  const app=await fixture(t,{debugEnabled:true,diagnostics,env:{LIVE_APIS:'true',OPENAI_API_KEY:'test'},fetchImpl:async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(guide)}]}]})});
  assert.equal((await app.post('/api/organize',{...input,testId})).status,200);
  assert.deepEqual(recorded.map(item=>item.event.type),['index.request','index.ready']);
  assert.equal(recorded[0].event.details.requestId,recorded[1].event.details.requestId);
  assert.equal(JSON.stringify(recorded).includes(source.text),false);
  assert.deepEqual(await (await app.post('/api/debug/event',{testId,event:{type:'not-allowed'}})).json(),{accepted:false});
  assert.equal(client.length,1);
  assert.equal((await app.post('/api/debug/activity',{testId},{Origin:'https://outside.example'})).status,403);
  assert.equal((await app.post('/api/debug/activity',{testId})).status,200);
});

async function fixture(t, options = {}) {
  const handler = createApiHandler({ env: {}, fetchImpl: () => { throw new Error('Unexpected paid call'); }, ...options });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    get: (route) => fetch(`${origin}${route}`),
    post: (route, body, headers = {}) => fetch(`${origin}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body) }),
  };
}

test('status defaults to demo and requires an explicit live gate', () => {
  assert.deepEqual(apiStatus({}), { organizer: 'demo', voice: 'browser', mode: 'demo' });
  assert.equal(apiStatus({ OPENAI_API_KEY: 'test', ELEVENLABS_API_KEY: 'test' }).mode, 'demo');
  assert.deepEqual(apiStatus({ LIVE_APIS: 'true', OPENAI_API_KEY: 'test' }), { organizer: 'gpt-6-luna', voice: 'browser', mode: 'partial' });
  assert.equal(apiStatus({ LIVE_APIS: 'true', OPENAI_API_KEY: 'test', ELEVENLABS_API_KEY: 'test' }).mode, 'live');
});

test('demo endpoints return actionable 503 responses without contacting providers', async (t) => {
  let calls = 0;
  const app = await fixture(t, { env: { OPENAI_API_KEY: 'secret', ELEVENLABS_API_KEY: 'secret' }, fetchImpl: () => { calls++; } });
  assert.deepEqual(await (await app.get('/api/status')).json(), { organizer: 'demo', voice: 'browser', mode: 'demo' });
  for (const [route, body] of [['/api/organize', input], ['/api/speak', { text: 'Review momentum.' }]]) {
    const result = await app.post(route, body);
    assert.equal(result.status, 503);
    assert.match((await result.json()).error, /configure|LIVE_APIS=true/i);
  }
  assert.equal(calls, 0);
});

test('external origins, absent origins, foreign hostnames and non-JSON posts are rejected', async (t) => {
  const app = await fixture(t);
  assert.equal((await app.post('/api/organize', input, { Origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await app.post('/api/organize', input, { Origin: '' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = request(`${app.origin}/api/organize`, { method: 'POST', headers: { Host: 'unrelated.example', Origin: 'http://unrelated.example', 'Content-Type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end(JSON.stringify(input));
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await app.post('/api/organize', input, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await app.post('/api/organize', input, { 'Content-Type': 'text/plain' })).status, 415);
});

test('rejects empty/duplicate/excess source input and cumulative text overflow without truncation', async (t) => {
  const app = await fixture(t);
  const invalidInputs = [
    { ...input, materials: [] },
    { ...input, title: ' ' },
    { ...input, materials: [source, source] },
    { ...input, materials: [{ ...source, text: ' ' }] },
    { ...input, materials: Array.from({ length: 101 }, (_, i) => ({ ...source, id: `source-${i}` })) },
    { ...input, materials: [{ ...source, text: 'x'.repeat(250_001) }, { ...source, id: 'notes-2', text: 'x'.repeat(250_000) }] },
  ];
  for (const body of invalidInputs) assert.equal((await app.post('/api/organize', body)).status, 400);
  assert.equal((await app.post('/api/speak', { text: 'x'.repeat(2501) })).status, 400);
  assert.equal((await app.post('/api/speak', { text: ' ' })).status, 400);
});

test('rejects oversized HTTP requests and malformed JSON', async (t) => {
  const app = await fixture(t);
  assert.equal((await app.post('/api/organize', { title: 'x'.repeat(3 * 1024 * 1024) })).status, 413);
  const malformed = await fetch(`${app.origin}/api/organize`, { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(malformed.status, 400);
});

test('organize calls GPT-6 Luna with strict source-aware structure and returns a validated guide', async (t) => {
  const calls = [];
  const app = await fixture(t, { env: { LIVE_APIS: 'true', OPENAI_API_KEY: 'server-secret' }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(guide) }] }] });
  } });
  const result = await app.post('/api/organize', input);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { mode: 'live', guide });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  const request = JSON.parse(calls[0].options.body);
  assert.equal(request.model, 'gpt-6-luna');
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 6000);
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(request.text.format.schema.properties.topics.items.properties.sourceIds.items.enum, ['notes-1']);
  assert.deepEqual(JSON.parse(request.input), input);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-secret');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('rejects invented citations, empty guides and incomplete provider responses', async (t) => {
  const responses = [
    { ...guide, topics: [{ ...guide.topics[0], sourceIds: ['invented'] }] },
    { ...guide, topics: [] },
    { ...guide, script: ' ' },
  ].map((badGuide) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(badGuide) }] }] }));
  responses.push({ status: 'incomplete', output: [] });
  const app = await fixture(t, { env: { LIVE_APIS: 'true', OPENAI_API_KEY: 'secret' }, fetchImpl: async () => Response.json(responses.shift()) });
  for (let i = 0; i < 4; i++) assert.equal((await app.post('/api/organize', input)).status, 502);
});

test('ElevenLabs converts a bounded script using the latest model and returns MP3 bytes', async (t) => {
  let received;
  const app = await fixture(t, { env: { LIVE_APIS: 'true', ELEVENLABS_API_KEY: 'speech-secret' }, fetchImpl: async (url, options) => {
    received = { url, options };
    return new Response(new Uint8Array([73, 68, 51, 1]), { headers: { 'Content-Type': 'audio/mpeg' } });
  } });
  const result = await app.post('/api/speak', { text: guide.script });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [73, 68, 51, 1]);
  assert.match(received.url, /\/v1\/text-to-speech\/JBFqnCBsd6RMkjVDRZzb\?output_format=mp3_44100_128$/);
  assert.deepEqual(JSON.parse(received.options.body), { text: guide.script, model_id: 'eleven_v4' });
  assert.equal(received.options.headers['xi-api-key'], 'speech-secret');
});

test('provider errors and network failures do not expose provider text or credentials', async (t) => {
  let attempt = 0;
  const app = await fixture(t, { env: { LIVE_APIS: 'true', OPENAI_API_KEY: 'super-secret' }, fetchImpl: async () => {
    attempt++;
    if (attempt === 1) return Response.json({ error: 'super-secret private upstream stack' }, { status: 401 });
    if (attempt === 2) throw new Error('super-secret private network details');
    if (attempt === 3) throw new DOMException('private timeout info', 'TimeoutError');
    return Response.json({ error: 'private quota info' }, { status: 429 });
  } });
  for (const status of [502, 502, 504, 429]) {
    const result = await app.post('/api/organize', input);
    assert.equal(result.status, status);
    assert.doesNotMatch(await result.text(), /super-secret|private/);
  }
});

test('rate limit bounds provider requests and resets after one minute', async (t) => {
  let time = 100_000;
  const app = await fixture(t, { now: () => time });
  for (let i = 0; i < 12; i++) assert.equal((await app.post('/api/speak', { text: 'Hello.' })).status, 503);
  assert.equal((await app.post('/api/speak', { text: 'Hello.' })).status, 429);
  time += 60_001;
  assert.equal((await app.post('/api/speak', { text: 'Hello.' })).status, 503);
});

test('only two provider requests can run at once', async (t) => {
  let count = 0;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  let finish;
  const released = new Promise((resolve) => { finish = resolve; });
  const app = await fixture(t, { env: { LIVE_APIS: 'true', ELEVENLABS_API_KEY: 'secret' }, fetchImpl: async () => {
    count++;
    if (count === 2) signalStarted();
    await released;
    return new Response(new Uint8Array([73, 68, 51]), { headers: { 'Content-Type': 'audio/mpeg' } });
  } });
  const first = app.post('/api/speak', { text: 'First.' });
  const second = app.post('/api/speak', { text: 'Second.' });
  await started;
  const third = await app.post('/api/speak', { text: 'Third.' });
  finish();
  assert.equal(third.status, 429);
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal(count, 2);
});

test('does not serve provider JSON or oversized payloads as audio', async (t) => {
  let count = 0;
  const app = await fixture(t, { env: { LIVE_APIS: 'true', ELEVENLABS_API_KEY: 'secret' }, fetchImpl: async () => {
    count++;
    return count === 1 ? Response.json({ error: 'Not audio' }) : new Response('small', { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(13 * 1024 * 1024) } });
  } });
  assert.equal((await app.post('/api/speak', { text: 'Hello.' })).status, 502);
  assert.equal((await app.post('/api/speak', { text: 'Hello.' })).status, 502);
});

test('CLI mode uses ChatGPT login independently of API billing and validates the same guide', async (t) => {
  let called=0;
  const cliOrganizer={available:true,organize:async (received,options)=>{
    called++;assert.deepEqual(received,input);assert.ok(options.signal instanceof AbortSignal);
    assert.match(options.instructions,/untrusted study data/);
    assert.deepEqual(options.schema.properties.topics.items.properties.sourceIds.items.enum,['notes-1']);
    return guide;
  }};
  const app=await fixture(t,{env:{LUNA_ORGANIZER:'codex-cli',LIVE_APIS:'false'},cliOrganizer});
  const status=await (await app.get('/api/status')).json();
  assert.equal(status.organizer,'gpt-6-luna');assert.equal(status.organizerTransport,'codex-cli');assert.equal(status.cliAuthenticated,true);assert.equal(status.voice,'browser');
  const response=await app.post('/api/organize',input);assert.equal(response.status,200);assert.deepEqual((await response.json()).guide,guide);assert.equal(called,1);
});

test('CLI mode reports missing login and refuses invalid citations', async (t)=>{
  const missing=await fixture(t,{env:{LUNA_ORGANIZER:'codex-cli'},cliOrganizer:{available:false}});
  assert.equal((await missing.post('/api/organize',input)).status,503);
  const invalid=await fixture(t,{env:{LUNA_ORGANIZER:'codex-cli'},cliOrganizer:{available:true,organize:async()=>({...guide,topics:[{...guide.topics[0],sourceIds:['unknown']}]})}});
  assert.equal((await invalid.post('/api/organize',input)).status,502);
});

test('learning trace is read-only, development-only and requires the local app origin',async t=>{
  let calls=0;
  const sessionHistory={trace:async id=>{calls++;return {sessions:[{id,entries:[]}],summary:{sentences:0}};}};
  const hidden=await fixture(t,{sessionHistory});
  assert.equal((await hidden.post('/api/debug/learning-trace',{testId:'exam'})).status,404);
  const app=await fixture(t,{sessionHistory,debugEnabled:true});
  assert.equal((await app.post('/api/debug/learning-trace',{testId:'exam'},{Origin:'https://elsewhere.example'})).status,403);
  assert.equal((await app.post('/api/debug/learning-trace',{testId:'exam',providerKey:'forged'})).status,400);
  const response=await app.post('/api/debug/learning-trace',{testId:'exam'});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).sessions,[{id:'exam',entries:[]}]);
  assert.equal(calls,1);
});

test('status reports the tutor and grader separately from preparation without exposing credentials',()=>{
  const status=apiStatus({LIVE_APIS:'true',LUNA_ORGANIZER:'openai-api',LUNA_API_MODEL:'gpt-6-luna',LUNA_TUTOR_MODEL:'gpt-5.6-terra',OPENAI_API_KEY:'test-secret'});
  assert.equal(status.organizer,'gpt-6-luna');assert.equal(status.tutorModel,'gpt-5.6-terra');assert.equal(status.gradingModel,'gpt-5.6-terra');assert.doesNotMatch(JSON.stringify(status),/test-secret/);
  const custom=apiStatus({LIVE_APIS:'true',LUNA_ORGANIZER:'openai-api',LUNA_GRADING_MODEL:' custom-grader ',OPENAI_API_KEY:'test-secret'});
  assert.equal(custom.gradingModel,'custom-grader');
  assert.equal(apiStatus({LUNA_ORGANIZER:'openai-api'}).gradingModel,'demo');
});
