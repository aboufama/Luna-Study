# Controlled grading replay

The earlier rejected **z** answer was accepted by both independent graders in all three replay conditions. All six conditions returned a checked, correct, unassisted result. This does **not** establish that the earlier rejection is fixed: the grading implementation and low reasoning effort were unchanged.

| Condition | History entries | Two public judgments | Pair elapsed |
|---|---:|---|---:|
| z, reconstructed original history | 23 | correct / correct | 3.926 s |
| z, empty history | 0 | correct / correct | 3.315 s |
| z, target-scoped history | 2 | correct / correct | 4.602 s |
| w, reconstructed original history | 37 | correct / correct | 5.747 s |
| w, empty history | 0 | correct / correct | 2.964 s |
| w, z prior history with w submission | 23 | correct / correct | 2.917 s |

Every judgment marked reasoning sufficient and assistance unused. The original repaired adaptive run still contains the z disagreement: one correct/sufficient judgment and one partial/insufficient judgment, both unassisted. The w control had two correct judgments. Those raw records were not modified.

The z answer correctly subtracts 8 from both sides of `4z + 8 = 0`, obtains `4z = -8`, divides both sides by 4, obtains `z = -2`, and explains preservation of equality. The original notes and fixed reference support these steps. No source, sign, numerical, reference-answer, citation-resolution, or identity defect was found. Reconstructed original z and w requests have the same instruction hash, original citation IDs, and respective input-token counts (1,926 and 2,441) as the earlier calls. Full historical request bytes were not saved, so this remains a reconstructed replay.

There is no controlled evidence here that stripping history improves grading. Empty history deliberately removes assistance evidence and must not become the production input. The w-with-z-history condition is a counterfactual: its preceding canonical question still concerns z, which limits causal interpretation. One pair per condition is a diagnostic sample, not an accuracy estimate. The defensible inference is that the observed disagreement can vary between otherwise closely matched grading calls; the specific internal cause is unobserved.

No production change or score was made. A next experiment could compare higher **grader-only** reasoning effort on repeated complete, incomplete, wrong, and assisted answers before changing the default. Preserve exact source evidence, two independent semantic checks, and the existing credit rules. Background grading is outside the spoken response's critical path.

The run used `gpt-6-luna`, low reasoning, no tools, `store:false`, and the unchanged production organizer/schema/validation. Six conditions each received two fresh independent calls; no prior judgment was supplied to its partner. No Jev, microphone, ElevenLabs, tutoring, or mastery-write call occurred. Requests were serialized with the shared provider slot. Total wall time was 23.484 seconds; timings are this run's observations, not production percentiles.

Usage: **12 OpenAI calls**, 19,550 input tokens, 1,590 output tokens including 188 reasoning tokens, 14,118 cached input tokens, and 5,396 cache-write tokens. The repository's verified public-rate calculation estimates **$0.00161428**. Actual billed dollars were not returned and remain unavailable. Reasoning tokens are already included in output tokens; synthetic voice costs are not invented.

Reproduce from the repository root:

```sh
node benchmarks/tutor-quality/reconstruct-grade-fixtures.mjs
node benchmarks/tutor-quality-grade-replay.mjs
node --env-file-if-exists=.env benchmarks/tutor-quality-grade-replay.mjs --live --output benchmarks/tutor-quality/grade-replay-results.new.json
```

`grade-replay-fixtures.json` records reconstruction provenance. `grade-replay-results.json` records code and fixture hashes, complete synthetic request payloads, public structured outputs, resolved model, usage, timing, and validation decisions. It does not contain credentials or hidden reasoning.
