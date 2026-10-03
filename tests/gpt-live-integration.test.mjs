import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { sessionFixture, question } from './helpers/session-policy.mjs';

// Exercise the production tutor orchestrator with the replacement voice
// transport. No network beyond this test's loopback browser socket is used.
async function fixture(t, options = {}) {
  const transports = [], utterances = [], meters = [];
  const harness = await sessionFixture(t, {
    ...options,
    integrations: {
      env: { LIVE_APIS: 'true', OPENAI_API_KEY: 'mock' },
      WebSocketImpl: class { constructor() { throw Error('ElevenLabs STT must not run'); } },
      createSpeechStreamImpl() { throw Error('ElevenLabs TTS must not run'); },
      usageLedger: { start(testId, request) { meters.push({ testId, ...request }); return { update() {}, finish() {} }; } },
      createVoiceTransport(config) {
        const socket = new EventEmitter();
        Object.assign(socket, {
          readyState: 1, bufferedAmount: 0, sent: [], terminated: false,
          receive(message) { this.emit('message', Buffer.from(JSON.stringify(message))); },
          send(message, callback) { this.sent.push(JSON.parse(message)); callback?.(); },
          terminate() { this.terminated = true; this.readyState = 3; this.emit('close'); },
        });
        const transport = {
          config, socket, sampleRate: 16_000,
          createListeningSocket() { queueMicrotask(() => socket.receive({ message_type: 'session_started' })); return socket; },
          createSpeechStream(callbacks) {
            const utterance = {
              callbacks, text: '', canceled: false,
              write(text) { this.text += text; },
              finish() { queueMicrotask(() => {
                if (this.canceled || options.autoEnd === false) return;
                callbacks.onUsage?.({ status: 'pending', units: { characters: this.text.length } });
                callbacks.onAudio(Buffer.alloc(32).toString('base64'));
                callbacks.onEnd();
              }); },
              cancel() { this.canceled = true; },
            };
            utterances.push(utterance); return utterance;
          },
        };
        transports.push(transport); return transport;
      },
      ...options.integrations,
    },
  });
  await harness.flush();
  return { ...harness, transports, utterances, meters,
    async commit(text) { transports.at(-1).socket.receive({ message_type: 'committed_transcript', text }); await harness.flush(); },
    async partial(text) { transports.at(-1).socket.receive({ message_type: 'partial_transcript', text }); await harness.flush(); },
  };
}

test('GPT-Live transport handles PCM16k input/output without ElevenLabs calls or billing', async t => {
  const f = await fixture(t);
  const pcm = Buffer.alloc(3_200).toString('base64');
  await f.packet({ type: 'audio', audio: pcm });
  assert.deepEqual(f.transports[0].socket.sent[0], { message_type: 'input_audio_chunk', audio_base_64: pcm, sample_rate: 16_000 });
  assert.equal(f.messages.find(message => message.type === 'audio').sampleRate, 16_000);
  assert.ok(f.messages.some(message => message.type === 'audio-end'));
  assert.equal(f.meters.filter(meter => meter.provider === 'elevenlabs').length, 0);
  assert.ok(f.messages.some(message => message.type === 'practice-state' && message.current?.questionId === question.id));
});

test('GPT-Live transcript and hint clicks use the same canonical tutor policy', async t => {
  const f = await fixture(t);
  await f.advance(10);
  assert.equal(f.messages.findLast(message => message.type === 'hint-state').remaining, 3);
  await f.packet({ type: 'hint' });
  await f.waitFor(() => f.calls.length === 2, 'authorized hint turn');
  assert.equal(f.calls[1].input.readinessContext.trigger, 'hint-button');
  await f.complete(f.calls[1], 'Compare which side has more particles.');
  assert.equal(f.messages.findLast(message => message.type === 'hint-state').remaining, 2);
  assert.equal(f.messages.findLast(message => message.type === 'practice-state').current.assisted, true);
  await f.packet({ type: 'hint' });
  assert.equal(f.calls.length, 2, 'cooldown is enforced before any second model call');
  await f.commit('Could you repeat the question?');
  await f.waitFor(() => f.calls.length === 3, 'committed transcript reaches Terra');
  assert.ok(f.calls[2].input.conversation.some(turn => turn.role === 'user' && turn.content === 'Could you repeat the question?'));
  await f.complete(f.calls[2], question.question);
});

test('GPT-Live preserves validated whiteboard packets and rejects interrupted audio', async t => {
  const board = { title: 'Concentration', blocks: [{ id: 'gradient', type: 'latex', content: 'c_1>c_2' }] };
  const f = await fixture(t, {
    greeting: { reply: question.question, questionId: question.id, board },
    integrations: { canvasRouter: { classify: async () => ({ needsCanvas: true, continuesWorkingProblem: true, candidateMatchesQuestion: true }) } },
  });
  await f.waitFor(() => f.messages.some(message => message.type === 'canvas' && message.board), 'validated board');
  const canvas = f.messages.findLast(message => message.type === 'canvas' && message.board);
  assert.equal(canvas.board.blocks[0].content, 'c_1>c_2');
  assert.equal(typeof canvas.board.revision, 'string');
  const earlier = f.utterances[0], before = f.messages.filter(message => message.type === 'audio').length;
  await f.packet({ type: 'interrupt' });
  earlier.callbacks.onAudio(Buffer.alloc(32).toString('base64'));
  await f.flush();
  assert.equal(f.messages.filter(message => message.type === 'audio').length, before, 'late old-turn audio is suppressed');
});

