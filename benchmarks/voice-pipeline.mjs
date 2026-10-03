// Explicitly authorized live-provider benchmark. Never opens a microphone or
// audio device: incoming PCM is counted and discarded, never saved or played.
// Run from project root: node --env-file=.env benchmarks/voice-pipeline.mjs
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { createCodexOrganizer } from '../server/codex.mjs';
import { attachLiveVoice } from '../server/live-voice.mjs';
import { createSpeechStream } from '../server/speech-stream.mjs';
import { createUsageBudget } from './usage-budget.mjs';
const usage = await createUsageBudget({ name: 'voice-pipeline.mjs', maxRequests: 13, sttSessionMaxSeconds: 30, ttsModels: [process.env.ELEVENLABS_REALTIME_MODEL_ID?.trim() || 'eleven_v4_turbo', 'eleven_flash_v2_5'] });

const PHRASE = 'What is the difference between active and passive transport?';
const MATERIAL = 'Passive transport moves substances down a concentration gradient without energy. Active transport uses energy to move substances against the gradient.';
const RATE = 16000, BPS = RATE * 2, CHUNK = BPS / 10, TIMEOUT = 30000;
const key = process.env.ELEVENLABS_API_KEY?.trim();
const voice = process.env.ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb';
const output = new URL('./voice-pipeline-results.json', import.meta.url);
const round = (value) => Number(value.toFixed(1));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const sanitize = (value) => String(value).replaceAll(key || 'KEY_NOT_SET', '[redacted]').slice(0, 1200);
const report = {
  startedAt: new Date().toISOString(), phrase: PHRASE, material: MATERIAL,
  microphoneUsed: false, playbackUsed: false, audioSaved: false,
  method: 'Actual loopback WebSocket client -> attachLiveVoice -> Scribe -> Luna -> ElevenLabs TTS -> loopback client. One synthetic PCM clip is sent in real-time 100 ms chunks in each session. Silence follows until transcript commitment. All returned audio is counted and discarded. Primary latency is final input PCM chunk sent to first returned nonempty audio chunk. This excludes physical audio-device capture/playback latency. Baseline selects exec with 1.0 second VAD; optimized selects stream with 0.5 second VAD. The optimized process starts warming while the synthetic question streams.',
  perSessionTimeoutMs: TIMEOUT, runs: [], source: { model: 'eleven_flash_v2_5', generationRequests: 0 },
};

function energyEnd(pcm) {
  let end = 0;
  for (let offset = 0; offset < pcm.length; offset += 320) {
    const limit = Math.min(offset + 320, pcm.length); let sum = 0;
    for (let i = offset; i < limit; i += 2) sum += pcm.readInt16LE(i) ** 2;
    if (Math.sqrt(sum / ((limit - offset) / 2)) > 160) end = limit;
  }
  if (!end) throw new Error('No speech energy in synthetic PCM.');
  return end;
}

