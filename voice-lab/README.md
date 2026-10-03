# Luna Voice Lab

A separate comparison app. Run `npm run voice-lab` from the repository root and open **http://localhost:5196**. The study app continues on port 5188; this lab does not read study materials, alter course designs, or change the main tutor. Port 5196 avoids the existing experiment on 5190.

Six real adapters: OpenAI Realtime, Gemini Live, ElevenLabs Agents, Deepgram Voice Agent, Groq Whisper → Groq text → ElevenLabs, and browser Whisper/Moonshine → chosen text model → ElevenLabs. There are no simulated provider responses or browser-speech fallbacks. See [the research and selection rationale](RESEARCH.md).

## Connections

The server reads the root `.env`. Keys can also be added temporarily in **Connections**. Temporary keys stay in tab memory and in the active server session, never localStorage or files. Environment key values are never returned to the browser. A configured key is not proof of valid access. Failed connections surface in the page.

Realtime errors distinguish a deactivated API account, an invalid key, unavailable models, quota limits, and invalid session settings. The error identifies whether the credential came from Connections or the server environment, without exposing keys or raw provider messages. A working Codex OAuth login does not replace the API key used by this adapter. For `account_deactivated`, supply a key from your active API account in Connections; changing the Realtime model or signing into Codex again will not repair that rejected key.

- `ELEVENLABS_API_KEY`: Agents plus speech for both custom pipelines.
- `ELEVENLABS_VOICE_ID`: optional; defaults to the provider's George voice.
- `OPENAI_API_KEY`: Realtime and optional streaming text in the local challenger.
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`: Gemini Live.
- `DEEPGRAM_API_KEY`: Deepgram's managed voice agent.
- `GROQ_API_KEY`: cloud Whisper + fast text, or just text for the local challenger.
- `VOICE_LAB_CLI_MODEL`: OAuth text model, default `gpt-5.6-luna`, verified in this machine's CLI model catalog. Run `codex login` if needed.
- `VOICE_LAB_PORT`: optional port, default 5196; HMR uses the next port.

Codex OAuth is used through the authenticated CLI. It is not extracted or sent to the public Realtime endpoint. A dedicated, prewarmed `codex app-server` streams text deltas to ElevenLabs phrase by phrase. Groq and OpenAI API text options also stream. The original full-reply CLI baseline is retained in the research evidence; the delivered path uses streaming.

The first ElevenLabs Agents connection creates or reuses **Luna Voice Lab · independent comparison**, with its own prompt. It does not modify the existing Luna UX Playground agent. Calls stop after ten minutes. Stopping or switching an option releases its microphone, socket, pending AI request, speech stream, and worker. No conversation audio or transcripts are saved by the lab server; providers apply their own account retention policies.

## Local speech

The in-house option lazily downloads Transformers.js 3.8.1 and pretrained `Xenova/whisper-tiny.en` q8 weights by default; the MIT-licensed `onnx-community/moonshine-tiny-ONNX` remains an optional speed experiment into the browser's cache. Inference runs in a dedicated browser worker on WASM, including on machines without WebGPU. First-load download and model initialization are reported separately. No custom model training, GPU server, or Web Speech API is involved. English speech is the target of these small models; recognition quality for technical vocabulary and accents must be evaluated.

The adaptive energy detector retains a pre-roll and waits 700 ms after speech by default. It is deliberately simple and is weaker than a learned endpoint detector in noisy rooms. A 20-second limit bounds each custom-pipeline utterance. Microphone audio stays in the browser for the local option; the transcript goes to the selected text provider and the reply text goes to ElevenLabs. All other options send speech to their corresponding hosted provider.

## Comparison method

1. Start one option. Use headphones and the same scenario.
2. For a repeatable input, use **Replay a clip** with the same audio file, at most 20 seconds and 10 MB. Live microphone input is suppressed during the replay.
3. Try a short “yes”, a mid-sentence correction, and a thinking pause. Score naturalness and interruptions manually.
4. Export results before reloading. Only exported results persist; credentials are excluded.

First audio means the time from **estimated last voiced microphone frame to the first PCM chunk scheduled in Web Audio**, with queue delay included. It is not acoustic microphone-to-speaker latency. It includes endpoint delay, transcription, reasoning, speech synthesis, networking, and client scheduling. Warm-up is separate. Extremely early native replies may arrive before the local detector formally closes a turn; the reference remains its last detected speech frame.

All hosted audio uses a local-server WebSocket relay in this experiment. This permits consistent PCM/replay instrumentation and server-held credentials, but does not establish optimal production WebRTC latency. Provider-native transports, voices, endpointers and text models differ. In particular, native audio preserves vocal cues that an STT→text chain loses. To isolate local vs hosted STT, select **Groq** with the same text-model override and pause setting for the local challenger, then compare it with Groq × ElevenLabs. No winner is preselected.

## Verification

`npm run voice-lab:test` runs offline unit checks; `npm run voice-lab:build` verifies the frontend build. `node voice-lab/tests/browser.mjs` exercises UI/setup/error cleanup against the running server. `node voice-lab/tests/live-comparison.mjs --live` is explicitly opt-in, incurs real provider usage, and expects a synthetic fixture at `voice-lab/test-results/probe.wav`. The fixture is not committed. Read the saved [live measurement evidence](research/live-comparison.json) for actual runs and limitations.

## Reference code and ownership

Adapters and the browser UI were implemented in this repository against the providers' documented protocols. The app reuses its own `server/codex.mjs` and `server/speech-stream.mjs`, with an isolated app-server transport in `voice-lab/oauth.mjs`. External repositories informed design and review; downloaded reference source snapshots are excluded from Git. Their licenses do not grant access to hosted APIs. Model/runtime licenses are independent of API billing.
