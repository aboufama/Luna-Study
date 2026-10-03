# Initial GPT-Live transport smoke findings

These are rapid integration findings, before the comprehensive cohort. They establish provider access and an actual round trip, not a quality pass or a latency improvement.

All rapid runs through `gpt-live-policy-02.json` disabled material retrieval to isolate the voice adapter, using the full small synthetic sources in both arms. They are therefore not measurements of the complete current production retrieval path. The follow-up policy runner enables actual Jev prefetch and bounded retrieval tools. All cohorts use fixture-prepared questions with production canonical bank identity/masking/consumption; question preparation and import indexing are not included in their latency measurements.

| Attempt | Outcome |
| --- | --- |
| `gpt-live-smoke-01.json` | Harness setup rejected invalid `difficulty: hard`; no provider voice session opened. Synthetic input generation remained billable. |
| `gpt-live-smoke-02.json` | Harness setup rejected a prefixed test ID rather than a UUID; no provider voice session opened. Synthetic input generation remained billable. |
| `gpt-live-smoke-03.json` | Current Terra/Scribe/Eleven arm completed one request: estimated speech-energy end to first received PCM 3,475.2 ms. GPT-Live connected in 683.1 ms, but its first Terra backend response failed output validation before voice output. Session close reported 19 seconds. |
| `gpt-live-smoke-04.json` | GPT-Live completed greeting and one real synthetic student request. First received PCM was 3,338.1 ms after estimated speech-energy end. Session close reported 22 seconds. **Voice fidelity failed.** |

The repeated synthetic generation calls used the same phrase and seed but returned different PCM hashes. Therefore the successful control in attempt 03 and GPT-Live retry in attempt 04 are not a bitwise matched pair. The apparent 137 ms difference is not evidence of a speedup. Future A/B/B/A runs keep each original PCM clip in memory and reuse it across every arm.

The transport-smoke `complete` state in attempt 04 only means the expected local transcript/audio-end packets arrived. Reviewing GPT-Live's actual public output transcript found:

1. The backend approved “Why is a cell membrane called a selective boundary, and how do passive and active transport differ?” GPT-Live instead began with “How does the cell membrane help maintain homeostasis?” before paraphrasing the approved question. That changes the canonical academic target.
2. GPT-Live began an autonomous “OK. I'll start a quick practice.” while the backend was working. Its latter words were associated with an active delivery stream once backend commentary arrived. A boolean active-stream gate cannot by itself establish that audio belongs to the newly authorized reply.
3. The backend's next full reply was “Great—start with the question already on the table. Explain the membrane’s selective role, then compare passive and active transport.” The observed voice transcript reached only “Great—” before the provisional output-quiet audio-end caused the harness to end the session. A short quiet period is not reliable proof that GPT-Live finished speaking the approved content.

Consequently first audio in this run may be filler or an unauthorized continuation. **Useful approved-answer latency remains unmeasured.** Prompt/stream-boundary/completion changes must be validated on real audio before promoting the experiment.

Reported list-price estimates for the recorded application events total approximately $0.06415 across attempts 03–04. This is incomplete: it excludes unpriced synthetic input generation and any missing usage on the failed/canceled backend requests. Four synthetic input requests each submitted 65 characters. Provider session seconds are measured; dollar estimates are not account charges. See each raw report's accounting coverage and request status.

The current matched probe additionally waits the simulated PCM playback duration between ordinary turns, since ElevenLabs may deliver output faster than real-time while GPT-Live clocks continuous duplex audio. It sends silence every 100 ms throughout startup and backend/voice output. Six local protocol/measurement tests pass. The next policy cohort covers a canonical question, a spoken request for a hint without a permit, and a problem switch, with real app-owned Terra/Jev/voice paths and isolated synthetic study data.

## Refined adapter replay

Attempt `gpt-live-smoke-05.json` passed a real production greeting and one delegated request with **2/2 exact normalized native voice/backend text matches**. The adapter now buffers the full approved utterance and waits for matching voice text plus a quiet interval. It did not reproduce the earlier homeostasis expansion or the truncated “Great” in this run. First received PCM was 3,308.7 ms after estimated speech-energy end; first backend text was 2,068.9 ms. Provider close reported 36 seconds, and measured application events were estimated at $0.04023021, excluding synthetic input generation. This is one successful smoke run, not a comparative performance result.

The subsequent bitwise matched `gpt-live-policy-01.json` cohort stopped after the first GPT-Live request failed. Control session 1 completed all three utterances. The native voice session completed an exact greeting, fully transcribed “Please ask me the membrane transport question,” then **chose to repeat the question autonomously without creating client delegation**. The application correctly dropped autonomous audio, but therefore received no committed user transcript and ran no tutor backend turn. The student-facing path remained silent until the benchmark timed out. Provider close reported 40 seconds. Two remaining planned sessions were not run.

This exposes a separate control issue: relying exclusively on the voice model to decide when to delegate can lose ordinary academic turns. A successful literal-speech smoke does not prove robust conversational routing. The matched cohort is incomplete and provides no defensible GPT-Live speedup estimate.

The control’s spoken hint request was correctly directed to the Hint button with three hints preserved. Its algebra switch asked the exact new question without giving the answer. Scribe split the two-sentence switch input into two commits, which remains recorded as a natural segmentation edge case. Native voice comparisons must retain such failures and independent actual-spoken transcripts rather than comparing only backend captions.

## Environmental interruption of the second policy attempt

`gpt-live-policy-02.json` is invalid as a comparative latency/reliability run. macOS power logs show the host entered idle sleep at 14:11:01 EDT and woke at 14:12:58, a reported 117-second sleep. The GPT-Live session ran from 14:10:48 to 14:12:58, so the process's 90-second timer could not execute on schedule and silence/network streaming stopped. The observed timeout and missing provider final usage must not be attributed to the API. See `gpt-live-policy-02-environment.json` for the narrowly retained evidence. The next bounded command uses `caffeinate -i` so idle sleep cannot interrupt the measurement.
