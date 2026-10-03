import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createGptLiveTransport, normalizeGptLiveSpeechText, compareGptLiveSpeech } from '../server/gpt-live-transport.mjs';

function fixture(t, options = {}) {
  const sockets = [], messages = [], events = [], errors = [], accounting = [];
  class Socket extends EventEmitter {
    constructor(url, config) { super(); Object.assign(this, { url, config, readyState: 0, bufferedAmount: 0, frames: [] }); sockets.push(this); }
    send(frame, callback) { this.frames.push(JSON.parse(frame)); callback?.(); }
    open() { this.readyState = 1; this.emit('open'); }
    receive(value) { this.emit('message', Buffer.from(JSON.stringify(value))); }
    terminate() { this.readyState = 3; this.emit('close'); }
  }
  const transport = createGptLiveTransport({ env: { OPENAI_API_KEY: 'test-key' }, testId: 'example', WebSocketImpl: Socket,
    delegationGraceMs: 8, speechQuietMs: 12, closeTimeoutMs: 20, speechTimeoutMs: 500,
    usageLedger: { start: (id, metadata) => { accounting.push({ start: metadata, id }); return { update: value => accounting.push({ update: value }), finish: value => accounting.push({ finish: value }) }; } },
    onEvent: value => events.push(value), onError: value => errors.push(value), ...options });
  const listener = transport.createListeningSocket();
  listener.on('message', value => messages.push(JSON.parse(value)));
  listener.on('error', () => {});
  const socket = sockets[0];
  function start() { socket.open(); socket.receive({ type: 'session.started', session: { id: 'live_test' } }); }
  t.after(() => { transport.close(); for (const item of sockets) item.receive({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 2 } }); });
  return { transport, listener, socket, sockets, messages, events, errors, accounting, start };
}

test('starts exact Live client protocol and preserves native 16 kHz microphone bytes', t => {
  const f = fixture(t); f.start();
  assert.equal(f.socket.url, 'wss://api.openai.com/v1/live/sessions');
  assert.equal(f.socket.frames[0].type, 'session.start');
  assert.deepEqual(f.socket.frames[0].session.delegation, { type: 'client' });
  assert.deepEqual(f.socket.frames[0].session.audio.format, { type: 'audio/pcm', rate: 16000 });
  assert.equal(f.listener.readyState, 1);
  let accepted = false;
  f.listener.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: 'AAA=', sample_rate: 16000 }), error => { assert.ifError(error); accepted = true; });
  assert.equal(accepted, true);
  assert.deepEqual(f.socket.frames.at(-1), { type: 'session.input_audio.append', audio: 'AAA=' });
  assert.equal(f.messages[0].message_type, 'session_started');
});

test('commits exact accumulated transcript once after client delegation', async t => {
  const f = fixture(t); f.start();
  f.socket.receive({ type: 'session.input_transcript.delta', delta: 'I think', start_ms: 100, end_ms: 400 });
  f.socket.receive({ type: 'session.delegation.created', offset_ms: 900, delegation: { id: 'delegation_1', target: 'client' } });
  f.socket.receive({ type: 'session.input_transcript.delta', delta: ' the answer is five.', start_ms: 400, end_ms: 850 });
  await sleep(15);
  f.socket.receive({ type: 'session.delegation.created', offset_ms: 900, delegation: { id: 'delegation_1', target: 'client' } });
  await sleep(15);
  assert.deepEqual(f.messages.filter(value => value.message_type === 'committed_transcript'), [{ message_type: 'committed_transcript', text: 'I think the answer is five.' }]);
  const speech = f.transport.createSpeechStream(); speech.write('Check your second step.'); speech.finish();
  assert.equal(f.socket.frames.at(-1).delegation_id, 'delegation_1'); speech.cancel(false);
});

test('a delegation arriving before its transcript waits instead of creating an empty turn', async t => {
  const f = fixture(t); f.start();
  f.socket.receive({ type: 'session.delegation.created', offset_ms: 100, delegation: { id: 'd', target: 'client' } });
  await sleep(15);
  assert.equal(f.messages.filter(value => value.message_type === 'committed_transcript').length, 0);
  f.socket.receive({ type: 'session.input_transcript.delta', delta: 'Could you repeat the question?', start_ms: 0, end_ms: 100 });
  await sleep(15);
  assert.equal(f.messages.at(-1).message_type, 'committed_transcript');
});

