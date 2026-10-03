export function toBase64(frame) {
  const pcm = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, frame[i])) * 32767);
  const bytes = new Uint8Array(pcm.buffer); let str = '';
  for (let i = 0; i < bytes.length; i += 8192) str += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(str);
}
export class TurnDetector {
  constructor({ onStart, onEnd, silenceMs = 460 }) { Object.assign(this, { onStart, onEnd, silenceMs }); this.reset(); }
  reset() { this.pre = []; this.frames = []; this.active = false; this.voiced = 0; this.quiet = 0; this.lastVoice = 0; this.noise = 0.002; }
  push(frame, now) {
    let energy = 0; for (const x of frame) energy += x * x; const rms = Math.sqrt(energy / frame.length);
    const threshold = Math.max(0.009, Math.min(0.035, this.noise * 3.5));
    const voiced = rms > threshold;
    if (!this.active && !voiced) this.noise = this.noise * 0.99 + rms * 0.01;
    if (voiced) { this.voiced += 20; this.quiet = 0; this.lastVoice = now; } else { this.quiet += 20; if (!this.active) this.voiced = 0; }
    if (!this.active) {
      this.pre.push(frame); if (this.pre.length > 15) this.pre.shift();
      if (this.voiced >= 80) { this.active = true; this.frames = this.pre.slice(); this.onStart?.(now); }
    } else this.frames.push(frame);
    if (this.active && (this.quiet >= this.silenceMs || this.frames.length >= 1000)) {
      const lastVoice = this.lastVoice; const frames = this.frames.slice(0, Math.max(1, this.frames.length - Math.floor(this.quiet / 20) + 5));
      const audio = new Float32Array(frames.reduce((n,f) => n + f.length, 0)); let offset = 0;
      for (const f of frames) { audio.set(f, offset); offset += f.length; }
      this.reset(); this.onEnd?.({ audio, endedAt: lastVoice, committedAt: now });
    }
    return rms;
  }
}

