# Grader model diagnostic comparison

**Terra matched all six predeclared pairs; Luna matched four.** Both Terra judgments correctly treated neutral w/y restatements as unassisted while retaining real same-target hints and worked solutions. All actual request fields except model were verified identical across the paired cohorts, including full input/history, instructions, structured schema, low reasoning effort, store:false, and tools:[]. No scores or production model configuration were changed by this experiment.

| Condition | Expected assistance | Luna | Terra |
|---|---|---|---|
| neutral-w | Unassisted | False assistance | Pass |
| neutral-y | Unassisted | False assistance | Pass |
| same-id-hint | Assisted | Pass | Pass |
| renamed-target-hint | Assisted | Pass | Pass |
| unrelated-teaching | Unassisted | Pass | Pass |
| worked-then-restated | Assisted | Pass | Pass |

Both models cited the actual inserted hint for same-ID and renamed-ID controls, and the actual worked solution for its control. Terra returned empty assistance citations for neutral w/y and unrelated teaching. Luna falsely cited earlier z feedback mixed with a new w question, and a neutral prefaced y question; see [the Luna diagnostic](grade-assistance-evidence-results.md). No source/evidence validation was relaxed.

| Measured item | gpt-6-luna | gpt-5.6-terra |
|---|---:|---:|
| Calls | 12 | 12 |
| Median independent-pair latency | 4.056 s | 5.071 s |
| Aggregate pair time | 23.087 s | 35.839 s |
| Input tokens | 52464 | 52464 |
| Cached input tokens | 26214 | 26214 |
| Output tokens | 1644 | 2133 |
| Reasoning tokens | 0 | 531 |
| Estimated list-rate cost | $0.004364490 | $0.096445800 |

Actual billed dollars are unavailable; every response reported usage. No Jev/audio calls. Background grading is outside the spoken response critical path, so these are grader-pair times rather than speech delays. The cohorts were sequential model blocks, not interleaved; service load and cache state can affect timing. One Terra pair took12.533s, so the median does not describe all waits.

This supports trying an explicit grader-only Terra override while retaining independent checks and all assistance/evidence rules. It does **not** establish broad reliability: only one pair per model per condition, six related synthetic algebra cases, all current answers complete/correct. It does not test Terra's false-credit rate on wrong or partial answers. Existing low-effort Luna controls and deterministic gates remain separate evidence; a new model needs balanced correctness controls and integrated follow-up.

Raw actual returned models match requested models for all24responses. Sources and code hashes are captured in [Terra raw results](grade-assistance-terra-results.json) and [frozen six-case fixtures](grade-assistance-evidence-fixtures.json). Terra results SHA-256: `a65b3afdeb65e952178264e98201b86da4c647a7b54aa174b381553bb9b7e01b`; Luna comparison SHA-256: `dc5045dd6bca485d517d5f1152bda4b29b60e679a91a238cc0102afed04fb9e6`. Exact input/schema/instruction parity was verified programmatically before writing this report.
