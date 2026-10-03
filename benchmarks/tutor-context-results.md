# Tutor context scenario measurements

The corrected rerun selected relevant original passages in all eight cases and retained every pending bank question and the earlier learner preference. Median initial context fell from 31,598.5 to 14,867 bytes. This did not make Luna consistently faster: its median first text was 2.282 seconds versus the original 1.647 seconds. Terra reached 1.203 seconds in this small rerun, with substantially higher token rates.

**Remaining failure:** Luna twice substituted the source document’s wording for the queued question’s wording. The recovered blank grid was correct, but that question did not become eligible for automatic grading. The lower-level forced-recovery regression is fixed; the model’s queued-question selection/wording reliability is still unresolved. No loose question matching or unearned grade is used to hide this result.

Terra passed the target checks in these four cases. Its city diagram placed A and B correctly but omitted explicit 0.2/0.8 coordinate labels. Its answer-feedback board also took 7.010 seconds, so it was not faster on every visual. These cases do not establish a general model-quality ranking or justify an automatic model switch.

Original run: 2026-10-02T07:05:43.828Z to 2026-10-02T07:06:41.065Z (UTC).

Twelve initial cases compare the frozen original Luna implementation, retrieval-enabled Luna, and retrieval-enabled Terra. A condition is run once per scenario, in source-payoff → blank-grid → scene-switch → answer-feedback order; within each scenario: before Luna → after Luna → after Terra. The saved JSON retains every response, board, provider request, context hash, token counter and check.

## Source and method

Three real ECON 2801 PDFs from Downloads contain 25,681 extracted characters:

- Problem Set 3 Econ 2801 2026.pdf: 4,366 characters; SHA-256 of extracted text: d94a37363ae233857bf07ac58b06cdab5df9ef72a699829fd9d16e274e6cb32b.
- Problem_Set_2_Detailed_Answer_Discussion_Fall_2026_ECON_2801.pdf: 10,412 characters; SHA-256 of extracted text: 36cd2e9f6e2dc94a2e52f4b1cf5bd6d018b34d7e2e33cc25c26f05c2bfb1ec8a.
- Solution_Problem_Set_5_Fall_2026_ECON_2801__Corrected_.pdf: 10,903 characters; SHA-256 of extracted text: de4a2823ba09d3eed1c8936cb6cc689b00e2112d5ae63f994450db880ee2e180.

The Pset 3 two-page source was visually verified, including both payoff tables and the 8-by-10 question. Pset 2 and corrected Pset 5 solutions provide the surrounding corpus. Pset 1 and 4 solution files were excluded because extraction was mostly incomplete. This is an extracted-text test, not an OCR accuracy evaluation.

The real local WebSocket/live-voice pipeline receives simulated ElevenLabs committed transcripts. OpenAI and Jev are real; intent classification, greetings/history, and grade verdicts are explicit fixtures. Returned silent PCM is generated after a fixed 100 ms fixture delay and never played. Audio numbers below do not measure ElevenLabs, microphone or device playback latency.

Five fixture exchanges preserve an early no-spoiler preference. During that priming only, simulated passage decisions initialize a previous working context with Pset 2 passages. Measured requests use real Jev; an unresolved selection must use original-source tools rather than treat the previous passage as sufficient.

## Measured timing

| Run | Condition | Cases | Median first text | Median synthetic first audio | Median text complete | Median initial context bytes | Total OpenAI input tokens |
|---|---|---:|---:|---:|---:|---:|---:|
| Initial | before-luna | 4 | 1.647 s | 1.800 s | 2.074 s | 31598.5 | 53952 |
| Initial | after-luna | 4 | 2.859 s | 3.090 s | 3.481 s | 19863.5 | 78967 |
| Initial | after-terra | 4 | 2.820 s | 3.062 s | 3.779 s | 19863.5 | 70512 |
| Corrected rerun | after-luna | 4 | 2.282 s | 2.415 s | 2.781 s | 14867 | 69584 |
| Corrected rerun | after-terra | 4 | 1.203 s | 1.484 s | 2.241 s | 14867 | 26718 |

First text means committed simulated transcript to the first spoken-text latency message at the local client, including prefetch and source-tool rounds. Text complete includes final model output. Board time means a validated visible canvas received at the local client, not browser paint. Cached counts vary between calls; none of these small-sample medians is a production percentile.

When the question is not tracked, dependent grading-evidence checks also fail because grading was never invoked; those flags do not mean source text or history was discarded.

