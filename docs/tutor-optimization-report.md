# Tutor and whiteboard report — October 2, 2026

Historical architecture checkpoint. Model configuration, canonical question delivery, grading evidence and the board have since changed. See [the current implementation and measured report](tutor-step-change-report.md); the measurements and failures below remain preserved as earlier evidence.

The requested context changes are implemented and running locally. A separate parallel-whiteboard prototype was also tested; it did not beat the combined tutor in these trials, so it is not enabled in production. They substantially reduce the first request's context, but **the current GPT-6 Luna configuration did not become faster or uniformly more reliable in the measured scenarios**. GPT-5.6 Terra started speaking sooner overall and passed all four target scenarios in the retest. Neither model delivered every board quickly.

## Whiteboard results first

These are observed local-client times from a simulated ElevenLabs committed transcript. OpenAI and Jev calls were real. Each configuration ran each scenario once; these are individual observations, not production percentiles or guarantees.

| Visual task | Original Luna | Updated Luna | Updated Terra |
| --- | ---: | ---: | ---: |
| Blank 8-row × 10-column matrix received | 3.767 s | 5.881 s | 2.520 s |
| Replace the old payoff table with question 4's city diagram | 1.877 s | 2.095 s | 2.477 s |
| Feedback board after the student's attempted answer | Inconclusive in original harness | 4.803 s | 7.010 s |

Both updated configurations ultimately produced the requested blank grid with exact dimensions and no invented payoffs or premature solution. Both replaced the stale payoff matrix with the city diagram and preserved the requested trial locations. The board contained diagram/matrix content, without standalone question prose. Updated Luna needed silent recovery for the grid; its ordinary response did not supply a usable board.

There is a remaining model failure: Luna twice used the source document's wording instead of the queued bank question's exact wording. The bank remained available, but strict question tracking could not recognize the rephrased question, so the following answer was not eligible for automatic grading. Strengthening the instruction did not eliminate this in the retest. Terra used the exact queued wording and the simulated grading-eligibility check passed. This report does not treat that unresolved Luna case as a success.

A separate implementation bug is fixed: when an exact bank question was already consumed by spoken output, a later recovered diagram used to consume it again and clear tracking. Same-turn recovery now preserves that active question, attempts, and assistance status. A real question-bank/mastery integration test verifies one eligible first answer and one score update; another turn or a different question cannot revive the consumed question.

## What changed

1. **Automatic passage retrieval:** Jev receives a bounded catalog of informative original-text previews alongside student-intent classification. The main OpenAI tutor receives selected original passages, exact source/chunk references, a source catalog, and explicit uncertainty instead of every source document on every turn. Current-question sources are pinned. Original text remains available server-side.
2. **Fallback lookup:** Luna can search/read original source passages before speaking. It has at most two lookup rounds and five calls per turn, with source-revision checks, cancellation, fixed deadlines, and separate usage accounting for each model continuation. These tools cannot execute commands, browse, or modify files.
3. **Conversation state:** Recent dialogue has an explicit window, while older public dialogue is preserved verbatim in a compact representation. The active public question and current exchange are explicit. This is not a lossy summary and does not cap total long-session history.
4. **Question bank:** The existing bank context is preserved without a relevance filter. Its existing 12,000-character default builder budget is unchanged. Grading still receives complete original materials and history.
5. **Instructions and diagnostics:** Speaking instructions were consolidated from 15,272 to 11,774 characters, a 22.9% reduction. Logs now record passage IDs/revisions, retrieval status, context/source/bank sizes, and extra lookup requests without source bodies or hidden reasoning. Source-ready returning greetings can retrieve grounding; unready setup greetings cannot.

The first retrieval prototype performed poorly because its short previews missed decisive text and its uncertainty fallback retained the previous topic. Three real Jev diagnostic calls isolated the preview problem. The final implementation uses informative query windows up to 800 original characters and prioritizes current-query evidence ahead of stale working passages. All eight retest turns had relevant original evidence available. The initial results remain in the measurement report.

## Separate parallel whiteboard agent

A benchmark-only prototype ran a speech-only Luna tutor and a silent Luna renderer concurrently. Both had the same prepared original passages. The renderer received the explicit public problem and current scene, never the private question bank or expected test drawing. Its output was validated and checked by Jev against the actual tutor reply before being accepted.

