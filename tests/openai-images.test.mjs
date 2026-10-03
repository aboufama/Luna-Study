import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { createOpenAIOrganizer, createOpenAILuna } from '../server/openai-luna.mjs';
import { createMaterialImageStore } from '../server/material-images.mjs';
import { checkedGrade } from '../server/mastery.mjs';
import { sourceCitationIds } from '../server/grade-citations.mjs';
import { MATERIAL_RETRIEVAL_TOOLS } from '../server/material-retrieval.mjs';

const env = { OPENAI_API_KEY: 'offline-test-key' };
const schema = { type: 'object', additionalProperties: false, required: ['reply'], properties: { reply: { type: 'string' } } };
const body = text => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const response = value => Response.json(body(JSON.stringify(value)));
function stream(output) {
  const text = typeof output === 'string' ? output : null;
  const completed = text === null ? { status: 'completed', output } : body(text);
  const events = [...(text === null ? [] : [{ type: 'response.output_text.delta', delta: text }]), { type: 'response.completed', response: completed }];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}
const parts = payload => payload.input.flatMap(item => Array.isArray(item.content) ? item.content : []);
const imageParts = payload => parts(payload).filter(part => part.type === 'input_image');
const studyInput = payload => JSON.parse(parts(payload).find(part => part.type === 'input_text').text);
const tool = id => ({ type: 'function_call', call_id: id, name: 'read_materials', arguments: '{"chunkIds":["chosen"],"sourceRevision":"current"}' });
const material = image => ({ id: image.sourceId, name: image.name, text: 'Derived search notes can be wrong: the arrow points left.' });

