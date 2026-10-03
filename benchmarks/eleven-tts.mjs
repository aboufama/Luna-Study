// Silent, bounded network benchmark. Run from the project root with:
// node --env-file=.env benchmarks/eleven-tts.mjs
// Audio is counted and immediately discarded; no microphone or playback APIs.
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createUsageBudget } from './usage-budget.mjs';
const usage = await createUsageBudget({ name: 'eleven-tts.mjs', maxRequests: 3, sttSessionMaxSeconds: 0, ttsModels: ['eleven_v4_turbo'] });
const WebSocket = usage.WebSocket;

const MODEL = 'eleven_v4_turbo';
const TEXT = 'Diffusion moves particles from higher to lower concentration. What changes when the concentration becomes equal?';
const KEY = process.env.ELEVENLABS_API_KEY?.trim();
const VOICE = process.env.ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb';
const OUT = new URL('./eleven-tts-results.json', import.meta.url);
const round = value => value === null ? null : Math.round(value * 10) / 10;

function safeDiagnostic(message) {
  const value = [message.error, message.error_type, message.message, message.detail?.message]
    .filter(value => typeof value === 'string').join(' | ');
  return value.split(KEY || '__missing_key__').join('[redacted]').replace(/sk_[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 400) || 'Provider returned an error.';
}

function trial({ name, prewarmMs }) {
  return new Promise(resolve => {
    const start = performance.now();
    let socket, sentAt = null, finished = false, delayTimer;
    const result = { name, prewarmMs, model: MODEL, ok: false, connectMs: null, textSentMs: null, firstAudioMs: null, firstAudioAfterSendMs: null, completeMs: null, completeAfterSendMs: null, audioBytesDiscarded: 0, audioChunks: 0, finalForTurnSeen: false, finalSeen: false, closeCode: null };
    const elapsed = () => performance.now() - start;
    function finish(error = null) {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(delayTimer);
      result.ok = !error && result.finalSeen && result.audioBytesDiscarded > 0;
      if (error) result.error = error;
      result.elapsedMs = round(elapsed());
      if (socket?.readyState === WebSocket.OPEN) socket.close();
      else if (socket?.readyState === WebSocket.CONNECTING) socket.terminate();
      resolve(result);
    }
    const timer = setTimeout(() => { socket?.terminate(); finish('Timed out after 20 seconds.'); }, 20_000);
    try {
      const query = new URLSearchParams({ model_id: MODEL, output_format: 'pcm_24000' });
      socket = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?${query}`, {
        headers: { 'xi-api-key': KEY }, handshakeTimeout: 12_000, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false,
      });
      socket.on('open', () => {
        result.connectMs = round(elapsed());
        socket.send(JSON.stringify({ voices: [VOICE] }));
        const send = () => {
          if (finished || socket.readyState !== WebSocket.OPEN) return;
          sentAt = performance.now(); result.textSentMs = round(elapsed());
          socket.send(JSON.stringify({ inputs: [{ text: `${TEXT} `, voice_id: VOICE, new_turn: false }] }));
          socket.send(JSON.stringify({ close_socket: true }));
        };
        if (prewarmMs) delayTimer = setTimeout(send, prewarmMs);
        else send();
      });
      socket.on('message', data => {
        if (finished) return;
        let message;
        try { message = JSON.parse(data.toString()); }
        catch { socket.terminate(); finish('Provider returned invalid JSON.'); return; }
        if (message.error || message.error_type || message.message_type === 'error') {
          socket.terminate(); finish(safeDiagnostic(message)); return;
        }
        if (typeof message.audio === 'string' && message.audio.length) {
          if (result.firstAudioMs === null) {
            result.firstAudioMs = round(elapsed());
            result.firstAudioAfterSendMs = sentAt === null ? null : round(performance.now() - sentAt);
          }
          result.audioBytesDiscarded += Buffer.byteLength(message.audio, 'base64');
          result.audioChunks++;
          if (result.audioBytesDiscarded > 4 * 1024 * 1024) { socket.terminate(); finish('Audio exceeded the benchmark limit.'); return; }
        }
        if (message.is_final_audio_for_turn === true) result.finalForTurnSeen = true;
        if (message.is_final === true || message.isFinal === true) {
          result.finalSeen = true; result.completeMs = round(elapsed());
          result.completeAfterSendMs = sentAt === null ? null : round(performance.now() - sentAt);
          finish(result.audioBytesDiscarded ? null : 'Final message contained no audio.');
        }
      });
      socket.on('unexpected-response', (_, response) => {
        response.resume(); socket.terminate(); finish(`WebSocket handshake rejected: HTTP ${response.statusCode}.`);
      });
      socket.on('error', error => finish(safeDiagnostic({ message: error.message })));
      socket.on('close', code => { result.closeCode = code; if (!finished) finish(`Socket closed before the final frame (code ${code}).`); });
    } catch (error) { finish(safeDiagnostic({ message: error.message })); }
  });
}

const report = {
  startedAt: new Date().toISOString(), model: MODEL, outputFormat: 'pcm_24000', text: TEXT,
  microphoneUsed: false, audioPlayed: false, audioSaved: false, providerCallLimit: 3,
  notes: ['Synthetic text only. First audio measures received bytes, not audible playback.', 'Prewarm trial opens and registers the voice one second before text becomes available. That deliberate wait is included in from-start times, excluded in after-send times.', 'Three sequential observations are not a statistically stable provider latency estimate.'],
  docs: ['https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd', 'https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket'],
  trials: [],
};

if (!KEY) {
  report.error = 'ELEVENLABS_API_KEY is not configured.';
} else {
  for (const config of [{ name: 'immediate-1', prewarmMs: 0 }, { name: 'immediate-2', prewarmMs: 0 }, { name: 'preopened-1', prewarmMs: 1000 }]) {
    const result = await trial(config);
    report.trials.push(result);
    await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(result));
    if (!result.ok) { report.stoppedEarly = 'First failed request ended the benchmark; no automatic retry.'; break; }
  }
}
report.usageBudget = await usage.finish();
report.completedAt = new Date().toISOString();
await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`);
if (report.error) console.log(report.error);
