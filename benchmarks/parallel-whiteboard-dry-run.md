# Parallel whiteboard phase experiment

Run: 2026-10-02T07:16:26.639Z. Model: gpt-6-luna. Offline harness check.

| Scenario | Current speech | Parallel speech | Current synthetic audio | Parallel synthetic audio | Current board shown | Parallel board shown | All checks |
|---|---:|---:|---:|---:|---:|---:|---|
| blank-grid | 0.01 s | 0.00 s | 0.11 s | 0.10 s | 0.01 s | 0.00 s | pass |
| scene-switch | 0.00 s | 0.00 s | 0.10 s | 0.10 s | 0.00 s | 0.01 s | pass |
| source-payoff | 0.00 s | 0.00 s | 0.10 s | 0.10 s | none | none | pass |

## Interpretation

This small paired experiment isolates the prepared-context generation/routing phase. It does not establish a production speed improvement or recommend enabling parallel rendering. Parallel work starts only from an explicit public drawing request; it cannot anticipate a question that the tutor has not yet selected. No production files were changed.

## Method and limits

- One paired trial for each of three explicit public requests; fixed baseline-then-prototype order, no production percentiles or statistical speed claim.
- Clock starts when the identical prepared context is submitted. STT, student-intent and passage-prefetch latency are excluded from both conditions.
- Original passages are deterministically selected once using the production local retrieval implementation and shared unchanged within each pair. No gold board or reference answer enters renderer input.
- Uses production streaming adapter, decoder, speech text buffer, validation, board merge and Jev routing. It is a generation/routing phase experiment, not the full live WebSocket lifecycle.
- First synthetic audio is the first speech-buffer dispatch plus a fixed 100 ms timer. It does not measure or estimate ElevenLabs latency; no voice provider is called.
- Prototype main and silent renderer start concurrently; the proposed board is gated on both completing and a Jev speech/board consistency check. The renderer receives no question bank.
- Prototype is restricted to an explicit already established public problem. It cannot safely predict a new question selected later by the main tutor.
- No automatic visual recovery in this phase experiment; missing primary boards count as failures. Production can perform a separate silent recovery.
- Provider-reported usage is recorded per HTTP request. No dollar estimates or provider-cost inference.

Paid HTTP requests: 0 OpenAI, 0 Jev; limits 12 and 6. All actual response usage and public outputs are in the JSON artifact.
