// Loopback integrated tutor evaluation. No microphone, speakers, or paid voice.
// Default is a completely offline harness self-check. --live explicitly enables
// bounded paid OpenAI and Jev requests; credentials are read only from the env.
// node --env-file-if-exists=.env benchmarks/tutor-context-scenarios.mjs --live \
//   --max-requests=48
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import {resolveGradeCitations} from '../server/grade-citations.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const LIVE = process.argv.includes('--live');
const BASELINE = path.resolve(option('baseline') || path.join(ROOT, 'benchmarks/baselines/tutor-before-retrieval'));
const MAX_REQUESTS = Math.max(1, Math.min(70, Number(option('max-requests')) || 48));
const MAX_PROVIDER_REQUESTS = { openai: Math.max(1, Math.min(30, Number(option('max-openai')) || 24)), jev: Math.max(1, Math.min(40, Number(option('max-jev')) || 24)) };
const ROUNDS = Math.max(1, Math.min(3, Math.floor(Number(option('rounds')) || 1)));
const PRODUCTION_BANK = process.argv.includes('--production-bank');
const REAL_GRADING = process.argv.includes('--real-grading');
const REAL_INTENT = process.argv.includes('--real-intent');
const ANSWER_VARIANT = option('answer-variant') || 'concise';
if(!['concise','reasoned'].includes(ANSWER_VARIANT))throw Error('Unknown answer fixture variant');
const followUpAnswer=ANSWER_VARIANT==='reasoned'
  ? 'My answer is eight. In a strict Nash equilibrium each player has a unique best response to the other player’s strategy. Two equilibria cannot share a column, because that would require two distinct strict best-response rows against the same column; similarly they cannot share a row. Thus there can be at most eight, since there are only eight rows. To attain eight, put payoff (1,1) in cells (i,i) for i from one through eight and (0,0) in every other cell, including columns nine and ten. At each of those eight diagonal cells either player loses payoff by deviating alone, so all eight are strict equilibria.'
  : 'My answer is eight: strict equilibria cannot share a row or column, and eight disjoint pairs can attain it.';