async function storedImages(t) {
  const directory = await mkdtemp(join(tmpdir(), 'luna-image-adapter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const imageStore = createMaterialImageStore({ directory }), testId = randomUUID(), images = [];
  for (const color of ['red', 'blue']) {
    const canvas = createCanvas(24, 16), context = canvas.getContext('2d');
    context.fillStyle = color; context.fillRect(0, 0, 24, 16);
    const saved = await imageStore.put({ testId, name: `${color}.png`, bytes: canvas.toBuffer('image/png'), mimeType: 'image/png' });
    images.push({ ...saved, sourceId: saved.id });
  }
  return { imageStore, testId, images };
}

test('organizer resolves original images from material IDs independently of text/excerpt shape and labels pixels as authoritative', async t => {
  const { imageStore, testId, images } = await storedImages(t), requests = [], events = [];
  const organizer = createOpenAIOrganizer({ env, imageStore, diagnostics: { record: (_, event) => events.push(event) }, fetchImpl: async (_, options) => { requests.push(JSON.parse(options.body)); return response({ reply: 'Verified.' }); } });
  const input = { testId: randomUUID(), materials: [{ id: images[0].sourceId, name: 'Displayed filename', excerpts: [], derivedText: 'OCR error', imageEvidence: { sourceId: images[0].sourceId } }, { id: 'text-notes', name: 'Original text', text: 'A genuine original text source.' }] };
  await organizer.organize(input, { schema, instructions: 'Study the sources.', usageContext: { testId, operation: 'grading' } });
  const payload = requests[0];
  assert.deepEqual(studyInput(payload), input);
  assert.deepEqual(imageParts(payload), [{ type: 'input_image', detail: 'high', image_url: images[0].dataUrl }]);
  const label = JSON.parse(parts(payload)[1].text).originalImage;
  assert.deepEqual(label, { sourceId: images[0].sourceId, name: 'red.png', width: 24, height: 16 });
  assert.match(payload.instructions, /pixels are the authoritative source evidence/);
  assert.match(payload.instructions, /OCR.*only navigation aids/);
  assert.doesNotMatch(JSON.stringify(events), /base64|OCR error|offline-test-key/);
  assert.equal(payload.store, false);
});

test('index chunks resolve image pixels and explicit extraction images work before store lookup', async t => {
  const { imageStore, testId, images } = await storedImages(t), requests = [];
  const organizer = createOpenAIOrganizer({ env, imageStore, fetchImpl: async (_, options) => { requests.push(JSON.parse(options.body)); return response({ reply: 'Read.' }); } });
  await organizer.organize({ chunks: [{ chunkId: 'chunk', sourceId: images[1].sourceId, excerpts: [{ id: 'derived', text: 'Navigation aid.' }] }] }, { schema, instructions: 'Index.', usageContext: { testId } });
  assert.equal(imageParts(requests[0])[0].image_url, images[1].dataUrl);
  let resolves = 0;
  const extractor = createOpenAIOrganizer({ env, imageStore: { resolve() { resolves++; throw Error('Extraction must use the explicit original.'); } }, fetchImpl: async (_, options) => { requests.push(JSON.parse(options.body)); return response({ reply: 'Read.' }); } });
  await extractor.organize({ task: 'Read original screenshot.' }, { schema, instructions: 'Extract only.', images: [images[0]], usageContext: { testId } });
  assert.equal(resolves, 0); assert.equal(imageParts(requests[1])[0].image_url, images[0].dataUrl);
});

test('both independent grading calls receive actual original pixels; derived notes cannot become a textual source citation', async t => {
  const { imageStore, testId, images } = await storedImages(t), requests = [];
  const question = { id: 'question', topicId: 'directions', sourceIds: [images[0].sourceId], question: 'Which way is the arrow pointing?', difficulty: 'hard' };
  const organizer = createOpenAIOrganizer({ env, imageStore, fetchImpl: async (_, options) => {
    const payload = JSON.parse(options.body); requests.push(payload);
    const input = studyInput(payload);
    assert.deepEqual(input.materials[0].excerpts, []);
    assert.equal(input.materials[0].textOrigin, 'derived-image-text');
    return response({ questionId: question.id, topicId: question.topicId, sourceIds: question.sourceIds, verdict: 'correct', reasoningSufficient: true, assistanceUsed: false,
      assistanceCitationIds: [], answerCitationIds: [input.answerExcerpts[0].id], sourceCitationIds: sourceCitationIds(input) });
  } });
  const grade = await checkedGrade({ organizer, testId, question, answer: 'The arrow points right.', materials: [material(images[0])], conversation: [] });
  assert.deepEqual(grade, { verdict: 'correct', unassisted: true, checked: true });
  assert.equal(requests.length, 2);
  for (const request of requests) assert.equal(imageParts(request)[0].image_url, images[0].dataUrl);
  assert.deepEqual(requests[0].input, requests[1].input, 'the second independent check sees the same original pixels and no first verdict');
});

test('tutor receives selected originals initially and newly retrieved pixels in tool continuations exactly once', async t => {
  const { imageStore, testId, images } = await storedImages(t), requests = [], resolves = [], spoken = [];
  const store = { resolve: async options => { resolves.push(options); return imageStore.resolve(options); } };
  const luna = createOpenAILuna({ env, imageStore: store, fetchImpl: async (_, options) => {
    const payload = JSON.parse(options.body); requests.push(payload);
    if (requests.length < 3) return stream([tool(`read-${requests.length}`)]);
    return stream('<say>Look at the arrow in the original diagram.</say>');
  } });
  t.after(() => luna.close());
  const result = await luna.respond({ testId, materials: [material(images[0])] }, { onText: value => spoken.push(value), retrieval: { tools: MATERIAL_RETRIEVAL_TOOLS,
    execute: () => ({ passages: [{ sourceId: images[1].sourceId, text: 'Derived visual search notes.' }, { sourceId: images[0].sourceId, text: 'Another derived passage.' }] }),
  } });
  assert.deepEqual(requests.map(request => imageParts(request).length), [1, 2, 2]);
  assert.deepEqual(imageParts(requests[1]).map(part => part.image_url), images.map(image => image.dataUrl));
  assert.equal(requests[1].input.at(-2).type, 'function_call_output');
  assert.equal(requests[1].input.at(-1).role, 'user');
  assert.deepEqual(resolves, [{ testId, sourceIds: [images[0].sourceId] }, { testId, sourceIds: [images[1].sourceId] }]);
  assert.equal(result.timings.modelRequests, 3);
  assert.equal(spoken.join(''), result.reply);
  assert.doesNotMatch(JSON.stringify({ result, spoken }), /base64|Derived visual|offline-test-key/);
});

test('missing, foreign, malformed or substituted image references fail before any provider call', async t => {
  const { imageStore, testId, images } = await storedImages(t);
  for (const [name, input, store, explicit] of [
    ['missing store', { testId, materials: [material(images[0])] }, undefined],
    ['missing test', { materials: [material(images[0])] }, imageStore],
    ['foreign test', { testId: randomUUID(), materials: [material(images[0])] }, imageStore],
    ['malformed reserved ID', { testId, materials: [{ id: 'img-forged', text: 'Fake' }] }, imageStore],
    ['store omitted image', { testId, materials: [material(images[0])] }, { resolve: async () => [] }],
    ['store substituted image', { testId, materials: [material(images[0])] }, { resolve: async () => [images[1]] }],
    ['explicit hash mismatch', {}, undefined, [{ ...images[0], dataUrl: images[1].dataUrl }]],
    ['explicit remote URL', {}, undefined, [{ ...images[0], dataUrl: 'https://example.invalid/image.png' }]],
    ['explicit omissions', { materials: [material(images[0])] }, undefined, []],
  ]) await t.test(name, async () => {
    let requests = 0;
    const organizer = createOpenAIOrganizer({ env, imageStore: store, fetchImpl: async () => { requests++; return response({ reply: 'Must not happen.' }); } });
    await assert.rejects(organizer.organize(input, { schema, instructions: 'Read.', ...(explicit === undefined ? {} : { images: explicit }) }), error => [400, 409].includes(error.status));
    assert.equal(requests, 0);
  });
});

test('image bytes have a separate bound while ordinary context and provider response caps remain enforced', async t => {
  const raw = Buffer.alloc(3 * 1024 * 1024, 1);
  const original = { sourceId: `img-${createHash('sha256').update(raw).digest('hex')}`, name: 'Transport fixture.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${raw.toString('base64')}`, width: 10, height: 10 };
  // The store/importer independently decodes real images. This mock isolates the transport byte budget.
  let requests = 0;
  const organizer = createOpenAIOrganizer({ env, fetchImpl: async (_, options) => { requests++; assert.ok(options.body.length > 2 * 1024 * 1024); return response({ reply: 'Read.' }); } });
  await organizer.organize({ task: 'Read.' }, { schema, instructions: 'Read.', images: [original] });
  await assert.rejects(organizer.organize({ text: 'x'.repeat(2 * 1024 * 1024) }, { schema, instructions: 'Read.', images: [original] }), error => error.status === 400);
  const oversized = Buffer.alloc(20 * 1024 * 1024 + 1, 1);
  await assert.rejects(organizer.organize({}, { schema, instructions: 'Read.', images: [{ ...original, dataUrl: `data:image/png;base64,${oversized.toString('base64')}` }] }), error => error.status === 413);
  assert.equal(requests, 1);
  const luna = createOpenAILuna({ env, imageStore: { resolve: async () => [original] }, fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'text/event-stream' } }) });
  t.after(() => luna.close());
  await assert.rejects(luna.respond({ testId: randomUUID(), materials: [material(original)] }), error => error.status === 502);
});

test('late image resolution after cancellation cannot start a model request or emit speech', async t => {
  const { testId, images } = await storedImages(t), controller = new AbortController();
  let release, began, requests = 0; const started = new Promise(resolve => { began = resolve; });
  const luna = createOpenAILuna({ env, imageStore: { resolve: () => { began(); return new Promise(resolve => { release = resolve; }); } }, fetchImpl: async () => { requests++; return stream('<say>Late.</say>'); } });
  t.after(() => luna.close());
  const spoken = [], pending = luna.respond({ testId, materials: [material(images[0])] }, { signal: controller.signal, onText: value => spoken.push(value) });
  const rejected = assert.rejects(pending, error => error.status === 499);
  await started; controller.abort(); await rejected; release([images[0]]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 0); assert.deepEqual(spoken, []);
});
