# GPT-Live final bounded policy findings

**Keep the current voice pipeline as the default.** GPT-Live successfully speaks approved tutoring content in some real sessions, but the final comparison stopped on another voice-content deviation. This experiment does not establish a latency or reliability improvement, and the planned four-session comparison did not finish. No further paid retries were run after this final attempt.

## Final policy05 observations

The final cohort ran on October 2, 2026, 19:15:48–19:17:11 UTC. It used the production Terra/Jev/retrieval/voice path on an isolated localhost server, the same three synthetic 16 kHz PCM clips across arms, and six fixture-prepared canonical questions ready before either transport connected. The question-bank preparation model was deliberately replaced with a fixed fixture; retrieval and tutoring were real. The frozen adapter SHA256 was `dd0e79289f85b6ac617421631f13e4069a3fb65dedfe6a543d804136a4e6d821`. Caffeinate prevented idle sleep; maximum event-loop lag was 2 ms. The current preview server and user data were not modified by this harness.

| Request | Current Scribe + Terra + Eleven | GPT-Live + same Terra/Jev backend |
| --- | ---: | ---: |
| Restate canonical membrane question | Complete; first PCM 3,090.3 ms | Complete; first PCM 4,390.0 ms |
| Ask for an unauthorized hint | Complete refusal; first PCM 1,379.3 ms | Failed during unapproved opening; no complete refusal |
| Switch to algebra without solving it | Correct question spoken; first PCM 3,863.5 ms | Not attempted after failure |

The table measures estimated student speech-energy end to first received PCM. First useful academic audio, physical speaker latency, and browser microphone buffering were not measured. One complete paired request is not enough for a stable median, tail latency, or general speed claim. The failed hint produced its first PCM at 1,685.4 ms, but that is a failed response and is excluded from successful latency aggregates.

For the one completed matched restatement, both providers were sent the same canonical question. GPT-Live took 2,250.3 ms to commit the student transcript versus 814.7 ms for Scribe. From commitment to first PCM, native voice took 2,139.7 ms versus 2,275.6 ms for the current pipeline. A 135.9 ms improvement after commitment was outweighed by a 1,435.6 ms longer commitment delay, producing a net 1,299.7 ms slower response in this sample.

The native greeting and canonical restatement matched approved text literally. On the next request, the approved reply was “Use the Hint button for a nudge, or tell me your first step.” The provider instead began “Okay, I’ll”. The finite neutral acknowledgement allowance accepted “Okay,”, but “I’ll” did not begin the approved body. The guard then stopped further playback and surfaced a recoverable error. Three 16 kHz PCM packets, totaling 9,600 bytes or 300 ms of generated audio, had already reached the client. Transcript/audio alignment was not measured, so the audible words cannot be inferred exactly. No academic hint or solution was observed. The hint count stayed at three, but the student did not receive the intended complete refusal.

This failure used normal provider delegation. It was not another missing-delegation timeout or host-sleep artifact. The backend selected the correct fixed policy response in approximately 197 ms. The remaining failure is the generative voice layer departing from the authorized text, despite a verbatim instruction and full-utterance buffer.

## Additional state finding

Both transports exposed a separate practice-state discrepancy: after the correct canonical question was spoken, `practice-state.current.status` was `set-aside`, with zero attempts and no assistance. The control's final algebra question had that status; the native canonical biology restatement also had it with a single committed student transcript. Therefore this is not explained solely by Scribe splitting the two-sentence algebra request. It should be corrected and regression-tested independently of the voice experiment.

The control hid its biology board on the algebra switch, before the new question audio. The native session stopped before that scenario and cannot claim a fresh topic-switch/whiteboard pass in policy05. No mastery points were awarded, which is appropriate because these student inputs contained no answer attempt. Real independent grading, earned hints, interruptions, screenshots, inactivity, and a full thirty-minute learning session were **not exercised by this small paid cohort**; they remain separate coverage obligations, even where existing deterministic suites test their rules.

## Accounting and reproducibility

| Measured application estimate | Control session | Native session |
| --- | ---: | ---: |
| Jev | $0.00061538 | $0.00027489 |
| Thinking / LLM | $0.03618440 | $0.01320290 |
| Voice | $0.00883728 | $0.02416667 |
| Total | $0.04563706 | $0.03764446 |