test('drops autonomous speech until approved backend content and reports transcript as diagnostics', t => {
  const f = fixture(t); f.start(); const audio = [];
  const speech = f.transport.createSpeechStream({ onAudio: value => audio.push(value) });
  const pcm = Buffer.alloc(640); for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(900, i);
  f.socket.receive({ type: 'session.output_audio.delta', delta: pcm.toString('base64') });
  assert.equal(audio.length, 0);
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'Unapproved model words', start_ms: 0, end_ms: 100 });
  assert.equal(f.events.at(-1).deliveredStreamActive, false);
  speech.write('What was your first step?'); speech.finish();
  f.socket.receive({ type: 'session.output_audio.delta', delta: pcm.toString('base64') });
  assert.equal(audio.length, 1); speech.cancel(false);
});

test('new student speech invalidates the current backend speech and rejects its late writes/audio', t => {
  const f = fixture(t); f.start(); const audio = [];
  const speech = f.transport.createSpeechStream({ onAudio: value => audio.push(value) }); speech.write('Earlier question.'); speech.finish();
  const before = f.socket.frames.length;
  f.socket.receive({ type: 'session.input_transcript.delta', delta: 'Switch problems.', start_ms: 1000, end_ms: 1500 });
  speech.write('Stale answer');
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'hAODAw==' });
  assert.equal(f.socket.frames.length, before);
  assert.equal(audio.length, 0);
});

test('marks speech completion as a local quiet heuristic and ignores silence padding', async t => {
  const f = fixture(t); f.start(); let ended = 0;
  const speech = f.transport.createSpeechStream({ onEnd: () => ended++ }); speech.write('Now try that step.'); speech.finish();
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'Now try that step.' });
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'hAODAw==' });
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'AAAAAAAAAAA=' });
  await sleep(20);
  assert.equal(ended, 1);
  assert.equal(f.events.find(value => value.type === 'live-speech-end').confirmedByProvider, false);
  assert.ok(speech.timing.firstAudioMs !== null);
});

test('streams all pauses immediately after first audible frame to avoid doubled silence', t => {
  const f = fixture(t); f.start(); const audio = [];
  const speech = f.transport.createSpeechStream({ onAudio: value => audio.push(value) }); speech.write('First. Second.'); speech.finish();
  for (const delta of ['AAAAAAAAAAA=', 'hAODAw==', 'AAAAAAAAAAA=', 'hAODAw==', 'AAAAAAAAAAA=']) f.socket.receive({ type: 'session.output_audio.delta', delta });
  assert.deepEqual(audio, ['hAODAw==', 'AAAAAAAAAAA=', 'hAODAw==', 'AAAAAAAAAAA=']);
  speech.cancel(false);
});

test('usage updates are cumulative snapshots and graceful close waits for final usage', t => {
  const f = fixture(t); f.start();
  f.socket.receive({ type: 'session.usage.updated', usage: { seconds: 3 } });
  f.socket.receive({ type: 'session.usage.updated', usage: { seconds: 5 } });
  f.listener.terminate();
  assert.equal(f.socket.frames.at(-1).type, 'session.close');
  assert.equal(f.socket.readyState, 1);
  assert.equal(f.accounting.filter(value => value.finish).length, 0);
  f.socket.receive({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 5.25 } });
  assert.deepEqual(f.accounting.at(-1), { finish: { status: 'completed', units: { sessionDurationMs: 5250 } } });
  assert.equal(f.socket.readyState, 3);
});

test('disconnect without finalization preserves known usage and marks failure', t => {
  const f = fixture(t); f.start();
  f.socket.receive({ type: 'session.usage.updated', usage: { seconds: 4 } });
  f.socket.terminate();
  assert.deepEqual(f.accounting.at(-1), { finish: { status: 'failed', units: { sessionDurationMs: 4000 } } });
  assert.equal(f.events.find(value => value.type === 'live-session-finalized').finalized, false);
});

test('closing before connection cannot start a paid session on a late open', t => {
  const f = fixture(t); f.listener.close(); f.socket.open();
  assert.deepEqual(f.socket.frames, []);
  assert.equal(f.listener.readyState, 3);
});

