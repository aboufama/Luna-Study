// Benchmarks only. Never import this guard into the application voice path.
// Pricing metadata: https://elevenlabs.io/docs/api-reference/models/list
// Quota: https://elevenlabs.io/docs/api-reference/user/subscription/get
// Custom voice multipliers are deliberately unsupported and fail closed.
import WebSocket from 'ws';

const API = 'https://api.elevenlabs.io';
const STT_CREDITS_PER_SECOND = 100; // Conservative reservation, not a quoted tariff.
const positive = value => Number.isFinite(value) && value > 0;

export async function createUsageBudget({ name, maxRequests, ttsModels = ['eleven_v4_turbo'], sttSessionMaxSeconds = 0, env = process.env, fetchImpl = globalThis.fetch, WebSocketImpl = WebSocket } = {}) {
  if (env.BENCHMARK_LIVE !== 'true') throw Error('Live benchmark blocked: set BENCHMARK_LIVE=true explicitly for this run.');
  const cap = Number(env.BENCHMARK_MAX_CREDITS);
  if (!Number.isSafeInteger(cap) || cap <= 0) throw Error('Live benchmark blocked: BENCHMARK_MAX_CREDITS must be a positive integer.');
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 32) throw Error('Invalid benchmark request ceiling.');
  if (!Number.isFinite(sttSessionMaxSeconds) || sttSessionMaxSeconds < 0 || sttSessionMaxSeconds > 120) throw Error('Invalid benchmark STT duration ceiling.');
  const key = env.ELEVENLABS_API_KEY?.trim(), voice = env.ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb';
  if (!key) throw Error('Live benchmark blocked: missing ElevenLabs configuration.');
  const headers = { 'xi-api-key': key };
  async function read(endpoint) {
    const response = await fetchImpl(`${API}${endpoint}`, { method: 'GET', headers, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw Error(`Budget preflight read failed (HTTP ${response.status}).`);
    return response.json();
  }
  function balance(data) {
    if (!Number.isSafeInteger(data?.character_count) || !Number.isSafeInteger(data?.character_limit) || data.character_count < 0 || data.character_limit < data.character_count) throw Error('Budget preflight cannot verify remaining included credits.');
    return { used: data.character_count, limit: data.character_limit, remaining: data.character_limit - data.character_count };
  }
  const before = balance(await read('/v1/user/subscription'));
  if (cap > before.remaining) throw Error('Benchmark budget exceeds remaining included credits; overage is not authorized.');
  const [catalog, voiceInfo] = await Promise.all([read('/v1/models'), read(`/v1/voices/${encodeURIComponent(voice)}`)]);
  if (voiceInfo?.voice_id !== voice || voiceInfo?.category !== 'premade') throw Error('Budget cannot verify a standard voice rate; only verified premade voices are allowed.');
  if (!Array.isArray(catalog) || !Array.isArray(ttsModels) || !ttsModels.length) throw Error('Budget cannot verify model pricing.');
  const rates = new Map();
  for (const id of new Set(ttsModels)) {
    const model = catalog.find(item => item.model_id === id), multiplier = model?.model_rates?.character_cost_multiplier;
    const discount = model?.model_rates?.cost_discount_multiplier;
    if (!model?.can_do_text_to_speech || !positive(multiplier) || (discount != null && !positive(discount))) throw Error(`Budget cannot verify character pricing for ${id}.`);
    // Ignore discounts and round upward. Each write rounds separately; no
    // refund on errors, retries or abandoned connections.
    rates.set(id, Math.max(1, multiplier) * Math.max(1, discount ?? 1));
  }
  const record = { name, provider: 'ElevenLabs', maximumCredits: cap, maximumProviderRequests: maxRequests, before, reservedCredits: 0, providerRequests: 0, ttsCharacters: 0, sttReservedSeconds: 0, modelCreditCeilings: Object.fromEntries(rates), sttCreditsPerSecondReservation: STT_CREDITS_PER_SECOND, reservations: [], limitation: 'This enforces a local reservation ceiling using verified character pricing for premade voices and deliberately conservative STT duration reservations. Provider accounting can lag, and account balance changes may include other activity. It is not an account-wide billing limit.' };
  let blocked = false, finished = false;
  const sockets = new Set();
  function requireOpen() { if (blocked || finished) throw Error('Benchmark budget is closed; no further provider work is allowed.'); }
  function reserve(credits, detail) {
    requireOpen();
    if (!Number.isSafeInteger(credits) || credits < 0 || record.reservedCredits + credits > cap) { blocked = true; for (const socket of sockets) socket.terminate(); throw Error('Benchmark credit budget exhausted before the next provider send.'); }
    record.reservedCredits += credits; record.reservations.push({ credits, ...detail });
  }
  function request() {
    requireOpen();
    if (record.providerRequests >= maxRequests) { blocked = true; for (const socket of sockets) socket.terminate(); throw Error('Benchmark provider request ceiling reached.'); }
    record.providerRequests++;
  }
  function textReservation(text, model) {
    if (typeof text !== 'string' || !rates.has(model)) throw Error('Unverified benchmark TTS text or model.');
    const characters = [...text].length;
    reserve(Math.ceil(characters * rates.get(model)), { kind: 'tts', model, characters });
    record.ttsCharacters += characters;
  }
  function checkVoice(id) { if (id !== voice) throw Error('Unverified voice blocked by benchmark budget.'); }
  class BudgetWebSocket extends WebSocketImpl {
    constructor(address, options) {
      const url = new URL(address);
      if (url.protocol !== 'wss:' || url.hostname !== 'api.elevenlabs.io') throw Error('Benchmark provider socket endpoint is not approved.');
      const stt = url.pathname === '/v1/speech-to-text/realtime', model = url.searchParams.get('model_id');
      if (stt) {
        if (!sttSessionMaxSeconds || model !== 'scribe_v2_realtime' || url.searchParams.get('audio_format') !== 'pcm_16000') throw Error('Unbudgeted STT connection blocked.');
        // Reserve at least one full minute, including connection/idle time,
        // before opening. A hard wall-clock timer and PCM cap enforce duration.
        const seconds = Math.max(60, Math.ceil(sttSessionMaxSeconds));
        reserve(seconds * STT_CREDITS_PER_SECOND, { kind: 'stt-session', seconds });
        record.sttReservedSeconds += seconds;
      } else {
        if (!rates.has(model)) throw Error('Unverified TTS socket model.');
        const match = url.pathname.match(/^\/v1\/text-to-speech\/([^/]+)\/stream-input$/);
        if (match) checkVoice(decodeURIComponent(match[1]));
        else if (url.pathname !== '/v1/text-to-dialogue/stream-input') throw Error('Unapproved TTS socket endpoint.');
      }
      request();
      super(address, options);
      this.budgetModel = model; this.budgetStt = stt; this.budgetAudioBytes = 0; this.budgetBlocked = false;
      sockets.add(this);
      const timer = setTimeout(() => { this.budgetBlocked = true; this.terminate(); }, (stt ? sttSessionMaxSeconds : 60) * 1000);
      timer.unref?.(); this.once('close', () => { clearTimeout(timer); sockets.delete(this); });
    }
    send(data, ...args) {
      try {
        requireOpen(); if (this.budgetBlocked) throw Error('Benchmark socket duration limit reached.');
        const message = JSON.parse(String(data));
        if (this.budgetStt) {
          if (message.message_type !== 'input_audio_chunk' || typeof message.audio_base_64 !== 'string' || message.sample_rate !== 16000) throw Error('Unbudgeted STT message blocked.');
          const bytes = Buffer.byteLength(message.audio_base_64, 'base64');
          if (this.budgetAudioBytes + bytes > sttSessionMaxSeconds * 32000) throw Error('Benchmark STT audio duration ceiling reached.');
          this.budgetAudioBytes += bytes;
        } else {
          if (message.voices) { if (!Array.isArray(message.voices)) throw Error('Invalid voice registration.'); message.voices.forEach(checkVoice); }
          if (message.inputs) {
            if (!Array.isArray(message.inputs)) throw Error('Invalid dialogue input.');
            for (const input of message.inputs) { checkVoice(input.voice_id); textReservation(input.text, this.budgetModel); }
          }
          if (Object.hasOwn(message, 'text')) textReservation(message.text, this.budgetModel);
          if (!message.voices && !message.inputs && !Object.hasOwn(message, 'text') && message.close_socket !== true && message.keep_alive !== true) throw Error('Unbudgeted speech message blocked.');
        }
        return super.send(data, ...args);
      } catch (error) {
        this.budgetBlocked = true; this.terminate();
        const callback = args.at(-1); if (typeof callback === 'function') callback(error);
        queueMicrotask(() => this.emit('error', error));
      }
    }
  }
  async function fetchTts(address, options) {
    requireOpen(); const url = new URL(address);
    const match = url.pathname.match(/^\/v1\/text-to-speech\/([^/]+)$/);
    if (url.origin !== API || options?.method !== 'POST' || !match) throw Error('Unapproved generation endpoint blocked.');
    checkVoice(decodeURIComponent(match[1])); const body = JSON.parse(options.body);
    textReservation(body.text, body.model_id); request();
    return fetchImpl(address, { ...options, redirect: 'error' });
  }
  async function finish() {
    if (finished) return record;
    finished = true; for (const socket of sockets) socket.terminate();
    try { record.after = balance(await read('/v1/user/subscription')); record.observedAccountCreditDelta = record.after.used - before.used; }
    catch { record.balanceAfterUnavailable = true; }
    return record;
  }
  return { WebSocket: BudgetWebSocket, fetchTts, finish, record };
}
