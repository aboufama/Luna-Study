import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { attachLiveVoice } from '../server/live-voice.mjs';
import { createMasteryStore, questionKey } from '../server/mastery.mjs';
import { createSessionUsage } from '../server/session-usage.mjs';
import { createMaterialRetrieval, MATERIAL_RETRIEVAL_TOOLS } from '../server/material-retrieval.mjs';
import { createQuestionBank } from '../server/question-bank.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const study = { title: 'Biology', date: '2026-10-14', indexStatus: 'ready', materials: [{ id: 'notes', name: 'Class notes', text: 'Diffusion moves particles from higher to lower concentration.' }] };
const immediate = () => new Promise(resolve => setImmediate(resolve));

function completeTutorConversation(input) {
  const originals = new Map();
  const earlier = (input.conversationMemory?.earlierTurns || []).map(([entry, role, value]) => {
    const content = typeof value === 'string' ? value : originals.get(value.repeat);
    assert.equal(typeof content, 'string', 'every repeat references an earlier verbatim turn');
    originals.set(entry, content);
    return { role, content };
  });
  return [...earlier, ...input.conversation];
}

// Control only the semantic prefetch completion. Real local chunking and tool
// execution keep these loopback tests faithful without a provider connection.
function controlledRetrieval({ deferred = true } = {}) {
  const harness = { created: [], pending: [], updates: [], executeCalls: [], notify() {} };
  harness.factory = config => {
    const local = createMaterialRetrieval({ ...config, env: {} });
    const instance = {
      config, closed: false,
      snapshot: () => local.snapshot(),
      update(input) { harness.updates.push(input); return local.update(input); },
      prefetch(request, options) {
        const snapshot = local.snapshot();
        const first = snapshot.catalog.sources[0];
        const result = first ? local.read({ chunkIds: [first.firstChunkId], sourceRevision: snapshot.sourceRevision }) : snapshot;
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        const pending = { request, options, result, resolve };
        harness.pending.push(pending); harness.notify();
        return deferred ? promise : Promise.resolve(result);
      },
      execute(name, args, options) { harness.executeCalls.push({ name, args, options }); return local.execute(name, args, options); },
      close() { instance.closed = true; local.close(); },
    };
    harness.created.push(instance);
    return instance;
  };
  return harness;
}

