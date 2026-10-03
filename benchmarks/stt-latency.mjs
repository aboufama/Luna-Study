// Explicitly authorized, bounded paid-provider benchmark. No mic or playback.
// Run from the project root: node --env-file=.env benchmarks/stt-latency.mjs
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createUsageBudget } from './usage-budget.mjs';
const usage = await createUsageBudget({ name: 'stt-latency.mjs', maxRequests: 5, sttSessionMaxSeconds: 15, ttsModels: ['eleven_flash_v2_5'] });
const WebSocket = usage.WebSocket;

const PHRASE = 'What is the difference between active and passive transport?';
const SAMPLE_RATE = 16000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
const CHUNK_BYTES = BYTES_PER_SECOND / 10;
const TIMEOUT_MS = 15000;
const key = process.env.ELEVENLABS_API_KEY?.trim();
const voice = process.env.ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb';
const outputPath = new URL('./stt-latency-results.json', import.meta.url);
const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const round = (value) => Number(value.toFixed(1));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const results = {
  startedAt: new Date().toISOString(),
  syntheticPhrase: PHRASE,
  source: {
    model: 'eleven_flash_v2_5', format: 'pcm_16000', sampleRate: SAMPLE_RATE,
    generationRequests: 0, audioSaved: false, microphoneUsed: false, playbackUsed: false,
  },
  method: {
    trials: [1.0, 0.5, 1.0, 0.5], chunkMs: 100, timeoutMs: TIMEOUT_MS,
    model: 'scribe_v2_realtime', commitStrategy: 'vad', vadThreshold: 0.4,
    minSpeechDurationMs: 100, minSilenceDurationMs: 100,
    description: 'The same generated PCM is sent at real-time pace in 100 ms chunks, followed by zero-valued silence. No manual commit is sent. PCM-end latency starts when the final PCM chunk is sent; speech-end latency uses the final 10 ms PCM frame with RMS above 160/32768, adjusted for trailing audio in its transmission chunk. These are network/provider timings, not microphone-to-speaker timings.',
    documentedVadSilenceBoundsSeconds: [0.3, 3.0],
    boundsSource: 'https://ui.elevenlabs.io/docs/components/speech-input',
    endpointSource: 'https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime',
    chunkSource: 'https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies',
  },
  runs: [],
};

function sanitize(message) {
  return String(message).replaceAll(key || 'KEY_NOT_SET', '[redacted]').slice(0, 1000);
}

function wordErrorRate(reference, actual) {
  const expected = normalize(reference).split(' '), observed = normalize(actual).split(' ').filter(Boolean);
  let previous = observed.map((_, i) => i + 1); previous.unshift(0);
  for (let i = 1; i <= expected.length; i++) {
    const current = [i];
    for (let j = 1; j <= observed.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (expected[i - 1] === observed[j - 1] ? 0 : 1));
    previous = current;
  }
  return round(previous[observed.length] / expected.length);
}

function speechEndOffset(pcm) {
  const frameBytes = SAMPLE_RATE / 100 * 2;
  let end = 0;
  for (let offset = 0; offset < pcm.length; offset += frameBytes) {
    const limit = Math.min(offset + frameBytes, pcm.length);
    let sum = 0;
    for (let i = offset; i < limit; i += 2) sum += pcm.readInt16LE(i) ** 2;
    if (Math.sqrt(sum / ((limit - offset) / 2)) > 160) end = limit;
  }
  if (!end) throw new Error('Generated PCM has no detected speech energy.');
  return end;
}

