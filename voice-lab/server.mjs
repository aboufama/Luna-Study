import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import WebSocket, { WebSocketServer } from 'ws';
import { createCodexOrganizer } from '../server/codex.mjs';
import { createSpeechStream, createSpeechTextBuffer } from '../server/speech-stream.mjs';
import { PROVIDERS, PROMPT } from './catalog.mjs';
import { pcmWav, validPcm, sseData, localRequestAllowed } from './protocol.mjs';
import { createOAuthVoice } from './oauth.mjs';
import { openaiErrorMessage } from './openai-errors.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VOICE_LAB_PORT || 5196);
const cli = await createCodexOrganizer({ env: { ...process.env, LUNA_CLI_MODEL: process.env.VOICE_LAB_CLI_MODEL || 'gpt-5.6-luna' } });
const vite = await createViteServer({ root, configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: { port: port + 1 }, fs: { deny: ['.env', '.env.*', '**/*.pem', '**/*.key', '**/.git/**'] } }, appType: 'spa' });
const keyNames = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'DEEPGRAM_API_KEY', 'GROQ_API_KEY'];
const baseKeys = Object.fromEntries(keyNames.map(k => [k, process.env[k] || (k === 'GEMINI_API_KEY' ? process.env.GOOGLE_API_KEY : '') || '']));
const server = http.createServer(async (req, res) => {
  if (!localRequestAllowed(req, port)) { res.writeHead(403).end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/api/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ keys: Object.fromEntries(keyNames.map(k => [k, Boolean(baseKeys[k])])), oauth: cli.available, oauthModel: cli.model })); return;
  }
  if (req.url === '/api/research') {
    res.setHeader('Content-Type', 'application/json');
    const broad = JSON.parse(await readFile(path.join(root, 'research/github-inventory.json')));
    const niche = JSON.parse(await readFile(path.join(root, 'research/niche-inventory.json')));
    res.end(JSON.stringify({ checkedAt: broad.checkedAt, repositories: [...broad.repositories.map(x => ({ name: x.repo, url: x.url, license: x.license, pushed: x.pushedAt })), ...niche.map(x => ({ name: x.name, url: 'https://github.com/' + x.name, license: x.license || 'Not declared', pushed: x.pushed }))] })); return;
  }
  vite.middlewares(req, res);
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 1_500_000 });
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/session') return;
  if (!req.headers.origin || !localRequestAllowed(req, port)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});

