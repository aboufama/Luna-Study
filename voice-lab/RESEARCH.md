# Voice agents: research before selection

Reviewed October 3, 2026. The saved inventory covers **34 repositories**, including **10 smaller composition/browser projects**, rather than treating the first five SDKs as the answer. Metadata and READMEs were inspected across the inventory; selected implementation files and recent issue samples were inspected in greater depth. This is a broad, bounded review, not a claim to have audited every file or found every voice project on GitHub. Push dates and star counts are discovery signals, not quality scores.

## The five comparisons, plus an in-house challenger

| Option | Why it deserves a listening slot | Important limitation |
|---|---|---|
| OpenAI Realtime | Native audio conversation and interruption baseline; maintained protocol and browser SDK examples. | Working Realtime API access is separate from the signed-in Codex CLI. The old example repository pins an obsolete preview model; this lab follows current GA event shapes. |
| Gemini Live | Independent native-audio family worth comparing for timing, conversational prosody, and interruptions. | Preview/version churn and reported short-response endpointing failures. Test “yes”, names, and pauses. |
| ElevenLabs Agents | Already accessible here, expressive voice, managed Scribe recognition and turn handling. | Agent settings matter; managed orchestration limits stage-level observability. A dedicated lab agent avoids modifying the study app. |
| Deepgram Voice Agent | One connection for a customizable hosted STT/LLM/TTS chain; current Node starter contains explicit audio/event ordering tests. | Hosted chain retains recognition and endpoint latency. Needs a Deepgram credential to measure locally. |
| Groq × ElevenLabs | Tests the smaller-repository composition approach directly: hosted Whisper, a fast hosted text model, and phrase-streamed ElevenLabs. | Batch utterance recognition is not continuous streaming STT. Must include endpoint and upload time, not just advertised model throughput. |
| **Luna in house** | Browser Whisper/Moonshine STT → Groq/OpenAI/Codex text → ElevenLabs. No custom training or GPU server. Same Groq/TTS settings can isolate the effect of local STT. | Client hardware, recognition quality, and pause detection may erase the network savings. OAuth now streams through a prewarmed app-server, although model inference remains a significant delay. |

These are a practical experiment shortlist, **not an empirical ranking**. Hume, xAI, Inworld, and Ultravox are strong reserves. They were not silently treated as equivalent to one of the six. The selection prioritizes two native-audio families, an already accessible voice platform, a streaming managed chain, and a controlled hosted-vs-local STT comparison. This gives each slot a distinct question to answer.

## What the niche source review changed