async function fixture(t, extraEnv = {}, start = study, _confirm = true, questionBank, integrations = {}, options = {}) {
  const changed = new EventEmitter(), messages = [], lunas = [], speech = [], stt = [], order = [];
  const notify = () => changed.emit('change');
  const greetingResult = options.greetingResult;
  function waitFor(predicate, description = 'expected event') {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const check = () => { if (predicate()) { clearTimeout(timer); changed.off('change', check); resolve(); } };
      const timer = setTimeout(() => { changed.off('change', check); reject(new Error(`Timed out waiting for ${description}`)); }, 1500);
      changed.on('change', check); check();
    });
  }
  class FakeStt extends EventEmitter {
    static OPEN = 1;
    constructor(url) {
      super(); this.url = url; this.readyState = 1; this.bufferedAmount = 0; this.terminated = false; this.sent = [];
      assert.match(url, /^wss:\/\/api\.elevenlabs\.io\/v1\/speech-to-text\/realtime\?/);
      stt.push(this); order.push('stt-open'); notify();
      queueMicrotask(() => this.receive({ message_type: 'session_started' }));
    }
    receive(message) { this.emit('message', Buffer.from(JSON.stringify(message))); }
    send(message, callback) { this.sent.push(JSON.parse(message)); callback?.(); notify(); }
    terminate() { this.terminated = true; this.readyState = 3; this.emit('close'); notify(); }
  }
  function createLunaFastImpl({ mode = 'voice' }) {
    const luna = {
      mode, calls: [], greetings: [], readyCalls: 0, closeCalls: 0,
      ready() { this.readyCalls++; order.push(`${mode}-ready`); notify(); return new Promise(() => {}); },
      respond(input, options) {
        if (input.readinessContext?.trigger === 'session-start') {
          this.greetings.push({ input, options });
          const result = greetingResult || { reply: `Welcome to ${input.title}.` };
          options.onText?.(result.reply); notify(); return Promise.resolve(result);
        }
        order.push(`${mode}-respond`);
        const result = new Promise((resolve, reject) => { this.calls.push({ input, options, resolve, reject }); });
        notify(); return result;
      },
      async close() { this.closeCalls++; notify(); },
    };
    lunas.push(luna); notify(); return luna;
  }
  function createSpeechStreamImpl(options) {
    const stream = { options, writes: [], finishes: 0, cancellations: 0,
      write(text) { this.writes.push(text); notify(); },
      finish() { this.finishes++; notify(); },
      cancel() { this.cancellations++; notify(); },
    };
    speech.push(stream); order.push('speech-open'); notify(); return stream;
  }
  const server = createServer((_, res) => { res.writeHead(404); res.end(); });
  // Explicit fixture decisions, not a production keyword classifier. Tests
  // needing semantic disagreement or pending decisions inject their own Jev.
  const examReplies = new Set(['in two weeks', 'in two days', 'My exam is tomorrow.', 'My exam is October 14.', 'My exam date is today.']);
  const helpReplies = new Set(['I need a hint.', 'I need another hint.', 'Can you give me a hint?', 'Can you suggest the next topic?', 'How am I doing?']);
  const intentRouter = { classify(text, context) { return { source: 'jev', examDeadline: examReplies.has(text), requestsHelp: helpReplies.has(text), answerAttempt: Boolean(context.activeQuestion) && !helpReplies.has(text) }; } };
  const tutorIntentRouter = { classify: async reply => ({ source: 'jev', acknowledgesMastery: reply === 'Transport is now mastered. We can review membranes next.' }) };
  const attached = attachLiveVoice(server, {
    cliOrganizer: { available: true, organize() { throw new Error('Unexpected exec transport'); } },
    env: { LIVE_APIS: 'true', ELEVENLABS_API_KEY: 'mock-only', ...extraEnv },
    createLunaFastImpl, createSpeechStreamImpl, WebSocketImpl: FakeStt, questionBank, intentRouter, tutorIntentRouter, ...integrations,
  });
  let client;
  t.after(async () => {
    client?.terminate(); await attached.close();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  client = new WebSocket(`${origin.replace('http:', 'ws:')}/api/live-voice`, { origin });
  client.on('message', data => { messages.push(JSON.parse(data.toString())); notify(); });
  await once(client, 'open');
  client.send(JSON.stringify({ type: 'start', ...start }));
  await waitFor(() => messages.some(message => message.type === 'ready'), 'listening readiness');
  if (!options.skipGreetingFlow) await waitFor(() => messages.some(message => message.type === 'transcript' && message.setup && message.final), 'initial spoken greeting');
  const welcome = { message: messages.find(message => message.setup && message.final), speech: speech[0], input: lunas[0]?.greetings[0]?.input };
  if (options.greetingAudio) {
    welcome.speech.options.onAudio('AAA=');
    await waitFor(() => messages.some(message => message.type === 'audio'), 'actual greeting audio');
  }
  const restoredBoard = messages.find(message => message.type === 'canvas')?.board;
  const restoredSelection = messages.find(message => message.type === 'canvas')?.selection;
  if (start.materials.length && start.indexStatus === 'ready') {
    await waitFor(() => messages.some(message => message.type === 'study-ready'), 'automatic technical readiness');
  }
  if (!options.skipGreetingFlow) {
  const previousInterrupts = messages.filter(message => message.type === 'interrupt').length;
  client.send(JSON.stringify({ type: 'interrupt' }));
  await waitFor(() => messages.filter(message => message.type === 'interrupt').length > previousInterrupts, 'greeting interruption');
  messages.length = 0; speech.length = 0;
  }
  for (let i = order.length - 1; i >= 0; i--) if (order[i] === 'speech-open') order.splice(i, 1);
  return { get client() { return client; }, messages, lunas, speech, stt, order, waitFor, welcome, restoredBoard, restoredSelection, notify,
    commit(text) { stt.at(-1).receive({ message_type: 'committed_transcript', text }); },
    partial(text) { stt.at(-1).receive({ message_type: 'partial_transcript', text }); },
    async reconnect(next = start, expectGreeting = true) {
      const closed = once(client, 'close');
      client.send(JSON.stringify({ type: 'stop' })); await closed;
      messages.length = 0; speech.length = 0;
      client = new WebSocket(`${origin.replace('http:', 'ws:')}/api/live-voice`, { origin });
      client.on('message', data => { messages.push(JSON.parse(data.toString())); notify(); });
      await once(client, 'open'); client.send(JSON.stringify({ type: 'start', ...next }));
      await waitFor(() => messages.some(message => message.type === 'ready'), 'reconnected readiness');
      if (expectGreeting) await waitFor(() => messages.some(message => message.type === 'transcript' && message.setup && message.final), 'new greeting');
      else assert.equal(messages.find(message => message.type === 'ready').greetingSuppressed, true);
    },
  };
}

test('short reconnect skips only duplicate greeting audio and keeps the complete tutor input', async t => {
  const testId = '18e2ced5-fab7-4b23-ae07-abc99c94a111';
  const directory = await mkdtemp(join(tmpdir(), 'luna-greeting-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createMasteryStore({ path: join(directory, 'mastery.json'), shared: false });
  const start = { ...study, testId, difficulty: 'final', topics: [{ title: 'Diffusion', summary: 'Concentration gradients.', sourceIds: ['notes'] }] };
  const memory = { sessionCount: 2, notes: ['Continue the concentration gradient discussion.'], recentSessions: [] };
  const sessionHistory = { start: () => 'session-id', context: async () => memory };
  const f = await fixture(t, {}, start, true, undefined, { masteryStore: store, sessionHistory }, { greetingAudio: true });
  await f.reconnect(start, false);
  assert.equal(f.speech.length, 0);
  assert.equal(f.messages.some(message => message.setup), false);
  assert.ok(f.messages.some(message => message.type === 'study-ready'));
  f.commit('Continue explaining diffusion.');
  await f.waitFor(() => f.lunas.at(-1).calls.length === 1, 'ordinary resumed Luna response');
  const input = f.lunas.at(-1).calls[0].input;
  for (const key of ['testId', 'title', 'date', 'difficulty', 'materials', 'topics', 'indexStatus']) assert.deepEqual(input[key], start[key]);
  assert.deepEqual(input.sessionMemory, memory);
  assert.equal(input.conversation.at(-1).content, 'Continue explaining diffusion.');
});

test('a greeting interrupted before audio is not cached and client skip flags do not bypass it', async t => {
  const testId = '18e2ced5-fab7-4b23-ae07-abc99c94a112';
  const directory = await mkdtemp(join(tmpdir(), 'luna-greeting-empty-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createMasteryStore({ path: join(directory, 'mastery.json'), shared: false });
  const start = { ...study, testId, skipGreeting: true, resumeSession: true };
  const f = await fixture(t, {}, start, true, undefined, { masteryStore: store });
  // A late callback from the canceled greeting cannot mark a successful greet.
  f.welcome.speech.options.onAudio('AAA=');
  await f.reconnect(start);
  assert.equal(f.messages.find(message => message.type === 'ready').greetingSuppressed, false);
  assert.equal(f.speech.length, 1);
});

test('a changed test date or changed source content retains the greeting on reconnect', async t => {
  const testId = '18e2ced5-fab7-4b23-ae07-abc99c94a113';
  const directory = await mkdtemp(join(tmpdir(), 'luna-greeting-changed-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createMasteryStore({ path: join(directory, 'mastery.json'), shared: false });
  const start = { ...study, testId };
  const f = await fixture(t, {}, start, true, undefined, { masteryStore: store }, { greetingAudio: true });
  const dated = { ...start, date: '2026-10-15' };
  await f.reconnect(dated);
  assert.equal(f.lunas.at(-1).greetings[0].input.date, '2026-10-15');
  f.speech[0].options.onAudio('AAA=');
  const sourced = { ...dated, materials: [{ ...study.materials[0], text: 'Updated class notes explain osmosis.' }] };
  await f.reconnect(sourced);
  assert.equal(f.messages.find(message => message.type === 'ready').greetingSuppressed, false);
});

test('greeting cache expires after five minutes, stays test-specific, and detects setup changes', () => {
  let now = 10_000;
  const usage = createSessionUsage({ now: () => now });
  const input = { ...study, testId: 'test-a', difficulty: 'test' };
  assert.equal(usage.needsGreeting(input), true);
  usage.markGreetingAudio(input);
  assert.equal(usage.needsGreeting(input), false);
  for (const changes of [{ testId: 'test-b' }, { title: 'Chemistry' }, { difficulty: 'final' }, { date: '2026-10-15' }, { indexStatus: 'indexing' }, { materials: [{ ...study.materials[0], text: 'Different content, same ID.' }] }]) assert.equal(usage.needsGreeting({ ...input, ...changes }), true);
  now += 299_999; assert.equal(usage.needsGreeting(input), false);
  now++; assert.equal(usage.needsGreeting(input), true);
  usage.markGreetingAudio(input); usage.clear(); assert.equal(usage.needsGreeting(input), true);
  assert.equal(usage.needsGreeting(study), true, 'anonymous tests never share greeting suppression');
});

test('audio watchdog counts silent PCM and releases a stream that stops sending packets', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = await fixture(t);
  t.mock.timers.tick(19_000);
  f.client.send(JSON.stringify({ type: 'audio', audio: 'AAA=' }));
  await f.waitFor(() => f.stt[0].sent.length === 1, 'silent audio heartbeat');
  t.mock.timers.tick(19_999);
  assert.equal(f.client.readyState, WebSocket.OPEN);
  const closed = once(f.client, 'close');
  t.mock.timers.tick(1);
  await closed;
  assert.ok(f.messages.some(message => message.type === 'paused' && message.reason === 'audio-stream-stalled'));
  assert.equal(f.stt[0].terminated, true);
  assert.equal(f.lunas[0].closeCalls, 1);
});

test('audio watchdog waits for an active tutor turn and speech before closing a stalled stream', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = await fixture(t);
  f.commit('Explain diffusion.');
  const turn = f.lunas[0].calls[0], stream = f.speech[0];
  t.mock.timers.tick(21_000);
  assert.equal(turn.options.signal.aborted, false);
  assert.equal(f.client.readyState, WebSocket.OPEN);
  turn.options.onText('Particles move down a concentration gradient. ');
  turn.resolve({ reply: 'Particles move down a concentration gradient.' });
  await f.waitFor(() => f.messages.some(message => message.role === 'assistant'), 'finished tutor text');
  stream.options.onAudio('AAA=');
  t.mock.timers.tick(2_000);
  assert.equal(f.client.readyState, WebSocket.OPEN);
  stream.options.onEnd(); await immediate();
  const closed = once(f.client, 'close');
  t.mock.timers.tick(2_000);
  await closed;
  assert.equal(f.stt[0].terminated, true);
});

test('stop reason whitelist preserves pause reasons and defaults untrusted values', async t => {
  for (const reason of ['background-idle', 'inactive', 'page-hidden', 'user-stopped', 'forged-reason', { reason: 'inactive' }, undefined]) {
    await t.test(typeof reason === 'string' ? reason : String(reason), async t => {
      const finished = [];
      const masteryStore = { load: async () => ({ overall: 0, topics: [] }), pendingNotices: async () => [], setTopics: async () => ({ overall: 0, topics: [] }) };
      const sessionHistory = { start: () => 'session-id', context: async () => null, finish: (_, details) => finished.push(details.reason) };
      const f = await fixture(t, {}, { ...study, testId: '18e2ced5-fab7-4b23-ae07-abc99c94a114' }, true, undefined, { masteryStore, sessionHistory });
      const closed = once(f.client, 'close');
      f.client.send(JSON.stringify({ type: 'stop', reason })); await closed;
      const expected = ['background-idle', 'inactive', 'page-hidden', 'user-stopped'].includes(reason) ? reason : 'user-stopped';
      assert.deepEqual(finished, [expected]);
      assert.equal(f.stt[0].terminated, true);
      assert.equal(f.lunas[0].closeCalls, 1);
    });
  }
});

test('fast Luna startup overlaps listening, with background planning disabled by default', async t => {
  const f = await fixture(t);
  assert.equal(f.lunas.length, 1);
  assert.equal(f.lunas[0].mode, 'voice');
  assert.equal(f.lunas[0].readyCalls, 1);
  assert.deepEqual(f.order, ['voice-ready', 'stt-open']);
  assert.equal(f.speech.length, 0);
  assert.equal(f.lunas[0].calls.length, 0);
  assert.equal(f.welcome.input.date, '2026-10-14');
  assert.equal(f.welcome.input.readinessContext.trigger, 'session-start');
  assert.equal(f.welcome.input.conversation.length, 0);
  assert.equal(f.welcome.speech.finishes, 1);
  assert.equal(f.welcome.speech.cancellations, 1);
  assert.match(f.stt[0].url, /vad_silence_threshold_secs=0.5/);
});

test('voice onboarding validates spoken dates but asks Luna to generate the response', async t => {
  const f = await fixture(t, {}, { title: 'Biology', date: '', difficulty: 'final', localToday: '2026-10-01', materials: [] });
  assert.deepEqual(f.welcome.input.readinessContext.missing, ['materials']);
  assert.deepEqual(f.welcome.input.readinessContext.optionalPlanningMissing, ['examDate']);
  assert.deepEqual(f.welcome.input.calendarContext, { today: '2026-10-01', sessionDate: '2026-10-01', examDate: null });
  f.commit('in two weeks');
  await f.waitFor(() => f.messages.some(message => message.type === 'setup-date'), 'spoken test date');
  assert.equal(f.messages.find(message => message.type === 'setup-date').date, '2026-10-15');
  assert.equal(f.lunas[0].calls.length, 1);
  const call = f.lunas[0].calls[0];
  assert.equal(call.input.date, '2026-10-15');
  assert.equal(call.input.readinessContext.dateInterpretation.date, '2026-10-15');
  assert.equal(call.input.calendarContext.examDate, '2026-10-15');
  assert.deepEqual(call.input.readinessContext.optionalPlanningMissing, []);
  assert.deepEqual(call.input.readinessContext.missing, ['materials']);
  assert.equal(f.speech[0].writes.length, 0, 'metadata never becomes fixed speech');
  call.options.onText('That gives us two weeks. What material would you like to use?');
  call.resolve({ reply: 'That gives us two weeks. What material would you like to use?' });
  await f.waitFor(() => f.messages.some(message => message.text?.startsWith('That gives us')), 'model-authored setup reply');
  assert.equal(f.speech[0].writes.join('').trim(), 'That gives us two weeks. What material would you like to use?');
});

test('Jev-approved academic answers containing help or explain retain first unassisted credit', async t => {
  for (const answer of ['Membrane proteins help transport substances.', 'This theory can explain the concentration gradient.']) {
    await t.test(answer, async t => {
      const directory = await mkdtemp(join(tmpdir(), 'luna-intent-grade-')); t.after(() => rm(directory, { recursive: true, force: true }));
      const store = createMasteryStore({ path: join(directory, 'mastery.json'), shared: false });
      const testId = '18e2ced5-fab7-4b23-ae07-abc99c94a119';
      const question = { id: 'intent-q', topicId: 'transport', topicTitle: 'Transport', difficulty: 'hard', question: 'Describe the process?', sourceIds: ['notes'], answer: 'Private reference.' };
      let consumed = false;
      const bank = { topics: () => [{ id: 'transport', title: 'Transport' }], context: () => null, consume(_, reply) { if (!consumed && reply === question.question) { consumed = true; return [question]; } return []; } };
      const seen = [];
      const intentRouter = { classify(text, context) { seen.push({ text, context }); return { source: 'jev', requestsHelp: false, answerAttempt: text === answer, examDeadline: false }; } };
      const f = await fixture(t, {}, { ...study, testId }, true, bank, { masteryStore: store, intentRouter, gradeAnswerImpl: async () => ({ checked: true, verdict: 'correct', unassisted: true }) });
      f.commit('Ask me a question.'); f.lunas[0].calls[0].resolve({ reply: question.question });
      await f.waitFor(() => f.messages.some(message => message.final && message.text === question.question));
      f.commit(answer); f.lunas[0].calls[1].resolve({ reply: 'That is correct.' });
      await f.waitFor(() => f.messages.some(message => message.type === 'mastery' && message.mastery.overall === 30));
      assert.equal(seen.at(-1).context.activeQuestion, question.question);
      assert.equal(JSON.stringify(seen).includes('Private reference.'), false);
      const reservation = await store.reserveAttempt(testId, { questionId: question.id, questionKey: questionKey(question), attempt: 1 });
      assert.equal(reservation.firstAttempt, true);
    });
  }
});

test('only Jev deadline intent can save a date; academic dates and unknown intent stay conversation', async t => {
  const intentRouter = { classify(text) { return text === 'My exam is October 31.' ? { source: 'jev', examDeadline: true, answerAttempt: false, requestsHelp: false } : { source: 'jev', examDeadline: false, answerAttempt: false, requestsHelp: false }; } };
  const f = await fixture(t, {}, { ...study, localToday: '2026-10-02' }, true, undefined, { intentRouter });
  f.commit('Ask me about Halloween.'); f.lunas[0].calls[0].resolve({ reply: 'What date is Halloween?' });
  await f.waitFor(() => f.messages.some(message => message.final && message.text === 'What date is Halloween?'));
  f.commit('October 31');
  assert.equal(f.lunas[0].calls[1].input.date, study.date);
  assert.equal(f.messages.some(message => message.type === 'setup-date'), false);
  f.commit('My exam is October 31.');
  assert.equal(f.lunas[0].calls[2].input.date, '2026-10-31');
  assert.equal(f.lunas[0].calls[2].input.readinessContext.dateInterpretation.date, '2026-10-31');
});

test('late Jev decisions cannot mutate a newer turn and committed speech remains in context', async t => {
  const pending = [];
  const intentRouter = { classify(text, context, options) { return new Promise(resolve => pending.push({ text, context, options, resolve })); } };
  const f = await fixture(t, {}, { ...study, localToday: '2026-10-02' }, true, undefined, { intentRouter });
  f.commit('My exam is October 31.');
  f.commit('Actually, keep studying.');
  assert.equal(pending[0].options.signal.aborted, true);
  pending[0].resolve({ source: 'jev', examDeadline: true }); await immediate();
  assert.equal(f.messages.some(message => message.type === 'setup-date'), false);
  pending[1].resolve({ source: 'jev', examDeadline: false, answerAttempt: false, requestsHelp: false });
  await f.waitFor(() => f.lunas[0].calls.length === 1);
  assert.equal(f.lunas[0].calls[0].input.date, study.date);
  assert.deepEqual(f.lunas[0].calls[0].input.conversation.filter(turn => turn.role === 'user').map(turn => turn.content), ['My exam is October 31.', 'Actually, keep studying.']);
});

test('unavailable Jev never uses date or help keywords as fallback intent', async t => {
  const intentRouter = { classify: async () => ({ source: 'unavailable', examDeadline: null, requestsHelp: null, answerAttempt: null }) };
  const f = await fixture(t, {}, { ...study, localToday: '2026-10-02' }, true, undefined, { intentRouter });
  f.commit('My exam is tomorrow. Help me.');
  await f.waitFor(() => f.lunas[0].calls.length === 1);
  assert.equal(f.lunas[0].calls[0].input.date, study.date);
  assert.equal(f.messages.some(message => message.type === 'setup-date'), false);
  assert.equal(f.lunas[0].calls[0].input.readinessContext.studentIntent.source, 'unavailable');
});

test('persisted indexed material starts normal Luna conversation without a consent gate', async t => {
  const f = await fixture(t, {}, study, false);
  assert.equal(f.welcome.input.readinessContext.ready, true);
  for (const text of ['Hmm', 'No', 'Quiz me']) f.commit(text);
  assert.equal(f.lunas[0].calls.length, 3);
  assert.deepEqual(f.lunas[0].calls.map(call => call.input.conversation.at(-1).content), ['Hmm', 'No', 'Quiz me']);
  assert.equal(f.messages.some(message => message.setup), false);
});

test('index state updates are silent, reject stale completions, and retain the actual conversation', async t => {
  const f = await fixture(t, {}, { ...study, indexStatus: 'indexing' }, false);
  f.commit('Yes');
  assert.equal(f.lunas[0].calls.length, 1);
  assert.equal(f.lunas[0].calls[0].input.readinessContext.ready, false);
  assert.equal(f.speech.at(-1).writes.length, 0);
  f.client.send(JSON.stringify({ type: 'index-status', status: 'ready', revision: 'old-source' }));
  await immediate();
  f.commit('Explain diffusion.');
  assert.equal(f.lunas[0].calls[1].input.indexStatus, 'indexing');
  f.client.send(JSON.stringify({ type: 'index-status', status: 'error', revision: 'notes' }));
  await f.waitFor(() => f.messages.some(message => message.type === 'index-status-updated' && message.status === 'error'), 'failed indexing');
  f.client.send(JSON.stringify({ type: 'index-status', status: 'ready', revision: 'notes' }));
  await f.waitFor(() => f.messages.some(message => message.type === 'index-status-updated' && message.status === 'ready'), 'correct source indexed');
  assert.equal(f.lunas[0].calls.length, 2, 'technical updates do not generate another spoken prompt');
  assert.equal(f.speech.flatMap(stream => stream.writes).length, 0);
  f.commit('Can we continue now?');
  const call=f.lunas[0].calls[2];
  assert.equal(call.input.readinessContext.ready, true);
  assert.deepEqual(call.input.conversation.filter(turn=>turn.role==='user').map(turn=>turn.content), ['Yes','Explain diffusion.','Can we continue now?']);
});

test('missing date and uncertainty are conversation data rather than a repeated audio gate', async t => {
  const f = await fixture(t, {}, { ...study, date: '', localToday: '2026-10-01' }, false);
  f.commit('I do not know the date yet.');
  const uncertain=f.lunas[0].calls[0];
  assert.equal(uncertain.input.readinessContext.ready, true);
  assert.deepEqual(uncertain.input.readinessContext.missing, []);
  uncertain.options.onText('Let’s work on diffusion.');
  uncertain.resolve({ reply:'Let’s work on diffusion.' });
  await f.waitFor(()=>f.messages.some(message=>message.text==='Let’s work on diffusion.'),'adaptive model reply');
  f.commit('in two days');
  await f.waitFor(() => f.messages.some(message => message.type === 'setup-date'), 'optional exam deadline');
  const dated=f.lunas[0].calls[1];
  assert.equal(dated.input.readinessContext.ready, true);
  assert.ok(dated.input.conversation.some(turn=>turn.content==='I do not know the date yet.'));
  assert.ok(dated.input.conversation.some(turn=>turn.content==='Let’s work on diffusion.'));
  assert.equal(f.lunas[0].readyCalls,1,'one warm CLI per session');
});

test('the logged current-day exchange cannot become an exam deadline or a study gate', async t => {
  const f = await fixture(t, {}, { ...study, date: '', localToday: '2026-10-02' });
  const exchange = [
    ['What day is it?', 'Today is October 2.'],
    ["Um, October 2nd, today’s date.", 'The session date is automatic. We can work on diffusion.'],
    ['Yep.', 'Which way do particles move?'],
  ];
  for (const [text, reply] of exchange) {
    f.commit(text);
    const call = f.lunas[0].calls.at(-1);
    assert.deepEqual(call.input.calendarContext, { today: '2026-10-02', sessionDate: '2026-10-02', examDate: null });
    assert.equal(call.input.date, '');
    assert.equal(call.input.readinessContext.ready, true);
    assert.deepEqual(call.input.readinessContext.missing, []);
    assert.equal(call.input.readinessContext.dateInterpretation.date, null);
    call.options.onText(reply); call.resolve({ reply });
    await f.waitFor(() => f.messages.some(message => message.final && message.text === reply), 'model-authored response');
  }
  assert.equal(f.messages.some(message => message.type === 'setup-date'), false);
  assert.deepEqual(f.lunas[0].calls.at(-1).input.conversation.filter(turn => turn.role === 'user').map(turn => turn.content), exchange.map(([text]) => text));

  f.commit('My exam is tomorrow.');
  await f.waitFor(() => f.messages.some(message => message.type === 'setup-date'), 'immediate exam-date save');
  const dated = f.lunas[0].calls.at(-1);
  assert.deepEqual(dated.input.calendarContext, { today: '2026-10-02', sessionDate: '2026-10-02', examDate: '2026-10-03' });
  assert.equal(dated.input.readinessContext.dateInterpretation.date, '2026-10-03');
  assert.deepEqual(dated.input.readinessContext.optionalPlanningMissing, []);
  assert.equal(f.speech.at(-1).writes.length, 0, 'saving a date never creates deterministic speech');
  f.commit('Yep.');
  f.commit("October 2nd, today's date.");
  const unchanged = f.lunas[0].calls.at(-1);
  assert.equal(unchanged.input.date, '2026-10-03');
  assert.equal(unchanged.input.readinessContext.ready, true);
  await immediate();
  assert.equal(f.messages.filter(message => message.type === 'setup-date').length, 1, 'a generic yes or current-day reply never saves an exam date');
});

test('repeating a saved deadline needs no new save or setup reset', async t => {
  const f = await fixture(t, {}, { ...study, localToday: '2026-10-02' });
  f.commit('My exam is October 14.');
  const call = f.lunas[0].calls.at(-1);
  assert.equal(call.input.calendarContext.examDate, study.date);
  assert.equal(call.input.readinessContext.dateInterpretation.date, study.date);
  assert.equal(call.input.readinessContext.ready, true);
  assert.deepEqual(call.input.readinessContext.changes, []);
  assert.deepEqual(call.input.readinessContext.optionalPlanningMissing, []);
  await immediate();
  assert.equal(f.messages.some(message => message.type === 'setup-date'), false);
});

test('a bare calendar reply follows the last spoken assistant, not whiteboard metadata, and cannot reset an exam date', async t => {
  const f = await fixture(t, {}, { ...study, localToday: '2026-10-02' });
  f.commit('What date is this session?');
  const call = f.lunas[0].calls[0];
  call.resolve({ reply: 'The session date is today, October 2.', board: { title: 'Diffusion', blocks: [{ type: 'latex', content: 'c_1>c_2' }] } });
  await f.waitFor(() => f.messages.some(message => message.type === 'canvas'), 'public board metadata after spoken reply');
  f.commit('Today.');
  const calendar = f.lunas[0].calls[1];
  assert.equal(calendar.input.date, study.date);
  assert.equal(calendar.input.readinessContext.dateInterpretation.date, null);
  await immediate();
  assert.equal(f.messages.some(message => message.type === 'setup-date'), false);
  f.commit('My exam date is today.');
  assert.equal(f.lunas[0].calls[2].input.date, '2026-10-02', 'explicit exam intent overrides the calendar context');
});

test('pending metadata updates are immutable turn snapshots, retained on cancellation and consumed on success', async t => {
  const f = await fixture(t);
  async function setup(fields) {
    f.client.send(JSON.stringify({ type: 'setup', ...fields }));
    const pong = once(f.client, 'pong'); f.client.ping(); await pong;
  }
  await setup({ difficulty: 'final' });
  f.commit('Continue.');
  const canceled = f.lunas[0].calls[0];
  assert.equal(canceled.input.readinessContext.changes.length, 1);
  await setup({ title: 'Transport' });
  assert.equal(canceled.options.signal.aborted, true);
  assert.equal(canceled.input.readinessContext.changes.length, 1, 'later updates cannot mutate the old input');
  canceled.resolve({ reply: 'Canceled reply.' });
  f.commit('Explain diffusion.');
  const successful = f.lunas[0].calls[1];
  assert.equal(successful.input.readinessContext.changes.length, 2, 'canceled changes survive together with new changes');
  successful.resolve({ reply: 'Particles move down the concentration gradient.' });
  await f.waitFor(() => f.messages.some(message => message.final && message.text === 'Particles move down the concentration gradient.'));
  f.commit('What happens next?');
  assert.deepEqual(f.lunas[0].calls[2].input.readinessContext.changes, []);
  assert.equal(successful.input.readinessContext.changes.length, 2, 'consumption does not rewrite prior input snapshots');
});

test('a source-ready welcome without an exam date can lead study and show a substantive board', async t => {
  const consulted = [], board = { title: 'Diffusion', blocks: [{ id: 'gradient', type: 'latex', content: 'c_1>c_2' }] };
  const bank = { context: () => consulted.push('context'), topics: () => [], consume: () => [] };
  const f = await fixture(t, {}, { ...study, date: '' }, true, bank, { canvasRouter: { classify: async () => ({ needsCanvas: false }) } }, { skipGreetingFlow: true, greetingResult: { reply: 'Welcome back. Compare these concentrations.', board } });
  await f.waitFor(() => f.messages.some(message => message.type === 'canvas' && message.visible));
  assert.equal(f.lunas[0].greetings[0].input.readinessContext.ready, true);
  assert.equal(f.messages.find(message => message.type === 'canvas').board.blocks[0].content, 'c_1>c_2');
  assert.deepEqual(consulted, ['context'], 'source-ready welcome may select a canonical practice question');
});

test('a source-ready welcome reopens a matching hidden scene, but an unready welcome cannot show a generated board', async t => {
  const scene = { title: 'Diffusion', revision: 'saved', blocks: [{ id: 'gradient', type: 'latex', content: 'c_1>c_2' }] };
  const canvasRouter = { classify: async () => ({ needsCanvas: true, shouldReopen: true }) };
  const f = await fixture(t, {}, { ...study, date: '', whiteboard: scene, whiteboardVisible: false }, true, undefined, { canvasRouter }, { skipGreetingFlow: true, greetingResult: { reply: 'Welcome back. Let us look at those concentrations again.' } });
  await f.waitFor(() => f.messages.some(message => message.type === 'canvas' && message.visible));
  const packets = f.messages.filter(message => message.type === 'canvas');
  assert.equal(packets.at(-1).board.revision, packets[0].board.revision);
  const unready = await fixture(t, {}, { ...study, date: '', indexStatus: 'indexing' }, true, undefined, { canvasRouter }, { skipGreetingFlow: true, greetingResult: { reply: 'Welcome back.', board: { title: scene.title, blocks: scene.blocks } } });
  await unready.waitFor(() => unready.messages.some(message => message.final));
  await immediate();
  assert.equal(unready.messages.some(message => message.type === 'canvas' && message.visible), false);
});

test('private questions are consulted only for actual Luna turns, consumed only for current replies, and never exposed as a bank', async t => {
  const contextCalls = [], consumed = [], discarded = [];
  const privateBank = { topics: [{ title: 'Diffusion', questions: [{ difficulty: 'easy', question: 'Which direction do particles move?', answer: 'PRIVATE QUEUE ANSWER', sourceIds: ['notes'] }] }] };
  const bank = {
    context(input) { contextCalls.push(input); return privateBank; },
    consume(input, reply) { consumed.push({ input, reply }); },
    discard(input) { discarded.push(input); },
  };
  const f = await fixture(t, {}, study, false, bank);
  assert.equal(contextCalls.length, 1, 'ready welcome receives practice preparation');
  f.commit('Ask me a question.');
  const current = f.lunas[0].calls[0];
  const publicQueue = structuredClone(privateBank); delete publicQueue.topics[0].questions[0].answer;
  assert.deepEqual(current.input.privateQuestionBank, publicQueue);
  assert.equal(contextCalls.length, 2);
  assert.equal(contextCalls[1].conversation.at(-1).content, 'Ask me a question.');
  assert.equal(privateBank.topics[0].questions[0].answer, 'PRIVATE QUEUE ANSWER', 'masking never mutates preparation');
  current.options.onText('Which direction do particles move? ');
  current.resolve({ reply: 'Which direction do particles move?' });
  await f.waitFor(() => consumed.length === 1, 'queued question consumed');
  assert.equal(consumed[0].reply, 'Which direction do particles move?');
  assert.equal(JSON.stringify(f.messages).includes('PRIVATE QUEUE ANSWER'), false);
  assert.equal(f.messages.some(message => Object.hasOwn(message, 'privateQuestionBank')), false);
  f.commit('Another question.');
  const stale = f.lunas[0].calls[1];
  f.client.send(JSON.stringify({ type: 'materials', materials: [], indexStatus: 'empty' }));
  await f.waitFor(() => discarded.length === 1, 'old private bank discarded');
  assert.deepEqual(discarded[0].materials, study.materials);
  stale.resolve({ reply: 'Stale private question.' });
  await immediate();
  assert.equal(consumed.length, 1);
  assert.equal(f.messages.some(message => message.text === 'Stale private question.'), false);
});

test('checked mastery runs after speech generation, publishes only scores, and announces once after completed audio', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'luna-live-mastery-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createMasteryStore({ path: join(directory, 'mastery.json'), shared: false });
  const testId = '18e2ced5-fab7-4b23-ae07-abc99c94a110';
  await store.setTopics(testId, [{ id: 'transport', title: 'Transport' }]);
  for (const n of [1,2]) await store.record(testId, { id: `seed-${n}`, questionId: `seed-q-${n}`, questionKey: questionKey({ topicId: 'transport', question: `Prior hard scenario ${n}?` }), attempt: 1, topicId: 'transport', topicTitle: 'Transport', difficulty: 'hard', verdict: 'correct', firstAttempt: true, unassisted: true, checked: true });
  const question = { id: 'hard-three', topicId: 'transport', topicTitle: 'Transport', difficulty: 'hard', question: 'Why do particles diffuse down a concentration gradient?', answer: 'TOP_SECRET_REFERENCE', sourceIds: ['notes'] };
  let consumed = false, finishGrade, notify = () => {}, gradeInput;
  const bank = { topics: () => [{ id: 'transport', title: 'Transport' }], context: () => ({ topics: [{ title: 'Transport', questions: [question] }] }), consume(_, reply) { if (!consumed && reply.includes(question.question)) { consumed = true; return [question]; } return []; } };
  const gradeAnswerImpl = (input) => { gradeInput = input; notify(); return new Promise(resolve => { finishGrade = resolve; }); };
  const trace=[];
  const sessionHistory={start:()=> 'trace-session',context:async()=>null,transcript:(_,entry)=>trace.push({kind:'transcript',...entry}),problem:(_,entry)=>trace.push({kind:'problem',...entry})};
  const f = await fixture(t, {}, { ...study, testId }, true, bank, { masteryStore: store, gradeAnswerImpl, sessionHistory }); notify = f.notify;
  f.commit('Quiz me.');
  const ask = f.lunas[0].calls[0]; ask.options.onText(question.question); ask.resolve({ reply: question.question });
  await f.waitFor(() => f.messages.some(message => message.text === question.question), 'actual queued question');
  f.commit('Particles move from a higher concentration to a lower concentration, down the gradient.');
  const answer = f.lunas[0].calls[1]; answer.options.onText('That identifies the direction correctly. '); answer.resolve({ reply: 'That identifies the direction correctly.' });
  await f.waitFor(() => Boolean(finishGrade), 'nonblocking checked grading');
  assert.ok(f.messages.some(message => message.text === 'That identifies the direction correctly.'));
  assert.equal((await store.load(testId)).overall, 60);
  assert.equal(gradeInput.question.id, question.id);
  finishGrade({ verdict: 'correct', unassisted: true, checked: true });
  await f.waitFor(() => f.messages.some(message => message.type === 'mastery' && message.mastery.overall === 100) && f.messages.some(message=>message.type==='topic-mastered'), 'mastery update and achievement notification');
  assert.equal(f.messages.filter(message => message.type === 'topic-mastered').length, 1);
  const answerTrace=trace.find(item=>item.kind==='transcript'&&item.role==='user'&&item.text.startsWith('Particles move'));
  const checkedTrace=trace.find(item=>item.kind==='problem'&&item.type==='result');
  assert.equal(answerTrace.spoken,true);assert.equal(checkedTrace.checked,true);
  assert.equal(checkedTrace.turnId,answerTrace.turnId,'async checked result links to original student speech, not later assistant turn');
  assert.equal(trace.find(item=>item.kind==='problem'&&item.type==='attempt').turnId,answerTrace.turnId);

  f.commit('Can you suggest the next topic?');
  const next = f.lunas[0].calls[2];
  assert.equal(next.input.masteryNotice, 'You have mastered Transport.');
  next.options.onText('We can review membranes next. '); next.resolve({ reply: 'We can review membranes next.' });
  await f.waitFor(()=>f.messages.some(message=>message.text==='We can review membranes next.'),'reply without synthetic suffix');
  assert.equal(f.speech.at(-1).writes.join('').trim(),'We can review membranes next.');
  f.speech.at(-1).options.onEnd();
  assert.equal((await store.pendingNotices(testId)).length,1,'unspoken achievement remains pending');
  for(const reply of ['You have not mastered Transport yet.', 'Maybe you have mastered Transport.', 'Have you mastered Transport?', 'Transport is next. Diffusion is mastered.']){
    f.commit('How am I doing?');const uncertain=f.lunas[0].calls.at(-1);
    assert.equal(uncertain.input.masteryNotice,'You have mastered Transport.');
    uncertain.options.onText(reply);uncertain.resolve({reply});
    await f.waitFor(()=>f.messages.some(message=>message.text===reply&&message.final),'uncertain mastery acknowledgment');
    f.speech.at(-1).options.onEnd();
    assert.equal((await store.pendingNotices(testId)).length,1,'negative, uncertain or unrelated mastery wording preserves notice');
  }
  f.commit('How am I doing?');
  const announcement=f.lunas[0].calls.at(-1);
  announcement.options.onText('Transport is now mastered. We can review membranes next. '); announcement.resolve({ reply: 'Transport is now mastered. We can review membranes next.' });
  await f.waitFor(() => f.messages.some(message => message.text === 'Transport is now mastered. We can review membranes next.'), 'model-authored mastery announcement');
  assert.equal(f.speech.at(-1).writes.join('').trim(), 'Transport is now mastered. We can review membranes next.');
  assert.equal((await store.pendingNotices(testId)).length, 1);
  f.speech.at(-1).options.onEnd();
  assert.equal((await store.pendingNotices(testId)).length, 0);
  assert.equal(JSON.stringify(f.messages).includes('TOP_SECRET_REFERENCE'), false);
  const publicScore = f.messages.find(message => message.type === 'mastery' && message.mastery.overall === 100).mastery;
  assert.deepEqual(Object.keys(publicScore).sort(), ['overall','topics']);
  assert.deepEqual(Object.keys(publicScore.topics[0]).sort(), ['id','mastered','score','title']);
});

test('Jev sees only proposed visible content, never blocks speech, rejects stale boards, and never clears drawings', async t => {
  const decisions = [];
  const canvasRouter = { classify(text, context) { if (context.phase === 'setup' || text === 'Welcome to Biology.') return Promise.resolve({ needsCanvas: false, source: 'jev' }); return new Promise(resolve => decisions.push({ text, context, resolve })); } };
  const f = await fixture(t, {}, study, true, undefined, { canvasRouter });
  const board = (title) => ({ title, blocks: [{ type: 'text', content: 'Which direction do particles move?' }, { type: 'diagram', elements: [{ type: 'text', x: 10, y: 10, text: 'Higher concentration' }, { type: 'arrow', x1: 20, y1: 50, x2: 80, y2: 50 }] }] });
  f.commit('Show diffusion.');
  f.lunas[0].calls[0].options.onText('Consider this. '); f.lunas[0].calls[0].resolve({ reply: 'Consider this.', board: board('Old board') });
  await f.waitFor(() => f.messages.some(message => message.text === 'Consider this.'), 'reply without waiting for Jev');
  assert.equal(f.speech[0].finishes, 1);
  assert.match(decisions[0].text, /Higher concentration/);
  assert.equal(decisions[0].context.phase, 'study');
  assert.equal(f.messages.some(message => message.type === 'canvas'), false);
  f.commit('Show the current version.');
  f.lunas[0].calls[1].options.onText('Look at this version. '); f.lunas[0].calls[1].resolve({ reply: 'Look at this version.', board: board('Current board') });
  await f.waitFor(() => f.messages.some(message => message.text === 'Look at this version.'), 'new reply');
  decisions[0].resolve({ needsCanvas: true, source: 'jev' }); decisions[1].resolve({ needsCanvas: true, source: 'jev' });
  await f.waitFor(() => f.messages.some(message => message.type === 'canvas'), 'current board');
  assert.deepEqual(f.messages.filter(message => message.type === 'canvas').map(message => message.board.title), ['Current board']);
  f.commit('Thanks.'); f.lunas[0].calls[2].options.onText('You are welcome. '); f.lunas[0].calls[2].resolve({ reply: 'You are welcome.' });
  await f.waitFor(() => f.messages.some(message => message.text === 'You are welcome.'), 'conversational reply');
  decisions[2].resolve({ needsCanvas: true, source: 'jev' }); await immediate();
  assert.equal(f.messages.some(message => message.type === 'canvas' && message.visible === false), false);
  assert.equal(f.messages.filter(message => message.type === 'canvas').length, 1, 'spoken hints never replace the current board');
});

test('a concrete generated visual opens without an exam date even when Jev declines its brief spoken cue',async t=>{
  const canvasRouter={classify:async()=>({needsCanvas:false,source:'jev',probability:.1})};
  const f=await fixture(t,{},{...study,date:''},true,undefined,{canvasRouter});
  f.commit('Give me a comparison.');
  f.lunas[0].calls[0].resolve({reply:'Compare these cells.',board:{title:'Payoffs',blocks:[{id:'payoffs',type:'matrix',rows:[['3,2','0,1'],['1,0','2,3']]}]}});
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.visible),'automatic structured visual');
  assert.equal(f.messages.find(m=>m.type==='canvas').board.blocks[0].type,'matrix');
  f.commit('Thanks.');
  f.lunas[0].calls[1].resolve({reply:'You are welcome.',board:{title:'Greeting',mode:'replace',blocks:[{type:'text',content:'You are welcome.'}]}});
  await f.waitFor(()=>f.messages.some(m=>m.type==='transcript'&&m.text==='You are welcome.'&&m.final));
  await immediate();
  assert.equal(f.messages.filter(m=>m.type==='canvas').length,1,'generic transcript text is still declined');
});

test('matching hidden scene reopens without generating or replacing its matrix',async t=>{
  const events=[];
  const scene={title:'Coordination game',revision:'old',blocks:[{id:'game',type:'matrix',rows:[['3,2','0,1'],['1,0','2,3']]}]};
  const canvasRouter={classify:async(text,context)=>({needsCanvas:false,shouldReopen:context.phase==='study'&&text!=='Welcome to Biology.',source:'jev'})};
  const f=await fixture(t,{}, {...study,whiteboard:scene,whiteboardVisible:false},true,undefined,{canvasRouter,diagnostics:{record:(_,event)=>events.push(event)}});
  f.commit('Where were we?');
  f.lunas[0].calls[0].resolve({reply:'Which two cells are Nash equilibria?'});
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.visible),'reopened saved matrix');
  const canvas=f.messages.find(m=>m.type==='canvas');
  assert.equal(canvas.board.revision,f.restoredBoard.revision);
  assert.deepEqual(canvas.board.blocks,f.restoredBoard.blocks);
  assert.ok(events.some(e=>e.type==='whiteboard.reopened'));
});

