# Unknown-date planning smoke

Passed this targeted live scenario. Sources were indexed and the exam date was empty. Terra asked about timing once, accepted the student's unknown date and weak-topic preference, then started actual canonical cell-transport practice. Declining more planning preserved the same question ID and did not start another intake checklist. No date was invented and no answer/solution was supplied.

| Turn | Exact tutor reply |
|---|---|
| welcome | We can jump into quiz practice. When is your test? |
| unknown-date-priority | Why is a cell membrane called a selective boundary, and how do passive and active transport differ? |
| decline-more-planning | Absolutely—go ahead and answer the cell transport question in your own words. Take your time. |

The student first said: “I don't know when the exam is yet. Cell transport is my weakest topic. Let's practice that now.” Then: “I'd rather not plan the timing or answer more setup questions. Please let me try the cell transport question.”

The same canonical ID `dffdce1f-daac-4a46-bb42-bc5fcc499b69` remained active after both requests. All mechanical checks passed; manual review separately checked the conversational claims above. No grading ran.

3 OpenAI Terra calls and 5 Jev calls, below the 8 OpenAI / 12 Jev request caps; no provider errors or blocked calls. All eight reported token usage. Estimated cost $0.016311484; actual billed dollars unavailable. 7.517 seconds wall time; 75 seconds on the virtual timeline. Median committed student transcript to first text was 1,612 ms across only two turns, excluding real STT and playback.

This is one short synthetic session using the real server/tutor/Jev, a fixed question bank and simulated ElevenLabs. It does not establish general planning reliability, test a supplied date being accepted, or measure learning gains. The optional calculator switch was omitted to keep scope narrow. Source code hashes were unchanged during the run.

[Raw captured replies and accounting](live-planning-release.json), [SHA-bound manual audit](live-planning-release.audit.json). Raw result SHA-256: `ec363e620d24eb94816899fa2f07aa01fb349b9bc6e84cff6883d23db935c1b6`.
