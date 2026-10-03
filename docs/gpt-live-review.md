# GPT-Live experimental voice correctness review

Updated 2026-10-02 after the full-reply transport and playback fixes. This review separates verified fixes from remaining limitations. Offline adversarial tests do not measure real model error frequency, human learning outcomes, or physical audio quality.

## Current implementation and verified improvements

| Initial preview problem | Current behavior | Evidence and limit |
| --- | --- | --- |
| Commentary clauses let the voice model invent a continuation. | The whole approved reply is buffered and submitted once at `finish()`. | Regression verifies one complete submission. Clause-level startup is sacrificed; this cannot force compliance. |
| Provider text was diagnostics-only; backend text was incorrectly recorded as spoken. | Actual transcript reaches captions and `lastSpokenAssistant`, and is recorded as spoken. Planned Terra text is recorded as `spoken:false`. | Integration tests verify both records. Planned text still enters teaching history and is sent as a caption candidate. |
| Requested and actual wording were not compared. | Normalized words are compared; a mismatch stops later playback and records fidelity. | A mismatch-before-audio test rejects subsequent PCM. Already-played audio cannot be retracted. |
| Grading could proceed without a voice-text check. | `captureAnswer` rejects a candidate while `voiceDeliveryVerified` is false. Mismatched speech marks the working question assisted. | Missing/partial/mismatched text checks pass. The completion boundary below still matters. |
| Quiet PCM was held or removed, creating gaps or doubled pauses. | All PCM after the first voiced frame, including quiet frames, is forwarded immediately. | Transport test verifies ordering and immediate quiet-frame forwarding. |
| An incomplete prefix could finish after an 800 ms gap. | Completion now requires a complete normalized transcript match and a 1500 ms quiet interval. Missing audio/incomplete replies fail explicitly. | Long-pause, partial-prefix and silence-only tests pass. Completion remains a local heuristic. |
| Delayed input fragments could become bogus new attempts, while missing delegation could stall a reply. | Fragments are timestamp-ordered, later input is excluded from older delegation, duplicates are rejected, and committed timestamps are not recommitted. A 550 ms transcript-idle fallback also requires 400 ms of quiet input PCM when real input is present. | Ordering/duplicate tests pass. Fallback is explicitly labeled; there is still no provider-confirmed final transcript boundary. |
| Close could race teardown and lose final accounting. | Close is awaitable, collects final cumulative usage, and reports bounded timeout as unconfirmed. | Final-usage, provider-error and timeout checks pass. |
| The browser inserted avoidable silence per packet. | GPT-Live uses an 80 ms onset/recovery reserve and otherwise contiguous scheduling. | Sine and recorded-arrival results are in `gpt-live-playback-review.md`. ElevenLabs is unchanged. |

The focused transport, integration, playback, caption and hint-client suites pass **52/52** at this review. This is a regression result, not proof of equal tutoring quality.

## Remaining limitations

### Transcript match is not playback completion

`openSpeech` currently sets `voiceDeliveryVerified = value.matched === true` on any provider transcript callback. It does not require `value.final`, complete audio, or confirmation that the browser played the reply. A full matching transcript may precede its audio or later additions. Cancellation can also finalize matching text while playback was interrupted.

This improves the initial preview, but the flag is stronger than the evidence. The next step is separate text fidelity, audio generation and delivered playback states; grading should depend on an accepted complete question-exposure state. Missing or uncertain exposure should not reserve a scored attempt.

The original normalizer removed meaningful signs. **That defect is fixed in current code:** normalization now preserves operators and grouping, and narrowly maps written numbers/operators to their spoken equivalents. The regression set distinguishes plus/minus, equals/not-equals, inequalities, grouped arithmetic and subscripts. This is still a text-pronunciation comparison, not proof of equivalent mathematical meaning or verified playback.

### Output audio is not bound to a verified backend turn

The session output handler dispatches every audio packet to current `activeSpeech`. After complete commentary is submitted, the gate accepts packets without correlating them with a provider output segment or delegation. Late callbacks on old objects are rejected; a late old provider packet arriving through the shared WebSocket after a new object becomes active can still acquire the new Luna turn ID.

Correlate documented provider segment/timing identities with an authorized epoch and maintain a cancellation fence. If the protocol cannot prove the boundary, ambiguous audio cannot count as verified current-turn output. A quiet delay is mitigation, not provenance. Recreating the provider session gives a stronger boundary with latency/context costs to measure.