test('restoring saved teaching text preserves its matrix and selection',async t=>{
  const matrix={id:'game',type:'matrix',rows:[['3,2','0,1'],['1,0','2,3']],rowLabels:['Up','Down'],columnLabels:['Left','Right']};
  const scene={title:'Saved game',revision:'saved-game',blocks:[{id:'definition',type:'text',content:'A payoff lists the outcome for each player.'},matrix]};
  const selection={boardRevision:scene.revision,blockId:'game',cell:{row:0,col:0}};
  const f=await fixture(t,{}, {...study,whiteboard:scene,whiteboardVisible:true,whiteboardSelection:selection});
  assert.deepEqual(f.restoredBoard.blocks,scene.blocks);
  assert.notEqual(f.restoredBoard.revision,scene.revision);
  assert.deepEqual(f.restoredSelection,{...selection,boardRevision:f.restoredBoard.revision});
  assert.deepEqual(f.welcome.input.whiteboardContext.board.blocks,scene.blocks);
  assert.equal(f.welcome.input.whiteboardContext.selection.content,'3,2');
});

test('an exact duplicate of the spoken question stays hidden even when Jev requests it',async t=>{
  const decisions=[];
  const canvasRouter={classify:async(text,context)=>{decisions.push({text,context});return{needsCanvas:true,source:'jev'};}};
  const f=await fixture(t,{},study,true,undefined,{canvasRouter});
  const question='Which direction does diffusion follow?';
  f.commit('Ask me a question.');
  f.lunas[0].calls[0].options.onText(question);
  f.lunas[0].calls[0].resolve({reply:question,board:{title:'Question',blocks:[{type:'text',content:question}]}});
  await f.waitFor(()=>f.messages.some(message=>message.type==='transcript'&&message.final&&message.text===question),'spoken question');
  await immediate();
  assert.ok(decisions.some(({context})=>context.phase==='study'));
  assert.equal(f.messages.some(message=>message.type==='canvas'),false);
  assert.equal(f.speech[0].writes.join('').trim(),question);
});

