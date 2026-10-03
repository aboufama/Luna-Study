# Restatement assistance check

**The wording clarification did not resolve the false assistance judgments.** Both neutral historical questions still received assisted judgments after the change. The four assistance controls behaved as expected. These results must not be described as a successful grading fix.

The exact final-run w and y grading inputs were captured, including originals, private reference, submitted answer and public history. The histories contain prior asks, skipped questions, neutral restatements and unsolved givens; manual inspection found no substantive help for w or y before their first answers. The server had queued them as unassisted. Earlier help for x exists in the longer histories but is a different target under the stated grading rule.

The prior instruction's phrase “including a prior restatement” was ambiguous. The clarification explicitly says that repeating a question, its givens, or an unsolved equation/diagram is not assistance, while prior substantive help remains assistance after a restatement or changed ID. No grading schema, source validation, semantic correctness requirement, agreement rule, model or effort changed.

| Frozen condition | Two live judgments | Expected assistance outcome |
|---|---|---|
| Before: neutral w | Correct, both assisted | Failed: should be unassisted |
| Before: neutral y | Correct, assistance disagreed | Failed: no checked agreement |
| After: exact same neutral w | Correct, both assisted | Failed |
| After: exact same neutral y | Correct, both assisted | Failed |
| After: same-ID concrete hint | Correct, both assisted | Passed |
| After: same target renamed after a hint | Correct, both assisted | Passed |
| After: teaching a different equation only | Correct, both unassisted | Passed |
| After: worked solution followed by a neutral restatement | Correct, both assisted | Passed |

All judgments marked the answers correct with sufficient reasoning. Before/after w inputs have the same SHA-256, as do before/after y inputs. Original instruction SHA-256 is `ee350206d6d2aa21004bc8c22811c239978f7499ba8e077be44db694b0d8cede`; clarified instructions hash to `ec657af3382a487c5dd13e0e390045ade7d277daacadfad8bd040de41b963474`. Full inputs, public judgments, fixture/code hashes and usage are preserved in `grade-restatement-results.json` and `grade-restatement-fixtures.json`.

The hypothesis that the restatement phrase alone caused the observed unfairness is not supported by the intervention. Long mixed history may contribute, but the actual prior message each grader considers assistance is currently unobserved. Do not strip assistance history or silently override an assisted judgment. A useful next diagnostic is immutable citations to the specific public assistant turn(s) claimed as substantive help, preserving neutral asks and actual prior help separately. That proposal is not implemented by this experiment.

The run made **16 OpenAI / zero Jev / zero voice calls**, using `gpt-6-luna` at low effort. No scores were written. Every call returned usage: 39,134 input tokens, 1,992 output tokens including 100 reasoning tokens, 25,149 cached input tokens and 13,937 cache-write tokens. Estimated public-rate cost: **$0.002994415**. Actual billed dollars are unavailable. Total wall time was 26.864 seconds; two-call conditions ranged from 2.570 to 3.979 seconds. This is one independent pair per condition, not a reliability estimate.

The frozen fixture builder refuses to overwrite its preserved before instructions. To rerun with separate output:

```sh
node benchmarks/tutor-quality-grade-replay.mjs --restatement-experiment --fixtures benchmarks/tutor-quality/grade-restatement-fixtures.json --output /tmp/luna-grade-restatement-dry.json
node --env-file-if-exists=.env benchmarks/tutor-quality-grade-replay.mjs --live --restatement-experiment --fixtures benchmarks/tutor-quality/grade-restatement-fixtures.json --output benchmarks/tutor-quality/grade-restatement-results.new.json
```

Thirty focused deterministic tests passed, including retained prior help across renamed IDs, strict independent agreement, exact citation rejection, provisional ordering and persistence. Those tests establish implementation invariants; they do not negate the live semantic failures above.
