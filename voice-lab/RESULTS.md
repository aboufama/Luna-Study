# Voice Lab: measured results and remaining access

October 3, 2026. Real provider audio, not canned responses. Synthetic speech was replayed in headless Chromium, followed by actual provider speech scheduled in Web Audio. The same 4.27-second input clip asked: “What is the difference between mitosis and meiosis? Keep it brief.”

## Delivered pipeline

| Option | Trial 1: first scheduled audio | Trial 2 | Median | Recognition |
|---|---:|---:|---:|---|
| ElevenLabs Agents | 2.382 s | 1.550 s | **1.966 s** | Exact input transcript both times |
| In-house: browser Whisper tiny.en → streaming Codex OAuth GPT-5.6 Luna → ElevenLabs | 4.782 s | 4.376 s | **4.579 s** | Exact input transcript both times |

**The in-house option did not beat ElevenLabs Agents in these trials.** Its browser transcription took 1.170–1.376 s, and its OAuth text model took 1.848–2.495 s to emit first text. Model load/warm-up took 3.192 s and 1.646 s and is excluded from turn latency, reported separately. All four completed trials released microphone tracks after stopping.

The earlier baseline used Moonshine tiny and a full-response CLI invocation. It misheard “meiosis” as “myosis” and “Keep it brief” as “Keep it grief,” and a short silence threshold split the prompt into two turns. Final-response delays were 10.497 s and 7.562 s. The delivered version uses a more accurate recognizer for this clip, a 700 ms pause setting, and true OAuth token streaming. Multiple factors changed together; this is an engineering improvement observation, **not a controlled estimate of the streaming transport's speedup**.

Moonshine remains available in Fine-tune as a speed experiment. The most useful next controlled comparison is **Groq × ElevenLabs vs local STT + the same Groq model + the same ElevenLabs voice and pause setting**, which requires a Groq API key. It removes the differing text models from the comparison. No claim about its outcome is made before measuring it.

## Access and verification

| Capability | Verified here |
|---|---|
| ElevenLabs Agents | Dedicated lab agent created; two full audio-in/audio-out trials completed |
| ElevenLabs streaming TTS | Real PCM produced for the custom pipeline; no browser TTS substitution |
| Browser-local recognition | WASM worker loaded and transcribed real synthetic speech; both final Whisper transcripts exact |
| OpenAI OAuth | Signed-in CLI verified; GPT-5.6 Luna appears in its model catalog; streaming replies and speech tested |
| OpenAI Realtime | Adapter implemented; configured API key rejected with HTTP 401. No successful Realtime conversation measured |
| Gemini Live | Adapter implemented against current official schema; no key supplied, live path unverified |
| Deepgram | Adapter implemented against current official schema; no key supplied, live path unverified |
| Groq cloud pipeline | STT and streaming-text adapters implemented; no key supplied, live path unverified |

Offline protocol checks cover WAV encoding, malformed/oversized PCM, fragmented UTF-8 SSE, same-origin loopback access, VAD pre-roll, and pauses. Browser checks cover six options, missing-key configuration, real auth-failure cleanup, narrow-screen overflow, cancellation while microphone access is pending, late stream disposal, provider-failure cleanup, closed AudioContexts, and no remaining sockets. Frontend build passes. The unchanged study app has not been fully re-audited as part of this isolated experiment.

## What these numbers do and do not say

- The reference is the last locally detected speech frame; the endpoint detector is an energy heuristic. Timing includes its pause plus transcription, text, speech, network, and scheduling. It is not a physical acoustic measurement.
- Two trials per option are a smoke test, not reliable p50/p95 estimates. The median is descriptive for these two values only.
- Hosted Agents and custom OAuth used different text models and different endpointing. The custom recognizer runs on this machine's CPU. No general ranking follows.
- The local-server WebSocket relay is consistent across this demo, but production WebRTC can perform differently.
- Naturalness and interruption quality have not been assigned automated scores. The page collects your listening ratings.
- Historical test results are saved here; the page starts with an empty session so your own results are not mixed with these.

Raw final evidence: [live-comparison.json](research/live-comparison.json). Initial baseline: [live-comparison-before-streaming.json](research/live-comparison-before-streaming.json). Synthetic audio fixtures and screenshots are excluded from Git.