test('live tutor records actual turn tokens against its test without guessing dollars',async t=>{
  const started=[];
  const ledger={start(testId,metadata){const event={testId,...metadata,updates:[]};started.push(event);return{update:value=>event.updates.push(value),finish:value=>{event.final=value;}};}};
  const testId='18e2ced5-fab7-4b23-ae07-abc99c94a112';
  const f=await fixture(t,{}, {...study,testId},true,undefined,{usageLedger:ledger});
  f.commit('Explain diffusion.');
  const turn=f.lunas[0].calls[0];
  turn.options.onUsage({units:{inputTokens:120,outputTokens:15,reasoningTokens:3}});
  turn.resolve({reply:'Particles spread down a concentration gradient.'});
  await f.waitFor(()=>f.messages.some(m=>m.type==='transcript'&&m.final));
  const event=started.find(e=>e.operation==='tutor');
  assert.equal(event.testId,testId);
  assert.deepEqual(event.updates,[{units:{inputTokens:120,outputTokens:15,reasoningTokens:3}}]);
  assert.equal(event.final.status,'completed');
  assert.equal(event.final.providerReportedUsd,undefined);
});

test('late TTS and STT send acknowledgments update accounting without restarting a closed session', async t => {
  const events = [];
  const ledger = { start(testId, metadata) { const event = { testId, ...metadata, updates: [], finals: [] }; events.push(event); return { update: value => event.updates.push(value), finish: value => event.finals.push(value) }; } };
  const f = await fixture(t, {}, { ...study, testId: '18e2ced5-fab7-4b23-ae07-abc99c94a112' }, true, undefined, { usageLedger: ledger });
  f.commit('Explain diffusion.');
  const speech = f.speech.at(-1), callbacks = [];
  speech.options.onUsage({ status: 'pending', units: {} });
  speech.options.onUsage({ status: 'canceled', units: { characters: 0, audioOutputMs: 0 } });
  const stt = f.stt.at(-1);
  stt.send = (_message, callback) => callbacks.push(callback);
  f.client.send(JSON.stringify({ type: 'audio', audio: Buffer.alloc(3200).toString('base64') }));
  const pong = once(f.client, 'pong'); f.client.ping(); await pong;
  assert.equal(callbacks.length, 1);
  const closed = once(f.client, 'close'); f.client.send(JSON.stringify({ type: 'stop' })); await closed;
  const messages = f.messages.length;
  callbacks[0](); callbacks[0]();
  speech.options.onUsage({ status: 'update', units: { characters: 13, audioOutputMs: 0 } });
  const input = events.find(event => event.operation === 'speech-recognition');
  const output = events.find(event => event.operation === 'speech-generation');
  assert.equal(input.updates.at(-1).units.audioInputMs, 100);
  assert.equal(input.finals.length, 1);
  assert.equal(output.updates.at(-1).units.characters, 13);
  assert.deepEqual(output.finals.map(value => value.status), ['canceled']);
  assert.equal(f.messages.length, messages, 'accounting does not send late audio or state');
});

test('exec speech attributes greeting and tutor operations once through the organizer', async t => {
  const calls = [];
  const cliOrganizer = { available: true, async organize(input, options) { calls.push({ input, options }); return { reply: calls.length === 1 ? 'Welcome to Biology.' : 'Particles spread down their concentration gradient.' }; } };
  const testId = '18e2ced5-fab7-4b23-ae07-abc99c94a112';
  const f = await fixture(t, { LUNA_VOICE_TRANSPORT: 'exec' }, { ...study, testId }, true, undefined, { cliOrganizer });
  assert.deepEqual(calls[0].options.usageContext, { testId, operation: 'greeting' });
  f.commit('Explain diffusion.');
  await f.waitFor(() => f.messages.some(message => message.final && message.text === 'Particles spread down their concentration gradient.'));
  assert.deepEqual(calls[1].options.usageContext, { testId, operation: 'tutor' });
  assert.equal(calls.length, 2);
  assert.equal(f.lunas.length, 0, 'exec does not additionally start a streaming model');
});

test('persistent board patches retain the scene and selected matrix cells become context only', async t => {
  const initialBoard = { title: 'Original matrix', revision: 'client-old-revision', blocks: [{ id: 'matrix-a', type: 'matrix', label: 'A', rows: [['1', '2'], ['3', '4']] }] };
  const canvasRouter = { async classify() { return { needsCanvas: true, source: 'jev' }; } };
  const f = await fixture(t, {}, { ...study, whiteboard: initialBoard }, true, undefined, { canvasRouter });
  assert.notEqual(f.restoredBoard.revision, initialBoard.revision);
  async function select(event) { f.client.send(JSON.stringify({ type: 'canvas-select', ...event })); const pong = once(f.client, 'pong'); f.client.ping(); await pong; }
  await select({ boardRevision: f.restoredBoard.revision, blockId: 'matrix-a', cell: { row: 0, col: 1 }, part: 0 });
  await select({ boardRevision: 'stale-revision', clear: true });
  await select({ boardRevision: f.restoredBoard.revision, clear: true, blockId: 'matrix-a' });
  assert.equal(f.lunas[0].calls.length, 0, 'a click must not start tutoring or grading');
  f.commit('Help me with this number.');
  const first = f.lunas[0].calls[0];
  assert.equal(first.input.whiteboardContext.selection.content, '2');
  assert.equal(first.input.whiteboardContext.selection.parentContent, '2');
  assert.equal(first.input.whiteboardContext.selection.part.index, 0);
  assert.deepEqual(first.input.whiteboardContext.selection.cell, { row: 0, col: 1 });
  first.options.onText('Look at its position. '); first.resolve({ reply: 'Look at its position.' });
  await f.waitFor(() => f.messages.some(message => message.text === 'Look at its position.'), 'spoken-only hint');
  assert.equal(f.messages.some(message => message.type === 'canvas'), false, 'a spoken hint preserves the matrix');
  await select({ boardRevision: f.restoredBoard.revision, clear: true });
  assert.equal(f.lunas[0].calls.length, 1, 'clearing selection must not start a response');
  f.commit('Compare the first row.');
  const second = f.lunas[0].calls[1];
  assert.equal(second.input.whiteboardContext.selection, null, 'accepted clear removes selection from the next spoken turn');
  second.options.onText('Compare the entries. '); second.resolve({ reply: 'Compare the entries.', board: { title: 'A visual hint must not retitle the scene', blocks: [{ id: 'hint', type: 'latex', content: '1<2' }] } });
  await f.waitFor(() => f.messages.some(message => message.type === 'canvas'), 'merged board');
  const merged = f.messages.find(message => message.type === 'canvas').board;
  assert.equal(merged.title, 'Original matrix');
  assert.deepEqual(merged.blocks.map(block => block.id), ['matrix-a', 'hint']);
  assert.deepEqual(merged.blocks[0].rows, initialBoard.blocks[0].rows);
  await select({ boardRevision: f.restoredBoard.revision, blockId: 'matrix-a', cell: { row: 0, col: 0 } });
  await select({ boardRevision: merged.revision, blockId: 'matrix-a', cell: { row: 0, col: 0 }, content: 'injected' });
  f.commit('Explain the comparison.');
  assert.equal(f.lunas[0].calls[2].input.whiteboardContext.selection, null, 'stale or forged selections are rejected');
  assert.equal(f.lunas[0].calls[2].input.whiteboardContext.board.revision, merged.revision);
});

test('grading sees displayed board help and canceled source revisions cannot publish a score', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'luna-board-grade-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createMasteryStore({ path: join(directory, 'mastery.json'), shared: false });
  const testId = '18e2ced5-fab7-4b23-ae07-abc99c94a110';
  const question = { id: 'board-q', topicId: 'transport', topicTitle: 'Transport', difficulty: 'hard', question: 'Which direction does diffusion follow?', answer: 'Higher to lower concentration.', sourceIds: ['notes'] };
  let consumed = false, notify = () => {}, gradeInput, finishGrade;
  const bank = { topics: () => [{ id: 'transport', title: 'Transport' }], context: () => null, discard() {}, consume(_, reply) { if (!consumed && reply.includes(question.question)) { consumed = true; return [question]; } return []; } };
  const gradeAnswerImpl = input => { gradeInput = input; notify(); return new Promise(resolve => { finishGrade = resolve; }); };
  const canvasRouter = { async classify(_, context) { return { needsCanvas: context.phase === 'study', source: 'jev' }; } };
  const f = await fixture(t, {}, { ...study, testId }, true, bank, { masteryStore: store, gradeAnswerImpl, canvasRouter }); notify = f.notify;
  f.commit('Show a question.');
  f.lunas[0].calls[0].options.onText(question.question);
  f.lunas[0].calls[0].resolve({ reply: question.question, board: { title: 'Diffusion', blocks: [{ id: 'concentrations', type: 'diagram', elements: [{ type: 'text', x: 10, y: 20, text: 'Higher concentration' }, { type: 'text', x: 60, y: 20, text: 'Lower concentration' }, { type: 'arrow', x1: 20, y1: 50, x2: 80, y2: 50 }] }] } });
  await f.waitFor(() => f.messages.some(message => message.type === 'canvas'), 'spoken question and displayed visual hint');
  f.commit('I need another hint.');
  assert.equal(f.lunas[0].calls.length, 1, 'voice help only invites the explicit button');
  f.speech.at(-1).options.onEnd();
  f.client.send(JSON.stringify({ type: 'hint' }));
  await f.waitFor(() => f.lunas[0].calls.length === 2, 'authorized hint turn');
  f.lunas[0].calls[1].options.onText('Compare the two concentrations. ');
  f.lunas[0].calls[1].resolve({ reply: 'Compare the two concentrations.', board: { title: 'Diffusion', blocks: [{ id: 'extra-hint', type: 'text', content: 'First compare the concentrations: c_1>c_2.' }] } });
  await f.waitFor(() => f.messages.filter(message => message.type === 'canvas').length === 2, 'hint patch for the same question');
  f.commit('Particles move from higher to lower concentration.');
  f.lunas[0].calls[2].options.onText('That describes the direction. '); f.lunas[0].calls[2].resolve({ reply: 'That describes the direction.' });
  await f.waitFor(() => Boolean(finishGrade), 'grade sees displayed content');
  assert.ok(gradeInput.conversation.some(item => item.content.includes('Higher concentration') && item.content.includes('Lower concentration')));
  assert.ok(gradeInput.conversation.some(item => item.content.includes('c_1>c_2')));
  assert.ok(gradeInput.conversation.some(item => item.content === question.question), 'the exact queued question was spoken');
  assert.ok(f.messages.some(message => message.type === 'canvas' && message.board.blocks.some(block => block.type === 'text' && block.id === 'extra-hint')), 'approved written help remains visible and enters grading evidence');
  assert.equal(gradeInput.question.id, question.id, 'a hint patch retains the active question for grading');
  f.client.send(JSON.stringify({ type: 'materials', materials: [], indexStatus: 'empty' }));
  await f.waitFor(() => f.messages.some(message => message.type === 'materials-ready' && message.count === 0), 'source revision changed');
  assert.equal(gradeInput.signal.aborted, true);
  finishGrade({ verdict: 'correct', unassisted: false, checked: true });
  await immediate(); await store.flush();
  assert.equal((await store.load(testId)).overall, 0);
  assert.equal(f.messages.some(message => message.type === 'mastery' && message.mastery.overall > 0), false);
});

test('material updates cancel stale answers silently and retain conversation while replacing factual sources', async t => {
  const f = await fixture(t);
  f.commit('Explain diffusion.');
  const old = f.lunas[0].calls[0], oldSpeech = f.speech[0];
  const updated = [{ id: 'new', name: 'New notes', text: 'Active transport requires energy.' }];
  f.client.send(JSON.stringify({ type: 'materials', materials: updated }));
  await f.waitFor(() => f.messages.some(message => message.type === 'materials-ready'), 'new materials acknowledgment');
  assert.equal(old.options.signal.aborted, true);
  assert.equal(oldSpeech.cancellations, 1);
  assert.equal(f.speech.length, 1, 'source updates do not synthesize acknowledgments');
  old.options.onText('Outdated claim. '); oldSpeech.options.onAudio('AQI='); old.resolve({ reply: 'Outdated claim.' });
  f.client.send(JSON.stringify({ type: 'materials', materials: updated }));
  f.client.send(JSON.stringify({ type: 'index-status', status: 'ready', revision: 'new' }));
  await f.waitFor(() => f.messages.some(message => message.type === 'index-status-updated'), 'indexing complete');
  await f.waitFor(() => f.messages.some(message => message.type === 'study-ready'), 'new-source technical readiness');
  f.commit('What requires energy?');
  await f.waitFor(() => f.lunas[0].calls.length === 2, 'response with new material');
  assert.deepEqual(f.lunas[0].calls[1].input.materials, updated);
  assert.equal(f.lunas[0].calls[1].input.conversation.some(item => item.content === 'Explain diffusion.'), true);
  assert.ok(f.lunas[0].calls[1].input.readinessContext.changes.some(change=>change.kind==='materials-changed'));
  assert.equal(f.messages.filter(message => message.type === 'materials-ready').length, 1);
  assert.equal(f.messages.some(message => message.audio === 'AQI=' || message.text === 'Outdated claim.'), false);
});

test('setup updates preserve sources, validate calendar fields, and cancel stale generation', async t => {
  const f = await fixture(t);
  f.commit('Explain diffusion.');
  const old = f.lunas[0].calls[0];
  f.client.send(JSON.stringify({ type: 'setup', date: '2026-10-15', difficulty: 'final', localToday: '2026-10-01' }));
  await f.waitFor(() => f.messages.some(message => message.type === 'setup-updated'), 'updated setup');
  assert.equal(old.options.signal.aborted, true);
  f.client.send(JSON.stringify({ type: 'setup', date: '2026-02-30' }));
  await f.waitFor(() => f.messages.some(message => message.type === 'error'), 'invalid setup rejected');
  assert.equal(f.messages.find(message => message.type === 'error').recoverable, true);
  await f.waitFor(() => f.messages.some(message => message.type === 'study-ready'), 'updated-date technical readiness');
  f.commit('What is diffusion?');
  await f.waitFor(() => f.lunas[0].calls.length === 2, 'next response after setup');
  assert.equal(f.lunas[0].calls[1].input.date, '2026-10-15');
  assert.equal(f.lunas[0].calls[1].input.difficulty, 'final');
  assert.deepEqual(f.lunas[0].calls[1].input.materials, study.materials);
});