test('resume creates an independent session while the previous one finalizes', t => {
  const f = fixture(t); f.start(); f.listener.close();
  const resumed = f.transport.createListeningSocket(); const next = f.sockets[1];
  next.open(); next.receive({ type: 'session.started', session: { id: 'live_resumed' } });
  f.socket.receive({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 1 } });
  assert.equal(resumed.readyState, 1);
  const speech = f.transport.createSpeechStream(); speech.write('Let us continue.'); speech.finish();
  assert.equal(next.frames.at(-1).type, 'session.commentary.append'); speech.cancel(false);
});

test('buffers a complete approved utterance before submitting one voice request', t => {
  const f = fixture(t); f.start(); const speech = f.transport.createSpeechStream();
  const count = f.socket.frames.length;
  speech.write('Great. '); speech.write('Explain the membrane role.');
  assert.equal(f.socket.frames.length, count);
  speech.finish();
  assert.equal(f.socket.frames.length, count + 1);
  assert.match(f.socket.frames.at(-1).content, /Great\. Explain the membrane role\./);
  speech.cancel(false);
});

test('an incomplete spoken prefix cannot falsely complete during a pause', async t => {
  const f = fixture(t); f.start(); let ended = 0; const transcripts = [];
  const speech = f.transport.createSpeechStream({ onEnd: () => ended++, onTranscript: value => transcripts.push(value) });
  speech.write('Great. Explain the membrane role.'); speech.finish();
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'Great.' });
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'hAODAw==' });
  await sleep(25);
  assert.equal(ended, 0); assert.equal(transcripts[0].matched, null);
  f.socket.receive({ type: 'session.output_transcript.delta', delta: ' Explain the membrane role.' });
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'hAODAw==' });
  await sleep(20);
  assert.equal(ended, 1); assert.equal(transcripts.at(-1).final, true); assert.equal(transcripts.at(-1).matched, true);
});

test('incompatible voice wording halts later playback and records failed fidelity', t => {
  const f = fixture(t); f.start(); const transcripts = [], errors = [], audio = [];
  const speech = f.transport.createSpeechStream({ onAudio: value => audio.push(value), onError: value => errors.push(value), onTranscript: value => transcripts.push(value) });
  speech.write('Explain the membrane role.'); speech.finish();
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'Explain homeostasis.' });
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'hAODAw==' });
  assert.equal(errors.length, 1); assert.equal(audio.length, 0);
  assert.equal(transcripts.at(-1).matched, false); assert.equal(transcripts.at(-1).final, true);
  assert.equal(f.socket.frames.at(-1).type, 'session.instructions.append');
});

test('cancellation exposes a final incomplete spoken transcript without claiming completion', t => {
  const f = fixture(t); f.start(); const transcripts = [];
  const speech = f.transport.createSpeechStream({ onTranscript: value => transcripts.push(value) });
  speech.write('First explain the membrane.'); speech.finish();
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'First explain' });
  speech.cancel();
  assert.deepEqual(transcripts.at(-1), { text: 'First explain', final: true, matched: false, approvedText: 'First explain the membrane.',
    literalExact: false, normalizedExact: false, approvedBodyMatched: false, allowedPrefix: null, fidelityType: null });
});

test('timestamp boundaries exclude later speech and chronological ordering absorbs delayed fragments', async t => {
  const f = fixture(t); f.start();
  f.socket.receive({ type: 'session.input_transcript.delta', event_id: 'later', delta: ' is five.', start_ms: 300, end_ms: 500 });
  f.socket.receive({ type: 'session.delegation.created', offset_ms: 600, delegation: { id: 'd1', target: 'client' } });
  f.socket.receive({ type: 'session.input_transcript.delta', event_id: 'early', delta: 'My answer', start_ms: 0, end_ms: 300 });
  f.socket.receive({ type: 'session.input_transcript.delta', event_id: 'next', delta: 'Actually change topics.', start_ms: 700, end_ms: 900 });
  await sleep(15);
  assert.equal(f.messages.filter(value => value.message_type === 'committed_transcript')[0].text, 'My answer is five.');
  f.socket.receive({ type: 'session.delegation.created', offset_ms: 1000, delegation: { id: 'd2', target: 'client' } });
  await sleep(15);
  assert.deepEqual(f.messages.filter(value => value.message_type === 'committed_transcript').map(value => value.text), ['My answer is five.', 'Actually change topics.']);
});

