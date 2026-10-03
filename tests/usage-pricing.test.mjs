import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateUsage, pricingSources } from '../server/usage-pricing.mjs';

const event = (overrides = {}) => ({ provider: 'openai', model: 'gpt-6-luna', at: '2026-10-02T12:00:00Z', status: 'completed', serviceTier: 'standard', units: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200, cacheWriteTokens: 300 }, ...overrides });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('Luna prices disjoint ordinary/cache-read/cache-write tokens without counting reasoning twice', () => {
  const input = event();
  const frozen = structuredClone(input);
  const estimate = estimateUsage(input);
  // 500*.10 + 200*.01 + 300*.125 + 100*.50, divided by one million.
  near(estimate.usd, .0001395);
  assert.equal(estimate.partial, false);
  assert.equal(estimate.verifiedAt, '2026-10-02');
  assert.equal(estimate.source, 'https://developers.openai.com/api/docs/models/gpt-6-luna');
  assert.match(estimate.notes.join(' '), /not a billed charge/);
  assert.equal(estimateUsage(event({ units: { ...input.units, reasoningTokens: 90 } })).usd, estimate.usd);
  assert.deepEqual(input, frozen, 'estimation never mutates event or counters');
});

test('long-context boundary and service tiers apply to the correct complete-request rates', () => {
  const base = { inputTokens: 272000, outputTokens: 1000, cachedInputTokens: 72000, cacheWriteTokens: 100000 };
  near(estimateUsage(event({ units: base })).usd, .02372);
  near(estimateUsage(event({ units: { ...base, inputTokens: 272001 } })).usd, .0471902);
  const standard = estimateUsage(event()).usd;
  for (const [tier, factor] of [['flex', .5], ['batch', .5], ['fast', 2], ['priority', 2]]) near(estimateUsage(event({ serviceTier: tier })).usd, standard * factor);
  for (const tier of [undefined, null, 'default', 'auto']) {
    const estimate = estimateUsage(event({ serviceTier: tier }));
    near(estimate.usd, standard); assert.match(estimate.notes.join(' '), /Standard processing rates are assumed/);
  }
  for (const tier of ['enterprise', '', 'scale', {}, 'toString']) assert.equal(estimateUsage(event({ serviceTier: tier })), null);
});

test('Terra uses its own input, output, and cache rates with the published tier and long-context adjustments', () => {
  const terra = overrides => event({ model: 'gpt-5.6-terra', ...overrides });
  const estimate = estimateUsage(terra());
  near(estimate.usd, .00299);
  assert.equal(estimate.source, 'https://developers.openai.com/api/docs/models/gpt-5.6-terra');
  assert.match(estimate.rateId, /^openai-gpt-5\.6-terra-/);
  assert.equal(estimate.partial, false);
  assert.equal(estimateUsage(terra({ units: { ...event().units, reasoningTokens: 90 } })).usd, estimate.usd);
  const base = { inputTokens: 272000, outputTokens: 1000, cachedInputTokens: 72000, cacheWriteTokens: 100000 };
  near(estimateUsage(terra({ units: base })).usd, .4764);
  near(estimateUsage(terra({ units: { ...base, inputTokens: 272001 } })).usd, .946804);
  for (const [serviceTier, factor] of [['flex', .5], ['batch', .5], ['fast', 2], ['priority', 2]]) near(estimateUsage(terra({ serviceTier })).usd, estimate.usd * factor);
  assert.equal(estimateUsage(terra({ serviceTier: 'ultrafast' })), null);
  assert.equal(estimateUsage(terra({ units: { inputTokens: 1000, outputTokens: 100 } })).partial, true);
  assert.equal(estimateUsage(terra({ units: { inputTokens: 1000 } })), null);
});

test('missing cache details and interrupted observations are partial; missing core counts remain unknown', () => {
  for (const status of ['pending', 'canceled', 'failed', 'interrupted', undefined]) {
    const estimate = estimateUsage(event({ status }));
    assert.equal(estimate.partial, true); assert.match(estimate.notes.join(' '), /may be incomplete/);
  }
  const missingWrites = estimateUsage(event({ units: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200 } }));
  assert.equal(missingWrites.partial, true); near(missingWrites.usd, .000132);
  assert.match(missingWrites.notes.join(' '), /unreported cache-write premiums are excluded/);
  const missingCache = estimateUsage(event({ units: { inputTokens: 1000, outputTokens: 100, cacheWriteTokens: 0 } }));
  assert.equal(missingCache.partial, true); near(missingCache.usd, .00015);
  assert.match(missingCache.notes.join(' '), /without assuming a cache discount/);
  for (const units of [{}, { inputTokens: 100 }, { outputTokens: 100 }, { inputTokens: null, outputTokens: 0 }]) assert.equal(estimateUsage(event({ units })), null);
});