test('speech opens before Luna completes and an early text clause reaches the client as audio', async t => {
  const f = await fixture(t);
  f.commit('What is diffusion?');
  await f.waitFor(() => f.lunas[0].calls.length === 1, 'Luna response');
  const request = f.lunas[0].calls[0], stream = f.speech[0];
  assert.ok(f.order.indexOf('speech-open') < f.order.indexOf('voice-respond'));
  assert.equal(request.options.effort, 'low');
  assert.equal(request.input.title, study.title);
  assert.deepEqual(request.input.materials, study.materials);
  assert.equal(request.input.conversation.at(-1).content, 'What is diffusion?');
  request.options.onText('Diffusion moves particles. ');
  assert.deepEqual(stream.writes, ['Diffusion moves particles. ']);
  stream.options.onAudio('AAA=');
  await f.waitFor(() => f.messages.some(message => message.type === 'audio'), 'early audio');
  assert.equal(stream.finishes, 0);
  assert.equal(f.messages.some(message => message.type === 'transcript' && message.role === 'assistant' && message.final), false);
  assert.ok(f.messages.some(message => message.role === 'assistant' && message.final === false && message.text === 'Diffusion moves particles.' && Number.isInteger(message.turnId)));
  request.resolve({ reply: 'Diffusion moves particles.' });
  await f.waitFor(() => f.messages.some(message => message.role === 'assistant' && message.final), 'final reply');
  assert.equal(stream.finishes, 1);
  stream.options.onEnd();
  await f.waitFor(() => f.messages.some(message => message.type === 'audio-end'), 'audio completion');
  assert.ok(f.messages.some(message => message.type === 'latency' && message.stage === 'first-text'));
  assert.ok(f.messages.some(message => message.type === 'latency' && message.stage === 'first-audio'));
});

test('the closing speech tag flushes a short tail before the board completes, without closing TTS', async t => {
  const f = await fixture(t);
  f.commit('Show diffusion.');
  const call = f.lunas[0].calls[0], stream = f.speech[0];
  call.options.onText('Consider this');
  assert.equal(stream.writes.length, 0);
  call.options.onSpeechEnd();
  assert.equal(stream.writes.join('').trim(), 'Consider this');
  assert.equal(stream.finishes, 0);
  call.resolve({ reply: 'Consider this' });
  await f.waitFor(() => stream.finishes === 1, 'complete speech stream');
  assert.equal(stream.writes.length, 1);
  f.commit('Another view.');
  const stale = f.lunas[0].calls[1], staleSpeech = f.speech[1];
  stale.options.onText('Late tail');
  f.partial('Wait');
  stale.options.onSpeechEnd();
  assert.deepEqual(staleSpeech.writes, []);
});

test('barge-in aborts the old turn and rejects its late audio, text and completed reply', async t => {
  const f = await fixture(t);
  f.commit('First question');
  const old = f.lunas[0].calls[0], oldSpeech = f.speech[0];
  old.options.onText('Initial answer. '); oldSpeech.options.onAudio('AAA=');
  await f.waitFor(() => f.messages.some(message => message.type === 'audio'), 'first turn audio');
  f.partial('Wait, another question');
  await f.waitFor(() => f.messages.some(message => message.type === 'interrupt'), 'interruption');
  assert.equal(old.options.signal.aborted, true);
  assert.equal(oldSpeech.cancellations, 1);
  old.options.onText('Stale text must not be spoken. ');
  oldSpeech.options.onAudio('AQI='); oldSpeech.options.onEnd();
  old.resolve({ reply: 'Stale completed answer.' });
  f.commit('Second question');
  await f.waitFor(() => f.lunas[0].calls.length === 2, 'second turn');
  const current = f.lunas[0].calls[1];
  current.options.onText('Current answer. '); current.resolve({ reply: 'Current answer.' });
  await f.waitFor(() => f.messages.some(message => message.text === 'Current answer.'), 'second completed reply');
  assert.deepEqual(oldSpeech.writes, ['Initial answer. ']);
  assert.equal(f.messages.some(message => message.audio === 'AQI='), false);
  assert.equal(f.messages.some(message => message.text === 'Stale completed answer.'), false);
  assert.equal(f.messages.some(message => message.type === 'audio-end'), false);
});

test('optional high-effort planning never blocks speech and its completed hint reaches a later turn', async t => {
  const f = await fixture(t, { LUNA_VOICE_PLANNER: 'true' }, { ...study, date: '', localToday: '2026-10-02' });
  const voice = f.lunas.find(luna => luna.mode === 'voice'), planner = f.lunas.find(luna => luna.mode === 'planner');
  assert.equal(planner.readyCalls, 1);
  f.commit('Explain diffusion.');
  await f.waitFor(() => planner.calls.length === 1, 'background planning');
  assert.equal(planner.calls[0].options.effort, 'high');
  assert.deepEqual(planner.calls[0].input.calendarContext, { today: '2026-10-02', sessionDate: '2026-10-02', examDate: null });
  assert.equal(voice.calls[0].options.effort, 'low');
  assert.equal(Object.hasOwn(voice.calls[0].input, 'teachingHint'), false);
  voice.calls[0].options.onText('Particles move down a concentration gradient. ');
  voice.calls[0].resolve({ reply: 'Particles move down a concentration gradient.' });
  await f.waitFor(() => f.messages.some(message => message.role === 'assistant'), 'answer while planner is pending');
  assert.equal(f.speech[0].finishes, 1);
  planner.calls[0].resolve({ reply: 'Next, contrast diffusion with active transport.' });
  await immediate();
  f.commit('What should I compare next?');
  await f.waitFor(() => voice.calls.length === 2, 'next voice turn');
  assert.deepEqual(voice.calls[1].input.teachingHint, { text: 'Next, contrast diffusion with active transport.', throughUserTurn: 1 });
  assert.equal(planner.calls[0].options.signal.aborted, true);
});

test('stopping a session aborts generation and closes voice, planner, speech and STT', async t => {
  const f = await fixture(t, { LUNA_VOICE_PLANNER: 'true' });
  f.commit('Explain diffusion.');
  const voice = f.lunas.find(luna => luna.mode === 'voice'), planner = f.lunas.find(luna => luna.mode === 'planner');
  await f.waitFor(() => planner.calls.length === 1, 'planner request');
  const closed = once(f.client, 'close');
  f.client.send(JSON.stringify({ type: 'stop' }));
  await closed;
  assert.equal(voice.calls[0].options.signal.aborted, true);
  assert.equal(planner.calls[0].options.signal.aborted, true);
  assert.equal(voice.closeCalls, 1); assert.equal(planner.closeCalls, 1);
  assert.equal(f.stt[0].terminated, true);
  assert.equal(f.speech[0].cancellations, 1);
  const count = f.messages.length;
  voice.calls[0].options.onText('Late text. '); f.speech[0].options.onAudio('AAA=');
  voice.calls[0].resolve({ reply: 'Late answer.' }); planner.calls[0].resolve({ reply: 'Late hint.' });
  await immediate();
  assert.equal(f.messages.length, count);
});

test('session memory stays private and public history hooks finish once without storing answer keys', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'luna-live-history-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createMasteryStore({ path: join(directory, 'mastery.json'), shared: false });
  const testId = '18e2ced5-fab7-4b23-ae07-abc99c94a110';
  const memory = { sessionCount: 1, notes: ['Previously practiced diffusion.'], resume: null, recentSessions: [{ endedAt: '2026-10-01T12:00:00Z', lastProblem: { topicTitle: 'Transport' } }] };
  const recorded = [], sessionId = 'private-session-id';
  const sessionHistory = {
    start(input) { recorded.push({ method: 'start', testId: input.testId }); return sessionId; },
    async context(id, options) { assert.equal(id, testId); assert.equal(options.excludeSessionId, sessionId); return memory; },
    ...Object.fromEntries(['transcript','userAudio','assistantAudio','problem','finish'].map(method => [method, (id, value) => { assert.equal(id, sessionId); recorded.push({ method, value }); }])),
  };
  const question = { id: 'question-history', topicId: 'transport', topicTitle: 'Transport', difficulty: 'easy', question: 'Which way do particles diffuse?', answer: 'PRIVATE REFERENCE ANSWER', sourceIds: ['notes'] };
  let consumed = false;
  const bank = { topics: () => [], consume(_, reply) { if (!consumed && reply.includes(question.question)) { consumed = true; return [question]; } return []; } };
  const f = await fixture(t, {}, { ...study, testId }, true, bank, { masteryStore: store, sessionHistory, gradeAnswerImpl: async () => null });
  assert.deepEqual(f.welcome.input.sessionMemory, memory, 'returning greeting gets the full private memory, not a fixed welcome string');
  f.client.send(JSON.stringify({ type: 'audio', audio: 'AAA=' }));
  await f.waitFor(() => f.stt[0].sent.length === 1, 'accepted input audio');
  f.commit('Quiz me.');
  const turn = f.lunas[0].calls[0], stream = f.speech[0];
  assert.deepEqual(turn.input.sessionMemory, memory);
  turn.options.onText(`${question.question} `);
  stream.options.onAudio('AAA=');
  turn.resolve({ reply: question.question });
  await f.waitFor(() => f.messages.some(message => message.text === question.question), 'asked question');
  f.commit('I need a hint.');
  const closed = once(f.client, 'close');
  f.client.send(JSON.stringify({ type: 'stop' }));
  await closed;
  stream.options.onAudio('AQI=');
  assert.equal(recorded.filter(item => item.method === 'finish').length, 1);
  assert.equal(recorded.find(item => item.method === 'finish').value.reason, 'user-stopped');
  assert.equal(recorded.filter(item => item.method === 'userAudio').length, 1);
  assert.equal(recorded.filter(item => item.method === 'assistantAudio').length, 1);
  assert.deepEqual(recorded.filter(item => item.method === 'problem').map(item => item.value.type), ['asked'], 'merely requesting help is not delivered assistance');
  assert.equal(JSON.stringify(recorded).includes(question.answer), false);
  assert.equal(JSON.stringify(f.messages).includes('Previously practiced diffusion'), false);
  assert.equal(recorded.filter(item => item.method === 'transcript' && item.value.role === 'user' && item.value.text === 'Quiz me.').length, 1);
});

test('two-source setup forwards wait and ordinary replies directly to Luna without asking enough', async t => {
  const f = await fixture(t, {}, { ...study, materials: [...study.materials, { id: 'second', name: 'Second notes', text: 'Active transport uses energy.' }] }, false);
  assert.equal(f.welcome.input.readinessContext.ready, true);
  assert.doesNotMatch(f.welcome.message.text, /2 sources|everything|enough/);
  for (const text of ['I think so, but wait, I have another chapter to add.', 'Um, okay.', 'Actually, can we just start with a practice question?']) f.commit(text);
  assert.equal(f.lunas[0].calls.length, 3);
  assert.equal(f.lunas[0].calls[0].input.conversation.at(-1).content, 'I think so, but wait, I have another chapter to add.');
  assert.equal(f.lunas[0].calls[2].input.conversation.at(-1).content, 'Actually, can we just start with a practice question?');
  assert.equal(f.messages.some(message => message.setup), false);
});

test('natural confirmation is ordinary conversational context rather than a deterministic setup turn', async t => {
  const f = await fixture(t, {}, study, false);
  f.commit('Yeah, those are all the notes I have for now.');
  assert.equal(f.lunas[0].calls.length, 1);
  assert.equal(f.lunas[0].calls[0].input.conversation.at(-1).content, 'Yeah, those are all the notes I have for now.');
  f.commit('What does diffusion mean?');
  assert.equal(f.lunas[0].calls.length, 2);
  assert.equal(f.messages.some(message => message.setup), false);
});

test('source refresh cannot repeat completeness and unindexed turns never receive quiz preparation', async t => {
  const contexts=[];
  const f = await fixture(t, {}, study, false, {context(input){contexts.push(input);return {private:'question'};}});
  f.client.send(JSON.stringify({ type: 'materials', materials: [{ id: 'replacement', name: 'Replacement notes', text: 'Osmosis moves water across a membrane.' }], indexStatus: 'indexing' }));
  await f.waitFor(() => f.messages.some(message => message.type === 'materials-ready'), 'replacement material');
  assert.equal(f.speech.length,0);
  f.commit('Please explain osmosis.');
  assert.equal(f.lunas[0].calls.length, 1);
  assert.equal(f.lunas[0].calls[0].input.readinessContext.ready,false);
  assert.equal(f.lunas[0].calls[0].input.privateQuestionBank,undefined);
  assert.equal(contexts.length,1);
  f.client.send(JSON.stringify({ type: 'index-status', status: 'ready', revision: 'replacement' }));
  await f.waitFor(() => f.messages.some(message => message.type === 'index-status-updated' && message.status === 'ready'), 'replacement indexed');
  assert.equal(f.lunas[0].calls.length,1,'indexing completion waits for the existing turn before it can lead');
  f.commit('Please explain osmosis.');
  assert.equal(f.lunas[0].calls.length, 2);
  assert.deepEqual(f.lunas[0].calls[1].input.materials.map(item => item.id), ['replacement']);
  assert.equal(f.lunas[0].calls[1].input.readinessContext.ready,true);
  assert.equal(contexts.length,2);
});

test('saved label selection restores safely, survives unrelated patches, and clears when its matrix changes', async t => {
  const matrix = { id: 'matrix-a', type: 'matrix', label: 'A', rows: [['1', '2'], ['3', '4']], rowLabels: ['First row', 'Second row'], columnLabels: ['Left column', 'Right column'] };
  const initialBoard = { title: 'Saved matrix', revision: 'saved-revision', blocks: [matrix] };
  const savedSelection = { boardRevision: 'saved-revision', blockId: 'matrix-a', label: { axis: 'row', index: 1 }, part: 0 };
  const canvasRouter = { async classify() { return { needsCanvas: true, source: 'jev' }; } };
  const f = await fixture(t, {}, { ...study, whiteboard: initialBoard, whiteboardSelection: savedSelection }, false, undefined, { canvasRouter });
  assert.deepEqual(f.restoredSelection, { ...savedSelection, boardRevision: f.restoredBoard.revision });
  assert.equal(Object.hasOwn(f.restoredSelection, 'content'), false);
  assert.equal(f.lunas[0].calls.length, 0, 'restoring a click never starts tutoring');
  f.commit('Add a hint about this row.');
  const first = f.lunas[0].calls[0];
  assert.equal(first.input.whiteboardContext.selection.content, 'Second');
  assert.deepEqual(first.input.whiteboardContext.selection.label, { axis: 'row', index: 1 });
  first.resolve({ reply: 'Look across the row.', board: { title: 'Hint', blocks: [{ id: 'hint', type: 'latex', content: '3<4' }] } });
  await f.waitFor(() => f.messages.some(message => message.type === 'canvas'), 'hint patch');
  const patch = f.messages.find(message => message.type === 'canvas');
  assert.deepEqual(patch.selection, { ...savedSelection, boardRevision: patch.board.revision });
  f.commit('Change the matrix.');
  const second = f.lunas[0].calls[1];
  assert.equal(second.input.whiteboardContext.selection.content, 'Second');
  assert.equal(second.input.whiteboardContext.selection.boardRevision, patch.board.revision);
  second.resolve({ reply: 'Here is a different matrix.', board: { title: 'Changed', blocks: [{ ...matrix, rows: [['7', '8'], ['9', '10']] }] } });
  await f.waitFor(() => f.messages.filter(message => message.type === 'canvas').length === 2, 'changed matrix');
  assert.equal(f.messages.filter(message => message.type === 'canvas')[1].selection, null);
  f.commit('Explain it.');
  assert.equal(f.lunas[0].calls[2].input.whiteboardContext.selection, null);
});