test('late fragments and repeated delegation cannot create a bogus second student attempt', async t => {
  const f = fixture(t); f.start();
  f.socket.receive({ type: 'session.input_transcript.delta', event_id: 'e1', delta: 'Five.', start_ms: 0, end_ms: 300 });
  f.socket.receive({ type: 'session.delegation.created', offset_ms: 500, delegation: { id: 'd1', target: 'client' } });
  await sleep(15);
  f.socket.receive({ type: 'session.input_transcript.delta', event_id: 'e2', delta: ' I think.', start_ms: 300, end_ms: 450 });
  f.socket.receive({ type: 'session.delegation.created', offset_ms: 500, delegation: { id: 'd2', target: 'client' } });
  await sleep(15);
  assert.equal(f.messages.filter(value => value.message_type === 'committed_transcript').length, 1);
  assert.equal(f.events.find(value => value.type === 'live-late-input-transcript').action, 'not-recommitted');
});

test('duplicate transcript event IDs are ignored without erasing intentionally repeated words', async t => {
  const f = fixture(t); f.start();
  for (const event of [
    { event_id: 'same', delta: 'Very ', start_ms: 0, end_ms: 100 },
    { event_id: 'same', delta: 'Very ', start_ms: 0, end_ms: 100 },
    { event_id: 'different', delta: 'very sure.', start_ms: 100, end_ms: 300 },
  ]) f.socket.receive({ type: 'session.input_transcript.delta', ...event });
  f.socket.receive({ type: 'session.delegation.created', offset_ms: 500, delegation: { id: 'd1', target: 'client' } });
  await sleep(15);
  assert.equal(f.messages.at(-1).text, 'Very very sure.');
});

test('factory close is awaitable and resolves after all final usage is recorded', async t => {
  const f = fixture(t); f.start(); let resolved = false;
  const closing = f.transport.close().then(value => { resolved = true; return value; });
  await sleep(1); assert.equal(resolved, false);
  f.socket.receive({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 7 } });
  const result = await closing;
  assert.equal(result[0].finalized, true);
  assert.equal(f.accounting.at(-1).finish.units.sessionDurationMs, 7000);
});

test('awaitable close has a bounded timeout and reports unconfirmed finalization', async t => {
  const f = fixture(t); f.start();
  const result = await f.transport.close();
  assert.equal(result[0].finalized, false); assert.equal(result[0].status, 'canceled');
});

test('no audible output fails explicitly even when the exact transcript was produced', async t => {
  const f = fixture(t, { speechTimeoutMs: 25 }); f.start(); let ended = 0; const errors = [];
  const speech = f.transport.createSpeechStream({ onError: value => errors.push(value), onEnd: () => ended++ });
  speech.write('Try again.'); speech.finish();
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'Try again.' });
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'AAAAAAAAAAA=' });
  await sleep(35);
  assert.equal(ended, 0); assert.equal(errors.length, 1); assert.match(errors[0], /did not produce/);
});

test('model punctuation and capitalization differences preserve exact spoken-word fidelity', async t => {
  const f = fixture(t); f.start(); const transcripts = [];
  const speech = f.transport.createSpeechStream({ onTranscript: value => transcripts.push(value) });
  speech.write('Great — explain the membrane!'); speech.finish();
  f.socket.receive({ type: 'session.output_transcript.delta', delta: ' great, explain the membrane.' });
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'hAODAw==' });
  await sleep(20);
  assert.equal(transcripts.at(-1).matched, true); assert.equal(transcripts.at(-1).final, true);
});

test('identical words spoken in a later timestamp interval are a new attempt', async t => {
  const f = fixture(t); f.start();
  for (const [index, start] of [0, 1000].entries()) {
    f.socket.receive({ type: 'session.input_transcript.delta', event_id: `e${index}`, delta: 'Five.', start_ms: start, end_ms: start + 300 });
    f.socket.receive({ type: 'session.delegation.created', offset_ms: start + 500, delegation: { id: `d${index}`, target: 'client' } });
    await sleep(15);
  }
  assert.deepEqual(f.messages.filter(value => value.message_type === 'committed_transcript').map(value => value.text), ['Five.', 'Five.']);
});

test('provider failure during graceful close settles the close promise and accounting once', async t => {
  const f = fixture(t); f.start();
  const closing = f.transport.close();
  f.socket.emit('error', new Error('simulated connection loss'));
  f.socket.terminate();
  const result = await closing;
  assert.equal(result[0].finalized, false); assert.equal(f.accounting.filter(value => value.finish).length, 1);
});

