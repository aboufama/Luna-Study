import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSpeechStream, createSpeechTextBuffer } from '../server/speech-stream.mjs';

function fixture(t, options = {}) {
  const sockets = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    constructor(url, config) {
      super(); Object.assign(this, { url, config, readyState: 0, bufferedAmount: 0, frames: [], terminated: false });
      sockets.push(this);
    }
    send(frame, callback) { this.frames.push(JSON.parse(frame)); callback?.(); }
    open() { this.readyState = Socket.OPEN; this.emit('open'); }
    receive(message) { this.emit('message', Buffer.from(JSON.stringify(message))); }
    terminate() { this.terminated = true; this.readyState = 3; this.emit('close'); }
    close() { this.readyState = 3; this.emit('close'); }
  }
  const audio = [], errors = [];
  let ends = 0;
  const stream = createSpeechStream({ env: { ELEVENLABS_API_KEY: 'mock-key' }, voice: 'test-voice', WebSocketImpl: Socket, onAudio: value => audio.push(value), onError: value => errors.push(value), onEnd: () => ends++, ...options });
  t.after(() => stream.cancel());
  return { stream, sockets, audio, errors, get ends() { return ends; } };
}

test('speech preopens and registers one V4 voice before receiving any text', t => {
  const f = fixture(t);
  assert.equal(f.sockets.length, 1);
  const socket = f.sockets[0];
  assert.match(socket.url, /\/v1\/text-to-dialogue\/stream-input\?/);
  assert.match(socket.url, /model_id=eleven_v4_turbo/);
  assert.match(socket.url, /output_format=pcm_24000/);
  assert.deepEqual(socket.frames, []);
  socket.open();
  assert.deepEqual(socket.frames, [{ voices: ['test-voice'] }]);
  assert.equal(f.audio.length, 0);
  assert.ok(Number.isFinite(f.stream.timing.connectMs));
});

test('queued text and finish retain ordering while the socket is connecting', t => {
  const f = fixture(t), socket = f.sockets[0];
  f.stream.write('First sentence. ');
  f.stream.write('Second sentence. ');
  f.stream.finish();
  f.stream.write('Must not be spoken.');
  f.stream.finish();
  assert.deepEqual(socket.frames, []);
  socket.open();
  assert.deepEqual(socket.frames, [
    { voices: ['test-voice'] },
    { inputs: [{ text: 'First sentence. ', voice_id: 'test-voice', new_turn: false }], flush: true },
    { inputs: [{ text: 'Second sentence. ', voice_id: 'test-voice', new_turn: false }], flush: true },
    { close_socket: true },
  ]);
});

test('Flash uses its own initialization, flushing and closing protocol', t => {
  const f = fixture(t, { model: 'eleven_flash_v2_5' }), socket = f.sockets[0];
  f.stream.write('A short answer. '); f.stream.finish(); socket.open();
  assert.match(socket.url, /\/v1\/text-to-speech\/test-voice\/stream-input\?/);
  assert.equal(socket.frames[0].text, ' ');
  assert.ok(socket.frames[0].voice_settings);
  assert.deepEqual(socket.frames.slice(1), [{ text: 'A short answer. ', flush: true }, { text: '' }]);
});

test('PCM chunks are forwarded immediately and final completion fires once', t => {
  const f = fixture(t), socket = f.sockets[0];
  socket.open(); f.stream.write('A short answer. ');
  socket.receive({ audio: 'AAA=' });
  assert.deepEqual(f.audio, ['AAA=']);
  assert.equal(f.ends, 0);
  socket.receive({ is_final_audio_for_turn: true });
  assert.equal(f.ends, 0, 'A flushed clause is not the end of the reply.');
  f.stream.finish();
  socket.receive({ is_final: true });
  socket.receive({ audio: 'AAA=' }); socket.receive({ is_final: true });
  assert.equal(f.ends, 1);
  assert.equal(f.audio.length, 1);
  assert.deepEqual(f.errors, []);
  assert.ok(f.stream.timing.completeMs >= f.stream.timing.firstAudioMs);
});

test('cancellation clears queued text and ignores late open, audio and final events', async t => {
  for (const openFirst of [false, true]) {
    await t.test(openFirst ? 'after open' : 'while connecting', t => {
      const controller = new AbortController();
      const f = fixture(t, { signal: controller.signal }), socket = f.sockets[0];
      if (openFirst) socket.open();
      f.stream.write('Canceled reply. '); controller.abort();
      const sent = socket.frames.length;
      socket.open(); socket.receive({ audio: 'AAA=' }); socket.receive({ is_final: true });
      f.stream.write('Late reply. '); f.stream.finish();
      assert.equal(socket.frames.length, sent);
      assert.equal(socket.terminated, true);
      assert.deepEqual(f.audio, []); assert.deepEqual(f.errors, []); assert.equal(f.ends, 0);
    });
  }
  await t.test('already aborted does not open a socket', t => {
    const controller = new AbortController(); controller.abort();
    const f = fixture(t, { signal: controller.signal });
    assert.equal(f.sockets.length, 0); assert.deepEqual(f.errors, []);
  });
});

