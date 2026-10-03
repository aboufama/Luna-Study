# Independent release review

The final saved release passes the core repaired scenarios, with remaining teaching and layout limitations. This is a review of a synthetic session, not a learning-outcome score. [Saved run](live-adaptive-release.json) has SHA-256 `786c3b10d603a3f48d86dfef557e8fd53db27917e283dd0f5a275e8f6b84f21b` and used 51 OpenAI / 56 Jev requests. This independent review made no provider calls or production edits. Earlier failed checkpoints remain intact.

## Conversation

The previously failing “just tell me” shortcut after a checked partial principle is now blocked before tutor generation: one Jev call, zero OpenAI, no solution in speech or on the board. Three reserved hints provide orientation, inverse-operation strategy, then subtracting 3; they do not jump to the final value or assume the student completed the next equation. Wrong x=7 work receives a concrete repair request without revealing x=4. Biology clarification neutrally restates the task, and the no-calculator request is respected.

Feedback invites a concrete revision or next question. Canonical revisits and pause/resume stay bound, and displayed boards change with the current target. The late conversation nevertheless repeats the y equation and cell comparison. The fixed bank and script contribute to this, but it is still a limitation of the demonstrated teaching. The welcome board also provides a general equality cue before a hint; “no solved step or solution giveaway” is supported, whereas “no instructional support before a hint” would be too strong.

The [separate planning smoke](live-planning-release.json) also passes manual review: after the learner says the date is unknown and cell transport is weak, Luna asks the canonical cell question; after planning is declined, Luna invites the answer without more intake or a giveaway. That is only two student requests.

## Grading

Eleven recognized attempts produced ten checked grades and one review disagreement. The complete z, w and y answers were checked correct and unassisted. In `method-recap`, both graders agree on a target attempt, partial correctness and insufficient reasoning, but disagree on assistance. The attempt is preserved and no score is awarded. This is a remaining semantic reliability limitation, not a lost-attempt or incorrect-score success claim. Final application values are 82 overall, Equations 100/mastered and Cell transport 63; these are policy outputs, not teaching-quality percentages or proof of lasting mastery. The final spoken recap appropriately qualifies lasting mastery.

## Actually displayed boards

All **13 accepted updates** were replayed with the production read-only Whiteboard at desktop and phone sizes: **26 renders, zero browser or math errors**. I inspected all 26 images and four additional right-scrolled table views. Equations and biology content match the synthetic sources and current public question. No stale solution appears when switching targets. No malformed math, overlapping content or word-fragmented prose was found. One invalid generated candidate remains in the raw session; it was not an accepted displayed board.

The four mobile tables deliberately use native horizontal scrolling. Their **36 cells** retain whole ordinary words and **16px body text**; rightmost columns are reachable. This is usable rather than a claim that every column fits at once. Row labels move out of view during scrolling, and the final table is wordy with a narrow energy column on desktop. The table mixes a membrane role with transport processes, leaving some cells appropriately blank; no factual category error was found.

- [All 26 exact-board replays and renderer hashes](release-board-audit.json)
- [Four exact release tables: scroll, word and font measurements](release-matrix-scroll-audit.json)
- [Full-app mobile evidence: 18 named check groups](../../artifacts/hint-presence/results.json), including prior accepted matrices in the actual 258px frame, compact 8×10 numeric grid, accessible scrolling, dock, pause and centered close control
- [Final table, desktop](renders/release-accepted-desktop-13-final-review.png) · [mobile left](renders/release-accepted-mobile-13-final-review.png) · [mobile right](renders/release-matrix-mobile-right-final-review.png)
- [Structured independent rubric, packet notes and evidence](release-independent-audit.json)

No real microphone, actual ElevenLabs recognition/playback, human learner or delayed retention was measured. Fixed sources, a small question bank and correlated model judgments limit generalization. Earlier failures and the captured disagreement remain part of the evidence.