test('a quiet complete transcript reaches the backend even when Live never delegates', async t => {
  const f = fixture(t, { transcriptIdleMs: 12 }); f.start();
  f.socket.receive({ type: 'session.input_transcript.delta', delta: 'Please repeat the question.', start_ms: 100, end_ms: 600 });
  await sleep(20);
  assert.equal(f.messages.at(-1).message_type, 'committed_transcript');
  const decision = f.events.find(event => event.type === 'live-delegation');
  assert.equal(decision.reason, 'transcript-idle-fallback'); assert.equal(decision.delegationId, null);
  assert.equal(f.socket.frames.at(-1).type, 'session.instructions.append');
  const speech = f.transport.createSpeechStream(); speech.write('Explain the membrane.'); speech.finish();
  assert.equal(f.socket.frames.at(-1).delegation_id, null); speech.cancel(false);
});

test('fallback waits while microphone energy says the student is still speaking', async t => {
  const f = fixture(t, { transcriptIdleMs: 12, transcriptUnpunctuatedIdleMs: 12, microphoneQuietMs: 400 }); f.start();
  const voiced = Buffer.alloc(3200); for (let index = 0; index < voiced.length; index += 2) voiced.writeInt16LE(900, index);
  const sendPcm = bytes => f.listener.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: bytes.toString('base64') }), () => {});
  sendPcm(voiced);
  f.socket.receive({ type: 'session.input_transcript.delta', delta: 'I think', start_ms: 0, end_ms: 500 });
  await sleep(20);
  assert.equal(f.messages.filter(event => event.message_type === 'committed_transcript').length, 0);
  for (let index = 0; index < 3; index++) sendPcm(Buffer.alloc(3200));
  await sleep(110);
  assert.equal(f.messages.filter(event => event.message_type === 'committed_transcript').length, 0);
  sendPcm(Buffer.alloc(3200));
  await sleep(110);
  assert.equal(f.messages.filter(event => event.message_type === 'committed_transcript').length, 1);
});

test('a later transcript fragment resets the idle fallback and preserves the complete request', async t => {
  const f = fixture(t, { transcriptIdleMs: 25 }); f.start();
  f.socket.receive({ type: 'session.input_transcript.delta', delta: 'Ask me', start_ms: 0, end_ms: 200 });
  await sleep(15);
  f.socket.receive({ type: 'session.input_transcript.delta', delta: ' without solving it.', start_ms: 200, end_ms: 600 });
  await sleep(15);
  assert.equal(f.messages.filter(event => event.message_type === 'committed_transcript').length, 0);
  await sleep(20);
  assert.equal(f.messages.at(-1).text, 'Ask me without solving it.');
});

test('provider delegation arriving after the fallback does not create a second turn', async t => {
  const f = fixture(t, { transcriptIdleMs: 12 }); f.start();
  f.socket.receive({ type: 'session.input_transcript.delta', delta: 'Repeat it.', start_ms: 100, end_ms: 300 });
  await sleep(20);
  f.socket.receive({ type: 'session.delegation.created', offset_ms: 500, delegation: { id: 'late', target: 'client' } });
  await sleep(20);
  assert.equal(f.messages.filter(event => event.message_type === 'committed_transcript').length, 1);
  f.socket.receive({ type: 'session.input_transcript.delta', delta: 'Repeat it.', start_ms: 800, end_ms: 1000 });
  await sleep(20);
  assert.equal(f.messages.filter(event => event.message_type === 'committed_transcript').length, 2);
});

