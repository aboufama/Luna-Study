# GPT-Live protocol and experiment accounting

This is an experimental transport for Luna's existing tutor backend. GPT-Live 1 replaces Scribe recognition and ElevenLabs speech synthesis; Terra, the question bank, Jev, hint authorization, whiteboards, and independent mastery checks remain application responsibilities. It is not a direct replacement of the main tutor model.

## Connection and controls

The server opens `wss://api.openai.com/v1/live/sessions`, authenticates with its existing project key, and sends `session.start`. The session uses `gpt-live-1`, client delegation, Marin, and mono PCM16LE at 16 kHz. Input stays continuous, including silence. Browser audio goes through the existing local WebSocket and worklet; this experiment does not use WebRTC. The project key stays server-side. [Official connection protocol](https://developers.openai.com/api/docs/guides/voice-websockets?api=live).

Live's delegation event contains an ID and timestamp, not the student request. The adapter maintains timestamped transcript fragments. It commits the fragments associated with a delegation after a short settling period. If Live never delegates, an application fallback waits 550 ms after a terminal punctuation fragment, or 1,100 ms for an unpunctuated tail, and, when microphone PCM is available, at least 400 ms of measured quiet. It then starts the existing backend with a null delegation ID. A late provider delegation cannot create a duplicate student attempt. [Client delegation](https://developers.openai.com/api/docs/guides/live-delegation).

The adapter buffers the entire approved tutor reply before returning it to Live. Actual voice transcript text is compared against that reply, with narrowly specified pronunciation equivalence for numbers and mathematical operators. One leading neutral acknowledgment may precede the complete approved body: “okay,” “ok,” “alright,” “all right,” or “got it.” The audit preserves raw wording, literal equality, normalized equality, the accepted prefix, and approved-body equality separately. Evaluative additions such as “correct,” “yes,” or “great,” repeated acknowledgments, changed academic content, and extra suffixes still fail. Streaming acknowledgment tolerance requires a comma or period; “all right angles” and the mathematical variable “OK = 5” are not stripped.

A mismatching prefix stops further playback; unfinished lexical or spelled-number tails may settle for 500 ms to avoid rejecting a split word. An incomplete reply cannot report successful completion. Mathematical signs and grouping must not disappear during comparison. These controls can stop subsequent audio but cannot retract anything already heard.

The primary Live WebSocket has no authoritative utterance-end or output-audio-done event. Completion therefore requires full transcript coverage and 1.5 seconds without a voiced output frame. This is still a local heuristic. Provider output transcripts and PCM have separate arrival timing and no shared turn ID, so active-stream association does not prove exact acoustic delivery. A late input fragment beyond the committed boundary is recorded as uncertain, not submitted as another answer. [Session and transcript semantics](https://developers.openai.com/api/docs/guides/live-conversations).

Graceful close sends `session.close`, retains the connection for `session.closed`, and records final provider seconds. Shutdown can await this promise; after a bounded timeout, finalization remains explicitly unconfirmed. Cumulative `session.usage.updated` snapshots are never summed.

## Evidence and failed attempts

| Artifact | Interpretation |
| --- | --- |
| `gpt-live-access.json` | Real account access; session ready in 1,553 ms, clean finalization, zero provider seconds. |
| `gpt-live-smoke-01.json` | Harness rejected invalid difficulty before application provider calls. Input synthesis had already run. |
| `gpt-live-smoke-02.json` | Harness rejected invalid test ID before application provider calls. Input synthesis had already run. |
| `gpt-live-smoke-03.json` | Eleven baseline responded; the Live arm's backend failed output validation before speech. Live final duration: 19 seconds. |
| `gpt-live-smoke-04.json` | Transport completed but voice fidelity failed: changed academic question, autonomous filler, and premature completion after “Great.” This is not a quality success. |
| `gpt-live-smoke-05.json` | Full reply buffering produced matching reported transcripts for greeting and response. One synthetic student request is insufficient to establish reliability. |
| `gpt-live-policy-01.json` | Baseline completed three requests. Live repeated a question without delegating, so its application audio gate correctly withheld autonomous output but the student received no backend response. This motivated the transcript-idle fallback. |
| `gpt-live-policy-02.json` | Live input tail split around a host sleep transition. Independently checked `pmset` records show Idle Sleep 14:11:01–14:12:58 EDT, 117 seconds. The affected Live arm is invalid for performance/reliability inference; measured costs remain included and missing final duration stays unknown. See `gpt-live-policy-02-environment.json`. |
| `gpt-live-policy-03.json` | The Eleven control encountered microphone backpressure before the Live arm ran. This does not measure Live's performance. Production retrieval was enabled for this and subsequent policy runs. |
| `gpt-live-policy-04.json` | First Live session completed greeting and three requested turns with approved wording, including math. The second Live session reached its hint-button reminder but was stopped before any audio because the model prefixed “Okay,” to the approved sentence. This exposed an overly strict acknowledgment policy; it does not demonstrate unauthorized teaching. |
| `gpt-live-policy-05.json` | Final bounded run used the narrow acknowledgment allowance. Greeting and canonical question matched, but the hint request produced “Okay, I’ll” instead of the approved hint-button reminder. The incompatible continuation stopped playback after three PCM packets totaling 300 ms had been delivered. Exact audible words are unknown without acoustic alignment. Normal input delegation and backend authorization worked; the remaining failure is native voice wording. No further paid retry was run. |

The comparison runner's subsequent numbered reports contain the later cohort. Preserve failures when calculating reliability and spending. A local `complete` transport status is not a semantic or learning-quality pass.

The final frozen transport is SHA256 `dd0e79289f85b6ac617421631f13e4069a3fb65dedfe6a543d804136a4e6d821`, with 40 adapter tests passing. The real provider failure remains evidence against promoting this transport to the default for strictly controlled tutor replies. This test does not show that a forbidden hint was delivered, but it does show that approved content is not reliably spoken through a prompt-only native voice frontend.

Two direct transport probes were executed outside the report-writing harness. Their facts are explicitly reconstructed from completed tool output in the accounting script:

- Initial approved greeting: 904 ms from submitted commentary to audible received PCM, matching public transcript, four provider seconds.
- Revised full-utterance probe: greeting 1,087 ms and membrane question 883 ms from commentary to audible received PCM; both reported exact wording; 13 provider seconds total.

These fixed-text probes excluded recognition, routing, retrieval, and tutor reasoning. They must not be compared directly with end-to-end student-speech latency. They used silent synthetic microphone input and did not measure real speaker playback.

## Reproducible accounting

Run `node benchmarks/gpt-live-cost-summary.mjs` to update `benchmarks/gpt-live-cost-summary.json`. The script enumerates numbered smoke/policy files, selects one snapshot per test ID, sums each session once, and separately records the two reconstructed probes and access check. Per-category totals partition the combined benchmark estimate; adding them again would double-count.

GPT-Live's published rate is $0.05 per minute, billed per second, with backend model/tool charges separate. The report multiplies final provider seconds by that rate. Other estimates use the recorded application ledger's model, token/cache counters, voice characters, and sent-audio measurements. These are public list-price estimates, not account charges. [GPT-Live model pricing](https://developers.openai.com/api/docs/models/gpt-live-1).

Synthetic input clips were generated with ElevenLabs Flash. The artifacts record characters, PCM hashes, and conservative reservation ceilings, but not attributable per-request charged credits or USD. Account-wide credit snapshots can lag or include other activity; they are retained as observations and never treated as isolated clip charges. Missing usage from failed or canceled backend requests remains unestimated, not zero. Interactive user demo sessions and unrelated earlier experiments are outside this benchmark subtotal.

Through policy05, recorded usage estimates total **$0.451296**, comprising $0.437129 from numbered benchmarks and $0.014167 from the two direct transport probes. The numbered benchmark total partitions into voice $0.234117, backend LLM $0.199365, and Jev $0.003647. There are 249 confirmed Live seconds across benchmarks and direct probes; their $0.207500 voice estimate is already included in the combined amount. Fourteen application requests lack usable usage, one sleep-affected Live session lacks confirmed final duration, and 20 synthetic clip calls (1,145 submitted characters) have unknown attributable cost. This is a measured subtotal, not an exact bill or a complete experiment cost. The 16 recorded benchmark sessions include preflight failures, interrupted sessions, and invalid environmental runs; their failure count is not an API error-rate estimate.

First received audio can be filler. First useful approved-answer audio remains a distinct metric requiring acoustic or aligned-content review. Separate runs returned different PCM hashes despite the same seed, so cross-run numbers are not a matched causal speed comparison. A small matched cohort can identify failures and broad latency behavior; it cannot establish long-session reliability or equivalent tutoring performance.
