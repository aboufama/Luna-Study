import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createJevCourseRouter } from '../server/jev-course.mjs';
import { createApiHandler } from '../server/api.mjs';
import { COURSE_MOSAIC_CATALOG, COURSE_MOSAIC_IDS, COURSE_MOSAIC_VERSION, normalizeCourseTitle } from '../shared/course-mosaic-catalog.mjs';
import { COURSES } from '../src/course-mosaics/courses.mjs';

const env = { TYPESAFE_API_KEY: 'course-test-secret' };
const testId = '12345678-1234-4234-9234-123456789abc';
const answer = (choice = 'biology') => ({ type: 'choice', choice, confidence: .89, probabilities: Object.fromEntries(COURSE_MOSAIC_IDS.map(id => [id, id === choice ? .89 : .01])) });
const bodyFor = (choice = 'biology') => ({ model: 'jev-1.13.0', answers: { course_mosaic: answer(choice) }, usage: { input_tokens: 35, output_tokens: 4 } });
const ledgerFixture = () => {
  const starts = [], updates = [], finishes = [];
  return { starts, updates, finishes, ledger: { start(...args) { starts.push(args); return { update: value => updates.push(value), finish: value => finishes.push(value) }; } } };
};

test('shared catalogue exactly matches all twelve actual artwork IDs and normalizes titles', () => {
  assert.equal(COURSE_MOSAIC_VERSION, 2);
  assert.equal(new Set(COURSE_MOSAIC_IDS).size, 12);
  assert.deepEqual(COURSE_MOSAIC_IDS, COURSES.map(course => course.id));
  assert.deepEqual(COURSE_MOSAIC_CATALOG.map(course => Object.keys(course)), COURSE_MOSAIC_IDS.map(() => ['id', 'name', 'description']));
  assert.equal(normalizeCourseTitle('  AP\n  Biology  '), 'AP Biology');
  assert.equal(normalizeCourseTitle('x'.repeat(101)).length, 100);
  assert.equal(normalizeCourseTitle({ title: 'Physics' }), '');
});

test('Jev receives only a normalized title and the twelve categorical choices at the fixed endpoint', async () => {
  const meter = ledgerFixture();
  let sent;
  const router = createJevCourseRouter({ env: { ...env, TYPESAFE_MODEL: ' jev-custom ' }, usageLedger: meter.ledger, fetchImpl: async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    return Response.json({ ...bodyFor(), secret: 'provider-private-value' });
  } });
  const result = await router.classify('  AP\n Biology ', { testId, materials: [{ text: 'private-source-marker' }], conversation: 'private-conversation-marker' });
  assert.deepEqual(result, { courseId: 'biology', source: 'jev', classifiedTitle: 'AP Biology' });
  assert.equal(sent.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.headers.Authorization, 'Bearer course-test-secret');
  assert.equal(sent.body.model, 'jev-custom');
  assert.deepEqual(sent.body.state, { title: 'AP Biology' });
  assert.equal(sent.body.questions.course_mosaic.type, 'choice');
  assert.deepEqual(Object.keys(sent.body.questions.course_mosaic.criteria), COURSE_MOSAIC_IDS);
  assert.match(sent.body.questions.course_mosaic.instructions, /untrusted/);
  assert.doesNotMatch(sent.options.body, /private-source-marker|private-conversation-marker|12345678-1234/);
  assert.doesNotMatch(JSON.stringify(result), /secret|provider-private-value|confidence|probabilities/);
  assert.deepEqual(meter.starts, [[testId, { category: 'jev', provider: 'typesafe', operation: 'course-mosaic-classification', model: 'jev-custom' }]]);
  assert.deepEqual(meter.updates, [{ units: { inputTokens: 35, outputTokens: 4 }, model: 'jev-1.13.0' }]);
  assert.deepEqual(meter.finishes, [{ status: 'completed' }]);
});

test('each supported choice is accepted without a local title keyword override', async () => {
  for (const id of COURSE_MOSAIC_IDS) {
    const router = createJevCourseRouter({ env, fetchImpl: async () => Response.json(bodyFor(id)) });
    assert.equal((await router.classify('Interdisciplinary capstone')).courseId, id);
  }
  const router = createJevCourseRouter({ env, fetchImpl: async () => Response.json(bodyFor('literature')) });
  assert.equal((await router.classify('Physics in modern novels')).courseId, 'literature');
});