test('spoken numbers and explicit operators match their written algebra without erasing signs', () => {
  assert.equal(normalizeGptLiveSpeechText('Solve 2x + 3 = 11.'), normalizeGptLiveSpeechText('Solve two x plus three equals eleven.'));
  assert.notEqual(normalizeGptLiveSpeechText('2x + 3 = 11'), normalizeGptLiveSpeechText('2x - 3 = 11'));
  assert.notEqual(normalizeGptLiveSpeechText('x ≠ 2'), normalizeGptLiveSpeechText('x = 2'));
  assert.notEqual(normalizeGptLiveSpeechText('x < 2'), normalizeGptLiveSpeechText('x > 2'));
  assert.notEqual(normalizeGptLiveSpeechText('x ≈ 2'), normalizeGptLiveSpeechText('x = 2'));
  assert.notEqual(normalizeGptLiveSpeechText('x + (2 * 3)'), normalizeGptLiveSpeechText('(x + 2) * 3'));
  assert.notEqual(normalizeGptLiveSpeechText('x_1'), normalizeGptLiveSpeechText('x1'));
  assert.equal(normalizeGptLiveSpeechText('twenty-one'), normalizeGptLiveSpeechText('21'));
  assert.notEqual(normalizeGptLiveSpeechText('test-level'), normalizeGptLiveSpeechText('test level'), 'an ambiguous hyphen must not silently erase a possible subtraction');
  assert.equal(normalizeGptLiveSpeechText('3.5'), normalizeGptLiveSpeechText('three point five'));
});

test('algebra spoken in words reaches verified completion', async t => {
  const f = fixture(t); f.start(); const transcripts = [];
  const speech = f.transport.createSpeechStream({ onTranscript: value => transcripts.push(value) });
  speech.write('Solve 2x + 3 = 11.'); speech.finish();
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'Solve two x plus three equals eleven.' });
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'hAODAw==' });
  await sleep(20);
  assert.equal(transcripts.at(-1).matched, true); assert.equal(transcripts.at(-1).final, true);
});

test('unpunctuated ASR tail waits long enough for delayed final word and punctuation', async t => {
  const f = fixture(t); f.start();
  f.socket.receive({ type: 'session.input_transcript.delta', delta: 'Please ask the membrane transport', start_ms: 0, end_ms: 12400 });
  await sleep(780);
  assert.equal(f.messages.filter(event => event.message_type === 'committed_transcript').length, 0);
  f.socket.receive({ type: 'session.input_transcript.delta', delta: ' question', start_ms: 12800, end_ms: 13000 });
  await sleep(100);
  f.socket.receive({ type: 'session.input_transcript.delta', delta: '.', start_ms: 13000, end_ms: 13200 });
  await sleep(570);
  assert.deepEqual(f.messages.filter(event => event.message_type === 'committed_transcript').map(event => event.text), ['Please ask the membrane transport question.']);
});

test('partial spelled numbers may finish across deltas without a false fidelity failure', async t => {
  const f = fixture(t, { mismatchSettleMs: 40 }); f.start(); const transcripts = [], errors = [];
  const speech = f.transport.createSpeechStream({ onTranscript: value => transcripts.push(value), onError: value => errors.push(value) });
  speech.write('Use 2 and 21.'); speech.finish();
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'Use t' });
  assert.equal(transcripts.at(-1).matched, null);
  await sleep(10);
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'wo and twenty' });
  assert.equal(transcripts.at(-1).matched, null);
  await sleep(10);
  f.socket.receive({ type: 'session.output_transcript.delta', delta: ' o' });
  assert.equal(transcripts.at(-1).matched, null);
  await sleep(10);
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'ne.' });
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'hAODAw==' });
  await sleep(20);
  assert.equal(errors.length, 0); assert.equal(transcripts.at(-1).matched, true); assert.equal(transcripts.at(-1).final, true);
});

test('a stable wrong last word is rejected after the bounded lexical settling time', async t => {
  const f = fixture(t, { mismatchSettleMs: 15 }); f.start(); const errors = [], transcripts = [];
  const speech = f.transport.createSpeechStream({ onTranscript: value => transcripts.push(value), onError: value => errors.push(value) });
  speech.write('Explain membranes.'); speech.finish();
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'Explain homeostasis' });
  assert.equal(transcripts.at(-1).matched, null);
  await sleep(25);
  assert.equal(errors.length, 1); assert.equal(transcripts.at(-1).final, true); assert.equal(transcripts.at(-1).matched, false);
});

test('partial-number tolerance cannot mask an opposite mathematical operator', async t => {
  const f = fixture(t, { mismatchSettleMs: 15 }); f.start(); const errors = [];
  const speech = f.transport.createSpeechStream({ onError: value => errors.push(value) });
  speech.write('Two plus three equals five.'); speech.finish();
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'Two minus ' });
  assert.equal(errors.length, 1);
});