test('GPT-Live pause closes the paid transport, resume recreates it, stop closes it again', async t => {
  const f = await fixture(t);
  await f.packet({ type: 'pause' });
  assert.equal(f.transports[0].socket.terminated, true);
  assert.ok(f.messages.some(message => message.type === 'paused' && message.resumable));
  await f.packet({ type: 'audio', audio: Buffer.alloc(32).toString('base64') });
  assert.equal(f.transports[0].socket.sent.length, 0, 'paused microphone input is ignored');
  await f.packet({ type: 'resume' });
  await f.waitFor(() => f.messages.some(message => message.type === 'resumed'), 'resume');
  assert.equal(f.transports.length, 2);
  assert.equal(f.transports[1].socket.terminated, false);
  const ended = once(f.client, 'close');
  f.client.send(JSON.stringify({ type: 'stop', reason: 'user-stopped' }));
  await ended;
  assert.equal(f.transports[1].socket.terminated, true);
});

test('GPT-Live captions/history use the voice transcript and unverified speech cannot earn mastery', async t => {
  const logs = [], recorded = [];
  const f = await fixture(t, {
    intent: () => ({ answerAttempt: true, requestsHelp: false, examDeadline: false }),
    integrations: {
      diagnostics: { record: (_, value) => logs.push(value) },
      sessionHistory: { start: () => 'test-session', context: async () => null, transcript: (_, value) => recorded.push(value), setForegroundBusy() {} },
    },
  });
  f.utterances[0].callbacks.onTranscript({ text: 'The answer is high to low.', final: true, matched: false });
  await f.flush();
  assert.equal(f.messages.findLast(message => message.type === 'transcript').text, 'The answer is high to low.');
  assert.ok(recorded.some(turn => turn.text === question.question && turn.spoken === false));
  assert.ok(recorded.some(turn => turn.text === 'The answer is high to low.' && turn.spoken === true));
  await f.commit('They diffuse from high to low.');
  assert.ok(logs.some(event => event.type === 'grading.eligibility' && event.details.reason === 'voice-content-unverified'));
  assert.equal(logs.filter(event => event.type === 'grading.queued').length, 0);
});

test('GPT-Live grading waits for matching speech completion, not early or canceled transcript text', async t => {
  for (const stage of ['partial', 'exact-transcript', 'canceled-exact', 'no-audio', 'complete']) {
    const logs = [];
    const f = await fixture(t, {
      autoEnd: false,
      intent: () => ({ answerAttempt: true, requestsHelp: false, examDeadline: false }),
      integrations: {
        diagnostics: { record: (_, value) => logs.push(value) },
        masteryStore: { load: async () => ({ overall: 0, topics: [] }), pendingNotices: async () => [], setTopics: async () => ({ overall: 0, topics: [] }), beginCandidate: async () => false, resolveCandidate: async () => null },
      },
    });
    const callbacks = f.utterances[0].callbacks;
    const exact = stage !== 'partial';
    if (stage !== 'no-audio') callbacks.onAudio(Buffer.alloc(32).toString('base64'));
    callbacks.onTranscript({ text: exact ? question.question : 'Which way', final: exact, matched: exact ? true : null });
    if (stage === 'canceled-exact') {
      await f.packet({ type: 'interrupt' });
      callbacks.onEnd({ matched: true }); // Stale completion cannot verify a canceled question.
    }
    if (stage === 'no-audio' || stage === 'complete') callbacks.onEnd({ matched: true });
    await f.commit('High to low.');
    const eligibility = logs.find(event => event.type === 'grading.eligibility');
    assert.equal(eligibility.details.reason, stage === 'complete' ? 'queued-canonical-attempt' : 'voice-content-unverified', stage);
  }
});

test('GPT-Live diagnostics distinguish neutral acknowledgments from exact approved wording', async t => {
  const logs = [];
  const f = await fixture(t, { integrations: { diagnostics: { record: (_, value) => logs.push(value) } } });
  f.utterances[0].callbacks.onTranscript({ text: `Okay, ${question.question}`, final: true, matched: true,
    literalExact: false, normalizedExact: false, approvedBodyMatched: true, allowedPrefix: 'Okay',
    fidelityType: 'approved-body-with-neutral-ack' });
  const event = logs.find(event => event.type === 'voice.content-checked');
  assert.equal(event.details.reason, 'approved-body-with-neutral-ack');
  assert.equal(event.details.literalExact, false);
  assert.equal(event.details.normalizedExact, false);
  assert.equal(event.details.approvedBodyMatched, true);
  assert.equal(event.details.allowedPrefix, 'Okay');
  assert.equal(event.details.reply, `Okay, ${question.question}`);
});
