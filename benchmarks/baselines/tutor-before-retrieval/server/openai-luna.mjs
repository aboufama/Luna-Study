import { CodexError } from './codex.mjs';
import { lunaInstructions } from './luna-fast.mjs';
import { createTutorOutput } from './tutor-output.mjs';
import { tokenUsage } from './usage-ledger.mjs';
import { randomUUID } from 'node:crypto';

// Responses streaming and strict output contracts:
// https://developers.openai.com/api/docs/guides/streaming-responses
// https://developers.openai.com/api/docs/guides/structured-outputs
const ENDPOINT = 'https://api.openai.com/v1/responses';
const MAX_BYTES = 2 * 1024 * 1024;
const fail = (status, message, providerStatus) => { const error=new CodexError(status,message);if(Number.isInteger(providerStatus))error.providerStatus=providerStatus;throw error; };
const modelFor = env => env.LUNA_API_MODEL?.trim() || 'gpt-6-luna';
const keyFor = env => typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
const reportedName = value => typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,100}$/.test(value) ? value : undefined;
const report = (callback, usage, response) => {
  const units = tokenUsage(usage), model = reportedName(response?.model), serviceTier = reportedName(response?.service_tier);
  if (Object.keys(units).length || model || serviceTier) try { callback?.({ units, ...(model ? { model } : {}), ...(serviceTier ? { serviceTier } : {}) }); } catch { /* Accounting cannot interrupt a response. */ }
};

function inputText(input) {
  let value;
  try { value = JSON.stringify(input); } catch { fail(400, 'Send valid study context.'); }
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_BYTES) fail(400, 'The study context is too large. Use fewer materials.');
  return value;
}

async function withDeadline({ signal, timeoutMs }, work) {
  if (signal?.aborted) fail(499, 'The Luna request was canceled.');
  const controller = new AbortController();
  let timer, abort;
  const canceled = new Promise((_, reject) => {
    abort = () => { controller.abort(); reject(new CodexError(499, 'The Luna request was canceled.')); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new CodexError(504, 'Luna took too long to respond. Please try again.')); }, Number.isFinite(timeoutMs) ? Math.max(1, Math.min(180000, timeoutMs)) : 60000);
  });
  try { return await Promise.race([work(controller.signal), canceled]); }
  catch (error) { if (error instanceof CodexError) throw error; fail(502, 'Luna could not complete the OpenAI request. Please try again.'); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
}

async function request(fetchImpl, key, payload, signal) {
  if (signal.aborted) fail(499, 'The Luna request was canceled.');
  const response = await fetchImpl(ENDPOINT, { method: 'POST', redirect: 'error', signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (signal.aborted) { void response.body?.cancel().catch(() => {}); fail(499, 'The Luna request was canceled.'); }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 429) fail(429, 'OpenAI reached its usage limit. Check API quota or try again later.',response.status);
    if ([401, 403].includes(response.status)) fail(502, 'OpenAI could not authorize Luna. Check the API key and model access.',response.status);
    fail(502, 'OpenAI could not complete the Luna request.',response.status);
  }
  if (!response.body || Number(response.headers?.get('content-length')) > MAX_BYTES) fail(502, 'OpenAI returned an empty or oversized response.');
  return response;
}

async function readBody(response, signal, consume) {
  const reader = response.body.getReader();
  let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (!signal.aborted) {
      const item = await reader.read();
      if (signal.aborted) fail(499, 'The Luna request was canceled.');
      if (item.done) return;
      bytes += item.value.byteLength;
      if (bytes > MAX_BYTES) fail(502, 'OpenAI returned too much response data.');
      if (consume(item.value) === false) return;
    }
  } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}

function responseText(response) {
  if (!response || response.status !== 'completed' || !Array.isArray(response.output)) fail(502, 'Luna returned an incomplete response.');
  let text = '';
  for (const item of response.output) {
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message' || !Array.isArray(item.content)) fail(502, 'Luna returned an unsupported response.');
    for (const part of item.content) {
      if (part.type !== 'output_text' || typeof part.text !== 'string') fail(502, 'Luna could not provide a study response.');
      text += part.text;
    }
  }
  if (!text.trim()) fail(502, 'Luna returned an empty response.');
  return text;
}

