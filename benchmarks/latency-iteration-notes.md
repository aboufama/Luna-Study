# Bounded speech-buffer iteration, October 2, 2026

Retained change: a parsed `</say>` flushes the pending spoken-text buffer immediately. Previously, a short spoken segment without trailing whitespace could wait for the entire board JSON and model turn to complete. The new callback does not close the TTS connection. Speech remains the same, and board JSON remains separate and validated.

## Measured result

Two actual Luna responses were captured using synthetic study material, including each decoded text delta's arrival time. Those exact trace timings were replayed through real ElevenLabs TTS in ABBA order, two trials per condition. TTS opened at request start as it does in production. All returned PCM was counted and discarded. No microphone, browser, speakers, or saved audio were involved.

| Cycle | Single changed behavior | Baseline median first PCM | Candidate median first PCM | Reduction | Decision |
| --- | --- | --- | --- | --- | --- |
| 1, visual response | Flush at closing say tag | 4370.3 ms | 2752.3 ms | 1618.0 ms | Retained |
| 2, explanatory sentence | Reduce maximum word-boundary chunk from 160 to 60 characters | 3261.1 ms | 3040.6 ms | 220.5 ms | Experimental only |
| 3, same explanatory sentence | Reduce chunk from 60 to 32 characters | 3043.5 ms | 2934.4 ms | 109.1 ms | Experimental only |

Cycle 1 raw first-PCM times: baseline 4363.8 and 4376.7 ms; candidate 2757.4 and 2747.2 ms. Its model first spoken delta arrived at 2527 ms. The complete, validated board arrived at **4218 ms**, unchanged by earlier speech flushing. Therefore the spoken phrase “Consider this.” starts earlier, but the matrix is not available any earlier. This is an audio-start improvement, not a 1.618-second improvement in readiness of the full visual problem.

The explanatory response was one sentence contrasting passive and active transport. Its baseline already emitted a bounded fragment before completion. Smaller chunks saved less time and could affect speech prosody; playback/listening was deliberately not performed. Both aggressive chunk settings remain only in the benchmark. The loop stopped after these three bounded cycles.

These measurements are **request-start to first returned audio bytes**, isolating buffering effects with fixed model timing. They exclude Scribe end-of-speech commitment, onboarding, Jev routing, network transit to the browser, audio scheduling, and physical playback. They are two observations per condition, not production percentiles. The replay design provides a paired causal buffering comparison but does not measure live model variance or prove a general end-to-end latency reduction.

## Files and verification

- `latency-iteration.mjs`: bounded live-provider capture and replay harness. Two Luna generations and twelve TTS requests per full run. Run only when provider usage is authorized: `node --env-file-if-exists=.env benchmarks/latency-iteration.mjs`.
- `latency-iteration-results.json`: synthetic input, decoded delta timing, emitted speech chunks, returned byte counts, per-trial timing and medians. No credentials, raw provider messages, or audio.
- `../tests/latency-iteration.test.mjs`: every closing-tag split flushes speech before the board; board string content cannot fire a speech-completion callback.
- `../tests/luna-fast.test.mjs`: adapter callback fires before board generation completes.

The focused decoder, adapter, speech-stream, and iteration checks pass: 34 checks total. The full application gate is run separately by the main task after integration.