test('forged saved selection is discarded and live label clicks are context only', async t => {
  const initialBoard = { title: 'Saved', revision: 'original', blocks: [{ id: 'matrix-a', type: 'matrix', rows: [['1']], rowLabels: ['Row one'], columnLabels: ['Column one'] }] };
  const f = await fixture(t, {}, { ...study, whiteboard: initialBoard, whiteboardSelection: { boardRevision: 'original', blockId: 'matrix-a', label: { axis: 'row', index: 0 }, content: 'forged' } }, false);
  assert.equal(f.restoredSelection, null);
  const event = { type: 'canvas-select', boardRevision: f.restoredBoard.revision, blockId: 'matrix-a', label: { axis: 'column', index: 0 }, part: 1 };
  for (const selection of [event, { ...event, cell: { row: 0, col: 0 } }, { ...event, boardRevision: 'original' }]) f.client.send(JSON.stringify(selection));
  const pong = once(f.client, 'pong'); f.client.ping(); await pong;
  assert.equal(f.lunas[0].calls.length, 0);
  f.commit('Explain this label.');
  assert.equal(f.lunas[0].calls[0].input.whiteboardContext.selection.content, 'one');
  assert.deepEqual(f.lunas[0].calls[0].input.whiteboardContext.selection.label, { axis: 'column', index: 0 });
});


test('model failure produces a recoverable UI error and no fallback speech', async t => {
 const f=await fixture(t,{}, {...study,date:''},false);
 f.commit('I do not know when it is.');
 const call=f.lunas[0].calls[0];call.reject(new Error('mock model failure'));
 await f.waitFor(()=>f.messages.some(message=>message.type==='error'),'recoverable generation failure');
 assert.equal(f.messages.find(message=>message.type==='error').recoverable,true);
 assert.deepEqual(f.speech.flatMap(stream=>stream.writes),[]);
 assert.equal(f.messages.some(message=>message.role==='assistant'),false);
 assert.equal(f.speech[0].cancellations,1);
});

test('recent turns and verbatim conversation memory preserve the whole dialogue after setup changes',async t=>{
 const f=await fixture(t);
 for(let i=0;i<8;i++){
  f.commit(`Student turn ${i}.`);
  const call=f.lunas[0].calls[i],reply=`Generated response ${i}.`;
  call.options.onText(reply);call.resolve({reply});
  await f.waitFor(()=>f.messages.some(message=>message.text===reply),'generated response');
 }
 f.client.send(JSON.stringify({type:'setup',difficulty:'final'}));
 await f.waitFor(()=>f.messages.some(message=>message.type==='setup-updated'),'setup update');
 f.commit('Remember what I first asked?');
 const last=f.lunas[0].calls.at(-1);
 const conversation=completeTutorConversation(last.input);
 assert.ok(conversation.some(turn=>turn.content==='Student turn 0.'));
 assert.ok(conversation.some(turn=>turn.content==='Generated response 0.'));
 assert.equal(conversation.filter(turn=>turn.role==='user').length,9);
 assert.equal(last.input.conversation.length,8);
 assert.equal(last.input.conversationMemory.omittedPublicTurns,0);
 assert.equal(f.lunas[0].readyCalls,1);
});

test('API source-ready returning greeting can look up originals and prepare the first practice question', async t => {
  const bankInputs = [];
  const bank = { context(input) { bankInputs.push(input); return { topics: [] }; } };
  const memory = { sessionCount: 1, resume: 'Continue the concentration gradient problem.' };
  const sessionHistory = { start: () => 'returning-session', context: async () => memory };
  const start = { ...study, testId: '18e2ced5-fab7-4b23-ae07-abc99c94a121', date: '' };
  const f = await fixture(t, { LUNA_ORGANIZER: 'openai-api' }, start, true, bank, { sessionHistory }, { skipGreetingFlow: true });
  await f.waitFor(() => f.lunas[0].greetings.length === 1, 'returning greeting');
  const greeting = f.lunas[0].greetings[0];
  assert.equal(greeting.input.readinessContext.ready, true);
  assert.equal(greeting.input.readinessContext.trigger, 'session-start');
  assert.equal(greeting.input.sessionMemory.resume, memory.resume);
  assert.deepEqual(greeting.input.materials, [], 'a new retrieval session has no selected passages yet');
  assert.equal(greeting.input.retrievalStatus.unresolved, true);
  const source = greeting.input.materialCatalog.sources[0];
  assert.equal(source.sourceId, 'notes');
  assert.deepEqual(greeting.options.retrieval?.tools, MATERIAL_RETRIEVAL_TOOLS, 'a grounded returning welcome can fetch original evidence');
  const found = greeting.options.retrieval.execute('read_materials', { chunkIds: [source.firstChunkId], sourceRevision: greeting.input.sourceRevision }, { signal: greeting.options.signal });
  assert.equal(found.passages[0].text, study.materials[0].text);
  assert.equal(found.passages[0].sourceId, 'notes');
  assert.equal(bankInputs.length, 1, 'a ready welcome can prepare its first practice question');
  assert.equal(Object.hasOwn(greeting.input, 'privateQuestionBank'), true);
});

test('API unready greeting cannot look up sources that are still indexing', async t => {
  const start = { ...study, indexStatus: 'indexing' };
  const f = await fixture(t, { LUNA_ORGANIZER: 'openai-api' }, start, true, undefined, {}, { skipGreetingFlow: true });
  await f.waitFor(() => f.lunas[0].greetings.length === 1, 'unready greeting');
  const greeting = f.lunas[0].greetings[0];
  assert.equal(greeting.input.readinessContext.ready, false);
  assert.deepEqual(greeting.input.readinessContext.missing, ['indexing']);
  assert.deepEqual(greeting.input.materials, []);
  assert.equal(greeting.input.materialCatalog.sources[0].sourceId, 'notes');
  assert.equal(greeting.options.retrieval, undefined);
});

test('API voice starts intent and retrieval together, passes only original passages, and exposes bounded tools', async t => {
  const retrieval = controlledRetrieval(), intents = [];
  const intentRouter = { classify(text, context, options) { return new Promise(resolve => intents.push({ text, context, options, resolve })); } };
  const start = { ...study, materials: [
    { id: 'notes', name: 'Diffusion notes', text: 'Diffusion source passage. '.repeat(260) },
    { id: 'other', name: 'Other chapter', text: 'Additional original source excluded from the selected passage.' },
  ] };
  const f = await fixture(t, { LUNA_ORGANIZER: 'openai-api' }, start, true, undefined, { intentRouter, createMaterialRetrievalImpl: retrieval.factory });
  retrieval.notify = f.notify;
  f.commit('Explain diffusion.');
  await f.waitFor(() => intents.length === 1 && retrieval.pending.length === 1, 'both concurrent decisions started');
  assert.equal(f.lunas[0].calls.length, 0);
  assert.equal(intents[0].options.signal, retrieval.pending[0].options.signal, 'both decisions share turn cancellation');
  assert.equal(retrieval.pending[0].request.conversation.at(-1).content, 'Explain diffusion.');
  intents[0].resolve({ source: 'jev', answerAttempt: false, requestsHelp: false, examDeadline: false });
  await immediate();
  assert.equal(f.lunas[0].calls.length, 0, 'intent completion does not bypass pending retrieval');
  retrieval.pending[0].resolve(retrieval.pending[0].result);
  await f.waitFor(() => f.lunas[0].calls.length === 1, 'retrieved tutor request');
  const call = f.lunas[0].calls[0];
  assert.deepEqual(call.input.materials, retrieval.pending[0].result.materials);
  assert.ok(call.input.materials[0].text.length < start.materials[0].text.length);
  assert.deepEqual(call.input.materials.map(source => source.id), ['notes']);
  assert.equal(call.input.materialCatalog.totalSources, 2);
  assert.equal(call.input.retrievalStatus.completeness, 'partial-source-excerpts');
  assert.ok(call.input.passageReferences.every(passage => !Object.hasOwn(passage, 'text')), 'passage text is serialized only once');
  assert.deepEqual(call.options.retrieval.tools, MATERIAL_RETRIEVAL_TOOLS);
  const found = call.options.retrieval.execute('search_materials', { query: 'Additional', sourceIds: ['other'], sourceRevision: call.input.sourceRevision }, { signal: call.options.signal });
  assert.equal(found.passages[0].text, start.materials[1].text);
  assert.equal(Object.hasOwn(found, 'materials'), false);
  assert.equal(retrieval.executeCalls.length, 1);
});

test('API retrieval and intent completions from interrupted or replaced sources cannot start a stale tutor turn', async t => {
  const retrieval = controlledRetrieval(), intents = [];
  const intentRouter = { classify(text, context, options) { return new Promise(resolve => intents.push({ text, context, options, resolve })); } };
  const f = await fixture(t, { LUNA_ORGANIZER: 'openai-api' }, study, true, undefined, { intentRouter, createMaterialRetrievalImpl: retrieval.factory });
  retrieval.notify = f.notify;
  f.commit('Old interrupted request.');
  await f.waitFor(() => retrieval.pending.length === 1);
  f.partial('Wait');
  assert.equal(retrieval.pending[0].options.signal.aborted, true);
  intents[0].resolve({ examDeadline: true }); retrieval.pending[0].resolve(retrieval.pending[0].result);
  await immediate(); await immediate();
  assert.equal(f.lunas[0].calls.length, 0);
  f.commit('Explain the old source.');
  await f.waitFor(() => retrieval.pending.length === 2);
  const oldRevision = retrieval.pending[1].result.sourceRevision;
  f.client.send(JSON.stringify({ type: 'materials', materials: [{ id: 'replacement', name: 'New source', text: 'Osmosis is the movement of water.' }], indexStatus: 'indexing' }));
  await f.waitFor(() => f.messages.some(message => message.type === 'materials-ready'));
  assert.equal(retrieval.pending[1].options.signal.aborted, true);
  assert.deepEqual(retrieval.updates.at(-1).materials.map(source => source.id), ['replacement']);
  intents[1].resolve({ answerAttempt: false }); retrieval.pending[1].resolve(retrieval.pending[1].result);
  await immediate(); await immediate();
  assert.equal(f.lunas[0].calls.length, 0);
  f.client.send(JSON.stringify({ type: 'index-status', status: 'ready', revision: 'replacement' }));
  await f.waitFor(() => f.messages.some(message => message.type === 'index-status-updated' && message.status === 'ready'));
  f.commit('Explain osmosis now.');
  await f.waitFor(() => retrieval.pending.length === 3);
  assert.notEqual(retrieval.pending[2].result.sourceRevision, oldRevision);
  retrieval.pending[2].resolve(retrieval.pending[2].result); intents[2].resolve({ answerAttempt: false });
  await f.waitFor(() => f.lunas[0].calls.length === 1);
  assert.deepEqual(f.lunas[0].calls[0].input.materials.map(source => source.id), ['replacement']);
  assert.equal(f.messages.some(message => message.type === 'setup-date'), false);
});

test('API retrieval retains all queued questions while masking answers and preserves original sources for grading', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'luna-retrieval-grade-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createMasteryStore({ path: join(directory, 'mastery.json'), shared: false });
  const start = { ...study, testId: '18e2ced5-fab7-4b23-ae07-abc99c94a120', materials: [
    { id: 'notes', name: 'Diffusion notes', text: 'Diffusion moves particles down the gradient. '.repeat(170) },
    { id: 'other', name: 'Other source', text: 'An unselected chapter retained for independent checking.' },
  ] };
  const question = { id: 'retrieval-q', topicId: 'transport', topicTitle: 'Transport', difficulty: 'hard', question: 'Which direction do particles diffuse?', answer: 'PRIVATE REFERENCE ANSWER', sourceIds: ['notes'] };
  const privateBank = { topics: [{ title: 'Transport', questions: [question, { ...question, id: 'another', question: 'What is osmosis?', answer: 'SECOND PRIVATE ANSWER' }] }] };
  const bankBytes = JSON.stringify(privateBank), bankInputs = [], grades = [];
  let consumed = false, notify = () => {};
  const bank = { topics: () => [{ id: 'transport', title: 'Transport' }], context(input) { bankInputs.push(input); return privateBank; }, consume(_, reply) { if (!consumed && reply === question.question) { consumed = true; return [question]; } return []; } };
  const retrieval = controlledRetrieval({ deferred: false });
  const gradeAnswerImpl = async input => { grades.push(input); notify(); return null; };
  const f = await fixture(t, { LUNA_ORGANIZER: 'openai-api' }, start, true, bank, { masteryStore: store, gradeAnswerImpl, createMaterialRetrievalImpl: retrieval.factory });
  notify = f.notify; retrieval.notify = f.notify;
  for (let i = 0; i < 6; i++) {
    f.commit(`Earlier student statement ${i}.`);
    await f.waitFor(() => f.lunas[0].calls.length === i + 1);
    const reply = `Earlier tutor explanation ${i}.`;
    f.lunas[0].calls[i].resolve({ reply });
    await f.waitFor(() => f.messages.some(message => message.final && message.text === reply));
  }
  f.commit('Ask the practice question.');
  await f.waitFor(() => f.lunas[0].calls.length === 7);
  f.lunas[0].calls[6].resolve({ reply: question.question });
  await f.waitFor(() => f.messages.some(message => message.final && message.text === question.question));
  f.commit('From higher to lower concentration.');
  await f.waitFor(() => f.lunas[0].calls.length === 8);
  const answer = f.lunas[0].calls[7];
  assert.deepEqual(retrieval.pending.at(-1).request.activeQuestion.sourceIds, ['notes']);
  assert.equal(answer.input.activeQuestion.question, question.question);
  assert.equal(Object.hasOwn(answer.input.activeQuestion, 'answer'), false);
  assert.equal(answer.input.activeQuestion.attempts, 0, 'the FIFO background reservation has not committed yet');
  assert.equal(answer.input.hintContext.answerAttemptReceived, true);
  assert.ok(answer.input.conversationMemory.earlierTurns.length > 0);
  const maskedBank = structuredClone(privateBank); for (const q of maskedBank.topics[0].questions) delete q.answer;
  assert.ok(f.lunas[0].calls.every(call => JSON.stringify(call.input.privateQuestionBank) === JSON.stringify(maskedBank)));
  assert.equal(JSON.stringify(privateBank), bankBytes, 'all private prepared content remains unchanged');
  assert.deepEqual(bankInputs.at(-1).materials, start.materials);
  assert.deepEqual(completeTutorConversation(answer.input), bankInputs.at(-1).conversation);
  answer.resolve({ reply: 'That identifies the direction.' });
  await f.waitFor(() => grades.length === 1, 'background original-source grading');
  assert.deepEqual(grades[0].materials, start.materials);
  assert.deepEqual(grades[0].conversation, bankInputs.at(-1).conversation);
  assert.ok(grades[0].conversation.some(turn => turn.content === 'Earlier student statement 0.'));
  assert.ok(grades[0].conversation.length > answer.input.conversation.length);
  assert.deepEqual(answer.input.materials.map(source => source.id), ['notes']);
  assert.equal(JSON.stringify(f.messages).includes('PRIVATE REFERENCE ANSWER'), false);
});

test('API initial retrieval failure exposes unresolved evidence and lookup tools without sending the full corpus', async t => {
  const events = [];
  const f = await fixture(t, { LUNA_ORGANIZER: 'openai-api' }, study, true, undefined, { diagnostics: { record(testId, event) { events.push(event); } } });
  assert.deepEqual(f.welcome.input.materials, []);
  f.commit('Could we continue?');
  await f.waitFor(() => f.lunas[0].calls.length === 1);
  const call = f.lunas[0].calls[0];
  assert.deepEqual(call.input.materials, []);
  assert.equal(call.input.retrievalStatus.unresolved, true);
  assert.equal(call.input.retrievalStatus.reason, 'missing-key');
  assert.equal(call.input.materialCatalog.sources[0].sourceId, 'notes');
  assert.deepEqual(call.options.retrieval.tools, MATERIAL_RETRIEVAL_TOOLS);
  assert.ok(events.some(event => event.type === 'retrieval.prefetch-unresolved' && event.details.reason === 'missing-key'));
  assert.equal(JSON.stringify(events).includes(study.materials[0].text), false);
});


