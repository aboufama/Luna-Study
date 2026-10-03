// Verified public rates are estimates of measured usage, never account charges.
// Keep model allowlists explicit: aliases and plan rates can change independently.
const VERIFIED_AT = '2026-10-02';
const OPENAI_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-6-luna';
const CACHE_SOURCE = 'https://developers.openai.com/api/docs/guides/prompt-caching';
const JEV_SOURCE = 'https://docs.typesafe.ai/models';
const ELEVEN_SOURCE = 'https://elevenlabs.io/pricing/api';
const SCRIBE_METERING = 'https://elevenlabs.io/docs/overview/capabilities/speech-to-text';
const PROMO_START = Date.parse('2026-10-02T00:00:00Z');
// The offer says “until Oct 12” without a timezone; do not extend it into that day.
const PROMO_END = Date.parse('2026-10-12T00:00:00Z');
const TIERS = Object.freeze({ standard: 1, default: 1, auto: 1, flex: .5, batch: .5, fast: 2, priority: 2 });
const JEV_MODELS = new Set(['jev-1.13.0', 'jev-latest', 'jev-preview']);
const count = value => Number.isSafeInteger(value) && value >= 0;
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const present = (object, key) => Object.hasOwn(object, key);

export const pricingSources = Object.freeze([
  Object.freeze({ rateId: 'openai-gpt-6-luna-2026-10-02', source: OPENAI_SOURCE, verifiedAt: VERIFIED_AT, meteringSource: CACHE_SOURCE }),
  Object.freeze({ rateId: 'typesafe-jev-1.13-2026-10-02', source: JEV_SOURCE, verifiedAt: VERIFIED_AT }),
  Object.freeze({ rateId: 'eleven-v4-promo-2026-10-02', source: ELEVEN_SOURCE, verifiedAt: VERIFIED_AT, expiresAt: '2026-10-12T00:00:00Z' }),
  Object.freeze({ rateId: 'eleven-scribe-v2-realtime-2026-10-02', source: ELEVEN_SOURCE, verifiedAt: VERIFIED_AT, meteringSource: SCRIBE_METERING }),
]);

function result(event, usd, rateId, source, notes, partial = false) {
  if (!duration(usd)) return null;
  const roundedUsd = Math.round(usd * 1e12) / 1e12;
  if (!duration(roundedUsd)) return null;
  if (event.status !== 'completed') {
    partial = true;
    notes.push('Measured usage may be incomplete for this pending, interrupted, canceled, or failed request.');
  }
  return {
    // Pico-dollar precision retains sub-cent usage without binary float display noise.
    usd: roundedUsd,
    rateId, source, verifiedAt: VERIFIED_AT, partial,
    notes: ['Public list-price estimate, not a billed charge. Account allowances, credits, negotiated rates, and taxes are excluded.', ...notes],
  };
}

/** Pure: rates depend on the recorded event, never today's clock or account state. */
export function estimateUsage(event) {
  if (!event || typeof event !== 'object' || !event.units || typeof event.units !== 'object') return null;
  const units = event.units;
  if (event.provider === 'openai' && event.model === 'gpt-6-luna') {
    if (!count(units.inputTokens) || !count(units.outputTokens)) return null;
    const tier = event.serviceTier ?? 'standard';
    if (!Object.hasOwn(TIERS, tier)) return null;
    let partial = false;
    const notes = ['Uses global processing rates; any regional processing premium is excluded.'];
    if (event.serviceTier == null || ['default', 'auto'].includes(tier)) notes.push('Standard processing rates are assumed because an explicit priced service tier was not recorded.');
    let cached = 0, writes = 0;
    if (present(units, 'cachedInputTokens')) {
      if (!count(units.cachedInputTokens)) return null;
      cached = units.cachedInputTokens;
    } else {
      partial = true;
      notes.push('Cache-read counts were not reported; input is estimated at the ordinary rate without assuming a cache discount.');
    }
    if (present(units, 'cacheWriteTokens')) {
      if (!count(units.cacheWriteTokens)) return null;
      writes = units.cacheWriteTokens;
    } else {
      partial = true;
      notes.push('Cache-write counts were not reported; unreported cache-write premiums are excluded.');
    }
    if (cached > units.inputTokens || writes > units.inputTokens - cached) return null;
    // Both cache counters are disjoint input-token subsets; reasoning is already
    // included in outputTokens and must never be charged for a second time.
    const ordinary = units.inputTokens - cached - writes;
    const long = units.inputTokens > 272_000;
    const input = (ordinary * .10 + cached * .01 + writes * .125) * (long ? 2 : 1);
    const output = units.outputTokens * .50 * (long ? 1.5 : 1);
    if (long) notes.push('The full request uses the published long-context multipliers above 272,000 input tokens.');
    return result(event, (input + output) * TIERS[tier] / 1_000_000, `openai-gpt-6-luna-2026-10-02:${tier}${long ? ':long-context' : ''}`, OPENAI_SOURCE, notes, partial);
  }
  if (event.provider === 'typesafe' && JEV_MODELS.has(event.model)) {
    if (!count(units.inputTokens)) return null;
    const notes = ['Jev is priced per input token; output tokens have no list-price charge.'];
    if (event.model !== 'jev-1.13.0') notes.push('The recorded alias is estimated using its verified Jev 1.13 mapping; future alias changes require a rate refresh.');
    return result(event, units.inputTokens * .042 / 1_000_000, 'typesafe-jev-1.13-2026-10-02', JEV_SOURCE, notes);
  }
  if (event.provider === 'elevenlabs') {
    if (['eleven_v4', 'eleven_v4_turbo'].includes(event.model)) {
      const at = typeof event.at === 'string' ? Date.parse(event.at) : NaN;
      if (!Number.isFinite(at) || at < PROMO_START || at >= PROMO_END || !count(units.characters)) return null;
      const rate = event.model === 'eleven_v4_turbo' ? .011 : .022;
      return result(event, units.characters * rate / 1000, `eleven-v4-promo-2026-10-02:${event.model}`, ELEVEN_SOURCE, [
        'Uses the published promotional character rate for the recorded request date; no promotional rate is assumed from October 12 onward.',
        'Characters measure submitted text, not verified billed characters or played audio.',
      ]);
    }
    if (event.model === 'scribe_v2_realtime') {
      if (!duration(units.audioInputMs)) return null;
      return result(event, units.audioInputMs * .39 / 3_600_000, 'eleven-scribe-v2-realtime-2026-10-02', ELEVEN_SOURCE, [
        `Uses measured audio sent, not connection time or speech-only time (${SCRIBE_METERING}).`,
        'Base transcription estimate excludes unverified billing rounding and optional transcription add-ons; no minimum duration is invented.',
      ]);
    }
  }
  // Signed-in Codex plan usage and unverified providers/models are not API bills.
  return null;
}
