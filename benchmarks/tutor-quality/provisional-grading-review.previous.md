# Independent provisional-grading review

**12/12 deterministic checks passed.** This review made zero provider calls and changed no production files. It used a fake organizer and a disposable store.

Reproduce from the project root:

```sh
node benchmarks/tutor-quality/review-provisional-grading.mjs
```

The companion JSON records SHA-256 hashes of all reviewed code, every assertion outcome and the review timestamp.

## Checked outcomes

- target agrees grade disagrees.
- target agrees grade unclear.
- scaffold rejected by both.
- target judgments disagree.
- target identity unknown.
- contradictory nonattempt correct.
- foreign source citation.
- missing target judgment.
- dismissed scaffold does not consume first attempt.
- unresolved key survives reopen and blocks false firstness.
- canceled resolution retains pending marker.
- canceled store record does not score.

## Integration reviewed

- Jev thresholds remain 0.80 for canonical prompts and 0.90 for target attempts after scaffolds. Only a finite Jev abstention-band probability enters provisional review; outages, explicit no, clear help/setup and deadlines do not.
- Every job snapshots question identity, original materials, public conversation, source epoch and assistance before its feedback. The grader schema fixes question/topic/source IDs and resolves immutable citation IDs.
- Confirmed and provisional jobs enter one FIFO. Valid agreed target recognition allocates an attempt even when no grade can be agreed. Valid agreed non-attempts remove only their own pending marker.
- Source changes and cleanup abort active review. Store guards run inside the serial queue and before atomic rename; committed historical results are not rolled back. Hint results remain scoped to the old question identity when the current question changes.

## Limits

- These 12 checks do not replace WebSocket integration tests or live-provider teaching evaluation. Assistance timing and loopback source-change races require the separate integration suite.
- An unresolved candidate conservatively suppresses later first-attempt eligibility for that same question key across reconnect; it adds no attempt or score itself. There is no automatic reconciliation of permanently unresolved markers.
- At 1,024 unresolved markers per test, a persistent overflow hold blocks additional registrations and first-attempt qualification rather than evicting uncertainty. This exceptional fallback is broader than the ordinary per-key hold.
- The atomic rename invocation is the persistence commit boundary. Cancellation after commit does not undo a previously committed score.
- This audit records exact code hashes. Re-run if relevant implementation changes.

## Separately verified integration suite

`node --test tests/provisional-grading.test.mjs` passed **21/21** tests. The independent reviewer read the cases and ran them against the frozen code above. They cover FIFO ordering, genuine first-attempt preservation after a rejected scaffold, a later delivered hint, source-change cancellation, reconnect retention, and queued storage guards. These use deterministic provider doubles; they are not live-provider evidence. The 21 test count is separate from this report’s 12 synthetic review checks.
