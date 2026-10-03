// Bounded, synthetic text benchmark. Uses only the official OpenAI API.
// Run: node --env-file-if-exists=.env benchmarks/model-speed.mjs
// No SDK retries, parallel inference, tools, microphone, or audio are used.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MODELS = ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-5.6-terra', 'gpt-6-astra'];
const ENDPOINT = 'https://api.openai.com/v1/responses';
const MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
const ROUNDS = 3, TIMEOUT_MS = 40000, MAX_OUTPUT_TOKENS = 1200, MAX_BYTES = 2 * 1024 * 1024;
const RESULT_FILE = new URL('./model-speed-results.json', import.meta.url);
const REPORT_FILE = new URL('./model-speed-results.md', import.meta.url);
const PROMPT = 'Explain diffusion and osmosis to a first-year biology student in approximately 200 words. Use two short paragraphs and one everyday example. Explain concentration gradients, the role of a selectively permeable membrane, and what happens to an animal cell placed in a hypertonic solution. Finish with one short recall question. Use plain text, no headings, lists, citations, tools, or equations.';
const INSTRUCTIONS = 'You are a clear, accurate study tutor. Answer the synthetic teaching prompt directly using standard introductory biology. Do not describe your reasoning process.';
const SOURCES = [
  { title: 'Streaming API responses', url: 'https://developers.openai.com/api/docs/guides/streaming-responses' },
  { title: 'Understand output token counts', url: 'https://developers.openai.com/api/docs/guides/token-counting' },
  { title: 'Reasoning models', url: 'https://developers.openai.com/api/docs/guides/reasoning' },
];

const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const round = value => finite(value) ? Math.round(value * 1000) / 1000 : null;
const safeCode = value => typeof value === 'string' && /^[a-z_]{1,80}$/.test(value) ? value : 'provider_error';
const problem = code => Object.assign(new Error('Benchmark operation failed.'), { benchmarkCode: code });
const errorCode = error => error?.benchmarkCode || (error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network_error');
const median = values => {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};

async function readJson(response) {
  if (!response.body) throw problem('empty_response');
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw problem('oversize_response');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw problem('invalid_json'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function availability(key) {
  const began = performance.now(), result = { checkedAt: new Date().toISOString(), endpoint: MODELS_ENDPOINT, status: null, elapsedMs: null, models: [] };
  try {
    const response = await fetch(MODELS_ENDPOINT, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Authorization: `Bearer ${key}` } });
    result.status = response.status;
    const body = await readJson(response);
    if (!response.ok) { result.error = safeCode(body?.error?.code); return result; }
    if (!Array.isArray(body.data)) throw problem('invalid_model_list');
    const ids = new Set(body.data.map(model => model.id));
    result.models = MODELS.map(model => ({ model, available: ids.has(model), ...(ids.has(model) ? {} : { skipped: 'not_listed_for_this_api_key' }) }));
  } catch (error) { result.error = errorCode(error); }
  finally { result.elapsedMs = round(performance.now() - began); }
  return result;
}

export async function trial(key, model, trialNumber, order) {
  const began = performance.now(), deadline = AbortSignal.timeout(TIMEOUT_MS);
  const record = { requestedModel: model, trial: trialNumber, order, startedAt: new Date().toISOString(), status: 'pending', httpStatus: null, resolvedModel: null, serviceTier: null,
    headersMs: null, responseCreatedMs: null, firstTextDeltaMs: null, lastTextDeltaMs: null, completedMs: null, endedMs: null, textWindowMs: null, nonReasoningOutputTokens: null, approximateVisibleTokensPerSecond: null,
    inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, totalTokens: null, textDeltaCount: 0, outputCharacters: 0, outputWords: 0, streamBytes: 0, textDeltas: [], text: '' };
  let reader;
  function consume(frame) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let event;
    try { event = JSON.parse(data); } catch { throw problem('invalid_json'); }
    const atMs = performance.now() - began;
    if (event.response) {
      if (typeof event.response.model === 'string') record.resolvedModel = event.response.model;
      if (typeof event.response.service_tier === 'string') record.serviceTier = event.response.service_tier;
    }
    if (event.type === 'response.created') record.responseCreatedMs = round(atMs);
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string' && event.delta.length) {
      record.firstTextDeltaMs ??= round(atMs);
      record.lastTextDeltaMs = round(atMs);
      record.textDeltaCount++;
      record.textDeltas.push({ atMs: round(atMs), characters: event.delta.length });
      record.text += event.delta;
      if (record.text.length > 20000) throw problem('oversize_text');
    }
    if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type)) {
      record.completedMs = round(atMs);
      record.status = event.type.slice('response.'.length);
      const usage = event.response?.usage;
      for (const [key, value] of Object.entries({ inputTokens: usage?.input_tokens, cachedInputTokens: usage?.input_tokens_details?.cached_tokens, outputTokens: usage?.output_tokens, reasoningTokens: usage?.output_tokens_details?.reasoning_tokens, totalTokens: usage?.total_tokens })) if (finite(value)) record[key] = value;
      if (record.status !== 'completed') record.error = safeCode(event.response?.error?.code || event.response?.incomplete_details?.reason);
    }
    if (event.type === 'error') { record.status = 'failed'; record.error = safeCode(event.code || event.error?.code); }
  }
  try {
    const response = await fetch(ENDPOINT, { method: 'POST', redirect: 'error', signal: deadline, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: PROMPT, instructions: INSTRUCTIONS, reasoning: { effort: 'low' }, stream: true, store: false, tools: [], max_output_tokens: MAX_OUTPUT_TOKENS, service_tier: 'default' }) });
    record.httpStatus = response.status;
    record.headersMs = round(performance.now() - began);
    if (!response.ok) {
      const body = await readJson(response);
      record.status = 'failed'; record.error = safeCode(body?.error?.code); return record;
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw problem('unexpected_content_type');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (record.status === 'pending') {
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); break; }
      record.streamBytes += value.byteLength;
      if (record.streamBytes > MAX_BYTES) throw problem('oversize_stream');
      buffer += decoder.decode(value, { stream: true });
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        consume(frame);
        if (record.status !== 'pending') break;
      }
    }
    if (record.status === 'pending') throw problem('missing_terminal_event');
    if (record.status === 'completed' && !record.text.trim()) throw problem('empty_output');
  } catch (error) { record.status = 'failed'; record.error = errorCode(error); }
  finally {
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    record.endedMs = round(performance.now() - began);
    record.outputCharacters = record.text.length;
    record.outputWords = record.text.trim() ? record.text.trim().split(/\s+/).length : 0;
    if (finite(record.firstTextDeltaMs) && finite(record.lastTextDeltaMs)) record.textWindowMs = round(record.lastTextDeltaMs - record.firstTextDeltaMs);
    if (finite(record.outputTokens) && finite(record.reasoningTokens) && record.outputTokens >= record.reasoningTokens) record.nonReasoningOutputTokens = record.outputTokens - record.reasoningTokens;
    if (record.status === 'completed' && finite(record.nonReasoningOutputTokens) && record.textWindowMs > 0 && record.textDeltaCount > 1) record.approximateVisibleTokensPerSecond = round(record.nonReasoningOutputTokens / (record.textWindowMs / 1000));
  }
  return record;
}

