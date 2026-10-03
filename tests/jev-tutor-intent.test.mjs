import test from 'node:test';
import assert from 'node:assert/strict';
import { createJevTutorIntentRouter, createMasteryNoticeDelivery } from '../server/jev-tutor-intent.mjs';

const env = { TYPESAFE_API_KEY: 'test-only' };
const response = probability => ({ ok: true, json: async () => ({ answers: { acknowledges_mastery: { type: 'noul', noul: probability } } }) });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('tutor acknowledgment classification sends only the public reply and topic to Jev', async () => {
  let sent;
  const router = createJevTutorIntentRouter({ env, fetchImpl: async (url, options) => { sent = { url, options, body: JSON.parse(options.body) }; return response(.97); } });
  const result = await router.classify('You have a complete command of diffusion now.', { topic: 'Diffusion', materials: ['PRIVATE'], referenceAnswer: 'PRIVATE', progress: 'PRIVATE' });
  assert.deepEqual(result, { acknowledgesMastery: true, source: 'jev' });
  assert.equal(sent.url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.headers.Authorization, 'Bearer test-only');
  assert.deepEqual(sent.body.state, { assistant_response: 'You have a complete command of diffusion now.', topic: 'Diffusion' });
  assert.equal(JSON.stringify(sent.body).includes('PRIVATE'), false);
  assert.equal(sent.body.questions.acknowledges_mastery.type, 'noul');
});

test('Jev decisions replace keyword heuristics and uncertain results stay pending', async () => {
  for (const [probability, expected] of [[.99, true], [.85, true], [.84, null], [.5, null], [.2, false], [0, false], [null, null], ['true', null], [1.1, null]]) {
    const router = createJevTutorIntentRouter({ env, fetchImpl: async () => response(probability) });
    assert.equal((await router.classify('You have mastered Diffusion.', { topic: 'Diffusion' })).acknowledgesMastery, expected);
  }
  const offline = createJevTutorIntentRouter({ env: {}, fetchImpl: () => { throw Error('must not call'); } });
  assert.equal((await offline.classify('You have mastered Diffusion.', { topic: 'Diffusion' })).acknowledgesMastery, null);
  const malformed = createJevTutorIntentRouter({ env, fetchImpl: async () => ({ ok: true, json: async () => ({ answers: { acknowledges_mastery: { type: 'choice', noul: 1 } } }) }) });
  assert.equal((await malformed.classify('Congratulations.', { topic: 'Diffusion' })).acknowledgesMastery, null);
});

test('missing context, failures and cancellation never consume an acknowledgment', async () => {
  const controller = new AbortController(); controller.abort();
  const offline = createJevTutorIntentRouter({ env, fetchImpl: async () => { throw Error('private provider detail'); } });
  assert.equal((await offline.classify('', { topic: 'Diffusion' })).reason, 'missing-context');
  assert.equal((await offline.classify('Well done.', { topic: 'Diffusion' }, { signal: controller.signal })).reason, 'canceled');
  const result = await offline.classify('You mastered Diffusion.', { topic: 'Diffusion' });
  assert.equal(result.acknowledgesMastery, null); assert.equal(JSON.stringify(result).includes('private'), false);
});

test('the deadline includes stalled headers and body, and cancellation aborts in flight', async () => {
  for (const body of [false, true]) {
    let signal;
    const router = createJevTutorIntentRouter({ env, timeoutMs: 5, fetchImpl: async (_, options) => {
      signal = options.signal; return body ? { ok: true, json: () => new Promise(() => {}) } : new Promise(() => {});
    } });
    assert.equal((await router.classify('Well done.', { topic: 'Diffusion' })).reason, 'timeout');
    assert.equal(signal.aborted, true);
  }
  const controller = new AbortController(); let signal;
  const router = createJevTutorIntentRouter({ env, fetchImpl: async (_, options) => { signal = options.signal; return new Promise(() => {}); } });
  const pending = router.classify('Well done.', { topic: 'Diffusion' }, { signal: controller.signal });
  controller.abort(); assert.equal((await pending).reason, 'canceled'); assert.equal(signal.aborted, true);
});

test('mastery delivery acknowledges once whether speech or Jev finishes first', async () => {
  for (const audioFirst of [true, false]) {
    let resolve, acknowledgments = 0;
    const delivery = createMasteryNoticeDelivery({ router: { classify: () => new Promise(done => { resolve = done; }) }, reply: 'Well done.', topic: 'Diffusion', isCurrent: () => true, onAcknowledged: () => { acknowledgments++; } });
    await tick();
    if (audioFirst) { delivery.finish(); assert.equal(acknowledgments, 0); }
    resolve({ acknowledgesMastery: true }); await tick();
    if (!audioFirst) { assert.equal(acknowledgments, 0); delivery.finish(); }
    delivery.finish(); await tick(); assert.equal(acknowledgments, 1);
  }
});

test('interrupted, superseded, negative, unknown and failed delivery classifications stay pending', async () => {
  for (const kind of ['interrupted', 'superseded', 'negative', 'unknown', 'failed']) {
    let resolve, reject, current = true, acknowledgments = 0;
    const controller = new AbortController();
    const delivery = createMasteryNoticeDelivery({ router: { classify: () => new Promise((yes, no) => { resolve = yes; reject = no; }) }, reply: 'Well done.', topic: 'Diffusion', signal: controller.signal, isCurrent: () => current, onAcknowledged: () => { acknowledgments++; } });
    await tick(); delivery.finish();
    if (kind === 'interrupted') controller.abort();
    if (kind === 'superseded') current = false;
    if (kind === 'failed') reject(Error('unavailable'));
    else resolve({ acknowledgesMastery: kind === 'negative' ? false : kind === 'unknown' ? null : true });
    await tick(); delivery.finish(); assert.equal(acknowledgments, 0, kind);
  }
});
