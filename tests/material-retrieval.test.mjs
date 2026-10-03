import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createMaterialRetrieval, MATERIAL_RETRIEVAL_TOOLS } from '../server/material-retrieval.mjs';

const source = (id, text) => ({ id, name: `${id}.md`, text });
const game = source('games', '# Coordination games\n\nA strict equilibrium is a mutual strict best response. The two players choose a row and a column.\n\n');
const bio = source('biology', '# Membranes\n\nActive transport uses energy to move against a gradient. Passive diffusion moves down a gradient.\n\n');
const env = { TYPESAFE_API_KEY: 'mock-only', TYPESAFE_MODEL: 'jev-latest' };
const response = (request, score = () => .9) => new Response(JSON.stringify({ answers: Object.fromEntries(request.state.candidates.map(chunk => [chunk.chunkId, { type: 'noul', noul: score(chunk) }])), usage: { input_tokens: 100, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
function mock(score) {
  const requests = [], meters = [], events = [];
  return {
    requests, meters, events,
    fetchImpl: async (url, options) => { assert.equal(url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(options.redirect, 'error'); const request = JSON.parse(options.body); requests.push(request); return response(request, score); },
    usageLedger: { start(testId, metadata) { const meter = { testId, ...metadata }; meters.push(meter); return { update(value) { meter.usage = value; }, finish(value) { meter.final = value; } }; } },
    diagnostics: { record(testId, event) { events.push({ testId, ...event }); } },
  };
}
function exactOriginals(result, originals) {
  for (const passage of result.passages) assert.equal(passage.text, originals.find(value => value.id === passage.sourceId).text.slice(passage.start, passage.end));
  assert.equal(new Set(result.passages.map(value => value.chunkId)).size, result.passages.length);
}

test('Jev selects known original passages, pins active question sources, and never receives a private answer', async () => {
  const injected = mock(chunk => chunk.sourceId === 'biology' ? .93 : .02);
  const retrieval = createMaterialRetrieval({ materials: [game, bio], title: 'Review', env, ...injected });
  const result = await retrieval.prefetch({ query: 'Compare active transport and diffusion', activeQuestion: { question: 'What is a strict best response?', answer: 'private-answer-do-not-send', sourceIds: ['games'] } }, { testId: 'test-one' });
  assert.equal(result.status, 'selected'); assert.equal(result.unresolved, false);
  assert.deepEqual(new Set(result.materials.map(value => value.id)), new Set(['games', 'biology']));
  exactOriginals(result, [game, bio]);
  assert.equal(JSON.stringify(injected.requests).includes('private-answer-do-not-send'), false);
  assert.equal(injected.requests.length, 1); assert.equal(injected.meters[0].operation, 'material-prefetch');
  assert.equal(injected.meters[0].testId, 'test-one'); assert.deepEqual(injected.meters[0].usage.units, { inputTokens: 100, outputTokens: 10 });
  assert.equal(injected.meters[0].final.status, 'completed');
  assert.equal(JSON.stringify(injected.events).includes('strict equilibrium'), false);
  assert.equal(JSON.stringify(injected.events).includes('Compare active transport'), false);
});

test('unknown routing keeps working originals and new pinned evidence, explicitly unresolved', async () => {
  const injected = mock(() => .3), retrieval = createMaterialRetrieval({ materials: [game, bio], env, ...injected });
  const before = retrieval.snapshot();
  retrieval.read({ sourceRevision: before.sourceRevision, chunkIds: [before.catalog.sources.find(value => value.sourceId === 'games').firstChunkId] });
  const result = await retrieval.prefetch({ query: 'What about this?', activeQuestion: { question: { question: 'Energy?', sourceIds: ['biology'] } } });
  assert.equal(result.unresolved, true); assert.equal(result.retrievalStatus.reason, 'uncertain-or-no-match');
  assert.deepEqual(new Set(result.materials.map(value => value.id)), new Set(['biology', 'games'])); exactOriginals(result, [game, bio]);
});

test('missing credentials do not call a provider or silently include the entire corpus', async () => {
  const retrieval = createMaterialRetrieval({ materials: [game, bio], env: {}, fetchImpl() { throw Error('Unexpected provider call'); } });
  const result = await retrieval.prefetch({ query: 'Explain diffusion' });
  assert.equal(result.unresolved, true); assert.equal(result.retrievalStatus.reason, 'missing-key');
  assert.deepEqual(result.materials.map(material => material.id), ['biology']);
  assert.equal(result.retrievalStatus.fallbackMethod, 'current-query-lexical-evidence');
  exactOriginals(result, [game, bio]);
  assert.equal(result.catalog.totalSources, 2);
});

test('uncertain routing prioritizes the explicitly named current source ahead of stale working passages', async () => {
  const old = { id: 'old', name: 'Practice_Notes_1.pdf', text: 'Earlier source about comparing measurements and explaining the examples.' };
  const current = { id: 'current', name: 'Practice_Notes_2.pdf', text: 'For trial 4 the recorded measurements are 17, 29, and 41.' };
  const injected = mock(() => .3), retrieval = createMaterialRetrieval({ materials: [old, current], env, ...injected, maxPassages: 1 });
  const before = retrieval.snapshot();
  retrieval.read({ sourceRevision: before.sourceRevision, chunkIds: [before.catalog.sources.find(value => value.sourceId === 'old').firstChunkId] });
  const result = await retrieval.prefetch({ query: 'In Practice Notes 2, read the recorded measurements for trial 4.' });
  assert.equal(result.unresolved, true); assert.equal(result.retrievalStatus.reason, 'uncertain-or-no-match');
  assert.equal(result.retrievalStatus.fallbackMethod, 'current-query-lexical-evidence');
  assert.equal(injected.requests[0].state.candidates[0].sourceId, 'current');
  assert.deepEqual(result.materials.map(material => material.id), ['current']);
  assert.equal(result.materials[0].text, current.text);
});

test('uncertain lexical evidence retains pinned sources and single-letter strategies and quantities', async () => {
  const old = source('old', 'Earlier chapter about an unrelated alphabet.'), current = source('current', 'X gives 7 units and Y gives 9 units.'), pinned = source('pinned', 'The ongoing exercise uses the observed units.');
  const injected = mock(() => .3), retrieval = createMaterialRetrieval({ materials: [old, current, pinned], env, ...injected, maxPassages: 2 });
  const before = retrieval.snapshot();
  retrieval.read({ sourceRevision: before.sourceRevision, chunkIds: [before.catalog.sources.find(value => value.sourceId === 'old').firstChunkId] });
  const result = await retrieval.prefetch({ query: 'How do X and Y compare at 7 and 9?', activeQuestion: { question: 'Use the ongoing exercise.', sourceIds: ['pinned'] } });
  assert.equal(result.unresolved, true);
  assert.deepEqual(result.materials.map(material => material.id), ['pinned', 'current']);
  assert.deepEqual(result.coverage.missingPinnedSourceIds, []);
  exactOriginals(result, [old, current, pinned]);
});

test('missing active-question source IDs are reported instead of claiming complete pinned coverage', async () => {
  const retrieval = createMaterialRetrieval({ materials: [game], env, ...mock() });
  const result = await retrieval.prefetch({ query: 'strict equilibrium', activeQuestion: { sourceIds: ['games', 'removed-source'] } });
  assert.equal(result.unresolved, true); assert.deepEqual(result.coverage.missingPinnedSourceIds, ['removed-source']);
});

test('Jev candidate previews include a matching original passage beyond the first 300 characters', async () => {
  const original = source('late-evidence', 'Neutral lead-in. '.repeat(40) + 'Distinctivechloroplast supports the requested comparison.'), injected = mock();
  const retrieval = createMaterialRetrieval({ materials: [original], env, ...injected });
  await retrieval.prefetch({ query: 'Distinctivechloroplast' });
  assert.ok(injected.requests[0].state.candidates[0].excerpt.includes('Distinctivechloroplast'));
  assert.ok(original.text.includes(injected.requests[0].state.candidates[0].excerpt));
});

test('candidate windows seek distinctive evidence instead of the earliest generic query word', async () => {
  const original = source('late-evidence', ('In the introduction, the material is discussed in general. ').repeat(20) + 'Specific comparison: option U has 7 units, option R has 9 units, and option B has 13 units. Distinctivechloroplast is the labeled comparison.');
  const injected = mock(), retrieval = createMaterialRetrieval({ materials: [original], env, ...injected });
  await retrieval.prefetch({ query: 'In the material, read the Distinctivechloroplast comparison for U, R, and B at 7, 9, and 13.' });
  const preview = injected.requests[0].state.candidates[0].excerpt;
  assert.ok(preview.length <= 800);
  assert.match(preview, /Distinctivechloroplast/);
  assert.match(preview, /option U has 7 units/);
  assert.ok(original.text.includes(preview));
});

test('chunk IDs are deterministic, offsets preserve every Unicode character, and neighbors retain original context', () => {
  const original = source('unicode', '# Equations\n\n' + ('An example uses α and an emoji 🧠 with surrounding context.\n\n').repeat(35));
  const first = createMaterialRetrieval({ materials: [original], chunkChars: 500, maxPassageChars: 4000 });
  const second = createMaterialRetrieval({ materials: [original], chunkChars: 500, maxPassageChars: 4000 });
  const snapshot = first.snapshot(); assert.deepEqual(snapshot.catalog, second.snapshot().catalog);
  const read = first.read({ sourceRevision: snapshot.sourceRevision, chunkIds: [snapshot.catalog.sources[0].firstChunkId] });
  assert.ok(read.passages.length > 1); exactOriginals(read, [original]);
  for (const passage of read.passages) { assert.ok(passage.text.length <= 500); assert.equal(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(passage.text), false); }
  assert.ok(read.passages.some(passage => passage.start === read.passages[0].end));
});

test('search filters exact known source IDs and tools reject stale, unknown, or malformed requests', async () => {
  const retrieval = createMaterialRetrieval({ materials: [game, bio] }), { sourceRevision, catalog } = retrieval.snapshot();
  const result = retrieval.execute('search_materials', { query: 'gradient', sourceIds: ['biology'], sourceRevision });
  assert.ok(result.passages.length); assert.ok(result.passages.every(passage => passage.sourceId === 'biology'));
  assert.equal(Object.hasOwn(result, 'materials'), false); assert.equal(Object.hasOwn(result, 'catalog'), false);
  assert.equal(retrieval.read({ sourceRevision, chunkIds: ['invented'] }).error.code, 'unknown-chunk-id');
  assert.equal(retrieval.search({ sourceRevision, query: 'gradient', sourceIds: ['invented'] }).error.code, 'unknown-source-id');
  assert.equal(retrieval.read({ sourceRevision: 'stale', chunkIds: [catalog.sources[0].firstChunkId] }).error.code, 'stale-source-revision');
  assert.equal(retrieval.execute('shell', {}).error.code, 'unknown-tool');
  assert.equal(retrieval.read({ sourceRevision, chunkIds: [] }).error.code, 'invalid-arguments');
  const none = retrieval.search({ sourceRevision, query: 'zzzznotfound', sourceIds: null }); assert.equal(none.unresolved, true); assert.deepEqual(none.passages, []);
});

test('passage and catalog budgets remain bounded and omitted pinned sources are explicit', async () => {
  const originals = Array.from({ length: 12 }, (_, index) => source(`s-${index}`, `# Material ${index}\n\n` + 'Original context and evidence. '.repeat(50)));
  const injected = mock(() => .95), retrieval = createMaterialRetrieval({ materials: originals, env, ...injected, chunkChars: 500, maxPassageChars: 1000, maxPassages: 2, maxCatalogChars: 1000, maxCandidates: 5 });
  const result = await retrieval.prefetch({ query: 'context', activeQuestion: { question: 'Compare these sources', sourceIds: originals.map(value => value.id) } });
  assert.equal(injected.requests[0].state.candidates.length, 5);
  assert.ok(result.materials.reduce((sum, value) => sum + value.text.length, 0) <= 1000);
  assert.ok(result.passages.length <= 2); assert.ok(JSON.stringify(result.catalog).length <= 1000);
  assert.ok(result.coverage.missingPinnedSourceIds.length); assert.equal(result.unresolved, true); assert.ok(result.catalog.omittedSources);
  exactOriginals(result, originals);
});

test('invalid provider output falls back without invented passage IDs and preserves measured usage', async () => {
  const injected = mock();
  injected.fetchImpl = async () => new Response(JSON.stringify({ answers: { invented: { type: 'noul', noul: .99 } }, usage: { input_tokens: 30 } }));
  const retrieval = createMaterialRetrieval({ materials: [game], env, ...injected });
  const result = await retrieval.prefetch({ query: 'game', activeQuestion: { sourceIds: ['games'] } });
  assert.equal(result.retrievalStatus.reason, 'invalid-response'); exactOriginals(result, [game]);
  assert.deepEqual(injected.meters[0].usage.units, { inputTokens: 30 }); assert.equal(injected.meters[0].final.status, 'failed');
});

test('complete fetch plus body read is deadline bounded when injected transport ignores abort', async () => {
  const retrieval = createMaterialRetrieval({ materials: [game], env, timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({ start() {} })) });
  const began = performance.now(); const result = await retrieval.prefetch({ query: 'game' });
  assert.ok(performance.now() - began < 250); assert.equal(result.retrievalStatus.reason, 'timeout'); assert.equal(result.unresolved, true);
});

test('source replacement cancels stale prefetch and invalidates old reads without exposing old text', async () => {
  let release, request;
  const retrieval = createMaterialRetrieval({ materials: [game], env, fetchImpl: (_, options) => { request = JSON.parse(options.body); return new Promise(resolve => { release = resolve; }); } });
  const old = retrieval.snapshot(), pending = retrieval.prefetch({ query: 'games' });
  await setImmediate(); retrieval.update({ materials: [bio] });
  const canceled = await pending; assert.equal(canceled.status, 'canceled');
  release(response(request)); await setImmediate();
  assert.equal(JSON.stringify(retrieval.snapshot()).includes(game.text), false);
  assert.equal(retrieval.read({ sourceRevision: old.sourceRevision, chunkIds: [old.catalog.sources[0].firstChunkId] }).error.code, 'stale-source-revision');
});

test('newer prefetch supersedes older work and early abort or close never makes another provider call', async () => {
  const waiting = [];
  const retrieval = createMaterialRetrieval({ materials: [game, bio], env, fetchImpl: (_, options) => new Promise(resolve => waiting.push({ resolve, request: JSON.parse(options.body), signal: options.signal })) });
  const first = retrieval.prefetch({ query: 'game' }); await setImmediate();
  const second = retrieval.prefetch({ query: 'gradient' }); await setImmediate();
  assert.equal(waiting[0].signal.aborted, true); assert.equal((await first).status, 'canceled');
  waiting[1].resolve(response(waiting[1].request, chunk => chunk.sourceId === 'biology' ? .99 : .01));
  assert.equal((await second).status, 'selected');
  waiting[0].resolve(response(waiting[0].request)); await setImmediate();
  const controller = new AbortController(); controller.abort();
  assert.equal((await retrieval.prefetch({ query: 'game' }, { signal: controller.signal })).status, 'canceled');
  retrieval.close(); assert.equal((await retrieval.prefetch({ query: 'game' })).status, 'canceled'); assert.equal(waiting.length, 2);
});

test('strict Responses tool schemas require explicit revision and scope fields', () => {
  assert.deepEqual(MATERIAL_RETRIEVAL_TOOLS.map(tool => tool.name), ['search_materials', 'read_materials']);
  for (const tool of MATERIAL_RETRIEVAL_TOOLS) {
    assert.equal(tool.type, 'function'); assert.equal(tool.strict, true); assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual(new Set(tool.parameters.required), new Set(Object.keys(tool.parameters.properties)));
  }
});

test('source limits reject duplicate identities and oversized corpora before any provider work', () => {
  assert.throws(() => createMaterialRetrieval({ materials: [game, game] }), /Invalid retrieval source/);
  assert.throws(() => createMaterialRetrieval({ materials: [source('huge', 'x'.repeat(500001))] }), /Invalid retrieval source/);
});