export class VoiceSession {
  constructor(options) { Object.assign(this, options); this.stopped = false; this.nodes = new Set(); this.sequence = 0; this.stageTimes = {}; this.warmup = null; }
  emit(type, value) { if (!this.stopped) this.onEvent?.({ type, ...value }); }
  send(message) { if (!this.stopped && this.socket?.readyState === 1) this.socket.send(JSON.stringify(message)); }
  async start() {
    this.startedAt = performance.now(); this.emit('stage', { stage: 'Connecting' });
    this.context = new AudioContext(); await this.context.resume();
    if (this.stopped) return;
    if (this.provider === 'local') await this.loadStt();
    if (this.stopped) return;
    this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/session`);
    this.socket.onopen = () => this.send({ type: 'start', provider: this.provider, keys: this.keys, config: this.config });
    this.socket.onmessage = ({ data }) => { if (this.stopped) return; try { this.message(JSON.parse(data)); } catch (e) { this.error(e.message); } };
    this.socket.onerror = () => this.error('The local voice server could not connect.');
    this.socket.onclose = () => { if (!this.stopped) this.error('The voice session disconnected.'); };
  }
  loadStt() {
    this.emit('stage', { stage: 'Loading local speech model' });
    return new Promise((resolve, reject) => {
      this.rejectLoad = reject; this.worker = new Worker('/stt-worker.js', { type: 'module' });
      this.worker.onerror = () => { reject(new Error('Browser speech recognition could not load. Check your connection and browser.')); };
      this.worker.onmessage = ({ data }) => {
        if (this.stopped) return;
        if (data.type === 'progress') this.emit('load', data);
        if (data.type === 'loaded') { this.warmup = data.ms; this.rejectLoad = null; this.emit('warmup', { ms: data.ms }); resolve(); }
        if (data.type === 'error') { if (this.rejectLoad) reject(new Error(data.message)); else this.error(data.message); }
        if (data.type === 'result') {
          this.transcribing = false;
          if (this.queuedUtterance) { const next=this.queuedUtterance;this.queuedUtterance=null;this.utterance(next);return; }
          if (data.id !== this.sequence) return;
          this.stageTimes.stt = data.ms; this.emit('timing', { stage: 'stt', ms: data.ms });
          if (!data.text) { this.pending = null; this.emit('stage', { stage: 'Listening' }); return; }
          this.send({ type: 'utterance', text: data.text });
        }
      };
      this.worker.postMessage({ type: 'load', model: this.config.stt || 'whisper' });
    });
  }
  async microphone(rate) {
    this.rate = rate;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    if (this.stopped) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream;
    await this.context.audioWorklet.addModule('/capture.js'); if (this.stopped) return;
    this.source = this.context.createMediaStreamSource(stream);
    this.capture = new AudioWorkletNode(this.context, 'lab-capture', { processorOptions: { rate } });
    this.silent = this.context.createGain(); this.silent.gain.value = 0;
    this.source.connect(this.capture); this.capture.connect(this.silent); this.silent.connect(this.context.destination);
    this.detector = new TurnDetector({ silenceMs: Number(this.config.silenceMs || 700), onStart: () => {
      if (['local','groq'].includes(this.provider)) { this.sequence++; this.clearPlayback(); this.send({ type: 'interrupt' }); }
      this.turnMeasured = false; this.pending = { endedAt: performance.now(), input: this.replaying ? 'replay' : 'microphone', endpointMs: null }; this.stageTimes = {}; this.emit('stage', { stage: 'Listening' });
    }, onEnd: turn => this.utterance(turn) });
    this.capture.port.onmessage = ({ data }) => { if (!this.replaying && !this.stopped) this.frame(data); };
    this.emit('ready', { setupMs: performance.now() - this.startedAt }); this.emit('stage', { stage: 'Listening' });
  }
  frame(frame) {
    if (this.stopped) return;
    const now = performance.now(); const rms = this.detector.push(frame, now);
    if (this.pending && this.detector.active) this.pending.endedAt = this.detector.lastVoice;
    this.emit('level', { value: rms });
    if (!['local','groq'].includes(this.provider)) this.send({ type: 'audio', data: toBase64(frame) });
  }
  utterance({ audio, endedAt, committedAt }) {
    if (!this.turnMeasured) this.pending = { endedAt, input: this.replaying ? 'replay' : 'microphone', endpointMs: committedAt - endedAt };
    if (!['local','groq'].includes(this.provider)) return;
    if (this.provider === 'local') {
      if (this.transcribing) { this.queuedUtterance={audio,endedAt,committedAt};this.emit('stage', { stage: 'Finishing local transcription' });return; }
      this.transcribing = true; this.emit('stage', { stage: 'Transcribing locally' });
      this.worker.postMessage({ type: 'transcribe', id: this.sequence, audio }, [audio.buffer]);
    } else this.send({ type: 'utterance', audio: toBase64(audio) });
  }
  message(m) {
    if (m.type === 'error') return this.error(m.message);
    if (m.type === 'ready') { this.microphone(m.inputRate).catch(e => this.error(e.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser and start again.' : e.message)); return; }
    if (m.type === 'interrupt') { if (m.itemId) this.send({ type: 'playback_truncate', itemId: m.itemId, playedMs: Math.max(0, (this.context.currentTime - (this.firstPlayback ?? this.context.currentTime)) * 1000) }); this.clearPlayback(); this.emit('stage', { stage: 'Listening' }); return; }
    if (m.type === 'response_start') { this.firstPlayback = null; return; }
    if (m.type === 'audio') { this.play(m); return; }
    if (m.type === 'timing') this.stageTimes[m.stage] = m.ms;
    this.emit(m.type, m);
  }
  play(m) {
    if (!Number.isFinite(m.rate) || m.rate < 8000 || m.rate > 48000) throw new Error('Unsupported provider audio format.');
    const raw = atob(m.data); if (raw.length % 2) throw new Error('Invalid provider PCM.');
    const view = new DataView(Uint8Array.from(raw, c => c.charCodeAt(0)).buffer);
    const buffer = this.context.createBuffer(1, raw.length / 2, m.rate); const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    const node = this.context.createBufferSource(); node.buffer = buffer; node.connect(this.context.destination);
    const start = Math.max(this.context.currentTime + 0.015, this.nextAudio || 0); this.nextAudio = start + buffer.duration;
    this.firstPlayback ??= start;
    if (this.nextAudio - this.context.currentTime > 40) throw new Error('Audio playback fell behind. Start a new session.');
    this.nodes.add(node); node.onended = () => { this.nodes.delete(node); node.disconnect(); if (!this.nodes.size) this.emit('stage', { stage: 'Listening' }); }; node.start(start);
    this.emit('stage', { stage: 'Speaking' });
    if (this.pending) {
      const ms = performance.now() - this.pending.endedAt + (start - this.context.currentTime) * 1000;
      if (ms >= 0 && ms < 120000) this.emit('measurement', { ms, input: this.pending.input, endpointMs: this.pending.endpointMs, stages: { ...this.stageTimes }, warmupMs: this.warmup, llm: this.provider === 'local' ? this.config.llm : this.provider, model: this.config.model, stt: this.provider === 'local' ? this.config.stt || 'whisper' : undefined, textModel: this.config.textModel, prompt: this.config.prompt, silenceMs: this.config.silenceMs, at: new Date().toISOString() });
      this.pending = null;
      this.turnMeasured = true;
    }
  }
  clearPlayback() { for (const n of this.nodes) { try { n.stop(); n.disconnect(); } catch {} } this.nodes.clear(); this.nextAudio = 0; }
  async replay(file) {
    if (!this.detector || this.replaying) return;
    this.clearPlayback(); this.send({ type: 'interrupt' }); this.detector.reset(); this.replaying = true;
    try {
      if (file.size > 10_000_000) throw new Error('Use a clip smaller than 10 MB.');
      const decoded = await this.context.decodeAudioData(await file.arrayBuffer());
      if (decoded.duration > 20) throw new Error('Use the same short clip, up to 20 seconds, for each option.');
      const ctx = new OfflineAudioContext(1, Math.ceil(decoded.duration * this.rate), this.rate); const src = ctx.createBufferSource(); src.buffer = decoded; src.connect(ctx.destination); src.start();
      const rendered = await ctx.startRendering(); const pcm = rendered.getChannelData(0); const size = this.rate / 50;
      this.emit('notice', { message: `Replaying ${file.name}. Microphone input is paused during the clip.` });
      for (let i = 0; i < pcm.length + this.rate; i += size) { if (this.stopped) return; const f = new Float32Array(size); f.set(pcm.subarray(i, Math.min(pcm.length, i + size))); this.frame(f); await new Promise(r => setTimeout(r,20)); }
    } catch (e) { this.emit('notice', { message: e.message }); }
    finally { this.replaying = false; }
  }
  error(message) { this.emit('error', { message }); this.stop(); }
  stop() {
    if (this.stopped) return; this.send({ type: 'stop' }); this.stopped = true;
    this.sequence++; this.queuedUtterance=null; this.rejectLoad?.(new DOMException('Session canceled','AbortError')); this.rejectLoad = null;
    this.socket?.close(); this.worker?.terminate(); this.stream?.getTracks().forEach(t => t.stop());
    this.capture?.disconnect(); this.source?.disconnect(); this.silent?.disconnect(); this.clearPlayback(); this.context?.close().catch(() => {});
  }
}
