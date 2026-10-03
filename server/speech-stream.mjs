import WebSocket from 'ws';
import { normalizeSpeechAlignment } from '../shared/speech-alignment.mjs';

// Opens while Luna is thinking, then streams speech as clauses arrive.
// https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd
export function createSpeechStream({ env = process.env, voice, model = 'eleven_v4_turbo', signal, onAudio, onEnd, onError, onUsage, WebSocketImpl = WebSocket }) {
  const dialogue = /^eleven_v[34]/.test(model);
  const query = new URLSearchParams({ model_id: model, output_format: 'pcm_24000', sync_alignment: 'true' });
  if (!dialogue) query.set('inactivity_timeout', '60');
  const endpoint = dialogue ? '/v1/text-to-dialogue/stream-input' : `/v1/text-to-speech/${encodeURIComponent(voice)}/stream-input`;
  const start = performance.now();
  const timing = { connectMs: null, firstAudioMs: null, completeMs: null };
  let socket, stopped = false, finished = false, ending = false, textLength = 0, audioBytes = 0;
  let usageStarted = false, usageFinished = false, submittedCharacters = 0;
  let queued = [];
  let keepalive;
  const timer = setTimeout(() => fail('The spoken response took too long. Please ask again.'), 60_000);
  timer.unref?.();

  function clean() {
    clearTimeout(timer); clearInterval(keepalive);
    signal?.removeEventListener('abort', cancel);
    queued = [];
  }
  function reportUsage(status, units = { characters: submittedCharacters, audioOutputMs: audioBytes / 48 }) {
    if (!usageStarted || (usageFinished && status !== 'update')) return;
    if (!['pending', 'update'].includes(status)) usageFinished = true;
    try { onUsage?.({ status, units }); } catch { /* Accounting cannot interrupt speech. */ }
  }
  function stop(status) {
    if (stopped || finished) return;
    stopped = true; clean(); reportUsage(status); socket?.terminate();
  }
  function cancel() {
    stop('canceled');
  }
  function fail(message) {
    if (stopped || finished) return;
    stop('failed'); onError?.(message);
  }
  function send(message, characters = 0) {
    if (stopped || finished) return;
    if (socket?.readyState !== WebSocketImpl.OPEN) { queued.push({ message, characters }); return; }
    if (socket.bufferedAmount > 256_000) { fail('The voice connection fell behind. Please ask again.'); return; }
    try {
      let acknowledged = false;
      socket.send(JSON.stringify(message), error => {
        if (acknowledged) return;
        acknowledged = true;
        if (error) { if (!stopped && !finished) fail('The speech stream was interrupted. Please ask again.'); return; }
        // A successful write may be confirmed after cancellation. Preserve its
        // accounting without restarting speech or changing terminal status.
        if (characters) { submittedCharacters += characters; reportUsage(usageFinished ? 'update' : 'pending'); }
      });
    } catch { fail('The speech stream was interrupted. Please ask again.'); }
  }
  function write(text) {
    if (stopped || finished || ending || !text) return;
    textLength += text.length;
    if (textLength > 1800) { fail('Luna’s spoken answer was too long. Please ask a shorter question.'); return; }
    if (dialogue) send({ inputs: [{ text, voice_id: voice, new_turn: false }], flush: true }, text.length);
    else send({ text, flush: true }, text.length);
  }
  function finish() {
    if (stopped || finished || ending) return;
    ending = true;
    if (!textLength) { fail('Luna returned no spoken answer. Please ask again.'); return; }
    send(dialogue ? { close_socket: true } : { text: '' });
  }
  if (signal?.aborted) { cancel(); return { write, finish, cancel, timing }; }
  signal?.addEventListener('abort', cancel, { once: true });
  usageStarted = true; reportUsage('pending', {});
  try {
    socket = new WebSocketImpl(`wss://api.elevenlabs.io${endpoint}?${query}`, {
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY }, handshakeTimeout: 15_000, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false,
    });
  } catch { fail('ElevenLabs voice could not connect. Check your voice access.'); return { write, finish, cancel, timing }; }
  socket.on('open', () => {
    if (stopped) { socket.terminate(); return; }
    timing.connectMs = Math.round(performance.now() - start);
    const waiting = queued; queued = [];
    if (dialogue) send({ voices: [voice] });
    else send({ text: ' ', voice_settings: { stability: 0.5, similarity_boost: 0.8 }, generation_config: { chunk_length_schedule: [50, 120, 160, 290] } });
    for (const { message, characters } of waiting) send(message, characters);
    if (dialogue && !stopped && !finished) {
      keepalive = setInterval(() => { if (!ending) send({ keep_alive: true }); }, 10_000);
      keepalive.unref?.();
    }
  });
  socket.on('message', data => {
    if (stopped || finished) return;
    let message; try { message = JSON.parse(data.toString()); } catch { fail('ElevenLabs returned invalid speech data.'); return; }
    if (!message || message.error || message.message_type === 'error') { fail('ElevenLabs could not speak this response. Check voice access and credits.'); return; }
    if (message.audio) {
      if (typeof message.audio !== 'string' || message.audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.audio)) { fail('ElevenLabs returned invalid audio.'); return; }
      const size = Buffer.from(message.audio, 'base64').length;
      if (size % 2 || audioBytes + size > 12 * 1024 * 1024) { fail('The spoken response was not valid PCM audio.'); return; }
      audioBytes += size; reportUsage('pending');
      timing.firstAudioMs ??= Math.round(performance.now() - start);
      const alignment = normalizeSpeechAlignment(message.alignment, size / 48);
      onAudio?.(message.audio, alignment);
    }
    if (message.is_final === true || message.isFinal === true) {
      if (!ending || !audioBytes) { fail('ElevenLabs ended the speech stream unexpectedly. Please ask again.'); return; }
      finished = true; timing.completeMs = Math.round(performance.now() - start);
      clean(); reportUsage('completed'); socket.close(); onEnd?.();
    }
  });
  socket.on('error', () => fail('ElevenLabs voice could not connect. Check voice access and credits.'));
  socket.on('close', () => { if (!finished && !stopped) fail('The spoken response disconnected. Please ask again.'); });
  return { write, finish, cancel, timing };
}

// Send complete sentences when possible, bounded clauses for longer sentences.
export function createSpeechTextBuffer(write) {
  let buffer = '';
  function writeClauses(text) {
    while (text.length > 160) {
      const split = text.lastIndexOf(' ', 160);
      if (split < 40) break;
      write(text.slice(0, split + 1)); text = text.slice(split + 1);
    }
    if (text) write(text);
  }
  return {
    push(delta) {
      buffer += delta;
      let boundary;
      while ((boundary = buffer.search(/[.!?]["']?\s/)) >= 0) {
        const end = boundary + (buffer[boundary + 1] === '"' || buffer[boundary + 1] === "'" ? 2 : 1);
        writeClauses(buffer.slice(0, end) + ' '); buffer = buffer.slice(end).trimStart();
      }
      while (buffer.length > 160) {
        const split = buffer.lastIndexOf(' ', 160);
        if (split > 40) { write(buffer.slice(0, split + 1)); buffer = buffer.slice(split + 1); } else break;
      }
    },
    finish() { if (buffer.trim()) writeClauses(buffer.trim() + ' '); buffer = ''; },
  };
}