async function trial(cliOrganizer, pcm, energyEndBytes, mode, number) {
  const optimized = mode === 'stream';
  const env = { ...process.env, LUNA_VOICE_TRANSPORT: mode, LUNA_VAD_SILENCE_SECONDS: optimized ? '0.5' : '1.0' };
  const server = createServer((_, response) => { response.writeHead(404); response.end(); });
  const pipeline = attachLiveVoice(server, { cliOrganizer, env, WebSocketImpl: usage.WebSocket, createSpeechStreamImpl: options => createSpeechStream({ ...options, WebSocketImpl: usage.WebSocket }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const record = { trial: number, mode, vadSilenceSeconds: Number(env.LUNA_VAD_SILENCE_SECONDS), status: 'pending', audioBytesSent: 0, silenceBytesSent: 0, outputAudioBytes: 0, outputAudioChunks: 0, userTranscripts: [], assistantTranscripts: [], latencyEvents: [], states: [] };
  let finished = false, ready = false, pcmEndAt = null, energyEndAt = null, committedAt = null, firstAudioAt = null, audioEndAt = null;
  const beganAt = performance.now();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live-voice`, { origin: `http://127.0.0.1:${port}`, handshakeTimeout: 5000, maxPayload: 3 * 1024 * 1024 });
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const timer = setTimeout(() => finish('timeout', '30 second pipeline timeout'), TIMEOUT);
  function finish(status, error) {
    if (finished) return;
    finished = true; clearTimeout(timer);
    record.status = status; if (error) record.error = sanitize(error);
    record.sessionElapsedMs = round(performance.now() - beganAt);
    record.pcmEndMs = pcmEndAt === null ? null : round(pcmEndAt - beganAt);
    record.estimatedEnergySpeechEndMs = energyEndAt === null ? null : round(energyEndAt - beganAt);
    record.committedUserMs = committedAt === null ? null : round(committedAt - beganAt);
    record.firstAudioMs = firstAudioAt === null ? null : round(firstAudioAt - beganAt);
    record.audioEndMs = audioEndAt === null ? null : round(audioEndAt - beganAt);
    record.pcmEndToCommitMs = pcmEndAt !== null && committedAt !== null ? round(committedAt - pcmEndAt) : null;
    record.commitToFirstAudioMs = committedAt !== null && firstAudioAt !== null ? round(firstAudioAt - committedAt) : null;
    record.pcmEndToFirstAudioMs = pcmEndAt !== null && firstAudioAt !== null ? round(firstAudioAt - pcmEndAt) : null;
    record.energySpeechEndToFirstAudioMs = energyEndAt !== null && firstAudioAt !== null ? round(firstAudioAt - energyEndAt) : null;
    record.exactUserWords = normalize(record.userTranscripts.join(' ')) === normalize(PHRASE);
    const reply = record.assistantTranscripts.join(' ');
    record.replyChecks = {
      hasNonemptyReply: Boolean(reply.trim()), mentionsBothTransportTypes: /active/i.test(reply) && /passive/i.test(reply),
      mentionsEnergy: /energy|ATP/i.test(reply), mentionsGradientDirection: /gradient|higher|lower|high to low|low to high/i.test(reply),
      note: 'These are presence checks only. Read the saved synthetic reply to verify factual correctness and absence of contradictions.',
    };
    if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type: 'stop' })); ws.close(); }
    else ws.terminate();
    resolveResult(record);
  }
  ws.on('open', () => ws.send(JSON.stringify({ type: 'start', title: 'Synthetic transport latency check', materials: [{ id: 'synthetic-transport', name: 'transport-notes.txt', text: MATERIAL }] })));
  ws.on('message', (bytes) => {
    let message;
    try { message = JSON.parse(bytes.toString()); } catch { finish('error', 'Invalid pipeline JSON'); return; }
    const now = performance.now();
    if (message.type === 'ready' && !ready) {
      ready = true; record.readyMs = round(now - beganAt);
      void (async () => {
        const streamStart = performance.now(); let sentBytes = 0;
        for (let offset = 0; !finished && committedAt === null; offset += CHUNK) {
          const speechPcm = offset < pcm.length;
          const chunk = speechPcm ? pcm.subarray(offset, Math.min(offset + CHUNK, pcm.length)) : Buffer.alloc(CHUNK);
          sentBytes += chunk.length;
          await delay(streamStart + sentBytes / BPS * 1000 - performance.now());
          if (finished || committedAt !== null || ws.readyState !== WebSocket.OPEN) return;
          const sentAt = performance.now();
          if (speechPcm && offset < energyEndBytes && offset + chunk.length >= energyEndBytes) energyEndAt = sentAt - (offset + chunk.length - energyEndBytes) / BPS * 1000;
          ws.send(JSON.stringify({ type: 'audio', audio: chunk.toString('base64') }));
          if (speechPcm) { record.audioBytesSent += chunk.length; if (offset + chunk.length >= pcm.length) pcmEndAt = sentAt; }
          else record.silenceBytesSent += chunk.length;
        }
      })().catch((error) => finish('error', error.message));
    } else if (message.type === 'transcript' && message.final) {
      if (message.role === 'user') { committedAt ??= now; record.userTranscripts.push(message.text); }
      if (message.role === 'assistant') { record.assistantTranscripts.push(message.text); record.assistantReplyMs = round(now - beganAt); if (audioEndAt !== null) finish('complete'); }
    } else if (message.type === 'audio' && message.audio) {
      const length = Buffer.byteLength(message.audio, 'base64');
      if (length) { firstAudioAt ??= now; record.outputAudioBytes += length; record.outputAudioChunks++; }
    } else if (message.type === 'audio-end') {
      audioEndAt = now; if (record.assistantTranscripts.length) finish('complete');
    } else if (message.type === 'latency') record.latencyEvents.push({ stage: message.stage, ms: message.ms, turnId: message.turnId, receivedAtMs: round(now - beganAt) });
    else if (message.type === 'state') record.states.push({ state: message.state, atMs: round(now - beganAt) });
    else if (message.type === 'error') finish('error', message.message);
  });
  ws.on('unexpected-response', (_, response) => { response.resume(); finish('rejected', `Local pipeline HTTP ${response.statusCode}`); });
  ws.on('error', (error) => finish('error', error.message));
  ws.on('close', () => { if (!finished) finish('closed'); });
  try { return await result; }
  finally {
    ws.terminate();
    await pipeline.close();
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  }
}