test('one finite neutral acknowledgement preserves the entire approved body and raw fidelity distinctions', () => {
  const expected = 'Use the Hint button for a nudge, or tell me your first step.';
  for (const prefix of ['Okay,', 'OK,', 'Alright.', 'All right,', 'Got it.']) {
    const result = compareGptLiveSpeech(expected, `${prefix} ${expected}`);
    assert.equal(result.matched, true, prefix);
    assert.equal(result.literalExact, false);
    assert.equal(result.normalizedExact, false);
    assert.equal(result.approvedBodyMatched, true);
    assert.equal(result.fidelityType, 'approved-body-with-neutral-ack');
    assert.ok(result.allowedPrefix);
  }
  const exact = compareGptLiveSpeech(expected, expected);
  assert.equal(exact.literalExact, true); assert.equal(exact.normalizedExact, true);
  assert.equal(exact.fidelityType, 'exact-wording'); assert.equal(exact.allowedPrefix, null);
});

test('neutral-prefix matching never permits academic approval, repeated acknowledgements, or extra explanations', () => {
  const expected = 'Use the Hint button.';
  for (const prefix of ['Right,', 'Yes,', 'Correct,', 'Exactly,', 'Great,', 'Absolutely,', 'The answer is,', 'Okay, okay,', 'Got it. Okay,']) {
    assert.equal(compareGptLiveSpeech(expected, `${prefix} ${expected}`).matched, false, prefix);
  }
  assert.equal(compareGptLiveSpeech(expected, `Okay, ${expected} First subtract three.`).matched, false);
  assert.equal(compareGptLiveSpeech('Solve 2x + 3 = 11.', 'Okay, solve two x minus three equals eleven.').matched, false);
  assert.equal(compareGptLiveSpeech(expected, 'Okay,').matched, false);
  assert.equal(compareGptLiveSpeech(expected, 'Okayish, Use the Hint button.').matched, false);
});

test('acknowledgement matching does not erase right-angle geometry or an OK variable', () => {
  assert.equal(compareGptLiveSpeech('angles are equal.', 'All right angles are equal.').matched, false);
  assert.equal(compareGptLiveSpeech('= 5', 'OK = 5').matched, false);
  assert.equal(compareGptLiveSpeech('OK = 5', 'OK = 5').matched, true);
  assert.equal(compareGptLiveSpeech('All right angles are equal.', 'All right angles are equal.').matched, true);
  assert.equal(compareGptLiveSpeech('Use the Hint button.', 'Okay Use the Hint button.').matched, true);
});

test('a streamed neutral prefix remains incomplete until the exact body arrives and preserves actual wording', async t => {
  const f = fixture(t); f.start(); const transcripts = [], errors = [], ends = [];
  const speech = f.transport.createSpeechStream({ onTranscript: value => transcripts.push(value), onError: value => errors.push(value), onEnd: value => ends.push(value) });
  speech.write('Use the Hint button.'); speech.finish();
  f.socket.receive({ type: 'session.output_transcript.delta', delta: 'Okay,' });
  assert.equal(transcripts.at(-1).matched, null);
  f.socket.receive({ type: 'session.output_transcript.delta', delta: ' Use the Hint button.' });
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'hAODAw==' });
  await sleep(20);
  assert.equal(errors.length, 0); assert.equal(ends.length, 1);
  assert.equal(transcripts.at(-1).text, 'Okay, Use the Hint button.');
  assert.equal(transcripts.at(-1).final, true); assert.equal(transcripts.at(-1).matched, true);
  assert.equal(transcripts.at(-1).literalExact, false); assert.equal(transcripts.at(-1).allowedPrefix, 'Okay');
  assert.equal(ends[0].fidelityType, 'approved-body-with-neutral-ack');
});

test('number fragments still settle safely after an allowed neutral prefix', async t => {
  const f = fixture(t, { mismatchSettleMs: 40 }); f.start(); const errors = [], transcripts = [];
  const speech = f.transport.createSpeechStream({ onTranscript: value => transcripts.push(value), onError: value => errors.push(value) });
  speech.write('Use 21.'); speech.finish();
  for (const delta of ['Got ', 'it.', ' Use twenty', ' o', 'ne.']) {
    f.socket.receive({ type: 'session.output_transcript.delta', delta });
    await sleep(5);
  }
  f.socket.receive({ type: 'session.output_audio.delta', delta: 'hAODAw==' });
  await sleep(20);
  assert.equal(errors.length, 0); assert.equal(transcripts.at(-1).matched, true);
  assert.equal(transcripts.at(-1).allowedPrefix, 'Got it');
});