**[sreerevanth/groq-voice-assistant](https://github.com/sreerevanth/groq-voice-assistant/blob/895a590944ed45ae90bce0f89356236aab8a9dc2/backend/main.py)** is an important caution. Its pipeline docstring depicts early TTS dispatch, but `run_pipeline` actually awaits the completed `stream_llm` reply before `synthesize_speech(reply)`, then sends returned audio. Its sub-500 ms language is a target, not evidence that the implementation delivers streamed first audio at that time. No clear repository license appeared in metadata, so no code was copied.

**[automataIA/realtime-voice-agent](https://github.com/automataIA/realtime-voice-agent/blob/d3b939624b01d989b821ba0cf61974dcc2797abf/app/agent/pipeline.py)** has a real sentence-buffer path while LLM tokens arrive and a lower initial chunk threshold. Its service abstraction is useful; its fake/Edge-TTS modes are unsuitable as evidence of paid-provider performance. Our demo uses actual provider audio or displays a failure. The existing Luna speech buffer already implements a similar incremental-clause pattern and is reused.

**[Superactive-AI/inbrowser-ai](https://github.com/Superactive-AI/inbrowser-ai/blob/275a366c1336c8a9b04b6052981a02b28c107152/stt/whisper.worker.ts)** cleanly separates worker-based recognition from the rest of the pipeline. Its Whisper path requires WebGPU, and its fallback can use browser Web Speech; that fallback does not establish on-device transcription. Our local path uses small Whisper or Moonshine models on WASM and never silently substitutes Web Speech.

**[MissionSquad/BrowserAI](https://github.com/MissionSquad/BrowserAI/blob/2d31c4abd714430eee3829e62fa9ded185562d45/src/voice/voice-pipeline.ts)** exposes useful stage timing, press-to-talk interruption, and streaming speech scheduling. Its documentation correctly distinguishes partial ASR from Whisper/Moonshine utterance results. It is a good design reference, but importing all its model runtimes would add unnecessary dependencies to this targeted experiment.

**[gateniomer/whisper-browser](https://github.com/gateniomer/whisper-browser/tree/b7ed0f4314cee7431f2ca4b77ae62411314921de)** explicitly accounts for browser/worker WebGPU differences, VAD pre-roll, model caching, inference warm-up, and serial transcription. These are practical details missing from many “local AI” demos. Our first-load timing is separate and local inference is serialized. License metadata was absent; this was a design review, not code reuse.

**[alitalari/webrtc-ai-voice-agent](https://github.com/alitalari/webrtc-ai-voice-agent/tree/86f903abbd36986179129434581bd45f2fa38a37)** is a useful independent WebRTC + modular-provider reference with interruption and media tests. Its default setup uses fake providers until keys are configured. A working default demo is therefore not proof of working hosted AI or real latency.

**[enricollen/fastRTC-voice-agent](https://github.com/enricollen/fastRTC-voice-agent/tree/81428ce81050a21568f831d9bb6250ec95ba3d2d)** demonstrates the exact general composition the user suggested—swappable STT, hosted text reasoning, and ElevenLabs. It adds Python/FastRTC/LlamaIndex and provider-fallback behavior that is unnecessary for this isolated browser comparison.

**[xenova/whisper-web](https://github.com/xenova/whisper-web/blob/81869ed62970ff4373509b6004a6c9a3f0c5b64d/src/worker.js)** is a strong browser-ASR reference from the Transformers.js author. Its old main branch is not itself a conversational agent; current runtime/model documentation is a better implementation contract.

**[samsgates/local-voice-agent](https://github.com/samsgates/local-voice-agent)** has VAD, speech chunking and state tests. Its runtime/browser constraints and unclear standard license classification merit review before embedding it. **[00Julian00/Nova](https://github.com/00Julian00/Nova)** combines Groq and ElevenLabs but explicitly says it is no longer maintained and points to Nova2. It is historical evidence of the composition, not the quickest clean starting point today.

## Broader alternatives retained in the review

| Family / repositories | Findings and reason not to add another initial listening slot |
|---|---|
| [LiveKit Agents JS](https://github.com/livekit/agents-js), [Node starter](https://github.com/livekit-examples/agent-starter-node) | Strong production transport/orchestration, not a distinct voice model. Useful later for deployment and endpointing. Extra LiveKit infrastructure does not answer the immediate six-way listening question. |
| [Pipecat](https://github.com/pipecat-ai/pipecat) | Flexible Python pipelines and turn-taking components. A good future orchestrator; hosted providers still supply most voice differences. Vendor latency claims exclude unspecified setup/endpoints. |
| [TEN](https://github.com/TEN-framework/ten-framework) | Broad realtime agent framework with more deployment machinery; review component licenses individually. |
| [FastRTC](https://github.com/gradio-app/fastrtc) | Quick Python browser transport. Recent push activity was weaker than several alternatives in this snapshot. Not a separate acoustic model. |
| [LangChain voice-demo](https://github.com/langchain-ai/voice-demo) | Particularly useful precedent: multiple frameworks/providers in one comparative demo. Strong reference for keeping variants explicit; no clear license in metadata. |
| [OpenAI realtime agents](https://github.com/openai/openai-realtime-agents) | Agents SDK lifecycle patterns are useful, but the sampled hook uses an old preview model. Current official API docs take precedence. |
| [Google live console](https://github.com/google-gemini/live-api-web-console) | Interruption, output scheduling, and transcript event reference. Do not copy browser API-key placement into a public demo. |
| [ElevenLabs packages](https://github.com/elevenlabs/packages), [examples](https://github.com/elevenlabs/examples) | Active SDK code and lifecycle tests. Some old examples are marked deprecated. Use current API metadata for audio formats. |
| [Hume React SDK](https://github.com/HumeAI/hume-react-sdk), [Hume examples](https://github.com/HumeAI/hume-api-examples) | Strong reserve for emotional responsiveness. Separate key/configuration; not selected ahead of the controlled custom-pipeline comparison. |
| [xAI cookbook](https://github.com/xai-org/xai-cookbook) | Active voice-agent WebSocket and WebRTC examples, including ephemeral credentials. Strong native-audio reserve; do not assume obsolete voice-examples paths are current. |
| [Deepgram Node starter](https://github.com/deepgram-starters/node-voice-agent), [older demo](https://github.com/deepgram-devs/deepgram-voice-agent-demo) | Prefer the newer starter and its Settings/audio ordering tests. Old demo maintenance was weaker. |
| [Ultravox JS SDK](https://github.com/fixie-ai/ultravox-client-sdk-js), [model repository](https://github.com/fixie-ai/ultravox) | Hosted call/join-URL path does not require renting a GPU. A strong reserve for speech understanding; model repository and hosted SDK have different implications. |
| [Vapi browser SDK](https://github.com/VapiAI/client-sdk-web), [Retell client](https://github.com/RetellAI/retell-client-js-sdk) | Fast managed launch, particularly phone agents; extra orchestration/vendor layer and assistant setup. Useful product options, not interchangeable acoustic models. |
| [Cartesia Line](https://github.com/cartesia-ai/line) | Compelling managed low-latency speech orchestration, but its Python deployment adds setup relative to an already usable ElevenLabs account. Strong reserve for a TTS swap. |
| [Inworld API examples](https://github.com/inworld-ai/inworld-api-examples) | Small direct realtime examples and both WebSocket/WebRTC paths. Strong reserve; JWT/account setup needed to measure. |
| [Amazon Nova samples](https://github.com/aws-samples/amazon-nova-samples) | Nova Sonic is hosted, not a custom-GPU requirement. IAM, Bedrock access, and bidirectional stream setup add friction for this small experiment. |
| [Bolna](https://github.com/bolna-ai/bolna) | Open orchestration with hosted/dashboard differences; more telephony-oriented setup than the browser comparison needs. |
| [Voice-agent latency benchmark](https://github.com/openbenchmarks-labs/voice-agent-latency) | Useful benchmarking lead. Phone-call measurement is not directly comparable to browser PCM scheduling; no imported leaderboard numbers. |

## Failure modes examined

Recent issues were sampled, not independently reproduced. Reported problems included pending-turn state in LiveKit, Gemini short-utterance detection, failed Gemini connections not becoming terminal in Pipecat, canceling an in-progress ElevenLabs connection, microphone leaks in Vapi, microphone switching in Hume, and tool execution in an OpenAI example. Exact links and titles are preserved in `research/issues.json`. The lesson is lifecycle testing, not a blanket claim that the corresponding SDK is broken.

The lab explicitly closes pending sockets, late-resolving microphone streams, browser workers, queued playback, and canceled text/speech requests. It bounds audio payloads and session duration and does not substitute synthetic replies when a provider fails. Tools, retrieval, multimodal video, phone routing, and the study application's grading flow are intentionally outside this comparison; they would confound the voice test.

## Official implementation references

- [OpenAI Realtime](https://developers.openai.com/api/docs/guides/realtime), [GA conversations](https://developers.openai.com/api/docs/guides/realtime-conversations).
- [Gemini Live WebSocket guide](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket), [Live API schema](https://ai.google.dev/api/live).
- [ElevenLabs Agents WebSocket](https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket), [streamed speech](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd).
- [Deepgram voice settings](https://developers.deepgram.com/docs/voice-agent-settings).
- [Groq speech recognition](https://console.groq.com/docs/speech-to-text), [supported models](https://console.groq.com/docs/models).
- [Moonshine ONNX model card](https://huggingface.co/onnx-community/moonshine-tiny-ONNX).

## Evidence, not a speed promise

Machine-readable snapshots are in `research/github-inventory.json`, `niche-inventory.json`, `code-inventory.json`, `code-evidence.json`, and `issues.json`. Pinned source links above identify exactly which implementation informed the niche findings. Unlicensed sources were inspected, not incorporated.

The lab starts with empty results. Live measurements, when made, are saved separately in `research/live-comparison.json`. Missing provider keys, authentication failures, and untested paths are reported explicitly. Tiny sample sizes, distinct text models, synthetic speech, localhost relaying, and estimated endpoint timing prevent a production “fastest” claim. Human listening remains necessary to judge naturalness.