These are published-price estimates from recorded application units, not exact billed charges. The shorter failed native session reported 29 provider session seconds. The control includes two canceled LLM requests with missing usage and one partial voice estimate. The combined measured estimate is $0.08328152, excluding unpriced synthesis of 164 source characters and unreported usage. Different completion lengths prevent a paired cost conclusion. The account-wide Eleven credit change is retained in the raw report and is not attributed solely to this run.

Primary artifacts: `gpt-live-policy-05.json` preserves all raw public events, provider debug events, usage coverage, code hashes and source-clip hashes. `gpt-live-policy-05.audit.json` separates literal equality, normalized equality, permitted neutral prefixes, approved-body equality, actual native transcripts, backend captions, hints, boards and practice/mastery state. The benchmark probe and usage-budget tests pass 14/14; the frozen adapter's separate suite passed 40/40 before this paid run. Passing deterministic checks did not prevent the observed real provider deviation.

The earlier slow native sample in policy04 has a saved waterfall in `gpt-live-waterfall-04.json`: 1,117 ms final-ASR arrival + 1,106 ms commit wait + 238 ms orchestration + 2,685 ms Terra first text + 931 ms remaining full output/handoff + 912 ms voice = 6,989 ms. No retrieval tool call occurred on that turn. This identifies two costs of the present architecture: endpoint/commit delay and waiting for the complete authorized response before native speech.

# Earlier policy04 cohort (retained history)

The refined integration can complete a real tutoring session while preserving the approved question wording, hint refusal, and an algebra problem switch. It has **not yet completed the requested four-session comparison**, and these measurements do not establish a latency improvement.

`gpt-live-policy-04.json` used production material retrieval, real Terra/Jev/voice providers, a fixture-prepared canonical question bank prepared before both transports started, and the same three retained PCM clips across all arms. The adapter revision was `54cc0ce74e55338893d3b77b762886bbf92aac5e1d1da65a791e10f351db2b69`. Input was replayed in 100 ms packets with continuous silence, and ordinary turns waited for simulated output playback. Browser microphone batching, physical speaker playback, and learning outcomes were not measured. Host sleep was prevented; maximum observed event-loop lag was 81 ms.

| Request | Eleven control, first session | GPT-Live, first session | GPT-Live, second session |
| --- | ---: | ---: | ---: |
| Repeat canonical membrane question | 2,990.8 ms | 4,248.7 ms | 6,988.8 ms |
| Ask for a hint without using the button | 1,515.2 ms | 1,526.4 ms | Stopped on “Okay,” prefix; no audio delivered |
| Switch to the algebra problem | 4,639.7 ms | 4,635.3 ms | Not run after failure |

Times are estimated student speech-energy end to first received PCM. They are packet-arrival timings, not first-useful-answer measurements. The missing final control session and stopped native session prevent a balanced aggregate comparison. Native canonical restatement was slower in both observed runs; hint/switch timings were similar in the one completed pair. Small samples and variable real backend replies remain material limitations.

The first native session passed all three requests. It repeated the canonical question, referred an unauthorized hint request to the Hint button, preserved three remaining hints, and asked “How do equal operations solve 2x + 3 = 11, and why are those operations valid?” without revealing the answer. Actual native voice matched approved content, allowing explicit numeral/operator pronunciation equivalence for “two x plus three equals eleven.”

The second native session completed its greeting and canonical restatement, then emitted “Okay,” before the approved hint refusal. The exact-content guard rejected that prefix and stopped the turn before any PCM reached the client. This prevented unintended content exposure but caused an unnecessary conversational error for a harmless acknowledgement. A finite acknowledgement allowance may improve natural behavior, provided the remaining academic content must still match the approved reply and all raw spoken text remains logged.

The policy cohort's measured application events total approximately $0.14760 in published-price estimates, including the failed native turn; synthetic source generation and unreported usage are excluded. Native sessions reported 52 and 34 billable seconds. The control includes incomplete usage on canceled work, so costs are not a complete billed comparison. Original counters and coverage are in the raw report and its audit.

Earlier attempts remain retained: policy 01 exposed missing client delegation; policy 02 was interrupted by a verified 117-second host sleep and is invalid for API latency/reliability; policy 03 stopped in control startup with outgoing Scribe backpressure and simultaneous stalled provider work, before any GPT-Live session. These must not be collapsed into a single native-model failure percentage. See `gpt-live-initial-findings.md` for rapid integration history and `gpt-live-policy-04.audit.json` for separate backend/native transcripts, literal and normalized equality, boards, hints, mastery state and per-scenario timing.