const TIMEOUT = 40000;
const OUTPUT = path.resolve(option('output') || path.join(ROOT, 'benchmarks', LIVE ? 'tutor-context-results.json' : 'tutor-context-dry-run.json'));
const fixture = JSON.parse(await readFile(new URL('./tutor-context-fixture.json', import.meta.url), 'utf8'));
const material = { id: 'econ2801-pset3', name: fixture.source.name, text: fixture.pages.map(page => `[PDF page ${page.page}]\n${page.text}`).join('\n\n') };
const materials = [material, ...fixture.additionalSources.filter(source => ['econ2801-pset2-solutions', 'econ2801-pset5-solutions'].includes(source.id)).map(source => ({ id: source.id, name: source.name, text: source.pages.map(page => `[PDF page ${page.page}]\n${page.text}`).join('\n\n') }))];
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const round = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = text => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const q6 = 'In an 8-by-10 two-player normal-form game, what is the maximum number of strict Nash equilibria?';
const referenceAnswer = 'The maximum is eight. Two strict Nash equilibria cannot share a row or column, and eight distinct row-column pairs can attain the bound.';
const questions = [
  ['q1', 'Three-player payoff games', 'What are the payoffs when player 1 chooses U, player 2 chooses R, and player 3 chooses B?', 'The payoffs are (1, 6, 1).'],
  ['q2', 'Traveler’s Dilemma', 'What payoff does a utilitarian player maximize in Problem Set 3 question 2?', 'The sum of the payoffs received by both players.'],
  ['q3', 'Cinema coordination', 'In Case I of the cinema game, what payoff does each friend receive if all three meet?', 'Each receives two utils.'],
  ['q4', 'Spatial competition', 'What are the endpoints of the straight-line city in question 4?', 'Zero and one.'],
  ['q5', 'Two-player payoff games', 'What is the payoff pair at U and L in question 5?', 'The payoff pair is (8, 8).'],
  ['q6', 'Strict Nash equilibria', q6, referenceAnswer],
].map(([id, topicTitle, question, answer]) => ({ id, topicId: `topic-${id}`, topicTitle, question, answer, difficulty: 'medium', sourceIds: [material.id] }));
const topics = questions.map(q => ({ title: q.topicTitle, summary: `Problem Set 3 ${q.id}.`, sourceIds: q.sourceIds }));
const blankBoard = { title: 'Question 6: 8-by-10 game', mode: 'replace', blocks: [{ id: 'q6-grid', type: 'matrix', rows: Array.from({ length: 8 }, () => Array(10).fill('')), rowLabels: Array.from({ length: 8 }, (_, i) => `r${i + 1}`), columnLabels: Array.from({ length: 10 }, (_, i) => `c${i + 1}`) }] };
const staleBoard = { title: 'Question 1: player 3 chooses B', revision: 'fixture-stale-q1', blocks: [{ id: 'old-q1-payoffs', type: 'matrix', rows: fixture.verified.q1.B, rowLabels: ['U', 'D'], columnLabels: ['L', 'R'] }] };
const cityBoard = { title: 'Question 4: trial vendor positions', mode: 'replace', blocks: [{ id: 'city-trial', type: 'diagram', elements: [{ type: 'line', x1: 10, y1: 50, x2: 90, y2: 50 }, { type: 'text', x: 10, y: 65, text: '0' }, { type: 'text', x: 90, y: 65, text: '1' }, { type: 'circle', x: 26, y: 50, r: 2, label: 'A: 0.2' }, { type: 'circle', x: 74, y: 50, r: 2, label: 'B: 0.8' }] }] };
const scenarios = [
  { id: 'source-payoff', prompt: 'In Problem Set 3 question 1, player 1 chooses U, player 2 chooses R, and player 3 chooses B. Read me their three payoffs in player order. Voice only; do not solve the equilibria.', reply: 'Their payoffs are one, six, and one, in player order.', visual: false },
  { id: 'blank-grid', prompt: 'Ask me the queued question about the maximum number of strict Nash equilibria in an 8-by-10 game, exactly as written. Show a blank 8-row, 10-column grid. Do not fill in payoffs, mark equilibrium cells, or reveal the answer yet.', reply: q6, board: blankBoard, visual: true, grade: true },
  { id: 'scene-switch', prompt: 'We are finished with question 1. Remove its payoff matrix from view and switch to question 4. Show only the line city from 0 to 1, with vendor A at 0.2 and B at 0.8 as trial positions. Do not solve for an equilibrium.', reply: 'Here is question four’s city, with your two trial positions.', board: cityBoard, visual: true, stale: true },
  { id: 'answer-feedback', prompt: 'My answer is eight. Strict equilibria cannot share a row or column, and eight disjoint pairs can attain it. Is my argument right?', reply: 'Yes. Each strict equilibrium must occupy a different row and column, so eight is the attainable maximum.', visual: false, primeQuestion: true },
].filter(scenario => !option('scenario') || scenario.id === option('scenario'));
const priming = [
  ['I want practice without answer spoilers. Please keep the source question’s exact numbers.', 'I will preserve the source values and wait for your attempt.'],
  ['Our source is the game theory problem set numbered three.', 'We are working from Problem Set 3.'],
  ['Use a visual only when it helps the current problem.', 'I will use the board for the active visual problem.'],
  ['Do not repeat onboarding or ask for the current date.', 'We can continue directly with the material.'],
  ['Please keep the question bank available, but ask only one question at a time.', 'I will ask one question at a time.'],
];
const conditions = [
  { id: 'before-luna', root: BASELINE, model: 'gpt-6-luna' },
  { id: 'after-luna', root: ROOT, model: 'gpt-6-luna' },
  { id: 'after-terra', root: ROOT, model: 'gpt-5.6-terra' },
].filter(c => !option('condition') || option('condition').split(',').includes(c.id));
const report = {
  version: 2, startedAt: new Date().toISOString(), liveProviders: LIVE, baseline: BASELINE, rounds: ROUNDS, answerVariant:ANSWER_VARIANT, followUpAnswer, productionBank: PRODUCTION_BANK, realGrading: REAL_GRADING, realStudentIntent: REAL_INTENT,
  source: { name: fixture.source.name, sha256: fixture.source.sha256, pages: fixture.source.pages, materialTextSha256: sha(material.text), corpus: materials.map(m => ({ id: m.id, name: m.name, characters: m.text.length, textSha256: sha(m.text) })), totalCharacters: materials.reduce((sum, m) => sum + m.text.length, 0) },
  budget: { maxPaidHttpRequests: MAX_REQUESTS, maxPerProvider: MAX_PROVIDER_REQUESTS, used: 0, openai: 0, jev: 0 },
  boundaries: [
    'Real loopback WebSocket client and selected production attachLiveVoice/adapter; live mode uses real OpenAI plus Jev retrieval and canvas decisions.',
    'ElevenLabs STT is simulated using exact committed_transcript messages. A synthetic 100 ms delay produces counted silent PCM output; no microphone, speaker, voice provider, or audio file is used.',
    `Greeting/history priming and tutor mastery-notice intent remain fixtures. Student intent is ${REAL_INTENT ? 'the production Jev classifier' : 'simulated'}; grade verdicts are ${REAL_GRADING ? 'production checkedGrade with two independent Luna source-grounded requests' : 'simulated'}. No claims about STT accuracy.`,
    'Synthetic audio latency is pipeline timing plus the fixed fixture delay, not an estimate or measurement of ElevenLabs latency.',
    `${ROUNDS} trial(s) per source scenario/condition in fixed round → scenario → condition order; this is a small integrated case study, not a production percentile or counterbalanced experiment.`,
    PRODUCTION_BANK ? 'Question preparation is a deterministic fixture, but bank storage, revision, public resolution, exact consumption, and active-question grading eligibility use the production bank implementation.' : 'Question-bank storage and exact-string consumption are simulated fixtures.',
    'No provider dollars are fabricated; reported token counts and billed dollars remain separate.',
  ], conditions: [], runs: [],
};
let active = null;
const originalFetch = globalThis.fetch;