test('invalid or contradictory counters and unverified models/providers cannot receive guessed prices', () => {
  for (const units of [
    { inputTokens: -1, outputTokens: 0 }, { inputTokens: Infinity, outputTokens: 0 },
    { inputTokens: 1.2, outputTokens: 0 }, { inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0 },
    { inputTokens: 100, outputTokens: 1, cachedInputTokens: 101 },
    { inputTokens: 100, outputTokens: 1, cachedInputTokens: 60, cacheWriteTokens: 41 },
    { inputTokens: 100, outputTokens: 1, cachedInputTokens: null },
    { inputTokens: 100, outputTokens: 1, cacheWriteTokens: NaN },
  ]) assert.equal(estimateUsage(event({ units })), null);
  for (const provider of ['codex', 'unknown', undefined]) assert.equal(estimateUsage(event({ provider })), null);
  for (const model of ['gpt-6', 'gpt-6-luna-2026-10-02', 'gpt-6-luna-custom', 'gpt-5.6-luna']) assert.equal(estimateUsage(event({ model })), null);
  for (const invalid of [null, undefined, {}, { units: null }]) assert.equal(estimateUsage(invalid), null);
  assert.equal(estimateUsage(event({ units: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 } })).usd, 0, 'reported zero is distinct from missing');
});

test('direct Jev charges only measured input for verified model and alias names', () => {
  for (const model of ['jev-1.13.0', 'jev-latest', 'jev-preview']) {
    const estimate = estimateUsage(event({ provider: 'typesafe', model, units: { inputTokens: 1000000 } }));
    assert.equal(estimate.usd, .042); assert.equal(estimate.partial, false);
    assert.equal(estimateUsage(event({ provider: 'typesafe', model, units: { inputTokens: 1000000, outputTokens: 9999999 } })).usd, estimate.usd);
  }
  for (const model of ['jev', 'jev-1.14.0']) assert.equal(estimateUsage(event({ provider: 'typesafe', model })), null);
  assert.equal(estimateUsage(event({ provider: 'typesafe', model: 'jev-latest', units: { outputTokens: 40 } })), null);
});

test('Eleven v4 promotion is applied only to the recorded eligible date and exact models', () => {
  const voice = event({ provider: 'elevenlabs', model: 'eleven_v4_turbo', units: { characters: 1000 } });
  assert.equal(estimateUsage(voice).usd, .011);
  assert.equal(estimateUsage({ ...voice, model: 'eleven_v4' }).usd, .022);
  assert.equal(estimateUsage({ ...voice, at: '2026-10-11T23:59:59.999Z' }).usd, .011);
  for (const at of ['2026-10-12T00:00:00Z', '2026-10-13T12:00:00Z', '2027-10-02T00:00:00Z', '2026-10-01T23:59:59Z', undefined, 'invalid']) assert.equal(estimateUsage({ ...voice, at }), null);
  for (const model of ['eleven_turbo_v2_5', 'eleven_v4_turbo_custom', 'eleven_v3']) assert.equal(estimateUsage({ ...voice, model }), null);
  assert.equal(estimateUsage({ ...voice, units: { audioOutputMs: 1000 } }), null, 'never infer text characters from generated audio');
  assert.equal(estimateUsage({ ...voice, status: 'canceled' }).partial, true);
  assert.equal(estimateUsage(voice).usd, .011, 'historical event is independent of the current clock');
});

test('Scribe estimates sent audio duration only, with no invented rounding or minimum', () => {
  const speech = event({ provider: 'elevenlabs', model: 'scribe_v2_realtime', units: { audioInputMs: 3600000 } });
  assert.equal(estimateUsage(speech).usd, .39);
  const short = estimateUsage({ ...speech, units: { audioInputMs: 100 } });
  near(short.usd, .000010833333); assert.match(short.notes.join(' '), /rounding/);
  assert.equal(estimateUsage({ ...speech, units: { audioInputMs: 0 } }).usd, 0);
  for (const units of [{}, { audioOutputMs: 3600000 }, { connectionMs: 3600000 }, { audioInputMs: -1 }, { audioInputMs: Infinity }, { audioInputMs: Number.MAX_VALUE }]) assert.equal(estimateUsage({ ...speech, units }), null);
  assert.equal(estimateUsage({ ...speech, model: 'scribe_v2' }), null);
});

test('rate provenance is public, fixed, and separate from provider-reported charges', () => {
  assert.equal(pricingSources.length, 6);
  for (const source of pricingSources) { assert.match(source.source, /^https:\/\//); assert.equal(source.verifiedAt, '2026-10-02'); assert.ok(source.rateId); }
  const estimate = estimateUsage(event({ providerReportedUsd: 123 }));
  assert.equal(estimate.usd, .0001395);
  assert.equal(Object.hasOwn(estimate, 'providerReportedUsd'), false);
  assert.equal(Object.hasOwn(estimate, 'exactUsd'), false);
});

test('GPT-Live prices cumulative provider session duration including silence separately from backend tokens', () => {
  const event = { provider: 'openai', model: 'gpt-live-1', status: 'completed', units: { sessionDurationMs: 90_000, inputTokens: 5000, outputTokens: 1000 } };
  assert.equal(estimateUsage(event).usd, .075);
  assert.equal(estimateUsage(event).partial, false);
  assert.equal(estimateUsage({ ...event, status: 'canceled' }).partial, true);
  assert.equal(estimateUsage({ ...event, units: { audioInputMs: 90_000 } }), null, 'input audio alone is not provider session billing');
  assert.equal(estimateUsage({ ...event, units: { sessionDurationMs: -1 } }), null);
});
