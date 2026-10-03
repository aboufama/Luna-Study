# Terra tutor and canonical bank identity: three live rounds

2026-10-02T07:28:47.289Z to 2026-10-02T07:29:28.821Z (UTC). 12/12 cases completed; 12/12 pass the evaluated checks.

`LUNA_TUTOR_MODEL=gpt-5.6-terra` drives the main tutor. `LUNA_API_MODEL=gpt-6-luna` drives any separate visual recovery; both actual model names are retained per request. This is the integrated same-agent tutor/board path, not a parallel-renderer experiment.

## Method and boundaries

Three sequential rounds each run source-payoff → blank-grid → scene-switch → answer-feedback. This fixed order is not randomized or counterbalanced. Three samples per scenario do not establish production reliability or percentile latency. The source corpus is the same three real game-theory PDFs used in the prior comparison, with 25,681 extracted characters. PDF and extracted-text hashes, source filenames, runtime source-file hashes, and every trial are in the raw JSON.

The local WebSocket server, main model, Jev passage/canvas classifications, parser, question-bank storage/revision/resolution/consumption, active question, and grading eligibility are real production components. Question preparation is a deterministic fixture loaded through the production bank API: three difficulties are prepared for each of six topics, non-medium variants are consumed before the measured session, and automatic refills are disabled. The six medium questions remain available, or five after the feedback scenario’s canonical question was primed.

ElevenLabs recognition is simulated with committed-transcript events. Synthesis emits 10 ms of silent PCM after a fixed 100 ms fixture delay; it never uses a microphone, speaker, or paid voice endpoint. Audio times below are pipeline observations with that fixture, not measured ElevenLabs latency. Intent classifications, initial conversation/greeting replies, and grade verdicts are simulated. Grading eligibility and first-attempt accounting are real; this run does not establish grading accuracy.

For blank-grid, a real `<ask>` result must resolve a currently offered question ID without private answers, emit the exact canonical wording, consume that ID once, preserve all other questions, and allow exactly one checked first unassisted attempt. The matrix must contain eight rows and ten columns of blank cells with no premature answer. Scene-switch must replace the old payoff matrix with the line city and the requested vendor geometry. All cases check original-source evidence and preservation of the earlier no-spoiler preference.

## Per-trial observations

| Round | Scenario | Evaluated checks | First text | Synthetic first audio | Text complete | Board visible | OpenAI / Jev calls |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | source-payoff | pass | 1.952 s | 2.196 s | 2.192 s | — | 1 / 2 |
| 1 | blank-grid | pass | 1.608 s | 1.708 s | 2.148 s | 2.284 s | 1 / 2 |
| 1 | scene-switch | pass | 1.430 s | 1.675 s | 2.465 s | 2.604 s | 1 / 2 |
| 1 | answer-feedback | pass | 2.020 s | 2.728 s | 3.124 s | 6.396 s | 2 / 3 |
| 2 | source-payoff | pass | 1.137 s | 1.415 s | 1.415 s | — | 1 / 2 |
| 2 | blank-grid | pass | 2.345 s | 2.447 s | 3.134 s | 3.260 s | 1 / 2 |
| 2 | scene-switch | pass | 0.828 s | 1.185 s | 2.172 s | 2.320 s | 1 / 2 |
| 2 | answer-feedback | pass | 2.795 s | 2.912 s | 3.540 s | 6.021 s | 2 / 3 |
| 3 | source-payoff | pass | 0.786 s | 1.042 s | 1.029 s | — | 1 / 2 |
| 3 | blank-grid | pass | 1.900 s | 2.000 s | 2.508 s | 2.635 s | 1 / 2 |
| 3 | scene-switch | pass | 1.488 s | 1.738 s | 4.492 s | 4.668 s | 1 / 2 |
| 3 | answer-feedback | pass | 1.387 s | 1.494 s | 1.950 s | 4.461 s | 2 / 3 |

Across all 12 cases, median first text was 1.548 s, synthetic first audio 1.723 s, and text completion 2.328 s. Median initial context was 17,364 bytes. Board timing is reported separately because only some turns request or trigger a board.

| Scenario | Median first text | Median board visible | Recovery requests |
|---|---:|---:|---:|
| source-payoff | 1.137 s | — | 0 |
| blank-grid | 1.900 s | 2.635 s | 0 |
| scene-switch | 1.430 s | 2.604 s | 0 |
| answer-feedback | 2.020 s | 6.021 s | 3 |

## Usage

Observed 42 paid HTTP requests: 15 OpenAI and 27 Jev, bounded by 30 OpenAI, 40 Jev, and 70 total. There were no paid voice requests. Provider-reported billed dollars are **unavailable**. Public list-price estimate: **$0.178933 (partial)**. Missing cache-write counters, unreported use, account discounts/credits, tax, and billing adjustments are excluded; synthetic voice usage is not priced.

| Model | Metered operations | Input tokens | Output tokens | Cache-read tokens | Cache-write tokens reported | Reasoning tokens |
|---|---:|---:|---:|---:|---:|---:|
| jev-latest | 12 | 90883 | 7271 | 0 | 0 | 0 |
| gpt-5.6-terra | 12 | 87623 | 1511 | 28699 | 58888 | 341 |
| jev-1.13.0 | 15 | 17134 | 366 | 0 | 0 | 0 |
| gpt-6-luna | 3 | 25639 | 622 | 2462 | 23168 | 262 |

Counters are sums of provider-returned usage. Zero in a reported-counter sum does not establish that an absent cache-write counter was measured as zero. Output tokens already include reasoning; they are not charged again. Estimates use the production pricing calculator and the model/service tier recorded for each operation: [Terra rates](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Luna rates](https://developers.openai.com/api/docs/models/gpt-6-luna), and [Jev rates](https://docs.typesafe.ai/models).

## Evaluation audit

- Round 1, source-payoff: typesafe material-prefetch was failed. The source-prefetch diagnostic records a timeout at 856 ms despite HTTP 200 headers; no token usage was returned for that operation. Original-source fallback still supplied the required evidence and the final answer passed. The cost subtotal excludes this unmetered attempt and remains partial.
- Round 2, source-payoff: The original evaluator only accepted a contiguous tuple. The saved reply explicitly gives the same correct values for players 1, 2, and 3 in order. Saved response: “The payoffs are 1 for player 1, 6 for player 2, and 1 for player 3.” Raw check remains false in the original JSON; the evaluated summary corrects it without another provider call.
- Round 3, source-payoff: The original evaluator only accepted a contiguous tuple. The saved reply explicitly gives the same correct values for players 1, 2, and 3 in order. Saved response: “The payoffs are 1 for player 1, 6 for player 2, and 1 for player 3.” Raw check remains false in the original JSON; the evaluated summary corrects it without another provider call.

Prior Luna wording failures remain in the earlier comparison files. These new results use an ID-based speech resolver and a different main model, so they cannot isolate the causal effect of either change. They also cannot prove that the separate proposed parallel-board architecture is better.

Reproduce within the explicit request budget:

```sh
node --env-file-if-exists=.env benchmarks/tutor-context-scenarios.mjs --live --condition=after-terra --production-bank --rounds=3 --max-openai=30 --max-jev=40 --max-requests=70 --output=benchmarks/tutor-terra-bank-results.json
node benchmarks/tutor-terra-bank-report.mjs
```

Remove `--live` for a fully offline self-check. Add `--scenario=blank-grid --simulate-recovery` in offline mode to exercise delayed recovery while preserving the consumed question and first unassisted attempt. Each live invocation makes new paid requests; the report generator is offline.