test('invalid audio, empty final audio and unexpected early final fail safely', async t => {
  const cases = [
    ['invalid base64', { audio: '!bad' }, true],
    ['odd PCM byte count', { audio: 'AA==' }, true],
    ['empty final', { is_final: true }, true],
    ['final before finish', { audio: 'AAA=', is_final: true }, false],
  ];
  for (const [name, message, end] of cases) {
    await t.test(name, t => {
      const f = fixture(t), socket = f.sockets[0];
      socket.open(); f.stream.write('A short answer. '); if (end) f.stream.finish();
      socket.receive(message); socket.receive({ audio: 'AAA=' });
      assert.equal(f.errors.length, 1); assert.equal(f.ends, 0); assert.equal(socket.terminated, true);
      assert.equal(f.audio.length, name === 'final before finish' ? 1 : 0);
    });
  }
  await t.test('finishing without text never synthesizes', t => {
    const f = fixture(t), socket = f.sockets[0]; f.stream.finish();
    assert.equal(f.errors.length, 1); assert.deepEqual(socket.frames, []); assert.equal(socket.terminated, true);
  });
});

test('text buffer handles split sentence boundaries and decimals without losing text', () => {
  const sent = [], buffer = createSpeechTextBuffer(text => sent.push(text));
  const deltas = ['The value is 3.', '14. ', 'She said "Ready', '?" ', 'Then ask why', '.'];
  buffer.push(deltas[0]); assert.deepEqual(sent, []);
  for (const delta of deltas.slice(1)) buffer.push(delta);
  buffer.finish(); buffer.finish();
  assert.deepEqual(sent, ['The value is 3.14. ', 'She said "Ready?" ', 'Then ask why. ']);
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  assert.equal(normalize(sent.join('')), normalize(deltas.join('')));
});

test('a single large text delta is emitted as bounded clauses without losing words', () => {
  const sent = [], buffer = createSpeechTextBuffer(text => sent.push(text));
  const text = 'Explain how energy moves between particles and why temperature changes '.repeat(9).trim();
  buffer.push(text); buffer.finish();
  assert.equal(sent.join('').trim(), text);
  assert.ok(sent.length >= 4, 'Large deltas should be divided into several spoken clauses.');
  assert.ok(sent.every(chunk => chunk.length <= 161), 'Each clause should stay within the configured boundary.');
});

test('speech requests alignment and forwards only valid per-chunk character timing without delaying PCM',t=>{
  const values=[];const f=fixture(t,{onAudio:(audio,alignment)=>values.push({audio,alignment})}),socket=f.sockets[0];
  assert.match(socket.url,/sync_alignment=true/);socket.open();f.stream.write('Hi.');
  const pcm=Buffer.alloc(48000).toString('base64');
  socket.receive({audio:pcm,alignment:{chars:['H','i','.'],char_start_times_ms:[0,100,200],char_durations_ms:[100,100,100]}});
  assert.deepEqual(values[0].alignment,{chars:['H','i','.'],startsMs:[0,100,200],durationsMs:[100,100,100]});
  socket.receive({audio:pcm,alignment:{chars:['bad'],char_start_times_ms:[9999],char_durations_ms:[10]}});
  assert.equal(values[1].alignment,null);assert.equal(values[1].audio,pcm);assert.deepEqual(f.errors,[]);
});

test('speech usage counts confirmed text and received PCM without protocol padding or repeated completion', async t => {
  for (const model of ['eleven_v4_turbo', 'eleven_flash_v2_5']) await t.test(model, t => {
    const usage = [], f = fixture(t, { model, onUsage: value => usage.push(value) }), socket = f.sockets[0];
    assert.deepEqual(usage, [{ status: 'pending', units: {} }]);
    f.stream.write('Hello. '); f.stream.write('Next.'); f.stream.finish();
    assert.equal(usage.length, 1, 'queued text has not reached the transport');
    socket.open();
    assert.deepEqual(usage.at(-1), { status: 'pending', units: { characters: 12, audioOutputMs: 0 } });
    socket.receive({ audio: Buffer.alloc(4800).toString('base64') });
    socket.receive({ audio: Buffer.alloc(2400).toString('base64'), is_final: true });
    assert.deepEqual(usage.at(-1), { status: 'completed', units: { characters: 12, audioOutputMs: 150 } });
    const count = usage.length;
    socket.receive({ audio: 'AAA=', is_final: true }); socket.emit('error', Error('late')); f.stream.cancel();
    assert.equal(usage.length, count);
    assert.equal(usage.filter(value => value.status !== 'pending').length, 1);
    assert.equal(f.ends, 1);
  });
});