export function createOpenAIOrganizer({ env = process.env, usageLedger, diagnostics, fetchImpl = fetch } = {}) {
  const key = keyFor(env), model = modelFor(env);
  return {
    available: Boolean(key), model,
    async organize(input, { schema, instructions, signal, timeoutMs = 120000, usageContext, onUsage, maxOutputTokens = 10000 } = {}) {
      if (!key) fail(503, 'Configure OpenAI API access for Luna.');
      if (signal?.aborted) fail(499, 'The Luna request was canceled.');
      const serialized = inputText(input);
      if (!schema || typeof schema !== 'object' || !instructions) fail(400, 'Provide a study response schema and instructions.');
      const meter = usageLedger?.start(usageContext?.testId || input?.testId, { category: 'llm', provider: 'openai', operation: usageContext?.operation || 'organize', model });
      const began=performance.now(),requestId=randomUUID(),testId=usageContext?.testId||input?.testId,operation=usageContext?.operation||'organize';
      const log=(type,details={})=>{try{diagnostics?.record(testId,{type,details:{requestId,operation,model,...details}});}catch{/* Debug output cannot affect provider work. */}};
      log('llm.background-started');
      let completed = false;
      try {
        const value = await withDeadline({ signal, timeoutMs }, async requestSignal => {
          const response = await request(fetchImpl, key, { model, store: false, tools: [], reasoning: { effort: 'low' }, max_output_tokens: Number.isInteger(maxOutputTokens)?Math.max(256,Math.min(10000,maxOutputTokens)):10000,
            instructions, input: serialized, text: { format: { type: 'json_schema', name: 'study_response', strict: true, schema } } }, requestSignal);
          const parts = []; await readBody(response, requestSignal, chunk => { parts.push(Buffer.from(chunk)); });
          if (requestSignal.aborted) fail(499, 'The Luna request was canceled.');
          let body; try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { fail(502, 'Luna returned invalid response data.'); }
          report(data => { meter?.update(data); onUsage?.(data); }, body.usage, body);
          let result; try { result = JSON.parse(responseText(body)); } catch (error) { if (error instanceof CodexError) throw error; fail(502, 'Luna returned an invalid study response.'); }
          if (!result || typeof result !== 'object' || Array.isArray(result)) fail(502, 'Luna returned an invalid study response.');
          return result;
        });
        completed = true;log('llm.background-completed',{latencyMs:Math.round(performance.now()-began)});return value;
      } catch(error) { log('llm.background-failed',{reason:signal?.aborted?'canceled':'failed',errorCode:String(error.providerStatus||error.status||502),latencyMs:Math.round(performance.now()-began)});throw error; }
      finally { meter?.finish({ status: completed ? 'completed' : signal?.aborted ? 'canceled' : 'failed' }); }
    },
  };
}

export function createOpenAILuna({ env = process.env, mode = 'voice', fetchImpl = fetch } = {}) {
  const key = keyFor(env), model = modelFor(env), session = new AbortController();
  let busy = null, closed = false;
  async function ready() { if (closed) fail(499, 'Voice session ended.'); if (!key) fail(503, 'Configure OpenAI API access for Luna.'); }
  return {
    model, ready,
    async close() { closed = true; session.abort(); },
    async respond(input, { onText, onSpeechEnd, onUsage, signal, timeoutMs = 60000, effort = 'low' } = {}) {
      if (signal?.aborted) fail(499, 'The Luna request was canceled.');
      if (busy) fail(409, 'Luna is still answering another voice turn.');
      if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) fail(400, 'Unsupported Luna reasoning effort.');
      const reservation = {}; busy = reservation;
      // A replacement turn can start in the same stack as its predecessor's
      // abort, before that request has reached its asynchronous finally block.
      const release = () => { if (busy === reservation) busy = null; };
      signal?.addEventListener('abort', release, { once: true });
      const began = performance.now(); let firstDeltaMs = null;
      try {
        await ready();
        const serialized = inputText(input), requestSignal = signal ? AbortSignal.any([signal, session.signal]) : session.signal;
        return await withDeadline({ signal: requestSignal, timeoutMs }, async boundedSignal => {
          const response = await request(fetchImpl, key, { model, store: false, stream: true, tools: [], reasoning: { effort }, max_output_tokens: mode === 'planner' ? 4000 : 6000, instructions: lunaInstructions(mode), input: serialized }, boundedSignal);
          if (!response.headers?.get('content-type')?.toLowerCase().startsWith('text/event-stream')) fail(502, 'OpenAI returned an invalid response stream.');
          const decoder = mode === 'planner' ? null : createTutorOutput({ includeBoardStatus: true, onText, onSpeechEnd });
          const utf8 = new TextDecoder(); let buffer = '', output = '', finished = false;
          function event(frame) {
            const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data || data === '[DONE]') return;
            let value; try { value = JSON.parse(data); } catch { fail(502, 'OpenAI returned invalid stream data.'); }
            if (boundedSignal.aborted) return;
            if (['response.failed', 'response.incomplete', 'error'].includes(value.type)) { report(onUsage, value.response?.usage, value.response); fail(502, 'Luna could not finish that response.'); }
            if (value.type?.startsWith('response.refusal')) fail(502, 'Luna could not provide a study response.');
            if (['response.output_item.added', 'response.output_item.done'].includes(value.type) && !['message', 'reasoning'].includes(value.item?.type)) fail(502, 'Luna returned an unsupported response.');
            if (value.type === 'response.output_text.delta') {
              if (typeof value.delta !== 'string') fail(502, 'Luna returned invalid response text.');
              firstDeltaMs ??= Math.round(performance.now() - began);
              output += value.delta;
              if (output.length > (mode === 'planner' ? 1800 : 14000)) fail(502, 'Luna returned too much text.');
              if (decoder) decoder.push(value.delta); else onText?.(value.delta);
            }
            if (value.type === 'response.completed') {
              report(onUsage, value.response?.usage, value.response);
              const finalText = responseText(value.response);
              if (finalText !== output) fail(502, 'Luna returned an incomplete response stream.');
              finished = true;
            }
          }
          await readBody(response, boundedSignal, chunk => {
            buffer += utf8.decode(chunk, { stream: true });
            let match;
            while ((match = /\r?\n\r?\n/.exec(buffer))) { const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length); event(frame); if (finished) return false; }
          });
          if (boundedSignal.aborted) fail(499, 'The Luna request was canceled.');
          buffer += utf8.decode();
          if (!finished && buffer.trim()) event(buffer);
          if (!finished) fail(502, 'Luna returned an incomplete response stream.');
          const result = decoder ? decoder.finish() : { reply: output.trim() };
          if (!result.reply) fail(502, 'Luna returned an empty spoken response.');
          return { ...result, timings: { firstDeltaMs, totalMs: Math.round(performance.now() - began), reusedThread: false } };
        });
      } finally { signal?.removeEventListener('abort', release); release(); }
    },
  };
}