function fixtureResponse(payload, record) {
  if (payload.questions) return Response.json({ model: 'simulated-jev', answers: Object.fromEntries(Object.keys(payload.questions).map(key => [key, { type: 'noul', noul: key === 'needs_canvas' ? Number(Boolean(record?.scenario.visual && !record?.followUp)) : key === 'replace_canvas' ? Number(Boolean(record?.scenario.stale)) : key === 'answer_attempt' ? Number(Boolean(payload.state?.student_utterance?.startsWith('My answer is') && payload.state?.active_question)) : key.startsWith('c_') ? 1 : 0 }])), usage: {} });
  if (payload.text?.format?.type === 'json_schema') {
    const input = JSON.parse(payload.input), q = input.question;
    const grade = { questionId: q.id, topicId: q.topicId, sourceIds: q.sourceIds, verdict: 'correct', reasoningSufficient: true, assistanceUsed: false, ...(input.answerExcerpts?{answerCitationIds:[input.answerExcerpts[0].id],sourceCitationIds:input.materials.map(source=>source.excerpts[0].id)}:{answerQuotes: [input.studentAnswer], sourceQuotes: q.sourceIds.map(id => ({ sourceId: id, quote: input.materials.find(m => m.id === id).text.slice(0, 80) }))}) };
    return Response.json({ status: 'completed', model: payload.model, usage: { input_tokens: 100, output_tokens: 100 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(grade) }] }] });
  }
  const scenario = record?.scenario || scenarios[0];
  const omitForRecoveryCheck = process.argv.includes('--simulate-recovery') && record?.rendererMode !== 'visual';
  const spoken = record?.followUp ? '<say>Yes. Eight is the maximum because strict equilibria cannot share a row or column.</say>' : PRODUCTION_BANK && scenario.id === 'blank-grid' && record?.rendererMode !== 'visual' ? `<ask>${record.canonicalQuestionId}</ask>` : `<say>${scenario.reply}</say>`;
  const output = `${spoken}${scenario.board && !omitForRecoveryCheck && !record?.followUp ? `<board>${JSON.stringify(scenario.board)}</board>` : ''}`;
  const completed = { status: 'completed', model: payload.model, service_tier: 'default', usage: { input_tokens: 100, output_tokens: 100, output_tokens_details: { reasoning_tokens: 0 }, input_tokens_details: { cached_tokens: 0 } }, output: [{ type: 'message', content: [{ type: 'output_text', text: output }] }] };
  return new Response(new ReadableStream({ start(controller) { for (const event of [{ type: 'response.output_text.delta', delta: output }, { type: 'response.completed', response: completed }]) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
function contextSummary(payload) {
  let input;
  try { input = typeof payload.input === 'string' ? JSON.parse(payload.input) : null; } catch { /* Tool rounds can have message arrays. */ }
  if (!input) return { toolRound: true, inputBytes: Buffer.byteLength(JSON.stringify(payload.input)), toolResults: (Array.isArray(payload.input) ? payload.input : []).filter(item => item.type === 'function_call_output').map(item => { try { const value = JSON.parse(item.output); const sources = value.materials || value.passages?.map(p => ({ id: p.sourceId, text: p.text })) || []; return { sourceIds: [...new Set(sources.map(m => m.id))], sourceCharacters: sources.reduce((n, m) => n + m.text.length, 0), evidence: evidenceChecks(sources), status: value.retrievalStatus?.status, errorCode: value.error?.code }; } catch { return { invalid: true }; } }) };
  const bank = input.privateQuestionBank?.topics?.flatMap(topic => topic.questions || []) || [];
  const serialized = JSON.stringify(input);
  return { inputBytes: Buffer.byteLength(serialized), instructionBytes: Buffer.byteLength(payload.instructions || ''), inputKeys: Object.keys(input), conversationTurns: input.conversation?.length, conversationMemory: input.conversationMemory ? { totalEntries: input.conversationMemory.totalEntries, earlierTurns: input.conversationMemory.earlierTurns?.length, omittedPublicTurns: input.conversationMemory.omittedPublicTurns } : null, bankQuestionIds: bank.map(q => q.id), bankSha256: sha(input.privateQuestionBank || null), materialIds: input.materials?.map(item => item.id), materialChars: input.materials?.reduce((sum, item) => sum + (item.text?.length || item.excerpts?.reduce((n,p)=>n+p.text.length,0)||0), 0), evidence: evidenceChecks(input.materials), includesEarlyPreference: serialized.includes(priming[0][0]), activeQuestion: input.activeQuestion ? { id: input.activeQuestion.id, hasAnswer: Object.hasOwn(input.activeQuestion, 'answer'), attempts: input.activeQuestion.attempts, assisted: input.activeQuestion.assisted } : null, retrievalStatus: input.retrievalStatus || null, tools: (payload.tools || []).map(tool => tool.name) };
}
function evidenceChecks(sources = []) {
  const original = sources.filter(source => source.id === material.id).map(source => source.text||source.excerpts?.map(item=>item.text).join('')||'').join('\n');
  return { 'source-payoff': /1,\s*6,\s*1/.test(original), 'blank-grid': /8 strategies/.test(original) && /10 strategies/.test(original), 'scene-switch': /straight-line city/.test(original) && /point 0 to point 1/.test(original), 'answer-feedback': /8 strategies/.test(original) && /10 strategies/.test(original) };
}
function cityGeometry(board) {
  const elements = board?.blocks.filter(block => block.type === 'diagram').flatMap(block => block.elements) || [];
  const line = elements.find(item => item.type === 'line' && Math.abs(item.y2 - item.y1) < 1 && item.x2 - item.x1 > 50);
  const a = elements.find(item => item.type === 'circle' && /^A(?:\b|:)/.test(item.label || ''));
  const b = elements.find(item => item.type === 'circle' && /^B(?:\b|:)/.test(item.label || ''));
  const labels = elements.flatMap(item => [item.text || '', item.label || '']).join(' ');
  return Boolean(line && a && b && Math.abs((a.x - line.x1) / (line.x2 - line.x1) - .2) < .02 && Math.abs((b.x - line.x1) / (line.x2 - line.x1) - .8) < .02 && /\b0\b/.test(labels) && /\b1\b/.test(labels));
}
globalThis.fetch = async (url, init = {}) => {
  const target = String(url), isOpenAI = target === 'https://api.openai.com/v1/responses', isJev = target === 'https://api.typesafe.ai/v1/systemone';
  if (!isOpenAI && !isJev) throw Object.assign(new Error('Benchmark disallows unexpected destination'), { status: 400 });
  const payload = JSON.parse(init.body || '{}');
  if (!active?.measuring && !active?.followUp) return fixtureResponse(payload, active);
  const request = { provider: isOpenAI ? 'openai' : 'jev', model: payload.model, phase: active.followUp ? 'answer-follow-up' : 'scenario', startedMs: round(performance.now() - active.began), status: null, kind: isOpenAI ? (payload.text?.format?.type === 'json_schema' ? 'grading' : active.rendererMode === 'visual' ? 'recovery' : 'main-or-tool') : payload.questions?.needs_canvas ? 'canvas' : payload.questions?.answer_attempt ? 'student-intent' : 'prefetch', ...(isOpenAI ? { context: contextSummary(payload) } : { questions: Object.keys(payload.questions || {}).length }) };
  active.requests.push(request);
  if (!LIVE) { request.simulated = true; request.status = 200; if (isJev && process.argv.includes('--simulate-recovery')) await sleep(120); return fixtureResponse(payload, active); }
  if (report.budget.used >= MAX_REQUESTS || report.budget[request.provider] >= MAX_PROVIDER_REQUESTS[request.provider]) { request.blockedByBudget = true; throw Object.assign(new Error('Benchmark request budget reached'), { status: 429 }); }
  report.budget.used++; report.budget[request.provider]++;
  try { const response = await originalFetch(target, { ...init, redirect: 'error', signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(TIMEOUT)]) }); request.status = response.status; request.headersMs = round(performance.now() - active.began); return response; }
  catch (error) { request.failure = { status: Number.isInteger(error?.status) ? error.status : null, code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(error.code) ? error.code : 'NETWORK_OR_ABORT' }; throw error; }
};

async function run(condition, scenario, trialRound = 1) {
  const moduleUrl = relative => pathToFileURL(path.join(condition.root, relative)).href;
  const [{ attachLiveVoice }, { createOpenAILuna, createOpenAIOrganizer }, { createJevCanvasRouter }, { createMasteryStore, checkedGrade, validateGrade }] = await Promise.all(['server/live-voice.mjs', 'server/openai-luna.mjs', 'server/jev.mjs', 'server/mastery.mjs'].map(file => import(moduleUrl(file))));
  const work = await mkdtemp(path.join(tmpdir(), 'luna-context-trial-'));
  const changed = new EventEmitter(), messages = [], diagnosticEvents = [], meters = [], gradeCalls = [], recordedGrades = [], capturedInputs = [], consumed = new Set();
  const notify = () => changed.emit('change');
  const record = { condition: condition.id, model: condition.model, backgroundModel: 'gpt-6-luna', scenario: scenario.id, round: trialRound, status: 'pending', requests: [], modelResults: [], intentDecisions: [], gradeChecks: [], latencies: {}, checks: {}, bankInputExpectedIds: questions.map(q => q.id), gradeFixture: { eligibleCalls: 0 }, voiceSimulated: true };
  const trial = { scenario, measuring: false, requests: record.requests, began: performance.now(), rendererMode: 'voice' };
  active = trial;
  const waitFor = (predicate, description, timeout = TIMEOUT) => {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => { const check = () => { if (predicate()) { clearTimeout(timer); changed.off('change', check); resolve(); } }; const timer = setTimeout(() => { changed.off('change', check); reject(Object.assign(new Error(description), { code: 'HARNESS_TIMEOUT' })); }, timeout); changed.on('change', check); check(); });
  };
  let stt, seededReply = null, measuredModelCalls = 0, pendingResponders = 0, pendingRouting = 0, pendingGrades = 0;
  const env = { ...process.env, LIVE_APIS: 'true', LUNA_ORGANIZER: 'openai-api', LUNA_API_MODEL: 'gpt-6-luna', LUNA_TUTOR_MODEL: condition.model, LUNA_VOICE_PLANNER: 'false', ELEVENLABS_API_KEY: 'simulated-no-network', OPENAI_API_KEY: LIVE ? process.env.OPENAI_API_KEY : 'simulated-no-network', TYPESAFE_API_KEY: LIVE ? process.env.TYPESAFE_API_KEY : 'simulated-no-network' };
  class FakeStt extends EventEmitter {
    static OPEN = 1;
    constructor() { super(); stt = this; this.readyState = 1; this.bufferedAmount = 0; queueMicrotask(() => this.receive({ message_type: 'session_started' })); }
    receive(value) { this.emit('message', Buffer.from(JSON.stringify(value))); }
    send(_, callback) { callback?.(); }
    terminate() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  }
  function createSpeechStreamImpl(options) {
    let canceled = false, pending = null, characters = 0, delivered = false;
    const finishUsage = status => options.onUsage?.({ status, units: { characters, audioOutputMs: delivered ? 10 : 0 } });
    return { write(text) { characters += text.length; if (!pending) pending = new Promise(resolve => setTimeout(() => { if (!canceled) { delivered = true; options.onAudio(Buffer.alloc(480).toString('base64')); } resolve(); }, 100)); }, finish() { void Promise.resolve(pending).then(() => { if (!canceled) { finishUsage('completed'); options.onEnd(); } }); }, cancel() { canceled = true; finishUsage('canceled'); } };
  }
  function createLunaFastImpl(options) {
    const actual = createOpenAILuna({ ...options, fetchImpl: globalThis.fetch });
    return { ...actual, async respond(input, callOptions) {
      capturedInputs.push({ mode: options.mode || 'voice', measuring: trial.measuring, bankSha256: sha(input.privateQuestionBank || null), fullHistory: structuredClone(input.conversation || []), materials: structuredClone(input.materials || []) });
      if ((!trial.measuring && !trial.followUp) || input.readinessContext?.trigger === 'session-start') { const reply = seededReply || 'Ready for your next source question.'; callOptions.onText?.(reply); callOptions.onSpeechEnd?.(); return { reply }; }
      pendingResponders++; measuredModelCalls++; trial.rendererMode = options.mode || 'voice';
      try { const result = await actual.respond(input, { ...callOptions, timeoutMs: TIMEOUT }); record.modelResults.push({ mode: options.mode || 'voice', questionId: result.questionId || null, canonicalReply: result.reply }); return result; }
      finally { pendingResponders--; notify(); }
    } };
  }
  const usageLedger = { start(testId, metadata) { const event = { ...metadata, testId, status: 'pending', units: {}, providerReportedUsd: null }; if (trial.measuring || trial.followUp) meters.push(event); return { update(data = {}) { Object.assign(event.units, data.units); if (data.model) event.model = data.model; if (data.serviceTier) event.serviceTier = data.serviceTier; if (Number.isFinite(data.providerReportedUsd)) event.providerReportedUsd = data.providerReportedUsd; }, finish(data = {}) { this.update(data); event.status = data.status || 'completed'; notify(); } }; } };
  const realCanvas = createJevCanvasRouter({ env, fetchImpl: globalThis.fetch, usageLedger });
  const { createJevIntentRouter } = await import(moduleUrl('server/jev-intent.mjs'));
  const realIntent = createJevIntentRouter({ env, fetchImpl: globalThis.fetch, usageLedger });
  const gradeOrganizer = createOpenAIOrganizer({ env, fetchImpl: globalThis.fetch, usageLedger });
  const actualOrganizeGrade = gradeOrganizer.organize.bind(gradeOrganizer);
  gradeOrganizer.organize = async (input, options) => {
    const value = await actualOrganizeGrade(input, options);
    // Preserve diagnostic verdict fields and local validation only, never raw
    // provider errors, headers, source passages, or hidden reasoning.
    const resolved=input.answerExcerpts?resolveGradeCitations(value,{answerExcerpts:input.answerExcerpts,materials:input.materials}):{grade:value,reason:null};
    record.gradeChecks.push({ citationProtocol:Boolean(input.answerExcerpts),citationIssue:resolved.reason,answerCitationIds:value.answerCitationIds,sourceCitationIds:value.sourceCitationIds,questionId: value.questionId, verdict: value.verdict, reasoningSufficient: value.reasoningSufficient, assistanceUsed: value.assistanceUsed, evidenceValidated: Boolean(validateGrade(resolved.grade, input.question, input.studentAnswer, materials)) });
    return value;
  };
  const bankInput = { testId: randomUUID(), title: 'ECON 2801 Game Theory: Problem Set 3', materials };
  let bank = { setForegroundBusy() {}, schedule() {}, discard() {}, topics: () => questions.map(q => ({ id: q.topicId, title: q.topicTitle })), context: () => ({ topics: questions.filter(q => !consumed.has(q.id)).map(q => ({ topicId: q.topicId, title: q.topicTitle, questions: [structuredClone(q)] })) }), consume(_, reply) { const asked = questions.filter(q => !consumed.has(q.id) && normalize(reply).includes(normalize(q.question))); for (const q of asked) consumed.add(q.id); return asked; } };
  if (PRODUCTION_BANK) {
    const { createQuestionBank } = await import(moduleUrl('server/question-bank.mjs'));
    const preparation = { available: true, async organize(input) { return { questions: input.slots.map(slot => {
      const q = questions.find(item => item.topicTitle === slot.topicTitle);
      return { slotId: slot.slotId, difficulty: slot.difficulty, question: slot.difficulty === 'medium' ? q.question : `${q.question.slice(0, -1)} (${slot.difficulty} source exercise)?`, answer: q.answer, sourceIds: q.sourceIds };
    }) }; } };
    bank = createQuestionBank({ organizer: preparation, idleDelayMs: 0, batchSize: 12, maxContextChars: 24000 });
    assert.equal(bank.schedule(bankInput, { topics }), true);
    const until = performance.now() + 2000;
    while ((bank.context(bankInput)?.topics.flatMap(topic => topic.questions).length || 0) < 18) {
      if (performance.now() > until) throw Object.assign(new Error('Fixture bank preparation timeout'), { code: 'BANK_FIXTURE_TIMEOUT' });
      await sleep(5);
    }
    preparation.available = false;
    for (const q of bank.context(bankInput).topics.flatMap(topic => topic.questions).filter(q => q.difficulty !== 'medium')) assert.equal(bank.consumeById(bankInput, q.id, q.question).length, 1);
    const pending = bank.context(bankInput).topics.flatMap(topic => topic.questions);
    record.bankInputExpectedIds = pending.map(q => q.id);
    record.questionIdentity = { canonicalQuestionId: pending.find(q => q.question === q6)?.id, canonicalQuestion: q6, resolved: [], consumed: [] };
    trial.canonicalQuestionId = record.questionIdentity.canonicalQuestionId;
    const resolve = bank.resolve.bind(bank), consumeById = bank.consumeById.bind(bank), consume = bank.consume.bind(bank);
    bank.resolve = (...args) => { const value = resolve(...args); if (trial.measuring) record.questionIdentity.resolved.push({ id: args[1], found: Boolean(value), canonicalQuestion: value?.question, privateAnswerExposed: Boolean(value && Object.hasOwn(value, 'answer')) }); return value; };
    bank.consumeById = (...args) => { const value = consumeById(...args); if (trial.measuring) record.questionIdentity.consumed.push({ method: 'id', requestedId: args[1], consumedIds: value.map(q => q.id), canonicalSpeechPresent: value.every(q => normalize(args[2]).includes(normalize(q.question))) }); return value; };
    bank.consume = (...args) => { const value = consume(...args); if (trial.measuring) record.questionIdentity.consumed.push({ method: 'legacy-exact', consumedIds: value.map(q => q.id) }); return value; };
  }
  const masteryStore = createMasteryStore({ path: path.join(work, 'mastery.json'), shared: false });
  const originalRecord = masteryStore.record.bind(masteryStore);
  masteryStore.record = async (...args) => { recordedGrades.push(args[1]); return originalRecord(...args); };
  const server = createServer((_, response) => { response.writeHead(404); response.end(); });
  const pipeline = attachLiveVoice(server, {
    env, cliOrganizer: { available: true, organize() { throw Object.assign(new Error('Unexpected organizer inference'), { code: 'UNEXPECTED_ORGANIZER' }); } },
    createLunaFastImpl, createSpeechStreamImpl, WebSocketImpl: FakeStt, questionBank: bank, masteryStore, usageLedger,
    sessionHistory: { start: () => `fixture-${scenario.id}`, context: async () => null },
    diagnostics: { record(_, event) { if (trial.measuring || trial.followUp) diagnosticEvents.push({ ...event, atMs: round(performance.now() - trial.began) }); notify(); } },
    canvasRouter: { async classify(...args) { if (!trial.measuring && !trial.followUp) return { source: 'fixture', needsCanvas: false }; pendingRouting++; try { return await realCanvas.classify(...args); } finally { pendingRouting--; notify(); } } },
    intentRouter: { async classify(text, ...args) { const result = REAL_INTENT && (trial.measuring || trial.followUp) ? await realIntent.classify(text, ...args) : { source: 'fixture', examDeadline: false, requestsHelp: false, answerAttempt: text.startsWith('My answer is') }; if (trial.measuring || trial.followUp) record.intentDecisions.push({ text, ...result }); return result; } },
    tutorIntentRouter: { classify: async () => ({ source: 'fixture', acknowledgesMastery: false }) },
    gradeAnswerImpl: async args => { const call = { questionId: args.question.id, answer: args.answer, fullHistoryCount: args.conversation.length, materialTextSha256: sha(args.materials[0].text), hasEarlyPreference: JSON.stringify(args.conversation).includes(priming[0][0]), real: REAL_GRADING }; gradeCalls.push(call); pendingGrades++; notify(); try { const result = REAL_GRADING ? await checkedGrade({ ...args, organizer: gradeOrganizer }) : { checked: true, verdict: 'correct', unassisted: true }; call.result = result; return result; } finally { pendingGrades--; notify(); } },
  });
  let client;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    client = new WebSocket(`${origin.replace('http:', 'ws:')}/api/live-voice`, { origin });
    client.on('message', bytes => { const message = JSON.parse(bytes); messages.push({ ...message, receivedMs: trial.measuring || trial.followUp ? round(performance.now() - trial.began) : null }); notify(); });
    await once(client, 'open');
    client.send(JSON.stringify({ type: 'start', ...bankInput, localToday: '2026-10-02', date: '', indexStatus: 'ready', difficulty: 'test', topics, ...(scenario.stale ? { whiteboard: staleBoard, whiteboardVisible: true } : {}) }));
    await waitFor(() => messages.some(m => m.type === 'transcript' && m.final && m.role === 'assistant'), 'fixture greeting');
    async function seed(prompt, reply) { seededReply = reply; const count = messages.filter(m => m.type === 'transcript' && m.final && m.role === 'assistant').length; stt.receive({ message_type: 'committed_transcript', text: prompt }); await waitFor(() => messages.filter(m => m.type === 'transcript' && m.final && m.role === 'assistant').length > count, 'fixture history'); await sleep(1); }
    for (const [prompt, reply] of priming) await seed(prompt, reply);
    if (scenario.primeQuestion) await seed('Ask me the queued eight-by-ten strict-equilibrium question.', q6);
    seededReply = null; messages.length = 0; capturedInputs.length = 0;
    trial.measuring = true; trial.began = performance.now();
    record.startedAt = new Date().toISOString();
    stt.receive({ message_type: 'committed_transcript', text: scenario.prompt });
    await waitFor(() => messages.some(m => m.type === 'error') || diagnosticEvents.some(e => e.type === 'llm.failed') || (messages.some(m => m.type === 'transcript' && m.final && m.role === 'assistant') && messages.some(m => m.type === 'audio-end') && diagnosticEvents.some(e => ['whiteboard.shown', 'whiteboard.not-shown', 'whiteboard.closed', 'whiteboard.reopened', 'whiteboard.failed'].includes(e.type)) && pendingResponders === 0), 'measured tutor completion');
    // A recovery result immediately launches another routing promise. Wait for
    // a quiet event-loop window, not the fleeting gap between those promises.
    const settlingUntil = performance.now() + TIMEOUT;
    while (true) {
      await waitFor(() => pendingResponders === 0 && pendingRouting === 0, 'visual recovery and routing');
      const eventCount = diagnosticEvents.length, requestCount = record.requests.length;
      await sleep(40);
      if (pendingResponders === 0 && pendingRouting === 0 && diagnosticEvents.length === eventCount && record.requests.length === requestCount) break;
      if (performance.now() > settlingUntil) throw Object.assign(new Error('Visual settlement timeout'), { code: 'HARNESS_TIMEOUT' });
    }
    const spoken = messages.filter(m => m.type === 'transcript' && m.final && m.role === 'assistant').map(m => m.text).join(' ');
    const boardMessages = messages.filter(m => m.type === 'canvas');
    const board = boardMessages.findLast(m => m.visible && m.board)?.board || null;
    const firstText = messages.find(m => m.type === 'latency' && m.stage === 'first-text');
    const complete = messages.find(m => m.type === 'latency' && m.stage === 'text-complete');
    record.latencies = { committedTranscriptToFirstTextMs: firstText?.receivedMs ?? null, modelReportedFirstTextMs: firstText?.ms ?? null, committedTranscriptToSyntheticAudioMs: messages.find(m => m.type === 'audio')?.receivedMs ?? null, committedTranscriptToTextCompleteMs: complete?.receivedMs ?? null, committedTranscriptToBoardMs: boardMessages.find(m => m.visible && m.board)?.receivedMs ?? null, committedTranscriptToHideMs: boardMessages.find(m => m.visible === false)?.receivedMs ?? null };
    record.reply = spoken; record.board = board; record.boardMessages = boardMessages.map(({ audio, ...rest }) => rest); record.diagnostics = diagnosticEvents; record.usage = meters;
    record.providerCalls = measuredModelCalls;
    const firstMain = record.requests.find(request => request.provider === 'openai' && request.context?.bankQuestionIds);
    const expectedBank = capturedInputs.find(input => input.measuring && input.mode === 'voice')?.bankSha256;
    const evidenceWasProvided = record.requests.some(request => request.context?.evidence?.[scenario.id] || request.context?.toolResults?.some(result => result.evidence?.[scenario.id]));
    record.checks = {
      completeReply: Boolean(spoken),
      bankUnchangedAtFirstRequest: Boolean(firstMain) && firstMain.context.bankSha256 === expectedBank,
      bankContainsAllPendingQuestions: firstMain?.context.bankQuestionIds?.length === (scenario.primeQuestion ? 5 : 6),
      earlyStudentPreferencePreserved: firstMain?.context.includesEarlyPreference === true,
      noPrivateReferenceVerbatim: scenario.primeQuestion || !spoken.includes(referenceAnswer),
      noBoardMarkupInSpeech: !/<board>|<ask>|"blocks"|"rows"/.test(spoken),
      diagramOnlyBoard: !board || board.blocks.every(block => block.type !== 'text'),
      relevantOriginalEvidenceProvided: evidenceWasProvided,
    };
    if (scenario.id === 'source-payoff') record.checks.payoffTupleCorrect = /(?:one|1)\s*[,，]?\s*(?:six|6)\s*[,，]?\s*(?:and\s+)?(?:one|1)/i.test(spoken), record.checks.noUnrequestedBoard = !board;
    if (scenario.id === 'blank-grid') {
      const grid = board?.blocks.find(block => block.type === 'matrix' && block.rows.length === 8 && block.rows.every(row => row.length === 10));
      record.checks.exactGridDimensions = Boolean(grid);
      record.checks.noInventedPayoffsOrMarkedSolutions = Boolean(grid) && grid.rows.flat().every(cell => !cell.trim());
      record.checks.exactQueuedQuestionAsked = normalize(spoken).includes(normalize(q6));
      record.checks.noPrematureBoundAnswer = !/(?:maximum|at most|answer is|bound is)\s+(?:is\s+)?(?:eight|8)\b/i.test(spoken);
      if (PRODUCTION_BANK) {
        const identity = record.questionIdentity;
        record.checks.bankIdResolvedWithoutPrivateAnswer = identity.resolved.some(item => item.id === identity.canonicalQuestionId && item.found && item.canonicalQuestion === q6) && identity.resolved.every(item => !item.privateAnswerExposed);
        record.checks.bankConsumedByIdExactlyOnce = identity.consumed.flatMap(item => item.method === 'id' ? item.consumedIds : []).filter(id => id === identity.canonicalQuestionId).length === 1;
        record.checks.askProtocolReturnedCanonicalId = record.modelResults.some(result => result.mode === 'voice' && result.questionId === identity.canonicalQuestionId);
        record.checks.questionUnavailableAfterConsumption = bank.resolve(bankInput, identity.canonicalQuestionId) === null;
      }
      // Now provide one exact attempted answer with fixture feedback. This checks
      // server eligibility and original evidence retention, not grading quality.
      trial.measuring = false;
      if (REAL_GRADING || REAL_INTENT) trial.followUp = true;
      await seed(followUpAnswer, 'Thanks for your attempt.');
      if (REAL_GRADING || REAL_INTENT) {
        await waitFor(() => pendingResponders === 0 && pendingRouting === 0 && pendingGrades === 0, 'real follow-up grading');
        await sleep(100);
        await waitFor(() => pendingResponders === 0 && pendingRouting === 0 && pendingGrades === 0, 'real follow-up settlement');
        record.followUp = { reply: messages.filter(m => m.type === 'transcript' && m.final && m.role === 'assistant').slice(1).map(m => m.text).join(' '), masteryMessages: messages.filter(m => m.type === 'mastery').length };
      }
      await sleep(100);
      record.gradeFixture = { eligibleCalls: gradeCalls.length, calls: gradeCalls, records: recordedGrades.map(({ questionId, attempt, firstAttempt, unassisted, checked }) => ({ questionId, attempt, firstAttempt, unassisted, checked })) };
      record.checks.answerEligibleExactlyOnce = gradeCalls.length === 1 && recordedGrades.length === 1;
      record.checks.firstAttemptUnassisted = recordedGrades.length === 1 && recordedGrades[0].attempt === 1 && recordedGrades[0].firstAttempt === true && recordedGrades[0].unassisted === true;
      record.checks.gradingKeptOriginalSource = gradeCalls.length === 1 && gradeCalls[0].materialTextSha256 === sha(material.text);
      record.checks.gradingKeptEarlyConversation = gradeCalls.length === 1 && gradeCalls[0].hasEarlyPreference;
    }
    if (scenario.id === 'scene-switch') record.checks.stalePayoffRemoved = Boolean(board) && !board.blocks.some(block => block.id === 'old-q1-payoffs'), record.checks.cityDiagramShown = Boolean(board?.blocks.some(block => block.type === 'diagram')), record.checks.trialPositionsGeometricallyCorrect = cityGeometry(board);
    if (scenario.primeQuestion) {
      if (REAL_GRADING) await waitFor(() => pendingGrades === 0, 'real checked grading');
      await sleep(100);
      record.gradeFixture = { eligibleCalls: gradeCalls.length, calls: gradeCalls, records: recordedGrades.map(({ questionId, attempt, firstAttempt, unassisted, checked }) => ({ questionId, attempt, firstAttempt, unassisted, checked })) };
      record.checks.answerEligibleExactlyOnce = gradeCalls.length === 1 && recordedGrades.length === 1;
      record.checks.firstAttemptUnassisted = recordedGrades.length === 1 && recordedGrades[0].attempt === 1 && recordedGrades[0].firstAttempt === true && recordedGrades[0].unassisted === true;
      record.checks.gradingKeptOriginalSource = gradeCalls.length === 1 && gradeCalls[0].materialTextSha256 === sha(material.text);
      record.checks.gradingKeptEarlyConversation = gradeCalls.length === 1 && gradeCalls[0].hasEarlyPreference;
      record.checks.boundFeedbackPresent = /eight|\b8\b/i.test(spoken) && /row|column/i.test(spoken);
    }
    if ((scenario.grade || scenario.primeQuestion) && (REAL_GRADING || REAL_INTENT)) {
      await masteryStore.flush();
      const stored = JSON.parse(await readFile(path.join(work, 'mastery.json'), 'utf8')).tests[bankInput.testId];
      const savedEvents = Object.values(stored?.events || {}).filter(value => value && typeof value === 'object');
      record.persistedMastery = { public: await masteryStore.load(bankInput.testId), events: savedEvents, seenAttemptEntries: Object.keys(stored?.seenAttempts || {}).length };
      if (REAL_INTENT) record.checks.realIntentRecognizedUnassistedAnswer = record.intentDecisions.some(decision => decision.text.startsWith('My answer is') && decision.source === 'jev' && decision.answerAttempt === true && decision.requestsHelp === false);
      if (REAL_GRADING) {
        record.checks.twoIndependentRealGradesAgreed = record.requests.filter(request => request.kind === 'grading' && request.status === 200).length === 2 && gradeCalls.length === 1 && gradeCalls[0].result?.checked === true && gradeCalls[0].result.verdict === 'correct';
        record.checks.masteryPersistedExactlyOnce = savedEvents.length === 1 && savedEvents[0].attempt === 1 && savedEvents[0].firstAttempt === true && savedEvents[0].unassisted === true && savedEvents[0].verdict === 'correct' && record.persistedMastery.public.topics.find(topic => topic.id === savedEvents[0].topicId)?.score === 20;
      }
    }
    record.status = diagnosticEvents.some(e => e.type === 'llm.failed') || messages.some(m => m.type === 'error') ? 'failed' : 'completed';
  } catch (error) { record.status = 'failed'; record.failure = { code: /^[A-Z0-9_]{1,60}$/.test(error?.code || '') ? error.code : 'HARNESS_OR_PROVIDER_ERROR', status: Number.isInteger(error?.status) ? error.status : null }; record.diagnostics = diagnosticEvents; record.usage = meters; }
  finally { trial.measuring = false; trial.followUp = false; client?.terminate(); await pipeline.close(); bank.close?.(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(work, { recursive: true, force: true }); record.finishedAt = new Date().toISOString(); }
  return record;
}

try {
  if (LIVE && (!process.env.OPENAI_API_KEY?.trim() || !process.env.TYPESAFE_API_KEY?.trim())) throw Object.assign(new Error('Missing provider configuration'), { code: 'MISSING_PROVIDER_CONFIGURATION' });
  for (const condition of conditions) {
    const files = ['server/live-voice.mjs', 'server/openai-luna.mjs', 'server/luna-fast.mjs', 'server/tutor-output.mjs', 'server/jev-intent.mjs', 'server/mastery.mjs', ...(condition.id === 'before-luna' ? [] : ['server/grade-citations.mjs', 'server/material-retrieval.mjs', 'server/tutor-context.mjs', 'server/model-config.mjs', 'server/question-bank.mjs', 'server/question-identity.mjs'])];
    report.conditions.push({ id: condition.id, model: condition.model, root: condition.root, files: await Promise.all(files.map(async file => ({ file, sha256: sha(await readFile(path.join(condition.root, file), 'utf8')) }))) });
  }
  // Group by scenario, retaining the explicitly reported fixed condition order.
  // This is not a randomized or counterbalanced experiment.
  for (let trialRound = 1; trialRound <= ROUNDS; trialRound++) for (const scenario of scenarios) for (const condition of conditions) {
    if (LIVE && report.budget.used >= MAX_REQUESTS) { report.stoppedEarly = 'Paid HTTP request ceiling reached; no automatic retries.'; break; }
    const runResult = await run(condition, scenario, trialRound); report.runs.push(runResult); await writeFile(OUTPUT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ condition: condition.id, scenario: scenario.id, round: trialRound, status: runResult.status, checks: runResult.checks, latencies: runResult.latencies, paidRequests: report.budget.used }));
  }
  if (!LIVE) for (const result of report.runs) { assert.equal(result.status, 'completed'); for (const [name, passed] of Object.entries(result.checks)) if (name !== 'relevantOriginalEvidenceProvided') assert.equal(passed, true, `${result.condition}/${result.scenario}/${name}`); }
} catch (error) { report.failure = { code: /^[A-Z0-9_]{1,60}$/.test(error?.code || '') ? error.code : 'BENCHMARK_ERROR', status: Number.isInteger(error?.status) ? error.status : null }; process.exitCode = 1; }
finally { globalThis.fetch = originalFetch; active = null; report.finishedAt = new Date().toISOString(); await writeFile(OUTPUT, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ output: OUTPUT, live: LIVE, runs: report.runs.length, budget: report.budget, failure: report.failure, stoppedEarly: report.stoppedEarly })); }