// This lab owns its agent; it never changes the study app's agent or prompt.
let agentPromise;
async function labAgent(key, signal) {
  if (key === baseKeys.ELEVENLABS_API_KEY && agentPromise) return agentPromise;
  const create = async () => {
    const headers = { 'xi-api-key': key, 'Content-Type': 'application/json' };
    const list = await checkedFetch('https://api.elevenlabs.io/v1/convai/agents?page_size=100', { headers, signal }, 'ElevenLabs');
    const found = (await list.json()).agents?.find(a => a.name === 'Luna Voice Lab · independent comparison');
    if (found) return found.agent_id;
    const r = await checkedFetch('https://api.elevenlabs.io/v1/convai/agents/create', { method: 'POST', headers, signal, body: JSON.stringify({
      name: 'Luna Voice Lab · independent comparison', conversation_config: {
        agent: { first_message: '', language: 'en', prompt: { prompt: PROMPT, llm: 'gpt-6-luna', temperature: 0.5, max_tokens: 180 } },
        tts: { voice_id: process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb', model_id: 'eleven_v4_turbo', agent_output_audio_format: 'pcm_16000' },
        asr: { user_input_audio_format: 'pcm_16000' },
        conversation: { max_duration_seconds: 600, client_events: ['audio', 'interruption', 'user_transcript', 'agent_response'] },
      }, platform_settings: { overrides: { conversation_config_override: { agent: { prompt: { prompt: true } } } } },
    }) }, 'ElevenLabs');
    return (await r.json()).agent_id;
  };
  const promise = create();
  if (key === baseKeys.ELEVENLABS_API_KEY) { agentPromise = promise; promise.catch(() => { agentPromise = null; }); }
  return promise;
}
async function checkedFetch(url, init, name) {
  const response = await fetch(url, { ...init, signal: init.signal || AbortSignal.timeout(20000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`${name} returned HTTP ${response.status}. Check the key, model access, and credits.`); }
  return response;
}

wss.on('connection', client => {
  let upstream, provider, config, keys, ready = false, stopped = false, started = false, turn, speech, turnNumber = 0, history = [], keepalive;
  let responseActive = false, responseItem, responseAudioMs = 0, oauth, openaiKeySource = 'environment';
  const lifetime = new AbortController();
  const timeout = setTimeout(() => fail('The 10-minute comparison session ended. Start a new session to continue.'), 600000);
  const handshake = setTimeout(() => fail('The voice provider did not become ready within 30 seconds.'), 30000);
  const send = data => { if (!stopped && client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data)); };
  const up = data => { if (!stopped && upstream?.readyState === WebSocket.OPEN) upstream.send(typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data); };
  function cancelTurn() { turn?.abort(); speech?.cancel(); turn = null; speech = null; }
  function cleanup() { if (stopped) return; stopped = true; ready = false; clearTimeout(timeout); clearTimeout(handshake); clearInterval(keepalive); lifetime.abort(); cancelTurn(); upstream?.terminate(); void oauth?.close(); }
  function fail(message) { send({ type: 'error', message }); cleanup(); client.close(); }
  function markReady(rate) { if (ready || stopped) return; clearTimeout(handshake); ready = true; send({ type: 'ready', inputRate: rate, model: config.model || PROVIDERS.find(p => p.id === provider).model, llm: config.llm }); }
  function socket(url, options, onOpen, onMessage) {
    if (stopped) return;
    upstream = new WebSocket(url, { ...options, handshakeTimeout: 20000, maxPayload: 4_000_000 });
    upstream.on('open', () => { if (stopped) return upstream.terminate(); onOpen(); });
    upstream.on('message', (data, binary) => { if (stopped) return; try { onMessage(provider === 'deepgram' && binary ? data : JSON.parse(data.toString()), binary); } catch { fail('The provider returned an unsupported message.'); } });
    upstream.on('unexpected-response', (_, res) => {
      if (provider !== 'openai') { res.resume(); fail(`Provider handshake returned HTTP ${res.statusCode}. Check credentials and access.`); return; }
      let body = '', finished = false;
      const finish = () => {
        if (finished) return; finished = true; clearTimeout(timer);
        let error; try { error = JSON.parse(body).error; } catch {}
        fail(openaiErrorMessage(error, { source: openaiKeySource, status: res.statusCode }));
      };
      const timer = setTimeout(() => { finish(); res.destroy(); }, 3000);
      res.on('data', chunk => { body += chunk; if (body.length > 16000) { body = ''; finish(); res.destroy(); } });
      res.on('end', finish); res.on('error', finish);
    });
    upstream.on('error', () => { if (!stopped) fail('The provider connection failed. Check the key, model access, and network.'); });
    upstream.on('close', () => { if (!stopped) fail('The provider closed the conversation. Start a new session.'); });
  }
  async function start(m) {
    provider = m.provider; config = m.config || {};
    if (!PROVIDERS.some(p => p.id === provider)) throw new Error('Choose a supported voice option.');
    keys = { ...baseKeys };
    for (const name of keyNames) if (typeof m.keys?.[name] === 'string' && m.keys[name].length < 1000 && m.keys[name].trim()) keys[name] = m.keys[name].trim();
    if (typeof m.keys?.OPENAI_API_KEY === 'string' && m.keys.OPENAI_API_KEY.length < 1000 && m.keys.OPENAI_API_KEY.trim()) openaiKeySource = 'connection';
    for (const key of PROVIDERS.find(p => p.id === provider).needs) if (!keys[key]) throw new Error(`Add ${key} in Connections first.`);
    config.prompt = (typeof config.prompt === 'string' && config.prompt.trim() ? config.prompt : PROMPT).slice(0,6000);
    if (provider === 'local' || provider === 'groq') {
      config.llm = provider === 'groq' ? 'groq' : config.llm || 'codex';
      if (!['groq','openai','codex'].includes(config.llm)) throw new Error('Unsupported text model provider.');
      if (config.llm === 'codex' && !cli.available) throw new Error('Sign in with codex login to use the OAuth text model.');
      if (config.llm !== 'codex' && !keys[config.llm === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY']) throw new Error('Add the selected text provider key in Connections.');
      if (config.llm === 'codex') { oauth = createOAuthVoice({ model: cli.model, instructions: config.prompt }); await oauth.ready(); if (stopped) { await oauth.close(); return; } }
      markReady(16000); return;
    }
    if (provider === 'openai') {
      socket('wss://api.openai.com/v1/realtime?model=' + encodeURIComponent(config.model || 'gpt-realtime-2.1'), { headers: { Authorization: `Bearer ${keys.OPENAI_API_KEY}` } }, () => up({ type: 'session.update', session: { type: 'realtime', instructions: config.prompt, output_modalities: ['audio'], audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 450, create_response: true, interrupt_response: true } }, output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'marin' } } } }), m => {
        if (m.type === 'session.updated') markReady(24000);
        if (m.type === 'error') fail(openaiErrorMessage(m.error, { source: openaiKeySource }));
        if (m.type === 'input_audio_buffer.speech_started') send({ type: 'interrupt', itemId: responseItem });
        if (m.type === 'conversation.item.input_audio_transcription.completed') send({ type: 'transcript', role: 'user', text: m.transcript });
        if (m.type === 'response.created') { responseActive = true; responseItem = null; responseAudioMs = 0; send({ type: 'response_start' }); }
        if (m.type === 'response.output_audio.delta') { responseItem = m.item_id; responseAudioMs += Buffer.from(m.delta,'base64').length / 48; send({ type: 'audio', data: m.delta, rate: 24000 }); }
        if (m.type === 'response.output_audio_transcript.delta') send({ type: 'transcript', role: 'assistant', delta: m.delta });
        if (m.type === 'response.done') { responseActive = false; send({ type: 'done' }); }
      }); return;
    }
    if (provider === 'gemini') {
      socket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(keys.GEMINI_API_KEY), {}, () => up({ setup: { model: 'models/' + (config.model || 'gemini-3.8-live'), generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } }, systemInstruction: { parts: [{ text: config.prompt }] }, inputAudioTranscription: {}, outputAudioTranscription: {} } }), m => {
        if (m.error) return fail('Gemini rejected the request. Check your key and selected model.');
        if (m.setupComplete) markReady(16000);
        const c = m.serverContent; if (!c) return;
        if (c.interrupted) send({ type: 'interrupt' });
        if (c.inputTranscription?.text) send({ type: 'transcript', role: 'user', delta: c.inputTranscription.text });
        if (c.outputTranscription?.text) send({ type: 'transcript', role: 'assistant', delta: c.outputTranscription.text });
        for (const p of c.modelTurn?.parts || []) if (p.inlineData?.data) send({ type: 'audio', data: p.inlineData.data, rate: Number(p.inlineData.mimeType?.match(/rate=(\d+)/)?.[1] || 24000) });
        if (c.turnComplete) send({ type: 'done' });
      }); return;
    }
    if (provider === 'eleven') {
      const id = await labAgent(keys.ELEVENLABS_API_KEY, lifetime.signal);
      const r = await checkedFetch('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=' + encodeURIComponent(id), { headers: { 'xi-api-key': keys.ELEVENLABS_API_KEY }, signal: lifetime.signal }, 'ElevenLabs');
      const { signed_url } = await r.json(); if (stopped) return;
      let rate = 16000;
      socket(signed_url, {}, () => up({ type: 'conversation_initiation_client_data', conversation_config_override: { agent: { prompt: { prompt: config.prompt } } } }), m => {
        if (m.type === 'conversation_initiation_metadata') { const meta = m.conversation_initiation_metadata_event; rate = Number(meta.agent_output_audio_format.replace('pcm_', '')); markReady(Number(meta.user_input_audio_format.replace('pcm_', ''))); }
        if (m.type === 'ping') up({ type: 'pong', event_id: m.ping_event.event_id });
        if (m.type === 'audio') send({ type: 'audio', data: m.audio_event.audio_base_64, rate });
        if (m.type === 'interruption') send({ type: 'interrupt' });
        if (m.type === 'user_transcript') send({ type: 'transcript', role: 'user', text: m.user_transcription_event.user_transcript });
        if (m.type === 'agent_response') send({ type: 'transcript', role: 'assistant', text: m.agent_response_event.agent_response });
        if (m.type === 'error') fail('ElevenLabs rejected the conversation. Check agent configuration and credits.');
      }); return;
    }
    socket('wss://agent.deepgram.com/v1/agent/converse', { headers: { Authorization: `Token ${keys.DEEPGRAM_API_KEY}` } }, () => up({ type: 'Settings', audio: { input: { encoding: 'linear16', sample_rate: 16000 }, output: { encoding: 'linear16', sample_rate: 24000, container: 'none' } }, agent: { language: 'en', listen: { provider: { type: 'deepgram', model: 'nova-3' } }, think: { provider: { type: 'open_ai', model: 'gpt-4o-mini' }, prompt: config.prompt }, speak: { provider: { type: 'deepgram', model: 'aura-2-thalia-en' } } } }), (m, binary) => {
      if (binary) return send({ type: 'audio', data: m.toString('base64'), rate: 24000 });
      if (m.type === 'SettingsApplied') { markReady(16000); keepalive = setInterval(() => up({ type: 'KeepAlive' }), 5000); }
      if (m.type === 'UserStartedSpeaking') send({ type: 'interrupt' });
      if (m.type === 'ConversationText') send({ type: 'transcript', role: m.role === 'user' ? 'user' : 'assistant', text: m.content });
      if (m.type === 'AgentAudioDone') send({ type: 'done' });
      if (m.type === 'Error') fail('Deepgram rejected the conversation. Check model settings and account credits.');
    });
  }
  async function pipeline(m) {
    cancelTurn(); const controller = new AbortController(); turn = controller; const { signal } = controller; const id = ++turnNumber;
    const emit = data => { if (!signal.aborted && !stopped) send({ ...data, turn: id }); };
    const startedAt = performance.now();
    try {
      let text = m.text;
      if (provider === 'groq') {
        if (!validPcm(m.audio)) throw new Error('Invalid or oversized microphone recording.');
        emit({ type: 'stage', stage: 'Transcribing' });
        const form = new FormData(); form.append('file', new Blob([pcmWav(Buffer.from(m.audio, 'base64'))], { type: 'audio/wav' }), 'turn.wav'); form.append('model','whisper-large-v3-turbo'); form.append('language','en');
        const r = await checkedFetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${keys.GROQ_API_KEY}` }, body: form, signal }, 'Groq transcription');
        text = (await r.json()).text; emit({ type: 'timing', stage: 'stt', ms: performance.now() - startedAt });
      }
      if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('No clear speech was transcribed. Please try again.');
      text = text.trim(); emit({ type: 'transcript', role: 'user', text }); emit({ type: 'stage', stage: 'Thinking' });
      history = [...history.slice(-18), { role: 'user', content: text }];
      const llmAt = performance.now(); let answer = '', first = true;
      const tts = createSpeechStream({ env: { ELEVENLABS_API_KEY: keys.ELEVENLABS_API_KEY }, voice: config.voice || process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_v4_turbo', signal, onAudio: data => emit({ type: 'audio', data, rate: 24000 }), onEnd: () => emit({ type: 'done' }), onError: message => { if (!signal.aborted) fail(message); } });
      speech = tts; const buffer = createSpeechTextBuffer(value => tts.write(value));
      function delta(value) { if (signal.aborted || !value) return; if (first) { first = false; emit({ type: 'timing', stage: 'llm', ms: performance.now() - llmAt }); } answer += value; if (answer.length > 1700) throw new Error('The AI reply exceeded the voice limit.'); emit({ type: 'transcript', role: 'assistant', delta: value }); buffer.push(value); }
      if (config.llm === 'codex') {
        await oauth.respond(history, { signal, onText: delta });
      } else if (config.llm === 'groq') {
        const r = await checkedFetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', signal, headers: { Authorization: `Bearer ${keys.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.textModel || 'llama-3.1-8b-instant', messages: [{ role: 'system', content: config.prompt }, ...history], max_tokens: 200, stream: true, temperature: 0.5 }) }, 'Groq');
        for await (const part of sseData(r.body)) { if (part.error) throw new Error('Groq text generation failed.'); delta(part.choices?.[0]?.delta?.content); }
      } else {
        const r = await checkedFetch('https://api.openai.com/v1/responses', { method: 'POST', signal, headers: { Authorization: `Bearer ${keys.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.textModel || 'gpt-4.1-mini', instructions: config.prompt, input: history, max_output_tokens: 200, stream: true }) }, 'OpenAI');
        for await (const part of sseData(r.body)) { if (part.type === 'response.output_text.delta') delta(part.delta); if (part.type === 'error' || part.type === 'response.failed') throw new Error('OpenAI text generation failed.'); }
      }
      if (signal.aborted) return;
      if (!answer.trim()) throw new Error('The AI returned an empty reply.');
      history.push({ role: 'assistant', content: answer }); buffer.finish(); tts.finish();
    } catch (error) { if (!signal.aborted && !stopped) fail(error.message); }
  }
  client.on('message', raw => {
    if (stopped) return;
    try {
      const m = JSON.parse(raw.toString());
      if (m.type === 'start') { if (started) throw new Error('A session is already starting.'); started = true; start(m).catch(e => { if (!stopped) fail(e.message); }); return; }
      if (m.type === 'stop') { cleanup(); client.close(); return; }
      if (!ready) return;
      if (m.type === 'playback_truncate' && provider === 'openai' && m.itemId === responseItem && Number.isFinite(m.playedMs) && m.playedMs >= 0) { up({ type: 'conversation.item.truncate', item_id: responseItem, content_index: 0, audio_end_ms: Math.floor(Math.min(responseAudioMs, m.playedMs)) }); return; }
      if (m.type === 'interrupt') { cancelTurn(); if (provider === 'openai' && responseActive) up({ type: 'response.cancel' }); send({ type: 'interrupt' }); return; }
      if (m.type === 'utterance' && ['local', 'groq'].includes(provider)) { pipeline(m); return; }
      if (m.type === 'audio' && validPcm(m.data, 16000)) {
        if (upstream?.bufferedAmount > 256000) throw new Error('Audio upload fell behind. Restart the session.');
        if (provider === 'openai') up({ type: 'input_audio_buffer.append', audio: m.data });
        if (provider === 'gemini') up({ realtimeInput: { audio: { data: m.data, mimeType: 'audio/pcm;rate=16000' } } });
        if (provider === 'eleven') up({ user_audio_chunk: m.data });
        if (provider === 'deepgram') up(Buffer.from(m.data, 'base64'));
      }
    } catch (e) { fail(e.message || 'Invalid client message.'); }
  });
  client.on('close', cleanup); client.on('error', cleanup);
});
server.listen(port, '127.0.0.1', () => console.log(`Voice Lab: http://localhost:${port} · OAuth text model ${cli.available ? 'ready' : 'unavailable'}`));
async function shutdown() { for (const c of wss.clients) c.close(); await vite.close(); server.close(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
