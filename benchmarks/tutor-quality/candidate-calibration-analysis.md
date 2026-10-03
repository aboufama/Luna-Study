# Candidate-to-question relevance calibration

The production router was unchanged throughout `live-candidate-calibration.json`:24 actual Jev calls, zero OpenAI calls, all usage observed, estimated cost$0.001264914. The frozen fixture SHA-256 is `44b8216bc75a73ce0bdb652f4fce4ff9f41f1dfafdbf85a1c8893a01500c3d33`.

Independent review preceded all calls. Development covered three families: game grids, algebra, and cell biology. Held-out fixtures covered three different families: chemistry, history, and grammar. Each family contained a matching target, wrong target, mixed old/new targets, and an incomplete or generic scene. Thus12held-out cases represent three correlated domains, not12independent domains.

The predeclared selection rule maximized development positive recall among thresholds0.70,0.85,0.90 with no wrong/mixed or incomplete scenes displayed; ties favored the higher threshold. Selection0.70 was written before the first held-out call. All three thresholds are shown for transparency; no held-out retuning occurred.

| Split | Display threshold | Matching scenes opened | Wrong/mixed displayed | Incomplete displayed |
|---|---:|---:|---:|---:|
| Development |0.70|2/3|0/6|0/3|
| Development |0.85|0/3|0/6|0/3|
| Development |0.90|0/3|0/6|0/3|
| Held-out |0.70|2/3|0/6|0/3|
| Held-out |0.85|0/3|0/6|0/3|
| Held-out |0.90|0/3|0/6|0/3|

At0.70, five incomplete cases abstained and one was confidently rejected. Generic related teaching can be useful; these are insufficient-specificity cases rather than semantically false statements. The rule withholding mixed targets applies to an ordinary canonical transition, not a user-requested comparison.

The measured display boundary is now0.70; uncertain candidate matches remain hidden. The exact boundary and0.6999 abstention have regression tests. Working-problem identity and answer-attempt thresholds were not changed. This small stress set supports improved positive coverage, **not a universal safety or accuracy estimate**: only4/6positive scenes opened, while0/12wrong/mixed and0/6incomplete scenes opened.

## Why the two positives remained below threshold

Offline inspection rules out transport loss or truncation:

- The3×5grid request contained the exact structural JSON `[{"type":"matrix","rows":3,"columns":5}]`,40characters, plus the complete3-row/5-column question. Its candidate text contained only the expected empty-cell separators. Jev returned target match0.62 while visual usefulness was0.89. The prompt explicitly allowed correctly sized blank grids.
- The reaction request contained `2H_2+O_2\\rightarrow2H_2O` as24decoded characters and the complete corresponding chemical question. Its notation is equivalent to the plain-text coefficients/subscripts in the target. Nothing was clipped; target match and usefulness were both0.55.

The provider returns scores without explanations, so the causal reason for either low value cannot be established from these responses. A possible interpretation is that the classifier demands more than the target's givens, or struggles with notation equivalence; these remain hypotheses, not measured causes. No additional prompt adjustment or lower threshold was fitted to these two failures.

This set does not cover incorrect operators with otherwise identical values, large summaries near truncation limits, every diagram representation, or a population distribution of student problems. Display relevance also does not establish factual correctness or permission to reveal a solution.