| Prepared-context phase | Combined tutor | Parallel renderer prototype |
| --- | ---: | ---: |
| Blank 8×10 grid ready | 2.782 s | 2.981 s |
| City replacement ready | 1.719 s | 2.647 s |
| Voice-only payoff question | No board | No board |
| OpenAI requests across three cases | 3 | 6 |
| Total input tokens | 17,516 | 23,409 |
| Total output tokens, including reasoning | 421 | 1,025 |

All six runs passed the visual/content checks. The prototype preserved blank cells, removed the old payoff matrix, and agreed with the public request. It nevertheless took longer in both drawing cases and also started speech later. An unconditional renderer used an unnecessary extra request on the voice-only case.

These clocks start after context preparation, unlike the end-to-end table above. They must not be pooled. There was only one pair per case, in fixed order; the combined prompt had more cached input, and generated reasoning volume differed. This experiment does not prove that every parallel architecture is slower. It establishes that this particular prototype has no measured advantage warranting rollout.

**Recommendation:** keep the combined board path for now. A future parallel renderer should start from a small committed public drawing specification and run only when a visual is needed. Speculative drawing can handle an explicit already-known problem, but it cannot reliably predict a new question the main tutor has not chosen yet. It must keep turn/source/visibility cancellation and speech/scene agreement checks. A separate agent alone does not guarantee more dynamic or faster boards.

[Parallel experiment, methodology and raw measurements](/Users/andreboufama/Documents/Luna-Study/benchmarks/parallel-whiteboard-results.md).

## Voice latency and context size

| Configuration | Median first spoken text, 4 cases | Median initial context bytes |
| --- | ---: | ---: |
| Original Luna | 1.647 s | 31,598.5 |
| Updated Luna | 2.282 s | 14,867 |
| Updated Terra | 1.203 s | 14,867 |

Initial context decreased by **53.0%**. Updated Luna still requested additional source lookups in three of four retest cases, adding another model round. Terra needed no fallback lookup in those four cases. The measured Terra advantage is in starting speech; its 7.010-second feedback board shows why first text alone cannot assess the whiteboard experience.

First spoken text excludes hidden reasoning/markup but includes prefetch and any lookup rounds. ElevenLabs STT/TTS was simulated, using committed-transcript messages and a fixed synthetic audio delay. These tests do not measure recognition accuracy, actual voice-provider latency, browser paint, or speaker playback. Student intent and grading verdicts were fixtures; grading tests measure eligibility and evidence retention rather than grading-model correctness.

## Model choice

Keep separate decisions for the speaking tutor and background work. The measured Terra results support a broader tutor-only trial, not changing every indexing/preparation request to Terra. The configured production model remains GPT-6 Luna.

Authenticated model discovery listed GPT-5.6 Terra and GPT-6 Luna but not GPT-6 Terra. The official model catalog also had no GPT-6 Terra entry at verification time. Published standard short-context input/output rates are $2/$12 per million tokens for Terra and $0.10/$0.50 for Luna, before cache/tier adjustments. Terra is substantially more expensive per token. Sources: [model catalog](https://developers.openai.com/api/docs/models/all), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).

## Evidence and validation

- `npm run check`: **526 tests passed**, followed by a successful production build. The build retains its existing large-chunk advisory.
- Actual source corpus: three ECON 2801 PDFs from Downloads, **25,681 extracted characters**, with hashes and original extraction fixtures saved.
- Initial integrated experiment: 12 cases, 22 OpenAI + 24 Jev requests. Estimated token cost $0.140904, partial because some canceled work did not return complete usage.
- Corrected integrated retest: 8 cases, 13 OpenAI + 18 Jev requests. Estimated token cost $0.071887. No paid voice requests.
- Parallel phase experiment: 6 runs, 9 OpenAI + 6 Jev requests, with exact reported token counts in its separate artifact. Three additional Jev diagnostics investigated retrieval previews; their metadata is in `artifacts/material-retrieval-diagnostic.json`.
- Exact billed charges were not returned by the providers. Estimates use returned token counters and verified public rates; they exclude account discounts, credits, taxes, unreported work, and real voice usage.
- Original raw results are preserved. Two evaluation checks were corrected offline, and the original harness's recovery-settlement race is explicitly marked inconclusive rather than turned into a product failure.
- The local server was restarted after confirming there was no active saved session. `/` and `/api/status` returned HTTP 200.

[Detailed measurements, checks, usage, caveats, and reproduction](/Users/andreboufama/Documents/Luna-Study/benchmarks/tutor-context-results.md). [Exact current tutor context and color-coded flowchart](/Users/andreboufama/Documents/Luna-Study/docs/tutor-context.md).