test('an allowed prefix cannot hide repeated acknowledgements or a wrong settled last word', async t => {
  for (const wrong of ['Okay, okay, Explain membranes.', 'Okay, Explain homeostasis']) {
    const f = fixture(t, { mismatchSettleMs: 10 }); f.start(); const errors = [], transcripts = [];
    const speech = f.transport.createSpeechStream({ onTranscript: value => transcripts.push(value), onError: value => errors.push(value) });
    speech.write('Explain membranes.'); speech.finish();
    f.socket.receive({ type: 'session.output_transcript.delta', delta: wrong });
    await sleep(20);
    assert.equal(errors.length, 1, wrong); assert.equal(transcripts.at(-1).matched, false);
  }
});

test('unary and grouped subtraction cannot disappear from approved mathematical speech', () => {
  for (const [expected, actual] of [
    ['Solve -x = 2.', 'Solve x = 2.'],
    ['Use x - (y + 1).', 'Use x (y + 1).'],
    ['Use x - y.', 'Use x y.'],
    ['Use -3.', 'Use 3.'],
    ['Use x--y.', 'Use x y.'],
  ]) assert.equal(compareGptLiveSpeech(expected, actual).matched, false, expected);
  assert.equal(compareGptLiveSpeech('Solve -x = 2.', 'Solve minus x equals two.').matched, true);
});

test('leading decimal points preserve magnitude and accept explicit zero-point pronunciation', () => {
  assert.equal(compareGptLiveSpeech('Use .5 liters.', 'Use 5 liters.').matched, false);
  assert.equal(compareGptLiveSpeech('Use -.5 liters.', 'Use minus 5 liters.').matched, false);
  assert.equal(compareGptLiveSpeech('Use .5 liters.', 'Use zero point five liters.').matched, true);
  assert.equal(compareGptLiveSpeech('Use .5 liters.', 'Use 0.5 liters.').matched, true);
});

test('compatibility characters preserve powers and subscripts instead of collapsing to plain digits', () => {
  for (const [expected, actual] of [['2² = 4', '22 = 4'], ['x₁ = 3', 'x1 = 3'], ['x²', 'x2'], ['10⁻²', '10-2']]) {
    assert.equal(compareGptLiveSpeech(expected, actual).matched, false, expected);
  }
  assert.equal(compareGptLiveSpeech('Evaluate 2².', 'Evaluate 2².').matched, true);
});

test('factorial punctuation and inequality remain mathematical content', () => {
  assert.equal(compareGptLiveSpeech('Evaluate 5! = 120.', 'Evaluate 5 = 120.').matched, false);
  assert.equal(compareGptLiveSpeech('Evaluate n!.', 'Evaluate n.').matched, false);
  assert.equal(compareGptLiveSpeech('Evaluate 5!!.', 'Evaluate 5!.').matched, false);
  assert.equal(compareGptLiveSpeech('Evaluate 5!!.', 'Evaluate five factorial factorial.').matched, false);
  assert.equal(compareGptLiveSpeech('Evaluate 5!.', 'Evaluate five factorial.').matched, true);
  assert.equal(compareGptLiveSpeech('Evaluate 5!!.', 'Evaluate five double factorial.').matched, true);
  assert.equal(compareGptLiveSpeech('x != 2', 'x = 2').matched, false);
});

test('derivative primes cannot disappear through quotation normalization', () => {
  for (const [expected, actual] of [["Find f'(x).", 'Find f(x).'], ['Find f’(x).', 'Find f(x).'], ['Find f"(x).', "Find f'(x)."], ["Use y'.", 'Use y.']]) {
    assert.equal(compareGptLiveSpeech(expected, actual).matched, false, expected);
  }
  assert.equal(compareGptLiveSpeech("Find f'(x).", 'Find f prime open parenthesis x close parenthesis.').matched, true);
});

test('math fidelity hardening retains ordinary sentence punctuation and number-word compatibility', () => {
  assert.equal(compareGptLiveSpeech('Great! Explain the membrane.', 'Great. Explain the membrane!').matched, true);
  assert.equal(compareGptLiveSpeech('Use twenty-one.', 'Use 21.').matched, true);
  assert.equal(compareGptLiveSpeech('Use 3.5 liters.', 'Use three point five liters.').matched, true);
});
