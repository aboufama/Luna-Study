# Terra tutor: composed intent and checked grading

3/3 complete flows passed every check. 2026-10-02T07:35:15.769Z to 2026-10-02T07:35:48.517Z (UTC).

Each fresh session asks the real Terra tutor for the queued 8-by-10 strict Nash equilibrium question and a blank grid. Production bank resolution turns its `<ask>` ID into exact canonical speech and consumes that ID once. A simulated ElevenLabs transcript then submits the explained answer “eight.” The actual Jev student-intent classifier must identify an unassisted attempted answer. Terra gives real feedback, and the actual checked grader uses two fresh Luna requests against original sources before a real mastery store may persist one first-attempt event.

Question preparation and greeting/history replies remain deterministic fixtures; tutor mastery-notice intent remains simulated. Both main tutor turns, passage/canvas classification, student intent, grading, validation, and local mastery persistence are real. ElevenLabs audio is a silent 100 ms-delay fixture with no microphone, speakers, or paid voice. These 3 narrow synthetic student sessions do not establish production-wide grading reliability.

| Round | Canonical question / blank grid | Answer recognized | Checked grading decision | Persisted topic score | Initial text | Initial board | Grade applied after initial request |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | pass | pass | validated-agreement (comparison) | 20 | 1.926 s | 2.634 s | 12.108 s |
| 2 | pass | pass | validated-agreement (comparison) | 20 | 1.276 s | 2.045 s | 10.646 s |
| 3 | pass | pass | validated-agreement (comparison) | 20 | 1.365 s | 2.132 s | 9.199 s |


Round 1 persisted exactly 1 checked correct event: attempt 1, firstAttempt=true, unassisted=true. The medium-question topic score became 20; the overall score was 3 across six current topics. This does not mean the topic or whole course is mastered.
Round 2 persisted exactly 1 checked correct event: attempt 1, firstAttempt=true, unassisted=true. The medium-question topic score became 20; the overall score was 3 across six current topics. This does not mean the topic or whole course is mastered.
Round 3 persisted exactly 1 checked correct event: attempt 1, firstAttempt=true, unassisted=true. The medium-question topic score became 20; the overall score was 3 across six current topics. This does not mean the topic or whole course is mastered.

Total paid HTTP: 30 (12 OpenAI, 18 Jev), within the configured 12/20 provider limits. Estimated public token cost: **$0.096322**. Exact billed dollars remain **unavailable**. No voice cost is inferred from synthetic audio. Estimates use recorded model/tier/counters and exclude account credits, discounts, taxes, unreported usage, and negotiated charges.

The earlier twelve-case report simulated intent and grade verdicts. Its 12/12 evaluated pass rate must not be substituted for the composed grading result here. Raw files are preserved independently.

The initial composed run passed one of two trials. The second trial was rejected for a second-check identity mismatch, not credited. The final run adds per-request schema enums for exact question, topic, and source identity while preserving validators, and preserves canonical tracking through board notation. The initial raw evidence and failure report remain in `tutor-terra-fullchain-results.json` and `.md`; no failed result is replaced by this run.

Reproduce only when new paid testing is intended:

```sh
node --env-file-if-exists=.env benchmarks/tutor-context-scenarios.mjs --live --condition=after-terra --production-bank --scenario=blank-grid --real-intent --real-grading --rounds=3 --max-openai=12 --max-jev=20 --max-requests=32 --output=benchmarks/tutor-terra-fullchain-results.final.json
node benchmarks/tutor-terra-fullchain-report.mjs --input=tutor-terra-fullchain-results.final.json
```

Remove `--live` for a completely offline check. The report command performs no provider calls. Source/PDF hashes, exact synthetic utterances, model and source-file hashes, diagnostics, received boards, request metadata and usage are in the associated JSON.