async function run(pcm, speechEndBytes, silenceSeconds, trial) {
  const started = performance.now();
  const query = new URLSearchParams({ model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000', commit_strategy: 'vad', vad_silence_threshold_secs: String(silenceSeconds), vad_threshold: '0.4', min_speech_duration_ms: '100', min_silence_duration_ms: '100', language_code: 'en' });
  const socket = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${query}`, { headers: { 'xi-api-key': key }, handshakeTimeout: TIMEOUT_MS, maxPayload: 256 * 1024, perMessageDeflate: false });
  const record = { trial, vadSilenceSeconds: silenceSeconds, accepted: false, status: 'pending', audioBytesSent: 0, silenceBytesSent: 0, commits: [], partialCount: 0 };
  let finished = false, pcmEndAt = null, speechEndAt = null, firstPartialAt = null;
  let resolveRun;
  const completed = new Promise((resolve) => { resolveRun = resolve; });
  const timer = setTimeout(() => finish('timeout'), TIMEOUT_MS);
  const finish = (status, error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    record.status = status;
    if (error) record.error = sanitize(error);
    const finalCommit = record.commits.at(-1);
    record.transcript = record.commits.map((item) => item.text).join(' ');
    record.exactWords = normalize(record.transcript) === normalize(PHRASE);
    record.wordErrorRate = wordErrorRate(PHRASE, record.transcript);
    record.sessionElapsedMs = round(performance.now() - started);
    record.pcmEndMs = pcmEndAt === null ? null : round(pcmEndAt - started);
    record.estimatedSpeechEndMs = speechEndAt === null ? null : round(speechEndAt - started);
    record.firstPartialMs = firstPartialAt === null ? null : round(firstPartialAt - started);
    record.commitAfterPcmEndMs = finalCommit && pcmEndAt !== null ? round(finalCommit.atMs - (pcmEndAt - started)) : null;
    record.commitAfterEstimatedSpeechEndMs = finalCommit && speechEndAt !== null ? round(finalCommit.atMs - (speechEndAt - started)) : null;
    socket.close();
    const termination = setTimeout(() => socket.terminate(), 1000); termination.unref();
    resolveRun(record);
  };
  socket.on('message', (bytes) => {
    let message;
    try { message = JSON.parse(bytes.toString()); } catch { finish('error', 'Invalid JSON from Scribe'); return; }
    if (message.message_type === 'session_started' && !record.accepted) {
      record.accepted = true;
      record.readyMs = round(performance.now() - started);
      void (async () => {
        const streamStart = performance.now();
        let sentBytes = 0;
        for (let offset = 0; !finished; offset += CHUNK_BYTES) {
          const isSpeechPcm = offset < pcm.length;
          const chunk = isSpeechPcm ? pcm.subarray(offset, Math.min(offset + CHUNK_BYTES, pcm.length)) : Buffer.alloc(CHUNK_BYTES);
          sentBytes += chunk.length;
          await delay(streamStart + sentBytes / BYTES_PER_SECOND * 1000 - performance.now());
          if (finished || socket.readyState !== WebSocket.OPEN) return;
          const now = performance.now();
          if (isSpeechPcm && offset < speechEndBytes && offset + chunk.length >= speechEndBytes) speechEndAt = now - (offset + chunk.length - speechEndBytes) / BYTES_PER_SECOND * 1000;
          socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: chunk.toString('base64'), sample_rate: SAMPLE_RATE }));
          if (isSpeechPcm) { record.audioBytesSent += chunk.length; if (offset + chunk.length >= pcm.length) pcmEndAt = now; }
          else record.silenceBytesSent += chunk.length;
          if (pcmEndAt !== null && record.commits.length && normalize(record.commits.map((item) => item.text).join(' ')) === normalize(PHRASE)) finish('committed');
        }
      })().catch((error) => finish('error', error.message));
    } else if (message.message_type === 'partial_transcript' && message.text?.trim()) {
      firstPartialAt ??= performance.now(); record.partialCount++;
    } else if (message.message_type === 'committed_transcript' && message.text?.trim()) {
      record.commits.push({ atMs: round(performance.now() - started), text: message.text.trim() });
      if (pcmEndAt !== null && normalize(record.commits.map((item) => item.text).join(' ')) === normalize(PHRASE)) finish('committed');
    } else if (message.error || /error|exceeded|limited|throttled|overflow|exhausted|unaccepted/i.test(message.message_type || '')) finish('error', message.error || message.message_type);
  });
  socket.on('unexpected-response', (_, response) => {
    let body = ''; response.on('data', (chunk) => { if (body.length < 2000) body += chunk.toString(); });
    response.on('end', () => finish('rejected', `HTTP ${response.statusCode}: ${body}`));
  });
  socket.on('error', (error) => finish('error', error.message));
  socket.on('close', () => { if (!finished) finish('closed'); });
  return completed;
}

try {
  if (!key) throw new Error('ELEVENLABS_API_KEY is not configured.');
  results.source.generationRequests = 1;
  const generatedAt = performance.now();
  const response = await usage.fetchTts(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_16000`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: PHRASE, model_id: results.source.model, seed: 12345, language_code: 'en' }), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Synthetic speech generation HTTP ${response.status}: ${await response.text()}`);
  const pcm = Buffer.from(await response.arrayBuffer());
  if (!pcm.length || pcm.length % 2 || pcm.length > BYTES_PER_SECOND * 10) throw new Error('Synthetic PCM is empty, invalid, or exceeds the 10 second limit.');
  const speechEndBytes = speechEndOffset(pcm);
  Object.assign(results.source, { pcmBytes: pcm.length, durationMs: round(pcm.length / BYTES_PER_SECOND * 1000), estimatedSpeechEndMs: round(speechEndBytes / BYTES_PER_SECOND * 1000), generationMs: round(performance.now() - generatedAt) });
  for (const [index, threshold] of results.method.trials.entries()) {
    const result = await run(pcm, speechEndBytes, threshold, index + 1);
    results.runs.push(result);
    await writeFile(outputPath, JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(result));
    if (result.status !== 'committed') throw new Error(`STT benchmark stopped after ${result.status}; no further provider requests will be made.`);
  }
  results.summary = [1.0, 0.5].map((threshold) => {
    const runs = results.runs.filter((item) => item.vadSilenceSeconds === threshold);
    const measured = runs.filter((item) => item.commitAfterPcmEndMs !== null);
    return { vadSilenceSeconds: threshold, acceptedRuns: runs.filter((item) => item.accepted).length, exactWordRuns: runs.filter((item) => item.exactWords).length, measuredRuns: measured.length, meanCommitAfterPcmEndMs: measured.length ? round(measured.reduce((sum, item) => sum + item.commitAfterPcmEndMs, 0) / measured.length) : null, meanCommitAfterEstimatedSpeechEndMs: measured.length ? round(measured.reduce((sum, item) => sum + item.commitAfterEstimatedSpeechEndMs, 0) / measured.length) : null };
  });
} catch (error) {
  results.error = sanitize(error.message);
  process.exitCode = 1;
} finally {
  results.usageBudget = await usage.finish();
  results.finishedAt = new Date().toISOString();
  await writeFile(outputPath, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ summary: results.summary, error: results.error }));
}