test('canceling connecting speech reports an attempt without charging queued text or late packets', t => {
  const usage = [], controller = new AbortController();
  const f = fixture(t, { signal: controller.signal, onUsage: value => usage.push(value) }), socket = f.sockets[0];
  f.stream.write('Never submitted.'); controller.abort();
  socket.open(); socket.receive({ audio: 'AAA=', is_final: true }); f.stream.cancel();
  assert.deepEqual(usage, [
    { status: 'pending', units: {} },
    { status: 'canceled', units: { characters: 0, audioOutputMs: 0 } },
  ]);
});

test('speech failures retain valid observed units and exclude rejected audio and unsent text', async t => {
  await t.test('invalid PCM after valid audio', t => {
    const usage = [], f = fixture(t, { onUsage: value => usage.push(value) }), socket = f.sockets[0];
    socket.open(); f.stream.write('Sent.');
    socket.receive({ audio: Buffer.alloc(480).toString('base64') });
    socket.receive({ audio: 'AA==' });
    assert.deepEqual(usage.at(-1), { status: 'failed', units: { characters: 5, audioOutputMs: 10 } });
    assert.equal(usage.filter(value => value.status !== 'pending').length, 1);
  });
  await t.test('send callback failure', t => {
    const usage = [], f = fixture(t, { onUsage: value => usage.push(value) }), socket = f.sockets[0];
    socket.open(); socket.send = (_frame, callback) => callback(Error('write failed'));
    f.stream.write('Not confirmed.');
    assert.deepEqual(usage.at(-1), { status: 'failed', units: { characters: 0, audioOutputMs: 0 } });
  });
  await t.test('send throws', t => {
    const usage = [], f = fixture(t, { onUsage: value => usage.push(value) }), socket = f.sockets[0];
    socket.open(); socket.send = () => { throw Error('write failed'); };
    f.stream.write('Not sent.');
    assert.deepEqual(usage.at(-1), { status: 'failed', units: { characters: 0, audioOutputMs: 0 } });
    assert.equal(f.errors.length, 1);
  });
});

test('late successful send confirmations correct usage without reopening canceled speech', t => {
  const usage = [], callbacks = [], f = fixture(t, { onUsage: value => usage.push(value) }), socket = f.sockets[0];
  socket.open(); socket.send = (_frame, callback) => callbacks.push(callback);
  f.stream.write('Confirmed.'); f.stream.write('Unconfirmed.');
  callbacks[0](); f.stream.cancel(); callbacks[1](); callbacks[1](Error('late write failure'));
  assert.deepEqual(usage.at(-1), { status: 'update', units: { characters: 22, audioOutputMs: 0 } });
  assert.equal(usage.filter(value => ['completed','failed','canceled'].includes(value.status)).length, 1);
  assert.deepEqual(f.errors, []);
});

test('speech usage starts only for actual connection attempts and isolates accounting errors', async t => {
  await t.test('already canceled', t => {
    const usage = [], controller = new AbortController(); controller.abort();
    const f = fixture(t, { signal: controller.signal, onUsage: value => usage.push(value) });
    assert.deepEqual(usage, []); assert.equal(f.sockets.length, 0);
  });
  await t.test('constructor throws', t => {
    const usage = [];
    class FailedSocket { constructor() { throw Error('connect failed'); } }
    const f = fixture(t, { WebSocketImpl: FailedSocket, onUsage: value => usage.push(value) });
    assert.deepEqual(usage, [{ status: 'pending', units: {} }, { status: 'failed', units: { characters: 0, audioOutputMs: 0 } }]);
    assert.equal(f.errors.length, 1);
  });
  await t.test('accounting callback throws', t => {
    let calls = 0;
    const f = fixture(t, { onUsage() { calls++; throw Error('unavailable'); } }), socket = f.sockets[0];
    socket.open(); f.stream.write('Hi.'); f.stream.finish(); socket.receive({ audio: 'AAA=', is_final: true });
    assert.equal(calls, 4); assert.equal(f.ends, 1); assert.deepEqual(f.errors, []);
  });
});
