# Grader effort comparison

**Keep the production grader at low effort.** In this small controlled sample, low matched the predeclared outcome in all six independent pairs. Medium produced disagreements on three pairs and took longer. This is evidence against switching by assumption; it does not erase the earlier low-effort z disagreement or establish a general reliability rate.

The frozen six-case fixture was independently reviewed before paid calls. Each input was identical across efforts, including question, reference, source, submitted answer and history. Only the API request's grading reasoning effort changed. The two calls within each pair never saw one another's judgment. Low/medium order alternated by case; the benchmark made no production edits or mastery writes.

| Case | Low pair | Medium pair |
|---|---|---|
| Complete z solution and equality justification | Correct, unassisted | Disagreed: partial/assisted vs correct/unassisted |
| Complete w solution and equality justification | Correct, unassisted | Disagreed: correct vs partial; both incorrectly marked assisted |
| Correct z result without required explanation | Partial | Partial |
| Wrong z result with a sign error | Incorrect, unassisted | Both incorrect, but assistance judgments disagreed |
| Complete z after an explicit same-target worked solution | Correct, assisted | Correct, assisted |
| Logistics with no target answer | Agreed non-target; no attempt | Agreed non-target; no attempt |

Low matched all 12 individual expected judgments; medium matched 8 of 12. Production agreement logic withheld scores on the three medium disagreements. Neither effort awarded full unassisted credit to the incomplete, wrong, assisted, or non-answer controls. Reasoning-sufficiency expectations for non-correct answers were diagnostic; no grading threshold or validation was weakened.

| Observed metric | Low | Medium |
|---|---:|---:|
| Calls | 12 | 12 |
| Expected pairs | 6 / 6 | 3 / 6 |
| Median single request | 2.177 s | 3.290 s |
| Median independent pair | 4.464 s | 7.733 s |
| Input tokens | 24,382 | 24,382 |
| Output tokens, including reasoning | 2,121 | 4,759 |
| Reasoning tokens | 699 | 3,325 |
| Cached input tokens | 16,534 | 12,173 |
| Cache-write tokens | 7,812 | 12,173 |
| Estimated public-rate cost | $0.00220594 | $0.004026455 |

Total: **24 OpenAI calls, zero Jev or audio calls**, 48,764 input and 6,880 output tokens, including 4,024 reasoning tokens. All calls returned usage. Estimated total cost is **$0.006232395**; actual billed dollars were not returned. Cache differences contribute to the cost comparison, so the cost ratio is not purely an effort effect. The complete run took 77.721 seconds. Provider-slot queue time is excluded from condition timings. Background grading remains outside the spoken tutor response's critical path.

The comparison uses `gpt-6-luna`, the existing production organizer, identical strict schema and grader instructions, and unchanged citation resolution and independent agreement checks. A benchmark-only payload override supplied medium effort; production remains low. Synthetic sources and reconstructed histories are explicitly labeled. The original z rejection, the all-correct 12-call history replay, and these effort disagreements all remain preserved. The cause of an individual model judgment is unobserved; these data do not justify removing assistance history or weakening the rubric.

Evidence is in `grade-effort-results.json`: frozen fixture SHA-256, grading/adapter source hashes, complete synthetic payloads, actual effort, public structured judgments, exact usage, timing and accounting. `grade-effort-fixtures.json` records the expected outcomes, input histories and construction provenance. No credentials or hidden reasoning are stored.

Reproduce from the repository root, preserving the existing results:

```sh
node benchmarks/tutor-quality/build-grade-effort-fixtures.mjs
node benchmarks/tutor-quality-grade-replay.mjs --effort-experiment --fixtures benchmarks/tutor-quality/grade-effort-fixtures.json --output /tmp/luna-grade-effort-dry.json
node --env-file-if-exists=.env benchmarks/tutor-quality-grade-replay.mjs --live --effort-experiment --fixtures benchmarks/tutor-quality/grade-effort-fixtures.json --output benchmarks/tutor-quality/grade-effort-results.new.json
```

Each effort has only one pair per case. These observations are neither production percentiles nor a broad accuracy benchmark. The appropriate next check is the already planned full conversation run with exact grading inputs captured, while retaining low effort and all existing credit safeguards.
