# Terra tutor: composed intent and checked grading

1/2 complete flows passed every check. 2026-10-02T07:32:48.751Z to 2026-10-02T07:33:17.372Z (UTC).

Each fresh session asks the real Terra tutor for the queued 8-by-10 strict Nash equilibrium question and a blank grid. Production bank resolution turns its `<ask>` ID into exact canonical speech and consumes that ID once. A simulated ElevenLabs transcript then submits the explained answer “eight.” The actual Jev student-intent classifier must identify an unassisted attempted answer. Terra gives real feedback, and the actual checked grader uses two fresh Luna requests against original sources before a real mastery store may persist one first-attempt event.

Question preparation and greeting/history replies remain deterministic fixtures; tutor mastery-notice intent remains simulated. Both main tutor turns, passage/canvas classification, student intent, grading, validation, and local mastery persistence are real. ElevenLabs audio is a silent 100 ms-delay fixture with no microphone, speakers, or paid voice. This is two narrow synthetic student sessions, not evidence of production-wide grading reliability.

| Round | Canonical question / blank grid | Answer recognized | Checked grading decision | Persisted topic score | Initial text | Initial board | Grade applied after initial request |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | pass | pass | validated-agreement (comparison) | 20 | 1.542 s | 2.314 s | 13.542 s |
| 2 | pass | pass | identity-mismatch (second-check) | 0 | 1.646 s | 2.575 s | — |

Round 2 failed answerEligibleExactlyOnce, firstAttemptUnassisted, twoIndependentRealGradesAgreed, masteryPersistedExactlyOnce. The answer reached the grader once, but identity-mismatch at second-check; no score event was persisted. This is a real full-chain failure. The system conservatively withheld credit. The diagnostic establishes the rejection reason, but the raw grader payload was not retained in these initial trials.

Round 1 persisted exactly 1 checked correct event: attempt 1, firstAttempt=true, unassisted=true. The medium-question topic score became 20; the overall score was 3 across six current topics. This does not mean the topic or whole course is mastered.

Total paid HTTP: 20 (8 OpenAI, 12 Jev), within the configured 12/20 provider limits. Estimated public token cost: **$0.064652**. Exact billed dollars remain **unavailable**. No voice cost is inferred from synthetic audio. Estimates use recorded model/tier/counters and exclude account credits, discounts, taxes, unreported usage, and negotiated charges.

The earlier twelve-case report simulated intent and grade verdicts. Its 12/12 evaluated pass rate must not be substituted for the composed grading result here. Raw files are preserved independently.

Reproduce only when new paid testing is intended:

```sh
node --env-file-if-exists=.env benchmarks/tutor-context-scenarios.mjs --live --condition=after-terra --production-bank --scenario=blank-grid --real-intent --real-grading --rounds=2 --max-openai=12 --max-jev=20 --max-requests=32 --output=benchmarks/tutor-terra-fullchain-results.json
node benchmarks/tutor-terra-fullchain-report.mjs
```

Remove `--live` for a completely offline check. The report command performs no provider calls. Source/PDF hashes, exact synthetic utterances, model and source-file hashes, diagnostics, received boards, request metadata and usage are in the associated JSON.
