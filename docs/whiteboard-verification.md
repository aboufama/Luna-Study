# Whiteboard verification, October 2, 2026

Six simulated conversations passed through the production local WebSocket voice server. Student speech was supplied through fake ElevenLabs STT events; the production TTS adapter used fake ElevenLabs sockets. Luna and both Jev classifiers were real API calls. No real microphone, ElevenLabs network, speaker playback, or user history was used.

| Scenario | Result | Observed turn time |
| --- | --- | ---: |
| blank-eight-by-ten | Pass | 2.90 s |
| same-problem-hint | Pass | 1.42 s |
| unrelated-verbal-recall | Pass | 2.59 s |
| new-two-by-two-game | Pass | 2.06 s |
| reopen-same-game | Pass | 2.80 s |
| interrupted-generation | Pass | 2.13 s |

Assertions inspect real canvas packets, exact matrix dimensions and source payoffs, retained revisions, lack of premature solutions, and rejection of a genuinely completed model result delivered after interruption. The simulated speech adapter also received public speech and returned decoded audio packets; board JSON was not spoken.

The run made 6 Luna requests and 11 Jev requests (6 student-intent and 5 canvas-routing). These are single scenarios, not a production reliability or latency distribution. Audio timing is simulated. No missing-board repair was required in this run; separate live checks generated a valid blank 8×10 recovery matrix, and deterministic voice tests cover one-attempt repair, cancellation, failed repair, and no recursive retry.

Desktop and mobile browser checks separately rendered all 80 cells, selected the last row/column, preserved selection and reopened the matrix, without page-level horizontal overflow.

## Evidence and fixes

Old session history recorded claims of showing the 8×10 game at 02:08:42, 02:09:07, and 02:09:29 EDT without any accompanying displayed-board event. The former validator rejected first-class matrices wider than eight columns. Old logs did not retain the proposed rejected output, so they cannot establish whether each individual failure was omission, invalid output, or routing. New diagnostics record those branches separately.

Changes include 12×12 matrix support, proactive visual instructions, diagram-only live scenes, independent close/reopen/replace decisions, one silent missing/invalid-board repair, acceptance of fully validated JSON that only lacks its closing board tag, and rejection of stale client canvas packets. Truncated JSON and unsafe or invalid scenes remain rejected.

Full local check at completion: 430 tests passed; Vite build passed. The build retains its existing large-chunk advisory.

- [Detailed scenario artifact](../artifacts/whiteboard-scenarios.json)
- [Reusable simulated-voice harness](../artifacts/whiteboard-scenarios.mjs)
- [Earlier live smoke before repairs](../artifacts/whiteboard-live-smoke-before.json)
- [Earlier live smoke after routing and practice fixes](../artifacts/whiteboard-live-smoke-after.json)
- [Exact import and debug flow](import-and-debug.md)
