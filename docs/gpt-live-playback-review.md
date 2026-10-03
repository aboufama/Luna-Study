# GPT-Live playback gap review

2026-10-02. This diagnoses software scheduling against synthetic PCM and recorded packet arrival times. It does not establish the state of the user's microphone, speaker, Bluetooth route, acoustic echo cancellation, or actual perceived audio after the fix.

## Demonstrated client defect

The prior player placed **every** incoming audio buffer at `max(currentTime + 25 ms, previousBufferEnd)`. For a real-time stream, a packet can arrive before the previous buffer ends but with less than 25 ms remaining. The player then adds silence despite having received the next samples in time. The discontinuity can sound like a tick or crackle when the waveform is nonzero.

For example, if a previous buffer ends at 180 ms and the next packet arrives at 170 ms, a contiguous start at 180 ms is possible. Reapplying a 25 ms reserve instead schedules at 195 ms and inserts a 15 ms gap.

## Change

Only the `/api/gpt-live` client uses continuous-stream scheduling. It starts with an 80 ms reserve, preserves contiguous sample boundaries whenever at least 5 ms remain, and reestablishes the reserve only after an actual deadline miss. Existing ElevenLabs burst scheduling remains unchanged, including its 25 ms onset.

The tradeoff is **55 ms more initial browser buffering** for GPT-Live than before. This is intentional jitter protection, not a model/network latency gain. An 80 ms buffer cannot repair longer network stalls or PCM that the server discards.

## Evidence

The deterministic 437 Hz sine test uses ten 40 ms packets at 16 kHz (6,400 samples) with arrival times `[0,49,101,120,182,205,267,280,337,370]` ms:

| Scheduling | Initial reserve | Inserted gaps | Scheduled media duration |
| --- | ---: | ---: | ---: |
| Previous | 25 ms | 4, totaling 27 ms | 427 ms |
| Current GPT-Live | 80 ms | 0 | 400 ms |

Every decoded PCM sample is preserved exactly. This is a software continuity result, not an acoustic recording.

The actual microphone worklet was also evaluated without a device, using a four-second synthetic 437 Hz input in 128-sample processing frames. Both 44.1 kHz and 48 kHz input produced exactly 40 packets of 3,200 bytes, totaling the expected 64,000 PCM16 samples at 16 kHz. RMS values remained finite and no blank packet was inserted. Maximum adjacent-sample changes at packet boundaries stayed within ordinary changes inside packets (44.1 kHz: 2,545 vs 3,051 PCM units; 48 kHz: 2,803 vs 2,805). This found no chunk-boundary reset or lost-sample defect in the worklet. It is not a full resampler frequency-response test or a microphone-quality test.

Replay of actual recorded arrivals in `benchmarks/gpt-live-smoke-04.json` against both scheduling rules:

| Recorded stream | Packets | Old artificial gaps | New artificial gaps |
| --- | ---: | ---: | ---: |
| Study reply, turn 4 | 17 | 5, totaling 6.5 ms | 0 |
| Startup, turn 1 | 100 | 11 | 2 |

The startup trace still requires approximately 524 ms of total additional spacing in both scheduling simulations because the source trace contains a much larger gap or missing PCM. The new buffer consolidates small interruptions but does not repair the recorded server-side loss/stall. This is not a claim that all crackle is fixed.

Five `tests/live-playback.test.mjs` cases verify:

1. Continuous 16 kHz sine chunks under bounded packet jitter share exact adjacent start/end boundaries and preserve every PCM sample.
2. A packet received 10 ms before its deadline is appended without an artificial safety-margin gap.
3. A genuine underrun reestablishes a bounded reserve and subsequent chunks remain contiguous.
4. ElevenLabs 24 kHz onset and burst scheduling remain unchanged.
5. Interruption stops all queued buffers, rejects stale turns, and resets the reserve for new speech.

These five tests plus the caption-timing and hint-client regression suites pass: **22/22**. A final combined run including the latest GPT-Live transport and orchestration checks passes **52/52**. There were no provider calls and no microphone recording in these checks.

## Server-side continuity fix

The initial transport held quiet PCM until a later nonquiet chunk, then emitted the held silence. For a real-time stream this starves the browser during the pause and can replay that same silence after the wall-clock pause, lengthening it. **Current code fixes this:** after the first voiced frame it forwards all subsequent PCM immediately, including silence. The focused transport regression verifies that order and cadence. Leading silence is still skipped.

Current speech completion additionally requires the complete normalized output transcript plus 1500 ms of quiet. This prevents the previously demonstrated incomplete-prefix timeout, while remaining a local heuristic rather than a provider-confirmed completion event. Full approved tutor text is now submitted once, so clause-level startup behavior has also changed and must be included in the next real latency comparison.

## Separate capture packetization optimization

After the 100 ms-cadence provider baseline was recorded, the browser worklet gained a GPT-Live-only 320-sample/20 ms packet option. The ElevenLabs path remains at 1,600 samples/100 ms. Playback buffering remains at 80 ms; this change affects capture only.

At both 44.1 kHz and 48 kHz input, two-second multitone tests compared the original packets against 20 ms packets with variable processing callback sizes. Concatenated output was **bit-identical**, with all 32,000 PCM16 samples preserved. The new path produced 100 packets instead of 20. Five new packetization tests plus playback/caption/hint regressions pass **27/27**.

Within-packet batching delay decreases by **80 ms maximum and 40 ms mean** over uniformly positioned samples. At 48 kHz, the first new packet is emitted after 20 ms plus render-quantum rounding, under 23 ms, rather than after 100 ms. These are capture-buffer measurements; microphone drivers, model decisions, networking and synthesis are excluded. WebSocket messages increase from 10 to 50 per second while PCM bandwidth is unchanged. No end-to-end latency improvement is claimed until a matched 20 ms-provider replay or hardware run measures it. Existing provider benchmark files still use their recorded 100 ms input cadence.

## Final local preview check

An isolated browser tab loaded the updated preview, displayed the GPT-Live selector correctly and switched both ways without document navigation or application-origin console errors. No microphone or provider was activated. The only observed warnings belonged to an unrelated browser extension. Code inspection found no new automatic reload loop; normal Vite development changes can still remount the app and close its connection, so live listening checks should run against stable files.

Physical microphone input, speaker output, Bluetooth routing, acoustic echo and human-perceived crackle remain untested. The software defects above are fixed and covered; this report does not claim that all audible crackle is resolved. The strict content and grading risks, with current fixes distinguished from remaining limitations, are documented in `docs/gpt-live-review.md`.