export function summarize(results) {
  return MODELS.map(model => {
    const attempted = results.filter(item => item.requestedModel === model), complete = attempted.filter(item => item.status === 'completed');
    const rates = complete.map(item => item.approximateVisibleTokensPerSecond).filter(finite);
    return { model, trials: attempted.length, completed: complete.length, failures: attempted.filter(item => item.status !== 'completed').map(item => ({ trial: item.trial, status: item.status, httpStatus: item.httpStatus, code: item.error })),
      medianTtftMs: median(complete.map(item => item.firstTextDeltaMs)), medianApproximateVisibleTokensPerSecond: median(rates), medianCompletedMs: median(complete.map(item => item.completedMs)),
      minApproximateVisibleTokensPerSecond: rates.length ? Math.min(...rates) : null, maxApproximateVisibleTokensPerSecond: rates.length ? Math.max(...rates) : null,
      medianNonReasoningOutputTokens: median(complete.map(item => item.nonReasoningOutputTokens)), medianOutputWords: median(complete.map(item => item.outputWords)),
      resolvedModels: [...new Set(attempted.map(item => item.resolvedModel).filter(Boolean))], serviceTiers: [...new Set(attempted.map(item => item.serviceTier).filter(Boolean))] };
  });
}

export function markdown(report) {
  const value = (number, digits = 2) => finite(number) ? number.toFixed(digits) : 'Unavailable';
  const rows = [...report.summary].sort((a, b) => (b.medianApproximateVisibleTokensPerSecond ?? -1) - (a.medianApproximateVisibleTokensPerSecond ?? -1));
  const failures = rows.flatMap(row => row.failures.map(failure => `- ${row.model}, trial ${failure.trial}: ${failure.status}, HTTP ${failure.httpStatus ?? 'unavailable'}, code ${failure.code}.`));
  const skipped = report.availability.models.filter(item => !item.available).map(item => `Skipped ${item.model}: ${item.skipped}.`);
  return [
    '# OpenAI model speed benchmark',
    `Run: ${report.startedAt} to ${report.finishedAt || 'in progress'} (UTC). Synthetic introductory biology explanation, approximately 200 words.`,
    'All calls use the Responses API, default service tier, low reasoning, no tools, and a 1,200 output-token cap. Three sequential rotating rounds; no retries or warmups.',
    `| Model | Completed | Median first text | Approx. visible tok/s | Observed tok/s range | Median total | Median output tokens* | Median words |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${rows.map(row => `| ${row.model} | ${row.completed}/${row.trials} | ${value(row.medianTtftMs === null ? null : row.medianTtftMs / 1000)} s | ${value(row.medianApproximateVisibleTokensPerSecond, 1)} | ${value(row.minApproximateVisibleTokensPerSecond, 1)}–${value(row.maxApproximateVisibleTokensPerSecond, 1)} | ${value(row.medianCompletedMs === null ? null : row.medianCompletedMs / 1000)} s | ${value(row.medianNonReasoningOutputTokens, 0)} | ${value(row.medianOutputWords, 0)} |`).join('\n')}`,
    '*Output tokens here subtract reported reasoning tokens. This approximates visible content tokens: provider usage can include non-visible formatting tokens that are not separately itemized. Rates divide that count by the time from first to last nonempty text delta. The first delta may contain several tokens, and network buffering affects observed rates. TTFT is request start to the first nonempty text delta; total is request start to the terminal completed event.',
    'These are three samples per available model on one short task, not production percentiles or a quality evaluation. Differences in answer length, server load, routing, tokenization, connection setup, and caching can affect comparisons. Cached input and reasoning counts, every trial, delta timestamps, response model IDs, failures, and service tiers are retained in the JSON.',
    skipped.length || failures.length ? [...skipped, ...failures].join('\n') : 'No failures or unavailable models were observed.',
    `Official references: ${SOURCES.map(source => `[${source.title}](${source.url})`).join('; ')}.`,
  ].join('\n\n') + '\n';
}

