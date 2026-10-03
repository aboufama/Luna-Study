# Assistance evidence diagnostic

The new citation protocol authenticated all 12 judgments, but **did not fix false assistance classification**. Both graders still marked each neutral w/y answer assisted. All four control pairs matched their predeclared labels. No scores were written.

| Condition | Expected | Two judgments | Pair latency |
|---|---|---|---|
| neutral-w | Unassisted | Assisted / Assisted | 4.038 s |
| neutral-y | Unassisted | Assisted / Assisted | 4.212 s |
| same-id-hint | Assisted | Assisted / Assisted | 3.278 s |
| renamed-target-hint | Assisted | Assisted / Assisted | 4.140 s |
| unrelated-teaching | Unassisted | Unassisted / Unassisted | 4.073 s |
| worked-then-restated | Assisted | Assisted / Assisted | 3.346 s |

## What the graders actually cited

For neutral **w**, both cited conversation index 26, ID `h-97ed328f88c21894-0`:

> Correct. Your two operations give z = −2, and your reason is right: applying the same operation to both sides preserves equality. Try another hard equation. How do equal operations solve 5w - 10 = 20, and why are those operations valid?

This combines substantive feedback on **z** with the first **w** question. The selected words are authentic; their assistance attribution to w is wrong under the declared exact-target policy.

For neutral **y**, both cited conversation index 45, ID `h-5e1022b35985de9e-0`:

> Yes—here’s another hard equation from your notes. Take your time. How do equal operations solve 3y - 6 = 9, and why are those operations valid?

This contains encouragement and the unsolved question, with no y solution, operation, or worked step. Both assistance judgments are false against the declared neutral-restatement policy. No exact canonical-only exclusion applied to these prefaced/mixed turns.

## Method and accounting

Six predeclared conditions, two fresh independent production `checkedGrade` judgments each, gpt-6-luna at low reasoning. Same exact captured w/y inputs as the prior restatement experiment; unchanged four controls. Full public history and immutable assistant excerpt IDs supplied to both calls; neither saw the other verdict. The runner always obtains two judgments for diagnostic comparison, even if ordinary checkedGrade could exit after an invalid first result. In this cohort all judgments passed citation and semantic agreement validation.

12 OpenAI calls, 0 Jev, no audio: 52464 input tokens (26214 cached), 1644 output tokens, 0 reported reasoning tokens. Estimated list-rate cost **$0.004364490**; actual billed dollars unavailable. All 12 responses reported usage. Total measured pair time 23.087 seconds; request queue wait excluded.

Results SHA-256: `dc5045dd6bca485d517d5f1152bda4b29b60e679a91a238cc0102afed04fb9e6`. Frozen fixture SHA-256: `abed9f3e511eb7be93797fa058c740f2f62ab113493d95c35f05d65ac976add2`. Captured request payloads, structured outputs, resolved public help excerpts, usage and production code hashes are in [grade-assistance-evidence-results.json](grade-assistance-evidence-results.json); predeclared labels and source hashes are in [grade-assistance-evidence-fixtures.json](grade-assistance-evidence-fixtures.json).

## Implication and limits

This identifies a target-attribution failure, not a citation-identity or source-evidence failure. Authentic wording alone cannot establish that it helped the current problem. A next repair needs target-scoped public exposure metadata and explicit neutral-question spans, preserving substantive prior help after restatement or renamed IDs. Do not strip complete history or weaken the independent correctness/reasoning checks.

One pair per condition is diagnostic evidence, not a reliability estimate. These are synthetic algebra cases with exactly captured histories, not a general-subject accuracy evaluation. Interrupted non-permit speech and past reopened boards may still be incompletely represented by current completed-turn history; absence from the catalog is not proof of no help.