test('missing key, empty title, and already canceled requests keep neutral artwork without provider usage', async () => {
  let calls = 0;
  const meter = ledgerFixture(), fetchImpl = async () => { calls++; throw Error('Should never call'); };
  const missing = createJevCourseRouter({ env: {}, fetchImpl, usageLedger: meter.ledger });
  assert.deepEqual(await missing.classify('Biology'), { courseId: null, source: 'fallback', classifiedTitle: 'Biology', reason: 'missing-key' });
  const ready = createJevCourseRouter({ env, fetchImpl, usageLedger: meter.ledger });
  assert.equal((await ready.classify('  ')).reason, 'missing-title');
  assert.equal((await ready.classify('Biology', { signal: AbortSignal.abort() })).reason, 'canceled');
  assert.equal(calls, 0);
  assert.equal(meter.starts.length, 0);
});

test('unsupported or malformed categorical answers never become a course choice', async () => {
  const valid = answer();
  for (const invalid of [
    undefined, { ...valid, type: 'enum' }, { ...valid, type: 'noul' }, { ...valid, choice: 'medicine' },
    { ...valid, choice: '__proto__' }, { ...valid, confidence: '0.9' }, { ...valid, confidence: -1 },
    { ...valid, confidence: 2 }, { ...valid, probabilities: null }, { ...valid, probabilities: [] },
    { ...valid, probabilities: { biology: 1 } },
    { ...valid, probabilities: { ...valid.probabilities, other: 0 } },
    { ...valid, probabilities: { ...valid.probabilities, biology: -1 } },
  ]) {
    const meter = ledgerFixture();
    const router = createJevCourseRouter({ env, usageLedger: meter.ledger, fetchImpl: async () => Response.json({ ...bodyFor(), answers: { course_mosaic: invalid } }) });
    assert.deepEqual(await router.classify('Biology'), { courseId: null, source: 'fallback', classifiedTitle: 'Biology', reason: 'invalid-response' });
    assert.deepEqual(meter.finishes, [{ status: 'failed' }]);
  }
});

test('network, HTTP, JSON, and provider secrets become bounded public fallback reasons', async () => {
  for (const fetchImpl of [
    async () => { throw Error('course-test-secret and private-provider-error'); },
    async () => ({ ok: false, json: async () => { throw Error('Do not read rejected body'); } }),
    async () => ({ ok: true, json: async () => { throw Error('private-provider-error'); } }),
  ]) {
    const router = createJevCourseRouter({ env, fetchImpl });
    const result = await router.classify('Biology');
    assert.deepEqual(result, { courseId: null, source: 'fallback', classifiedTitle: 'Biology', reason: 'unavailable' });
    assert.doesNotMatch(JSON.stringify(result), /secret|private-provider/);
  }
});

test('deadline bounds both response headers and response body even if the provider ignores abort', { timeout: 1000 }, async () => {
  for (const hang of ['headers', 'body']) {
    const meter = ledgerFixture();
    let signal;
    const router = createJevCourseRouter({ env, timeoutMs: 15, usageLedger: meter.ledger, fetchImpl: async (_url, options) => {
      signal = options.signal;
      if (hang === 'headers') return new Promise(() => {});
      return { ok: true, json: () => new Promise(() => {}) };
    } });
    const result = await router.classify('Biology', { testId });
    assert.equal(result.reason, 'timeout');
    assert.equal(result.courseId, null);
    assert.equal(signal.aborted, true);
    assert.deepEqual(meter.finishes, [{ status: 'failed' }]);
  }
});

test('abort stops classification and late bodies cannot update a finished usage entry', { timeout: 1000 }, async () => {
  const meter = ledgerFixture(), abort = new AbortController();
  let release, requestSignal;
  const router = createJevCourseRouter({ env, usageLedger: meter.ledger, fetchImpl: async (_url, options) => {
    requestSignal = options.signal;
    return { ok: true, json: () => new Promise(resolve => { release = resolve; }) };
  } });
  const pending = router.classify('Biology', { signal: abort.signal, testId });
  await new Promise(resolve => setImmediate(resolve));
  abort.abort();
  const result = await pending;
  assert.equal(result.reason, 'canceled');
  assert.equal(requestSignal.aborted, true);
  release(bodyFor());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(meter.updates, []);
  assert.deepEqual(meter.finishes, [{ status: 'canceled' }]);
});