async function main() {
  const key = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
  if (!key) throw problem('missing_api_key');
  const report = { version: 1, startedAt: new Date().toISOString(), finishedAt: null, synthetic: true, endpoint: ENDPOINT,
    configuration: { models: MODELS, rounds: ROUNDS, maxGenerationCalls: MODELS.length * ROUNDS, timeoutMs: TIMEOUT_MS, maxOutputTokens: MAX_OUTPUT_TOKENS, reasoningEffort: 'low', requestedServiceTier: 'default', sequential: true, retries: 0, store: false, tools: [], instructions: INSTRUCTIONS, prompt: PROMPT },
    methodology: { ttft: 'Request start to first nonempty response.output_text.delta.', outputRate: '(usage.output_tokens - usage.output_tokens_details.reasoning_tokens) / seconds between first and last nonempty text delta. Approximate visible tokens; formatting tokens may remain.', total: 'Request start to response.completed.', timingClock: 'performance.now()', tokenCounts: 'Final provider usage; missing fields stay null.', sampleLimit: 'Three samples per model, one synthetic task; no production percentile or quality claim.' },
    sources: SOURCES, availability: await availability(key), trials: [], summary: [] };
  const save = async () => { report.summary = summarize(report.trials); await writeFile(RESULT_FILE, JSON.stringify(report, null, 2) + '\n'); await writeFile(REPORT_FILE, markdown(report)); };
  await mkdir(new URL('./', import.meta.url), { recursive: true });
  await save();
  console.log(JSON.stringify({ event: 'availability', status: report.availability.status, models: report.availability.models, error: report.availability.error }));
  if (report.availability.error) throw problem(report.availability.error);
  const available = report.availability.models.filter(item => item.available).map(item => item.model);
  for (let roundIndex = 0; roundIndex < ROUNDS; roundIndex++) {
    const offset = Math.floor(available.length * roundIndex / ROUNDS), ordered = [...available.slice(offset), ...available.slice(0, offset)];
    for (const model of ordered) {
      const result = await trial(key, model, roundIndex + 1, report.trials.length + 1);
      report.trials.push(result);
      await save();
      console.log(JSON.stringify({ event: 'trial', model, trial: result.trial, status: result.status, ttftMs: result.firstTextDeltaMs, approximateVisibleTokensPerSecond: result.approximateVisibleTokensPerSecond, completedMs: result.completedMs, error: result.error }));
    }
  }
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ event: 'complete', generationCalls: report.trials.length, summary: report.summary }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ event: 'benchmark_stopped', code: errorCode(error) })); process.exitCode = 1; });
}