| Run | Condition / scenario | First text | Synthetic audio | Board received (s) | Failed / inconclusive checks |
|---|---|---:|---:|---:|---|
| Initial | before-luna / source-payoff | 1.415 s | 1.597 s | — | None |
| Initial | after-luna / source-payoff | 2.902 s | 3.105 s | — | None |
| Initial | after-terra / source-payoff | 2.786 s | 3.039 s | — | None |
| Initial | before-luna / blank-grid | 2.409 s | 2.639 s | 3.767 | None |
| Initial | after-luna / blank-grid | 2.830 s | 3.075 s | — | diagramOnlyBoard (inconclusive), exactGridDimensions (inconclusive), noInventedPayoffsOrMarkedSolutions (inconclusive), exactQueuedQuestionAsked, answerEligibleExactlyOnce, gradingKeptOriginalSource, gradingKeptEarlyConversation; recovery board outcome inconclusive |
| Initial | after-terra / blank-grid | 2.855 s | 3.086 s | 3.980 | None |
| Initial | before-luna / scene-switch | 0.694 s | 0.867 s | 1.877 | None |
| Initial | after-luna / scene-switch | 2.887 s | 3.313 s | 4.350 | None |
| Initial | after-terra / scene-switch | 2.586 s | 2.836 s | 4.006 | None |
| Initial | before-luna / answer-feedback | 1.879 s | 2.004 s | — | diagramOnlyBoard (inconclusive); recovery board outcome inconclusive |
| Initial | after-luna / answer-feedback | 0.982 s | 1.132 s | — | diagramOnlyBoard (inconclusive); recovery board outcome inconclusive |
| Initial | after-terra / answer-feedback | 3.477 s | 3.595 s | — | diagramOnlyBoard (inconclusive); recovery board outcome inconclusive |
| Corrected rerun | after-luna / source-payoff | 2.745 s | 3.038 s | — | None |
| Corrected rerun | after-terra / source-payoff | 0.883 s | 1.147 s | — | None |
| Corrected rerun | after-luna / blank-grid | 2.631 s | 2.760 s | 5.881 | exactQueuedQuestionAsked, answerEligibleExactlyOnce, gradingKeptOriginalSource, gradingKeptEarlyConversation |
| Corrected rerun | after-terra / blank-grid | 1.366 s | 1.599 s | 2.520 | None |
| Corrected rerun | after-luna / scene-switch | 0.813 s | 1.098 s | 2.095 | None |
| Corrected rerun | after-terra / scene-switch | 1.040 s | 1.370 s | 2.477 | None |
| Corrected rerun | after-luna / answer-feedback | 1.932 s | 2.070 s | 4.803 | None |
| Corrected rerun | after-terra / answer-feedback | 2.234 s | 2.370 s | 7.010 | None |

## Usage and limitations

Initial: **22 OpenAI + 24 Jev requests** attempted; no paid voice. Provider-reported billed USD is unavailable. Estimated token cost is **$0.140904 (partial)**, using the documented standard model rates and actual returned token counters.

Corrected rerun: **13 OpenAI + 18 Jev requests** attempted; no paid voice. Provider-reported billed USD is unavailable. Estimated token cost is **$0.071887**, using the documented standard model rates and actual returned token counters.

Estimates include reported cache-read discounts and cache-write premiums, and count reasoning once within output tokens. They exclude credits, discounts, taxes, regional premiums and unavailable usage. Rates: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Jev](https://docs.typesafe.ai/models).

The initial harness had two evaluation defects: tool results expose passages rather than materials, and one keyword check missed capitalized “Eight”. Both checks are repaired offline with the original evidence. Its recovery-settlement race also canceled pending final board decisions, so four initial recovery board outcomes remain inconclusive. The original JSON is preserved; first-text timings and generated replies remain valid observations.

A separate forced-recovery offline case found a server eligibility issue: replaying the already-consumed queued question during visual recovery cleared the active question. This is distinct from the initial Luna paraphrase of the queued question. The corrected rerun, when present above, uses the final production fix and the repaired quiet-window settlement check.

Passing source-evidence checks proves the required original passage was available to the model, not that its hidden computation used it. A correct tuple alone cannot prove grounding because private question-bank references also exist. Grading checks verify server eligibility and full original evidence retention; the grading verdict itself is simulated. No bank entries or older learner requests are intentionally removed.

## Reproduction

The baseline source snapshot is in `benchmarks/baselines/tutor-before-retrieval`; it contains source files and hashes, without credentials or node_modules. The source fixture is `benchmarks/tutor-context-fixture.json`. The offline harness defaults to no provider calls:

```sh
node benchmarks/tutor-context-scenarios.mjs
node benchmarks/tutor-context-scenarios.mjs --condition=after-luna --scenario=blank-grid --simulate-recovery --output=/tmp/luna-recovery-check.json
node benchmarks/tutor-context-report.mjs
```

Live benchmarking is explicit and bounded; it reads environment configuration in memory. Do not run it again accidentally:

```sh
node --env-file-if-exists=.env benchmarks/tutor-context-scenarios.mjs --live --max-openai=24 --max-jev=24 --max-requests=48
```