async function fixture(t, options = {}) {
  const api = createApiHandler({ env: {}, ...options });
  const server = createServer((req, res) => { void api(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (path, body, headers = {}, method = 'POST') => fetch(`${origin}${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  return { origin, send };
}

test('course API returns normalized authoritative choice and attaches usage only to its test', async t => {
  const meter = ledgerFixture();
  let sent;
  const app = await fixture(t, { env, usageLedger: meter.ledger, fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return Response.json(bodyFor('physics')); } });
  const response = await app.send('/api/course-mosaic', { title: '  Waves & forces ', testId });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { courseId: 'physics', source: 'jev', classifiedTitle: 'Waves & forces' });
  assert.deepEqual(sent.state, { title: 'Waves & forces' });
  assert.equal(meter.starts[0][0], testId);
});

test('course API enforces same-origin, method, JSON, strict title-only schema and body limits before provider work', async t => {
  let calls = 0;
  const app = await fixture(t, { env, fetchImpl: async () => { calls++; return Response.json(bodyFor()); } });
  const cases = [
    [{ title: 'Biology' }, { Origin: 'https://outside.example' }, 'POST', 403],
    [{ title: 'Biology' }, { 'Sec-Fetch-Site': 'cross-site' }, 'POST', 403],
    [{ title: 'Biology' }, { 'Content-Type': 'text/plain' }, 'POST', 415],
    [undefined, {}, 'GET', 405],
    ['{', {}, 'POST', 400],
    [{ title: '' }, {}, 'POST', 400],
    [{ title: '  ' }, {}, 'POST', 400],
    [{ title: 123 }, {}, 'POST', 400],
    [{ title: 'x'.repeat(101) }, {}, 'POST', 400],
    [{ title: 'Biology', materials: [{ text: 'private-source-marker' }] }, {}, 'POST', 400],
    [{ title: 'Biology', testId: 'legacy-title' }, {}, 'POST', 400],
    [{ title: 'Biology', testId: null }, {}, 'POST', 400],
    [{ title: 'Biology', extra: true }, {}, 'POST', 400],
    [{ title: 'x'.repeat(3 * 1024 * 1024) }, {}, 'POST', 413],
  ];
  for (const [body, headers, method, status] of cases) {
    const response = await app.send('/api/course-mosaic', body, headers, method);
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /private-source-marker|course-test-secret/);
  }
  assert.equal(calls, 0);
});

test('course API missing-key fallback is neutral and classification has a separate rate budget from studying', async t => {
  const app = await fixture(t);
  for (let i = 0; i < 30; i++) {
    const result = await app.send('/api/course-mosaic', { title: 'Biology' });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { courseId: null, source: 'fallback', classifiedTitle: 'Biology', reason: 'missing-key' });
  }
  assert.equal((await app.send('/api/course-mosaic', { title: 'Biology' })).status, 429);
  const study = await app.send('/api/organize', { title: 'Biology', materials: [{ id: 'notes', name: 'Notes', text: 'Cells are alive.' }] });
  assert.equal(study.status, 503, 'study route reaches its configuration check rather than course rate limiting');
});

test('disconnecting the course HTTP client aborts its provider request', { timeout: 2000 }, async t => {
  let started, aborted;
  const providerStarted = new Promise(resolve => { started = resolve; });
  const providerAborted = new Promise(resolve => { aborted = resolve; });
  const app = await fixture(t, { env, fetchImpl: async (_url, options) => {
    options.signal.addEventListener('abort', aborted, { once: true });
    started();
    return new Promise(() => {});
  } });
  const outgoing = request(`${app.origin}/api/course-mosaic`, { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' } });
  outgoing.on('error', () => {});
  outgoing.end(JSON.stringify({ title: 'Biology' }));
  await providerStarted;
  outgoing.destroy();
  await providerAborted;
});
