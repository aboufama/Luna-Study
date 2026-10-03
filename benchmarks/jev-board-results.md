# Earlier board closure: measured lifecycle and correctness

The final production change closes an obsolete visible board during the existing student-intent call, before the main tutor starts. It adds one typed Jev question to that same request. It does not classify with keywords or add another serial API request. The retained drawing remains available; hiding does not grade, consume a bank question, or mark assistance. `LUNA_EARLY_BOARD_HIDE=off` restores the previous close-after-response path and omits the optional question.

Closing requires a valid `should_close_board` probability of at least 0.90. Confirmed help or attempted-answer signals veto it. An unknown close signal, malformed response, timeout or missing credentials keeps the scene. Unknown independent help/answer signals do not veto a confident board-relevance signal: the close question itself distinguishes topic changes from answers, hints, corrections and vague references. Current turn, source revision, board revision and manual visibility epoch must still match.

## Real classifier tests

| Cohort | Close / keep cases | Correct | False hides | Missed hides | Median latency | Range |
|---|---:|---:|---:|---:|---:|---:|
| Initial | 8 / 16 | 23/24 | 0 | 1 | 171.65 ms | 153–300.7 ms |
| Final: missing-question coverage | 4 / 20 | 24/24 | 0 | 0 | 145.8 ms | 126.3–227.2 ms |

The initial cases span biology, algebra, history and grammar with repeated vague references. One explicit grammar-to-forces switch scored 0.86 and was conservatively kept. The second cohort checks 12 previous keep cases plus 12 cases without an active bank question: explicit topic switches, discussion answers, and help/corrections. Expected labels were fixed before calls; no threshold was lowered. These small synthetic cohorts are evidence about the supplied cases, not a production false-hide rate.

## Real paired production timing

| Scenario | Legacy close | Early close | First tutor text with early hide | Tutor complete with early hide | Observed close reduction |
|---|---:|---:|---:|---:|---:|
| biology-to-history | 2218.2 ms | 135.6 ms | 816.7 ms | 1996.5 ms | 2082.6 ms |
| algebra-verbal-detour | 2028.8 ms | 315.8 ms | 1116.1 ms | 1799.5 ms | 1713 ms |
| grammar-to-forces | did not close | 132.7 ms | 2463.6 ms | 2772.6 ms | not finite |

All six final production loopback trials completed. They used eight real GPT-5.6 Terra requests (the grammar case used a source-read tool round in each condition) and twelve real Jev requests. The three pairs alternated condition order, used the same synthetic utterance/material/board per pair, and held the shared provider lock for each complete measured trial. They do not isolate every backend/cache/model source of variance, and tutor text generation was not made faster by this change. The measured benefit is the earlier visibility event.

The initial paired run is preserved. It exposed an overly strict help===false guard: with no active question, help was unknown and blocked early hiding. Its third legacy turn used an extra tool round, exhausting the six-request budget; the third early turn failed locally without exceeding that cap. The final run changes that independent-signal veto, retains the 0.90 closing threshold, and increases the explicitly authorized cap to eight model requests. No failed measurements were discarded.

STT commits known text and TTS emits silent PCM 100 ms after the first speech chunk. These are real orchestration/model/intent timings with simulated ElevenLabs, not measured speech recognition or synthesis performance. Local source catalog/read tools run; semantic source prefetch is disabled for this focused visibility experiment. Greeting, mastery notice and grading are fixtures or absent.

## Regression coverage and limits

25 modular tests cover early closure before an unresolved tutor response; off-switch compatibility; unknown/vague intent; stale intent and manual close/reopen; canceled audio/captions/boards; reverse-order topic routing; four subjects’ useful written teaching versus redundant questions; source-change grade cancellation; one-time attempt accounting; conservative help eligibility even when two grader doubles say unassisted; exact source evidence; subject-local completion; retained object patches/deletions, selection rebasing, and preventing unseen canceled text from entering grading evidence. The existing Jev and voice suites also passed in the 122-test focused run before the final three scene tests were added.

Correct assisted practice still earns the existing score increment; it cannot count as an unassisted hard win or unlock mastery. Three distinct qualifying hard wins are required per topic. Mastering currently indexed topics does not certify whole-course coverage; scope remains unverified. Regression tests use real local orchestration, question bank, checked-grade validation and persistence, with controlled provider replies. They do not establish model semantic accuracy, microphone accuracy, browser camera/touch quality, or comprehensive subject coverage.

## Usage

- jev-board-intent-results.json: 0 OpenAI + 24 Jev HTTP requests; estimated $0.000993300.
- jev-board-intent-results.final.json: 0 OpenAI + 24 Jev HTTP requests; estimated $0.000989730.
- jev-board-lifecycle-results.json: 6 OpenAI + 11 Jev HTTP requests; estimated $0.022303886.
- jev-board-lifecycle-results.final.json: 8 OpenAI + 12 Jev HTTP requests; estimated $0.027952466.

Across the preserved initial and final cohorts: 14 OpenAI + 71 Jev = 85 actual requests; estimated **$0.052239382**. Exact billed dollars are unavailable. The loopback ledger also contains unpriced simulated voice attempts; those are not actual provider requests and no voice charge is fabricated. Token-based estimates include only available actual model/Jev usage; service-tier assumptions and pricing sources remain in raw ledger snapshots.

## Reproduction

```sh
node --test tests/tutor-board-lifecycle.test.mjs tests/tutor-mastery-lifecycle.test.mjs tests/tutor-scene-lifecycle.test.mjs tests/jev-intent.test.mjs tests/live-voice.test.mjs
# Paid calls only when explicitly intended:
node --env-file-if-exists=.env benchmarks/jev-board-intent.mjs --live --missing-active-question
node --env-file-if-exists=.env benchmarks/jev-board-lifecycle.mjs --live --final
```

Raw probabilities, exact synthetic input contexts, usage, timestamps, source hashes, typed events, request counts and preserved failures are in the adjacent JSON files. Re-running paid commands replaces their designated final files; copy prior evidence first. Offline runs write separate files and make no provider calls.