### Mismatch checks cannot retract unauthorized help

Full-reply submission and transcript checks reduce drift. The voice model still generates audio independently. Audio arriving before a mismatching transcript may already reach the student. The three-hint quota therefore deterministically limits **requested backend hint generations**, but does not guarantee the second model never adds a hint.

Strict prevention requires holding audio until corresponding text is verified, or deterministic TTS for academic content. Either changes latency. Stronger prompt wording alone cannot establish the invariant.

### Captions, hint exposure and notices need delivery evidence

Planned Terra text and actual provider text currently share the same caption turn. The estimated caption timeline refuses to replace already-shown text with a non-prefix revision, so changed wording can stop captions advancing. Choose one authoritative spoken-caption source for this route; retain planned text separately for debugging.

Hint permits still commit at the first Terra token, before speech. Generating that token is not necessarily student exposure because captions follow consumed PCM. Failed or interrupted speech can charge a hint never heard. Commit on verified audio/caption exposure and retain conservative assistance state when delivery is uncertain.

Mastery-notice completion now benefits from the full normalized transcript requirement; the old incomplete-prefix case is mitigated. However, `onEnd` is still a quiet detector and the server does not await browser playback completion. It is not provider-confirmed or verified fully delivered.

### Input boundaries and concurrency remain experimental

Timestamp ordering and duplicate protection fix concrete faults. Discarding late fragments prevents duplicate attempts but can omit a genuinely delayed suffix. Delegation diagnostics correctly mark the boundary unconfirmed. The new transcript-idle/quiet-PCM fallback prevents indefinitely stranded text when GPT-Live omits delegation. It supplies a heuristic boundary for non-delegated speech, including greetings. Natural within-turn pauses, delayed recognition and short adjacent utterances still require testing; the fallback is not a provider-final transcript.

The two `attachLiveVoice` instances still have separate client locks. The selector closes its prior engine, but separate tabs can run one session per route. Use a shared lock if the intended rule is one conversation across both engines.

## Historical adversarial evidence and current status

A fake WebSocket drove the original transport with no API calls or microphone. Approved text was “Use the Hint button for a nudge.”; supplied provider text was “The complete answer is six.” followed by PCM. The initial adapter delivered it. **Current code stops subsequent PCM when the mismatch is received first.** Pre-transcript audio remains outside this guarantee.

Canceling one speech object, submitting another, and injecting old PCM through the shared provider socket delivered it to the new callback. **That attribution limitation remains.**

An accelerated quiet timer originally ended an incomplete prefix before a later clause. **Current tests prevent this with the complete normalized transcript requirement.** The resulting endpoint is still heuristic.

A greeting without delegation followed by a study request originally committed “Hello. What is diffusion?”. **Timestamp protection plus the new idle/quiet fallback now supply a local boundary; its adequacy under conversational pauses remains to be measured.**

## Small real-provider smoke result

`benchmarks/gpt-live-smoke-05.json` completed one measured request using synthetic 16 kHz input at 100 ms replay cadence. Speech-energy-end to first received audio was **3308.7 ms**, and first text was **2068.9 ms**. The startup reply and measured reply both passed normalized transcript fidelity (2/2). This is one request, not a statistically meaningful performance distribution. The file explicitly leaves first useful audio unannotated and did not test hardware playback. The later 20 ms browser microphone optimization does not retroactively change this benchmark.

## Final browser and promotion checks

After the updated server started, an isolated Brave tab loaded `http://127.0.0.1:5188/?voice=gpt-live`. The selector displayed GPT-Live, switched to Terra + ElevenLabs and back, and updated the URL correctly. No application-origin warning/error was observed; warnings belonged to an unrelated browser extension. No study card, microphone or provider session was opened.

Voice intentionally closes on unmount/pagehide and engine changes. Selector changes use `history.replaceState`, not navigation. No new automatic reload loop was found. Vite development edits may remount/reload the app, which correctly closes the paid connection; stable files are required during listening tests.

Before a scored default switch, compare matched prerecorded input and actual spoken transcripts across engines. Include exact restatement, unauthorized-answer requests, all hint levels/exhaustion/cooldown, wrong answers, problem switches, overlapping speech, delayed output, pauses and disconnects. Report substantive audio separately from filler, wording fidelity, unrequested help, grading errors, board-target agreement, interruption tail and unverified output. Physical microphone/speaker acoustics have **not** been tested by this review, and crackle is **not** claimed fully resolved.