test('a delayed memory lookup never starts a greeting over the student speaking first',async t=>{
 let resolveMemory;
 const sessionHistory={start:()=> 'session',context:()=>new Promise(resolve=>{resolveMemory=resolve;})};
 const f=await fixture(t,{}, {...study,testId:'18e2ced5-fab7-4b23-ae07-abc99c94a117'},false,undefined,{sessionHistory},{skipGreetingFlow:true});
 assert.ok(f.messages.some(message=>message.type==='ready'),'listening is not held behind memory');
 f.partial('I want to');resolveMemory({sessionCount:2});await immediate();
 assert.equal(f.lunas[0].greetings.length,0);assert.equal(f.speech.length,0);
 f.commit('I want to continue diffusion.');
 assert.equal(f.lunas[0].calls.length,1);
 assert.equal(f.lunas[0].calls[0].input.readinessContext.trigger,'student-turn');
 assert.equal(f.lunas[0].calls[0].input.sessionMemory.sessionCount,2);
});

test('a contextual Jev finish hides the scene without deleting it, and manual visibility is silent context', async t => {
  const scene = { title: 'Example', revision: 'saved-scene', blocks: [{ id: 'equation', type: 'latex', content: 'x+2=5' }] };
  const routed = [];
  const canvasRouter = { async classify(text, context) { routed.push({text,context});return {needsCanvas:false,shouldClose:context.phase==='study'&&text!=='Welcome to Biology.',source:'jev'}; } };
  const f = await fixture(t, {}, { ...study, whiteboard: scene, whiteboardVisible: true }, true, undefined, {canvasRouter});
  assert.equal(f.welcome.input.whiteboardContext.visible,true);
  f.commit('I understand, let us go back to talking.');
  f.lunas[0].calls[0].resolve({reply:'We can leave that example and discuss the next topic.'});
  await f.waitFor(()=>f.messages.some(message=>message.type==='canvas'&&message.visible===false),'natural close');
  const closed = f.messages.find(message=>message.type==='canvas');
  assert.equal(Object.hasOwn(closed,'board'),false,'hide packet never deletes retained drawing');
  assert.equal(routed.at(-1).context.existingBoard.text,'x+2=5');
  assert.equal(routed.at(-1).context.boardVisible,true);
  assert.equal(routed.at(-1).context.conversation.at(-2).content,'I understand, let us go back to talking.');
  f.commit('What were we looking at?');
  assert.equal(f.lunas[0].calls[1].input.whiteboardContext.visible,false);
  assert.equal(f.lunas[0].calls[1].input.whiteboardContext.board.blocks[0].content,'x+2=5');
  const calls=f.lunas[0].calls.length;
  f.client.send(JSON.stringify({type:'canvas-visibility',boardRevision:f.restoredBoard.revision,visible:true}));
  const pong=once(f.client,'pong');f.client.ping();await pong;
  assert.equal(f.lunas[0].calls.length,calls,'manual reopen produces no tutor or audio response');
  f.commit('This example again.');
  assert.equal(f.lunas[0].calls[2].input.whiteboardContext.visible,true);
});

test('restore honors closed state and ignores forged visibility packets', async t => {
  const scene={title:'Saved',revision:'original',blocks:[{id:'x',type:'latex',content:'x=3'}]};
  const f=await fixture(t,{}, {...study,whiteboard:scene});
  assert.equal(f.welcome.input.whiteboardContext.visible,false,'omitted visibility restores closed');
  for(const packet of [
    {type:'canvas-visibility',boardRevision:'original',visible:true},
    {type:'canvas-visibility',boardRevision:f.restoredBoard.revision,visible:'true'},
    {type:'canvas-visibility',boardRevision:f.restoredBoard.revision,visible:true,extra:'forged'}
  ])f.client.send(JSON.stringify(packet));
  const pong=once(f.client,'pong');f.client.ping();await pong;
  f.commit('Is the diagram open?');
  assert.equal(f.lunas[0].calls[0].input.whiteboardContext.visible,false);
});

test('manual close then reopen invalidates an older asynchronous close decision', async t => {
  const scene={title:'Saved',revision:'original',blocks:[{id:'x',type:'latex',content:'x=3'}]},decisions=[];
  const canvasRouter={classify(text,context){if(context.phase==='setup'||text==='Welcome to Biology.')return Promise.resolve({needsCanvas:false});return new Promise(resolve=>decisions.push(resolve));}};
  const f=await fixture(t,{}, {...study,whiteboard:scene,whiteboardVisible:true},true,undefined,{canvasRouter});
  f.commit('We have finished.');f.lunas[0].calls[0].resolve({reply:'We can move on.'});
  await f.waitFor(()=>decisions.length===1,'pending visual decision');
  for(const visible of [false,true])f.client.send(JSON.stringify({type:'canvas-visibility',boardRevision:f.restoredBoard.revision,visible}));
  const pong=once(f.client,'pong');f.client.ping();await pong;
  decisions[0]({needsCanvas:false,shouldClose:true,source:'jev'});await immediate();await immediate();
  assert.equal(f.messages.some(message=>message.type==='canvas'),false,'old router decision cannot undo a newer manual interaction');
  f.commit('Let us use this again.');assert.equal(f.lunas[0].calls[1].input.whiteboardContext.visible,true);
});

test('assistant captions stream accumulated spoken text and reject stale text after barge-in', async t => {
  const f=await fixture(t);f.commit('Explain it.');
  const call=f.lunas[0].calls[0];call.options.onText('The first ');call.options.onText('step.');
  await f.waitFor(()=>f.messages.some(message=>message.text==='The first step.'),'streaming caption');
  const captions=f.messages.filter(message=>message.role==='assistant');
  assert.deepEqual(captions.map(message=>message.text),['The first','The first step.']);
  assert.ok(captions.every(message=>message.final===false&&message.turnId===captions[0].turnId));
  f.partial('Wait');call.options.onText(' Stale suffix.');call.resolve({reply:'The first step. Stale suffix.'});
  await immediate();await immediate();
  assert.equal(f.messages.some(message=>message.text?.includes('Stale suffix')),false);
});

test('multi-zone selection restores, stays silent, rejects forged groups and clears with an empty group',async t=>{
 const board={title:'Group',revision:'saved-group',blocks:[{id:'matrix-a',type:'matrix',rows:[['1','2'],['3','4']]},{id:'equation',type:'latex',content:'x+1=2'}]};
 const saved={boardRevision:board.revision,targets:[{blockId:'matrix-a',zoneId:'cell-0-1'},{blockId:'equation',zoneId:'whole'}]};
 const f=await fixture(t,{}, {...study,whiteboard:board,whiteboardSelection:saved},false,undefined,{canvasRouter:{classify:async()=>({needsCanvas:true,source:'jev'})}});
 assert.deepEqual(f.restoredSelection,{boardRevision:f.restoredBoard.revision,targets:[saved.targets[1],saved.targets[0]]});
 const event={type:'canvas-select',boardRevision:f.restoredBoard.revision,targets:[{blockId:'matrix-a',zoneId:'cell-0-0'},{blockId:'matrix-a',zoneId:'cell-1-1'}]};
 f.client.send(JSON.stringify(event));
 f.client.send(JSON.stringify({...event,targets:[event.targets[0],{blockId:'equation',zoneId:'whole',content:'injected'}]}));
 const pong=once(f.client,'pong');f.client.ping();await pong;
 assert.equal(f.lunas[0].calls.length,0);assert.equal(f.speech.length,0);
 f.commit('Compare these two.');
 const turn=f.lunas[0].calls[0];assert.deepEqual(turn.input.whiteboardContext.selection.targets.map(target=>target.content),['1','4']);
 turn.resolve({reply:'Compare the selected entries.',board:{title:'Hint',blocks:[{id:'hint',type:'latex',content:'1<4'}]}});
 await f.waitFor(()=>f.messages.some(message=>message.type==='canvas'),'group survives unrelated patch');
 const patch=f.messages.find(message=>message.type==='canvas');assert.deepEqual(patch.selection.targets,event.targets);
 f.client.send(JSON.stringify({type:'canvas-select',boardRevision:patch.board.revision,targets:[]}));
 const clearPong=once(f.client,'pong');f.client.ping();await clearPong;
 assert.equal(f.lunas[0].calls.length,1,'clear does not generate a turn');
 f.commit('Now explain the equation.');assert.equal(f.lunas[0].calls[1].input.whiteboardContext.selection,null);
});

test('live PCM carries alignment separately from complete generated transcript',async t=>{
  const f=await fixture(t);f.commit('Explain diffusion.');await f.waitFor(()=>f.lunas[0].calls.length===1);
  const call=f.lunas[0].calls[0];call.options.onText('Particles move down the gradient.');call.resolve({reply:'Particles move down the gradient.'});
  await f.waitFor(()=>f.messages.some(message=>message.type==='transcript'&&message.role==='assistant'&&message.final));
  const alignment={chars:['P'],startsMs:[0],durationsMs:[30]};
  f.speech[0].options.onAudio(Buffer.alloc(4800).toString('base64'),alignment);
  await f.waitFor(()=>f.messages.some(message=>message.type==='audio'));
  assert.deepEqual(f.messages.find(message=>message.type==='audio').alignment,alignment);
  assert.equal(f.messages.find(message=>message.role==='assistant'&&message.final).text,'Particles move down the gradient.');
});

test('a needed but omitted visual gets one silent recovery and opens without a second speech turn',async t=>{
  const events=[],canvasRouter={classify:async(text,context)=>({needsCanvas:context.phase==='study'&&text!=='Welcome to Biology.',source:'jev'})};
  const f=await fixture(t,{},study,true,undefined,{canvasRouter,diagnostics:{record:(_,event)=>events.push(event)}});
  f.commit('Please draw how diffusion works.');
  f.lunas[0].calls[0].resolve({reply:'Particles move from high concentration to low concentration.'});
  await f.waitFor(()=>f.lunas.some(l=>l.mode==='visual'&&l.calls.length),'silent visual recovery');
  const visual=f.lunas.find(l=>l.mode==='visual');
  assert.deepEqual(visual.calls[0].input.materials,study.materials);
  assert.equal(Object.hasOwn(visual.calls[0].input,'privateQuestionBank'),false);
  visual.calls[0].resolve({reply:'Drawing.',board:{title:'Diffusion',blocks:[{id:'gradient',type:'diagram',elements:[{type:'rect',x:5,y:20,width:25,height:30,label:'High'},{type:'arrow',x1:35,y1:35,x2:65,y2:35},{type:'rect',x:70,y:20,width:25,height:30,label:'Low'}]}]}});
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.visible),'recovered diagram displayed');
  assert.equal(f.speech.length,1,'recovery never creates TTS');
  assert.equal(f.messages.some(m=>m.text==='Drawing.'),false,'recovery text stays out of captions');
  assert.ok(events.some(e=>e.type==='whiteboard.recovery-completed'));
  assert.equal(visual.calls.length,1);
});

async function preparedRecoveryBank(t, input) {
  let batches = 0;
  const bank = createQuestionBank({ idleDelayMs: 0, organizer: { available: true, async organize(request) {
    if (batches++) throw Error('No refill needed for this fixture.');
    const questions = { easy: 'What is diffusion?', medium: 'What is a concentration gradient?', hard: 'Which direction do particles diffuse?' };
    return { questions: request.slots.map(slot => ({ slotId: slot.slotId, difficulty: slot.difficulty, question: questions[slot.difficulty], answer: 'Particles move from higher to lower concentration.', sourceIds: slot.sourceIds })) };
  } } });
  t.after(() => bank.close());
  assert.equal(bank.schedule(input, { topics: [{ title: 'Transport', summary: 'Diffusion along a concentration gradient.', sourceIds: ['notes'] }] }), true);
  const deadline = Date.now() + 1500;
  while (!bank.context(input)) {
    assert.ok(Date.now() < deadline, 'real question bank preparation completes');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return { bank, questions: bank.context(input).topics[0].questions };
}

const recoveryQuestionBoard = { title: 'Concentrations', blocks: [{ id: 'concentrations', type: 'matrix', rows: [['Higher', 'Lower']] }] };

test('silent visual recovery preserves a consumed bank question and one eligible first answer', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'luna-recovery-grade-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createMasteryStore({ path: join(directory, 'mastery.json'), shared: false });
  const start = { ...study, testId: '18e2ced5-fab7-4b23-ae07-abc99c94a122' };
  const { bank, questions } = await preparedRecoveryBank(t, start), question = questions.find(item => item.difficulty === 'hard');
  const grades = [], problems = [], consumptions = [];
  const consume = bank.consume;
  bank.consume = (...args) => { const result = consume(...args); consumptions.push(result); return result; };
  const canvasRouter = { classify: async (text, context) => ({ needsCanvas: context.phase === 'study' && text !== 'Welcome to Biology.' }) };
  const sessionHistory = { start: () => 'recovered-question', context: async () => null, problem: (_, event) => problems.push(event) };
  const f = await fixture(t, {}, start, true, bank, { masteryStore: store, sessionHistory, canvasRouter, gradeAnswerImpl: async input => { grades.push(input); return { checked: true, verdict: 'correct', unassisted: true }; } });
  f.commit('Show me a practice question.');
  f.lunas[0].calls[0].resolve({ reply: question.question });
  await f.waitFor(() => f.lunas.some(luna => luna.mode === 'visual' && luna.calls.length), 'question visual recovery');
  assert.equal(bank.context(start).topics[0].questions.some(item => item.id === question.id), false, 'the real bank slot was consumed by the spoken question');
  f.lunas.find(luna => luna.mode === 'visual').calls[0].resolve({ reply: 'Drawing.', board: recoveryQuestionBoard });
  await f.waitFor(() => f.messages.some(message => message.type === 'canvas' && message.visible), 'recovered question board');
  assert.equal(consumptions.length, 1, 'displaying the same question does not consume it twice');
  assert.equal(problems.filter(event => event.type === 'asked').length, 1);
  f.commit('From higher to lower concentration.');
  const answer = f.lunas[0].calls[1];
  assert.equal(answer.input.activeQuestion.id, question.id);
  assert.equal(answer.input.activeQuestion.attempts, 0, 'the FIFO background reservation has not committed yet');
  assert.equal(answer.input.hintContext.answerAttemptReceived, true);
  assert.equal(answer.input.activeQuestion.assisted, true, 'the captured first attempt remains marked as attempted');
  answer.resolve({ reply: 'That identifies the direction.' });
  await f.waitFor(() => f.messages.some(message => message.type === 'mastery' && message.mastery.overall === 30), 'one eligible first-attempt grade');
  assert.equal(grades.length, 1);
  assert.equal(grades[0].question.id, question.id);
  assert.ok(grades[0].conversation.some(turn => turn.content.startsWith('Shown on the whiteboard: ')), 'grading still sees the recovered visual');
  assert.equal(problems.filter(event => event.type === 'attempt').length, 1);
});

test('silent visual recovery does not track a reply containing multiple bank questions', async t => {
  const { bank, questions } = await preparedRecoveryBank(t, study);
  const f = await fixture(t, {}, study, true, bank, { canvasRouter: { classify: async (text, context) => ({ needsCanvas: context.phase === 'study' && text !== 'Welcome to Biology.' }) } });
  const reply = `${questions[0].question} ${questions[1].question}`;
  f.commit('Show me a question.');
  f.lunas[0].calls[0].resolve({ reply });
  await f.waitFor(() => f.lunas.some(luna => luna.mode === 'visual' && luna.calls.length));
  f.lunas.find(luna => luna.mode === 'visual').calls[0].resolve({ reply: 'Drawing.', board: recoveryQuestionBoard });
  await f.waitFor(() => f.messages.some(message => message.type === 'canvas' && message.visible));
  f.commit('From higher to lower concentration.');
  assert.equal(f.lunas[0].calls[1].input.activeQuestion, null, 'ambiguous multi-question replies remain untracked');
});

