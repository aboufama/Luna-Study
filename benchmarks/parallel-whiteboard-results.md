# Parallel whiteboard phase experiment

Run: 2026-10-02T07:16:31.738Z. Model: gpt-6-luna. Real OpenAI + Jev; simulated audio.

| Scenario | Current speech | Parallel speech | Current synthetic audio | Parallel synthetic audio | Current board shown | Parallel board shown | All checks |
|---|---:|---:|---:|---:|---:|---:|---|
| blank-grid | 1.78 s | 2.28 s | 2.01 s | 2.53 s | 2.78 s | 2.98 s | pass |
| scene-switch | 0.57 s | 1.73 s | 0.73 s | 1.94 s | 1.72 s | 2.65 s | pass |
| source-payoff | 0.57 s | 0.70 s | 0.82 s | 0.93 s | none | none | pass |

## Observed result

Both conditions passed all measured checks. The parallel prototype was slower in both drawing cases: **2.78 → 2.98 seconds** for the blank grid, and **1.72 → 2.65 seconds** for the city switch. It did not improve first speech in these three trials. Both produced the exact blank dimensions, removed the previous matrix on the city switch, and withheld a board for the voice-only payoff question. Jev speech/board agreement was 0.79–0.95.

Across the three scenarios, current integrated generation used **3 OpenAI requests, 17,516 input tokens and 421 output tokens**. The parallel prototype used **6 requests, 23,409 input tokens and 1,025 output tokens**. Counts include both prototype models. Cached input tokens were 7,626 vs 5,450, and reasoning tokens were 99 vs 545. Output totals already include reasoning tokens; they must not be added again. These are observed token counts, not dollars.

The current prompt had an existing cached prefix; the first prototype pair had no cached input. Reasoning volume also varied. With one pair per case, this is evidence against adopting this particular prototype immediately, not proof that parallel rendering can never help. It also shows why an unconditional renderer wastes a model call on verbal-only turns.

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

Paid HTTP requests: 9 OpenAI, 6 Jev; limits 12 and 6. All actual response usage and public outputs are in the JSON artifact.

The current baseline here is the prepared-context **integrated main-model generation phase**, not the historical pre-retrieval app. These measurements must not be pooled with end-to-end transcript timings.
