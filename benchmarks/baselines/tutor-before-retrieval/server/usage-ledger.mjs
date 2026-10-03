import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Optional debug pricing must not make the study server unavailable while its
// module is being installed/updated. Missing rates remain explicitly unpriced.
let estimateUsage = () => null;
try { ({ estimateUsage } = await import('./usage-pricing.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND' || error.url !== new URL('./usage-pricing.mjs', import.meta.url).href) throw error; }

const DEFAULT_FILE = fileURLToPath(new URL('../data/usage-ledger.json', import.meta.url));
export const UNATTRIBUTED_TEST_ID = '__unattributed__';
const CATEGORIES = { jev: 'Jev', llm: 'Thinking / LLM', voice: 'Voice' };
const UNIT_KEYS = new Set(['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'reasoningTokens', 'characters', 'audioInputMs', 'audioOutputMs']);
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, 160) : '';
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const noop = { update() {}, finish() {} };

// Provider counters stay distinct from documented list-price estimates and billed charges.
export function tokenUsage(usage) {
  const result = {};
  for (const [key, value] of Object.entries({
    inputTokens: usage?.input_tokens ?? usage?.inputTokens,
    outputTokens: usage?.output_tokens ?? usage?.outputTokens,
    cachedInputTokens: usage?.cached_input_tokens ?? usage?.cachedInputTokens ?? usage?.input_tokens_details?.cached_tokens,
    cacheWriteTokens: usage?.cache_write_tokens ?? usage?.cacheWriteTokens ?? usage?.input_tokens_details?.cache_write_tokens,
    reasoningTokens: usage?.reasoning_tokens ?? usage?.reasoningTokens ?? usage?.reasoningOutputTokens ?? usage?.output_tokens_details?.reasoning_tokens,
  })) if (number(value)) result[key] = value;
  return result;
}

function totals(events) {
  const value = { requests: events.length, pendingRequests: 0, reportedCostRequests: 0, unpricedRequests: 0, providerReportedUsd: null, exactUsd: null, complete: false, estimatedUsd: null, estimatedRequests: 0, partialEstimatedRequests: 0, unestimatedRequests: 0, estimateComplete: false, missingUsageRequests: 0, statusCounts: {}, units: {}, unitCoverage: {} };
  const rateSources = new Map();
  for (const event of events) {
    value.statusCounts[event.status] = (value.statusCounts[event.status] || 0) + 1;
    if (event.status === 'pending') value.pendingRequests++;
    if (number(event.providerReportedUsd)) { value.reportedCostRequests++; value.providerReportedUsd = (value.providerReportedUsd ?? 0) + event.providerReportedUsd; }
    else value.unpricedRequests++;
    let measured = false;
    for (const [key, count] of Object.entries(event.units || {})) if (UNIT_KEYS.has(key) && number(count)) {
      value.units[key] = (value.units[key] || 0) + count;
      value.unitCoverage[key] = (value.unitCoverage[key] || 0) + 1;
      measured = true;
    }
    if (!measured) value.missingUsageRequests++;
    const estimate = estimateUsage(event);
    if (estimate && number(estimate.usd)) {
      value.estimatedUsd = (value.estimatedUsd ?? 0) + estimate.usd;
      value.estimatedRequests++;
      if (estimate.partial) value.partialEstimatedRequests++;
      const previous = rateSources.get(estimate.rateId);
      rateSources.set(estimate.rateId, { rateId: estimate.rateId, source: estimate.source, verifiedAt: estimate.verifiedAt, notes: [...new Set([...(previous?.notes || []), ...estimate.notes])] });
    } else value.unestimatedRequests++;
  }
  value.complete = value.requests > 0 && value.unpricedRequests === 0 && value.pendingRequests === 0;
  value.estimateComplete = value.requests > 0 && value.unestimatedRequests === 0 && value.partialEstimatedRequests === 0 && value.pendingRequests === 0;
  // Each rate result uses pico-dollar precision; do not expose binary summation
  // artifacts as additional precision in the combined estimate.
  if (value.estimatedUsd !== null) value.estimatedUsd = Math.round(value.estimatedUsd * 1e12) / 1e12;
  value.estimateSources = [...rateSources.values()];
  if (value.complete) value.exactUsd = value.providerReportedUsd;
  return value;
}

export function createUsageLedger({ file = DEFAULT_FILE, now = Date.now, idFactory = randomUUID, writeFileImpl = writeFile } = {}) {
  const events = new Map();
  let trackingStartedAt = new Date(now()).toISOString(), readError = null, writeError = null, retryMs = 1000, lastSavedAt = null, writing = null, timer, dirty = true, closed = false, flushing = 0;
  const ready = (async () => {
    if (file === null) return;
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.events) || !Number.isFinite(Date.parse(saved.trackingStartedAt))) throw new Error('Unsupported usage ledger.');
      trackingStartedAt = saved.trackingStartedAt;
      for (const entry of saved.events) {
        if (!entry?.id || !entry.testId || !Object.hasOwn(CATEGORIES, entry.category)) continue;
        if (entry.status === 'pending') entry.status = 'interrupted';
        if (!events.has(entry.id)) events.set(entry.id, entry);
      }
    } catch (error) { if (error.code !== 'ENOENT') readError = error; }
  })();
  function persist() {
    clearTimeout(timer);timer=null;
    if(writing)return writing;
    writing = (async () => {
      await ready;
      if(!dirty)return;
      dirty=false;
      if (readError || file === null) return;
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await chmod(path.dirname(file), 0o700);
      const temp = `${file}.${randomUUID()}.tmp`;
      await writeFileImpl(temp, JSON.stringify({ version: 1, trackingStartedAt, events: [...events.values()] }), { mode: 0o600 });
      await rename(temp, file);
      await chmod(file, 0o600);
      writeError = null; retryMs = 1000; lastSavedAt = new Date(now()).toISOString();
    })().catch(error => { writeError = error; dirty = true; retryMs = Math.min(30000, retryMs * 2); }).finally(()=>{writing=null;if(dirty&&!closed&&!flushing)scheduleTimer();});
    return writing;
  }
  function scheduleTimer(){if(!timer&&!writing&&!readError){timer=setTimeout(()=>void persist(),writeError?retryMs:300);timer.unref?.();}}
  function schedulePersist(){dirty=true;if(!closed&&!flushing)scheduleTimer();}
  void ready.then(()=>{if(!closed)scheduleTimer();});
  async function flush(){
    flushing++;
    try{await ready;do{await persist();}while(dirty&&!readError&&!writeError);}
    finally{flushing--;if(!flushing&&dirty&&!closed&&!readError)scheduleTimer();}
  }
  function start(testId, metadata = {}) {
    if (closed || !Object.hasOwn(CATEGORIES, metadata.category)) return noop;
    const event = { id: idFactory(), testId: clean(testId) || UNATTRIBUTED_TEST_ID, category: metadata.category, provider: clean(metadata.provider), operation: clean(metadata.operation), model: clean(metadata.model), ...(clean(metadata.serviceTier) ? {serviceTier:clean(metadata.serviceTier)} : {}), at: new Date(now()).toISOString(), status: 'pending', providerReportedUsd: null, units: {} };
    events.set(event.id, event);
    schedulePersist();
    let finished = false;
    function update(data = {}) {
      if(closed)return;
      for (const [key, value] of Object.entries(data.units || {})) if (UNIT_KEYS.has(key) && number(value)) event.units[key] = Math.max(event.units[key] || 0, value);
      if (number(data.providerReportedUsd)) event.providerReportedUsd = data.providerReportedUsd;
      if (clean(data.model)) event.model = clean(data.model);
      if (clean(data.serviceTier)) event.serviceTier = clean(data.serviceTier);
      schedulePersist();
    }
    return {
      update,
      finish(data = {}) {
        if (finished||closed) return;
        finished = true;
        update(data);
        event.status = ['completed', 'failed', 'canceled'].includes(data.status) ? data.status : 'completed';
        event.finishedAt = new Date(now()).toISOString();
        schedulePersist();
      },
    };
  }
  async function snapshot(testId) {
    await ready;
    const selected = [...events.values()].filter(event => event.testId === testId);
    return structuredClone({
      testId, trackingStartedAt, scope: 'since-tracking-started', currency: 'USD', totals: totals(selected),
      categories: Object.entries(CATEGORIES).map(([id, label]) => ({ id, label, ...totals(selected.filter(event => event.category === id)) })),
      unattributed: totals([...events.values()].filter(event => event.testId === UNATTRIBUTED_TEST_ID)),
      storage: {status: readError ? 'read-error' : writeError ? 'write-error' : file === null ? 'memory' : 'ok', lastSavedAt, pendingWrite: dirty || Boolean(writing)},
      notes: ['Only requests tracked since recording began are included; older activity cannot be reconstructed.', 'Billed USD is shown only when a provider reports a charge. Estimates apply documented API list prices to measured usage; they exclude account credits, subscription allowances, discounts, tax and unreported usage.', 'Jev responses report token counts without a dollar charge field.', 'Codex signed-in plan token counts are usage measurements, not an OpenAI API bill. OpenAI API responses also report tokens rather than the final account charge.', 'Voice characters and PCM duration measure submitted text and transmitted or generated audio; they do not verify playback or billed duration. Unverified model rates and missing measurements remain unestimated.', ...(readError || writeError ? ['Usage persistence is unavailable; current process measurements may not survive a restart.'] : [])],
    });
  }
  return { start, snapshot, flush, async close() { closed=true;await ready;for (const event of events.values()) if (event.status === 'pending') event.status = 'interrupted';dirty=true;await flush(); } };
}