test('same-question restatement preserves its identity but a different untracked problem cannot inherit it', async t => {
  for (const kind of ['repeated-question', 'different-problem']) await t.test(kind, async t => {
    const { bank, questions } = await preparedRecoveryBank(t, study), question = questions.find(item => item.difficulty === 'hard');
    const intentRouter = { classify: () => ({ answerAttempt: false, requestsHelp: false, examDeadline: false }) };
    const f = await fixture(t, {}, study, true, bank, { intentRouter, canvasRouter: { classify: async (text, context) => ({ needsCanvas: context.phase === 'study' && text !== 'Welcome to Biology.' }) } });
    f.commit('Ask a practice question.');
    f.lunas[0].calls[0].resolve({ reply: question.question, board: recoveryQuestionBoard });
    await f.waitFor(() => f.messages.some(message => message.type === 'canvas' && message.visible));
    f.commit('Now show another question.');
    const reply = kind === 'repeated-question' ? question.question : 'Which organelle makes proteins?';
    f.lunas[0].calls[1].resolve({ reply, boardStatus: 'incomplete' });
    await f.waitFor(() => f.lunas.some(luna => luna.mode === 'visual' && luna.calls.length));
    f.lunas.find(luna => luna.mode === 'visual').calls[0].resolve({ reply: 'Drawing.', board: { ...recoveryQuestionBoard, mode: 'replace' } });
    await f.waitFor(() => f.messages.filter(message => message.type === 'canvas' && message.visible).length === 2);
    f.commit('My answer.');
    if (kind === 'repeated-question') assert.equal(f.lunas[0].calls[2].input.activeQuestion.id, question.id, 'exact current-question restatement retains its original identity');
    else assert.equal(f.lunas[0].calls[2].input.activeQuestion, null, 'a different untracked problem cannot inherit the old question');
  });
});

test('superseding a missing-visual recovery aborts it and rejects its late drawing',async t=>{
  const f=await fixture(t,{},study,true,undefined,{canvasRouter:{classify:async(text,c)=>({needsCanvas:c.phase==='study'&&text!=='Welcome to Biology.'})}});
  f.commit('Draw diffusion.');f.lunas[0].calls[0].resolve({reply:'Here is the diffusion diagram.'});
  await f.waitFor(()=>f.lunas.some(l=>l.mode==='visual'&&l.calls.length));
  const visual=f.lunas.find(l=>l.mode==='visual').calls[0];
  f.partial('Wait, change topic.');
  assert.equal(visual.options.signal.aborted,true);
  visual.resolve({reply:'Drawing.',board:{title:'Late',blocks:[{type:'latex',content:'x=1'}]}});
  await immediate();await immediate();
  assert.equal(f.messages.some(m=>m.type==='canvas'),false);
});

test('an unrelated visible board closes when Jev declines the proposed teaching text',async t=>{
  const scene={title:'Old equation',revision:'old',blocks:[{id:'old-equation',type:'latex',content:'x+2=5'}]};
  const canvasRouter={classify:async(text,c)=>({needsCanvas:false,shouldClose:c.phase==='study'&&text!=='Welcome to Biology.',source:'jev'})};
  const f=await fixture(t,{}, {...study,whiteboard:scene,whiteboardVisible:true},true,undefined,{canvasRouter});
  f.commit('Now explain diffusion.');f.lunas[0].calls[0].resolve({reply:'Here is diffusion.',board:{title:'Diffusion',blocks:[{type:'text',content:'How does diffusion work?'}]}});
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.visible===false),'unrelated scene hidden');
  assert.equal(f.messages.some(m=>m.type==='canvas'&&m.visible===true),false);
  assert.equal(f.lunas.some(l=>l.mode==='visual'&&l.calls.length),false);
});

test('a different concrete problem replaces the old board even if Luna mistakenly emitted a patch',async t=>{
  const scene={title:'Old equation',revision:'old',blocks:[{id:'old-equation',type:'latex',content:'x+2=5'}]};
  const f=await fixture(t,{}, {...study,whiteboard:scene,whiteboardVisible:true},true,undefined,{canvasRouter:{classify:async(_,c)=>({needsCanvas:true,shouldReplace:c.phase==='study'&&c.hasBoardUpdate})}});
  f.commit('Switch to the new problem.');f.lunas[0].calls[0].resolve({reply:'Consider this new equation.',board:{title:'New equation',mode:'patch',blocks:[{id:'new-equation',type:'latex',content:'2y=8'}]}});
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'));
  assert.deepEqual(f.messages.find(m=>m.type==='canvas').board.blocks.map(b=>b.id),['new-equation']);
});

test('an invalid model visual gets one repair even when a short spoken cue is classified verbal',async t=>{
  const f=await fixture(t,{},study,true,undefined,{canvasRouter:{classify:async()=>({needsCanvas:false})}});
  f.commit('Show the diagram.');f.lunas[0].calls[0].resolve({reply:'Consider this.',boardStatus:'incomplete'});
  await f.waitFor(()=>f.lunas.some(l=>l.mode==='visual'&&l.calls.length),'repair attempted visual');
  f.lunas.find(l=>l.mode==='visual').calls[0].resolve({reply:'Drawing.',boardStatus:'incomplete'});
  await immediate();await immediate();
  assert.equal(f.lunas.filter(l=>l.mode==='visual').length,1,'failed repair cannot loop');
  assert.equal(f.messages.some(m=>m.type==='canvas'),false,'never show invented fallback content');
});

test('a canonical question ID survives board display and produces exactly one eligible grade with original evidence',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'luna-canonical-grade-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const start={...study,testId:'18e2ced5-fab7-4b23-ae07-abc99c94a124'};
  const {bank,questions}=await preparedRecoveryBank(t,start),question=questions.find(item=>item.difficulty==='hard');
  const store=createMasteryStore({path:join(directory,'mastery.json'),shared:false}),grades=[],consumed=[];
  const consumeById=bank.consumeById;bank.consumeById=(...args)=>{const result=consumeById(...args);consumed.push(result);return result;};
  const f=await fixture(t,{},start,true,bank,{canvasRouter:{classify:async()=>({needsCanvas:true,candidateMatchesQuestion:true})},masteryStore:store,gradeAnswerImpl:async input=>{grades.push(input);return {checked:true,verdict:'correct',unassisted:true};}});
  f.commit('Ask me a practice question.');
  const call=f.lunas[0].calls[0];
  assert.equal(call.options.resolveQuestion(question.id),question.question);
  assert.equal(call.options.resolveQuestion('unknown'),null);
  call.resolve({reply:question.question,questionId:question.id,board:{title:'Unknown concentration',blocks:[{id:'unknown',type:'latex',content:'x = ?'}]}});
  await f.waitFor(()=>f.messages.some(message=>message.type==='canvas'&&message.visible));
  assert.equal(consumed.length,1);assert.equal(consumed[0][0].id,question.id);
  assert.equal(call.options.resolveQuestion(question.id),question.question,'only the current consumed question remains available for faithful restatement');
  f.commit('From higher to lower concentration.');
  const answer=f.lunas[0].calls[1];assert.equal(answer.input.activeQuestion.id,question.id);
  answer.resolve({reply:'That identifies the direction.'});
  await f.waitFor(()=>f.messages.some(message=>message.type==='mastery'&&message.mastery.overall===30));
  assert.equal(grades.length,1);assert.equal(grades[0].question.id,question.id);
  assert.deepEqual(grades[0].materials,start.materials);
  assert.ok(grades[0].conversation.some(turn=>turn.content.startsWith('Shown on the whiteboard:')));
});

test('Jev-approved biology definitions appear as teaching text and remain public evidence',async t=>{
 const decisions=[],canvasRouter={classify:async(text,context)=>{decisions.push({text,context});return{needsCanvas:context.candidateTextOnly===true,source:'jev'};}};
 const f=await fixture(t,{},study,true,undefined,{canvasRouter});
 const content='Diffusion\nNet movement of particles from higher to lower concentration.';
 f.commit('Write the definition so I can refer to it.');
 f.lunas[0].calls[0].resolve({reply:'Keep this definition in view as we compare examples.',board:{title:'Diffusion',blocks:[{id:'definition',type:'text',content}]}});
 await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.visible),'written definition');
 assert.equal(f.messages.find(m=>m.type==='canvas').board.blocks[0].content,content);
 assert.ok(decisions.some(d=>d.context.candidateTextOnly&&d.context.hasBoardUpdate&&d.text.includes(content)),'Jev sees the proposed written teaching');
 f.commit('Give an example.');
 const conversation=completeTutorConversation(f.lunas[0].calls[1].input);
 assert.ok(conversation.some(turn=>turn.content===`Shown on the whiteboard: ${content}`),'written help is retained as public evidence');
});

test('algebra written steps can be text and preserve teaching questions with annotations',async t=>{
 const algebra={...study,title:'Algebra',materials:[{id:'notes',name:'Algebra notes',text:'To solve 2x+4=10, subtract4 from both sides to get2x=6, then divide both sides by2 to getx=3.'}]};
 const canvasRouter={classify:async(_,context)=>({needsCanvas:context.candidateTextOnly===true,source:'jev'})};
 const f=await fixture(t,{},algebra,true,undefined,{canvasRouter});
 const content='Why keep both sides equal?\n1. Subtract4 from both sides:2x=6.\n2. Divide both sides by2:x=3.';
 f.commit('Show the full worked explanation in writing.');
 f.lunas[0].calls[0].resolve({reply:'Apply the same operation to both sides at each step.',board:{title:'Worked equation',blocks:[{id:'steps',type:'text',content}]}});
 await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.visible),'written steps');
 assert.equal(f.messages.find(m=>m.type==='canvas').board.blocks[0].content,content,'a question mark does not discard an annotated teaching block');
});

test('pure teaching text requires Jev approval and conversational prose stays hidden',async t=>{
 for(const content of ['Diffusion moves down the concentration gradient.','Welcome back.','Your exam is next week.']) {
  const f=await fixture(t,{},study,true,undefined,{canvasRouter:{classify:async()=>({needsCanvas:false,source:'jev'})}});
  f.commit('Continue.');f.lunas[0].calls[0].resolve({reply:'Let us continue.',board:{title:'Notes',blocks:[{id:'note',type:'text',content}]}});
  await f.waitFor(()=>f.messages.some(m=>m.final&&m.text==='Let us continue.'));
  await immediate();assert.equal(f.messages.some(m=>m.type==='canvas'),false,content);
 }
});

test('scene objects containing only text use Jev gating and cannot bypass duplicate-question suppression',async t=>{
 const textScene=content=>({id:'notes',type:'scene',width:800,height:500,objects:[{id:'writing',type:'text',x:40,y:40,width:600,height:120,text:content}]});
 for(const [content,approved,expected] of [['Diffusion moves down the concentration gradient.',false,false],['Diffusion moves down the concentration gradient.',true,true],['Which direction does diffusion follow?',true,false]]){
  const decisions=[],f=await fixture(t,{},study,true,undefined,{canvasRouter:{classify:async(text,context)=>{decisions.push({text,context});return{needsCanvas:approved,source:'jev'};}}});
  const reply=content.endsWith('?')?content:'Keep this definition in view.';
  f.commit('Write the definition.');f.lunas[0].calls[0].resolve({reply,board:{title:'Written teaching',blocks:[textScene(content)]}});
  await f.waitFor(()=>f.messages.some(m=>m.final&&m.text===reply));await immediate();
  assert.equal(f.messages.some(m=>m.type==='canvas'&&m.visible),expected,content);
  if(!content.endsWith('?'))assert.ok(decisions.some(d=>d.context.candidateTextOnly&&d.text.includes(content)));
 }
});

test('scene deletion patches apply without Jev approval, preserve hidden state, and clear the last object',async t=>{
 const a={id:'a',type:'ellipse',x:40,y:40,width:100,height:80,label:'A'},b={id:'b',type:'ellipse',x:200,y:40,width:100,height:80,label:'B'};
 for(const visible of [true,false]){
  const scene={title:'Teaching scene',revision:'initial',blocks:[{id:'lesson',type:'scene',width:800,height:500,objects:[a,b]}]};
  const f=await fixture(t,{}, {...study,whiteboard:scene,whiteboardVisible:visible},true,undefined,{canvasRouter:{classify:async()=>({needsCanvas:false,source:'jev'})}});
  f.commit('Remove A.');f.lunas[0].calls[0].resolve({reply:'Removed.',board:{title:'Teaching scene',blocks:[{id:'lesson',type:'scene',width:800,height:500,objects:[],removedObjectIds:['a']}]}});
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.board?.blocks[0]?.objects.length===1));
  const partial=f.messages.find(m=>m.type==='canvas'&&m.board?.blocks[0]?.objects.length===1);assert.equal(partial.visible,visible);assert.equal(partial.board.blocks[0].objects[0].id,'b');
  f.commit('Remove B too.');f.lunas[0].calls[1].resolve({reply:'Cleared.',board:{title:'Teaching scene',blocks:[{id:'lesson',type:'scene',width:800,height:500,objects:[],removedObjectIds:['b']}]}});
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.board===null));
  const cleared=f.messages.find(m=>m.type==='canvas'&&m.board===null);assert.equal(cleared.visible,false);assert.equal(cleared.selection,null);
  assert.equal(f.lunas.some(l=>l.mode==='visual'),false,'deletion does not trigger a recovery redraw');
  f.commit('Continue in voice.');assert.equal(f.lunas[0].calls[2].input.whiteboardContext,undefined,'cleared scene cannot reopen later');
 }
});

test('whole-board replacements and block-only removals clear visible boards without recovery',async t=>{
 for(const update of [{title:'Clear',mode:'replace',blocks:[]},{title:'Clear',blocks:[],removedIds:['equation']}]){
  const scene={title:'Equation',revision:'saved',blocks:[{id:'equation',type:'latex',content:'x+2=5'}]};
  const f=await fixture(t,{}, {...study,whiteboard:scene,whiteboardVisible:true},true,undefined,{canvasRouter:{classify:async()=>({needsCanvas:false})}});
  f.commit('Clear the board.');f.lunas[0].calls[0].resolve({reply:'Cleared.',board:update});
  await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.board===null));
  assert.equal(f.messages.find(m=>m.type==='canvas').visible,false);assert.equal(f.lunas.some(l=>l.mode==='visual'),false);
 }
});

test('scene deletion and duplicate-only suppression preserve legacy exact spoken question tracking',async t=>{
 const question={id:'public-question',question:'Which direction does diffusion follow?',topicId:'transport',topicTitle:'Transport',difficulty:'easy',sourceIds:['notes'],answer:'From higher to lower concentration.'};
 for(const duplicate of [false,true]){
  let used=false;const bank={context:()=>({topics:[]}),consume(_,reply){if(!used&&reply.includes(question.question)){used=true;return[question];}return[];}};
  const f=await fixture(t,{},study,true,bank,{canvasRouter:{classify:async()=>({needsCanvas:duplicate,source:'jev',continuesWorkingProblem:true})}});
  const object=duplicate?{id:'question',type:'text',x:40,y:40,width:600,height:100,text:question.question}:{id:'shape',type:'ellipse',x:40,y:40,width:100,height:80,label:'Concentration'};
  f.commit('Ask me a question.');f.lunas[0].calls[0].resolve({reply:question.question,board:{title:'Current problem',blocks:[{id:'lesson',type:'scene',width:800,height:500,objects:[object]}]}});
  await f.waitFor(()=>f.messages.some(m=>m.final&&m.text===question.question));await immediate();
  if(!duplicate){
    await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.visible));
    f.commit('Remove the diagram but keep the question.');f.lunas[0].calls[1].resolve({reply:'We can continue aloud.',board:{title:'Current problem',blocks:[{id:'lesson',type:'scene',width:800,height:500,objects:[],removedObjectIds:['shape']}]}});
    await f.waitFor(()=>f.messages.some(m=>m.type==='canvas'&&m.board===null));
  }
  f.commit('Repeat the question.');assert.equal(f.lunas[0].calls.at(-1).input.workingProblem.id,question.id);
 }
});