try {
  if (!key) throw new Error('Missing ELEVENLABS_API_KEY.');
  const organizer = await createCodexOrganizer();
  if (!organizer.available) throw new Error('Configured Luna CLI organizer is unavailable.');
  report.lunaModel = organizer.model;
  report.ttsModel = process.env.ELEVENLABS_REALTIME_MODEL_ID?.trim() || 'eleven_v4_turbo';
  report.source.generationRequests = 1;
  const generatedAt = performance.now();
  const response = await usage.fetchTts(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_16000`, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: PHRASE, model_id: report.source.model, seed: 12345, language_code: 'en' }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Synthetic TTS HTTP ${response.status}: ${await response.text()}`);
  const pcm = Buffer.from(await response.arrayBuffer());
  if (!pcm.length || pcm.length % 2 || pcm.length > BPS * 10) throw new Error('Synthetic PCM is invalid or over 10 seconds.');
  const speechEnd = energyEnd(pcm);
  Object.assign(report.source, { pcmBytes: pcm.length, durationMs: round(pcm.length / BPS * 1000), energySpeechEndMs: round(speechEnd / BPS * 1000), generationMs: round(performance.now() - generatedAt) });
  for (const [index, mode] of ['exec', 'stream', 'exec', 'stream'].entries()) {
    const result = await trial(organizer, pcm, speechEnd, mode, index + 1);
    report.runs.push(result);
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(result));
    if (result.status !== 'complete') { report.stoppedEarly = 'Stopped at the first runtime failure; no automatic retry.'; break; }
  }
  report.summary = ['exec', 'stream'].map((mode) => {
    const runs = report.runs.filter((item) => item.mode === mode), measured = runs.filter((item) => item.pcmEndToFirstAudioMs !== null);
    return { mode, runs: runs.length, completed: runs.filter((item) => item.status === 'complete').length, exactTranscriptRuns: runs.filter((item) => item.exactUserWords).length, meanPcmEndToFirstAudioMs: measured.length ? round(measured.reduce((total, item) => total + item.pcmEndToFirstAudioMs, 0) / measured.length) : null, meanCommitToFirstAudioMs: measured.length ? round(measured.reduce((total, item) => total + item.commitToFirstAudioMs, 0) / measured.length) : null };
  });
} catch (error) { report.error = sanitize(error.message); process.exitCode = 1; }
finally {
  report.usageBudget = await usage.finish();
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary: report.summary, error: report.error, stoppedEarly: report.stoppedEarly }));
}
