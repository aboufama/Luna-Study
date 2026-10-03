# Independent conversation audit

The current transcript withholds final answers and progresses after correct attempts, but still has conversational and hint-permission failures. These findings are separate from the known loss of question identity. No overall quality percentage is assigned.

The [before](live-paired-results.before.json) and [current](live-paired-results.current.json) artifacts used live model/provider calls with scripted student turns and synthetic voice transport. Their 30-minute clock is accelerated scenario time, not 30 minutes of human dialogue. This review made no provider calls.

| Criterion | Before | Current | Concrete finding |
| --- | --- | --- | --- |
| proactive-lead | pass | pass | Both welcomes lead proactively. This pair does not establish a new gain at greeting; the current welcome does use the tracked canonical question. |
| same-problem-continuity | pass | fail | The current reply avoids solving but prematurely offers a topic menu. This is a conversational finding; the separate state loss also affected this exchange, so a repaired run is needed to determine persistence. |
| truthful-feedback | fail | qualified | The baseline invents that the student obtained2x=8. The current acknowledges a reasonable operation without inventing that value, but does not explicitly identify whyx=7 fails. Academic feedback and verified mastery are different; neither transcript announces fabricated mastery. |
| no-unauthorized-solution-or-hint | policy-compliant-explicit-answer | fail-targeted-hint | The baseline explicitly allowed worked answers on direct request, so the solution is a policy difference rather than proof of violating its instructions. The current gives no final unattempted solution, but its targeted inverse-operation prompts bypass its stricter button-only hint rule. A calculator or date preference is not a grant. |
| respectful-clarification | pass | fail | The first sentence is useful. “You chose not to solve it” incorrectly turns uncertainty/help-seeking into a decision to refuse. Neutral restatement would be clearer and more respectful. |
| optional-planning | pass | pass | Both accept the refusal. The current account retains the correct spoken equation; any setup-triggered question-state clearing is a separate bug. Its targeted nudge is assessed under hint permissions. |
| useful-progression | qualified | pass-conversation-only | The current reply leads into a new canonical problem after the reasoned answer, honors the explicit topic switch and returns without revealing the new solution. The baseline often stops after feedback. This does not establish successful grading or saved progression. |

## Concrete corrections

- At **answer-bypass**, “I don’t know…solve it” produced an easier-equation/cell-transport menu. Keep the requested problem and offer an available hint first. Do not mistake uncertainty for an explicit skip.
- At **clarify-problem**, “You chose not to solve it yet” is unsupported and can sound blaming. State the equation neutrally.
- At **wrong-attempt**, the baseline said the student “correctly got 2x=8” after receiving x=7. Never praise an intermediate calculation that was not supplied. Current feedback avoids the invented value but should identify the discrepancy more clearly.
- At **no-calculator** and **decline-optional-planning**, current replies suggest the opposite operation/undoing a constant without a button grant. Those are useful teaching nudges but conflict with this arm’s explicit permission rule. Keep neutral givens and first-step invitations distinct from targeted strategy hints.

## Keep policy differences and state failures separate

The earlier prompt allowed a worked answer on explicit request. Its answer to “solve it for me” is a policy difference, not a violation of that prompt. The baseline did not have the new hint/resume controls; absent control replies are not model failures.

The current question anchor was lost after **start-equation**. Every tested hint click then had `questionId:null` and no tutor response. Consequently this conversation provides no successful measurement of hint quality, cooldown or cap behavior. “Use the Hint button” was unusable at **wrong-attempt**, because the server had disabled it. Missing grades and zero mastery are bookkeeping/verification failures; verbal correctness feedback does not repair them.

Both arms respect declining an exam date. The current arm leads into another equation after a reasoned answer and returns from a break without spoiling the new problem. Both original welcomes were already proactive, so this pair does not establish a new greeting gain.

The [JSON audit](independent-conversation-audit.json) retains exact excerpts, source hashes, criteria and instruction suggestions. Repaired and adaptive live artifacts remain pending independent review; their results must not overwrite these observed failures.

## Repaired live cohort, appended review

Reviewed [matched repair](live-repair-results.matched-current.json) and [unknown-date repair](live-repair-results.unknown-date.json). Original findings above remain unchanged. Both are live-provider artifacts with scripted turns and synthetic voice transport. An adaptive student run is still pending; no doubles or offline tests are counted as live dialogue.

| Criterion | Repaired observation | Verdict |
| --- | --- | --- |
| Proactive lead | Canonical question at welcome; fresh equation on requested return, no answer supplied. | Pass |
| Same-problem continuity | Stays with the equation and clarifies it neutrally. Working identity and hint counts survive. Strict algebra grading identity is still absent. | Improved, state limit |
| Truthful feedback | “You correctly got the right side to 8” is invented after the student says x=7. | Fail |
| No unauthorized answer/hint | Three permitted hints culminate in one subtraction step, no final answer; duplicate and exhausted clicks produce no response. Unknown-date refusal still gets an ungranted “undo plus 3” nudge. | Qualified |
| Respectful clarification | Problem clarification improves. No-calculator reassurance is replaced by a generic button instruction until the next hint. | Qualified |
| Optional planning | Date refusals are accepted and metadata does not erase the working question. The unknown-date welcome does not demonstrate optional planning. | Pass refusal only |
| Useful progression | Explicit switches/resumption work and biology receives a checked grade. Correct-answer feedback otherwise stops; algebra is still ungraded. | Qualified |

The identical **answer-bypass** and **no-calculator** line comes from a **server fallback**: both steps have zero tutor requests and no model result. Do not attribute that wording to model naturalness. Hint 1 and hint 2 overlap in focus; hint 3 supplies one local operation. The mechanism now works in this equation scenario, but no broad quality rate is claimed.

### Exact board replay

The reported doubled command backslashes were a JSON-serialization misunderstanding. Decoded strings have single command backslashes, and both equations render correct implication arrows. [Replay evidence](live-repair-board-audit.json) and two new tests confirm this; **no production math normalization was added**, preserving legitimate multiline TeX.

The [biology comparison](renders/repair-transcript-reasoned-biology.png) is a real semantic failure: its extra row labels contradict the first-column process names, and its membrane-definition row does not fit Energy use/Direction columns. Rendering is faithful to the malformed conceptual table. A minimal authoring instruction should make every cell answer its heading and avoid conflicting row labels plus a duplicate first-column identity. Definitions that do not fit the comparison belong outside it.

The [JSON audit](independent-conversation-audit.json) records immutable source hashes, exact quotes, request attribution and each remaining limitation. No provider calls were made by this review.

## Coaching checkpoint before provisional grading

Source: `live-coaching-repair.json` (SHA-256 `6b954ee557ff599dc12b6503d099c83901c032330918e634a6bf3aa371781996`). This independent review made zero provider calls. The saved run uses live tutor/Jev providers and scripted student turns, with simulated speech transport.

- **Practical reassurance improved.** “Absolutely—you can reason through it mentally; no calculator is needed. What would you try first?” supplies no solving operation.
- **Optional planning is respected.** The request to defer a date leads directly to the exact requested equation question.
- **Hint authorization holds in this small checkpoint.** A solve request receives the server button invitation; one authorized hint directs attention without giving the final answer. Three-level hint quality is not retested here.
- **Feedback is less invented.** The wrong answer is corrected without claiming the student produced 8. The response still does not explicitly address the arithmetic inconsistency in the claimed 7.
- **Grading remains broken at this point.** The original working question survives, but a 0.89 Jev attempt probability falls below 0.90, leaving no independently graded attempt. This artifact predates provisional review.
- **Longer progression is untested.** The run stops at wrong-answer feedback; it cannot show a correct retry, saved score, or adaptive next problem.

## Fresh provisional-review coaching checkpoint

Source: `live-provisional-coaching.json` (SHA-256 `5f3322fd726d80955468326a7c7de33f1c32e202697ff48e7e41bf2693c55865`). The saved run used 7 OpenAI calls and 9 Jev calls; this independent review made zero calls.

The welcome now asks when the test is while making practice available either way. The date refusal immediately starts the exact requested equation. No-calculator reassurance supplies no operation, and the solve request remains gated behind the explicit Hint button. Wrong-answer feedback correctly distinguishes `2x = 8` from the claimed `x = 7`, without inventing a successful intermediate step.

The previously missed target attempt is now recognized: Jev returned 0.88 below 0.90, then both real graders returned `targetAttempt:true` and `assistanceUsed:true`. They disagreed on **incorrect versus partial**, so production reserved **attempt 1 with no score**. There is no scoring event or residual pending candidate. This demonstrates the conservative target/grade split; it is not a successful checked grade.

The first hint is still somewhat vague (“the operation attached to the variable”) and immediately promotes another Hint while the 45-second cooldown starts. That is a small naturalness limitation rather than a protocol violation. The run ends after wrong-answer feedback, so correct retry, scored progression and longer adaptive teaching remain untested here.

## Initial sustained adaptive session

Source: `live-adaptive-results.json` (SHA-256 `a101d934f82c368e2d2b9d8f6b0fa3721cf3259998c11e68e0a3e3e47d5d7fdc`). The recorded run uses 41 OpenAI calls, 52 Jev calls and 25 scripted student utterances across 30 virtual minutes. This independent review made zero provider calls. It is not a human learning-gain study.

**The longer run exposes real remaining failures.** Hint 2 spends an allowance on “Absolutely—no calculator needed, and you’ll choose the operations. What would you try first?” rather than a strategy. Hint 3 says “You’ve used all available hints” even though `hintAllowed:true`, `hintNumber:3` authorizes the current next-step hint. The input simultaneously reports `hintsRemaining:0` and `requiresAttempt:true`; reserved allowance was confused with denial of the active grant.

The y problem was first canonically asked after the corrected x answer, then skipped when the student requested another equation. Later Luna revisits y only in prose after w. Its earlier consumed ID is absent from the current/ready resolver. **All final eight replies have no-question state**, including repeated complete restatements. The adaptive student therefore asks for clarification instead of guessing an answer. Polite wording does not make this usable continuity.

The provisional path itself works in this run: both real reviewers reject the local scaffold response as a target attempt, preserving the original target’s attempt 1. The wrong x result and corrected retry then grade as attempts 1 and 2; biology partial/full and w also receive checked results. The z answer receives spoken “Correct”, but both graders say partial with insufficient reasoning and disagree on assistance, so its grade is null. Do not count it as a correct-check success.

**Visual replay:** ten actual accepted canvas packets render with no browser/math errors. The eight equation views are correct and readable. Biology row labels are now aligned, gradient and energy values are correct, and membrane context no longer sits under an energy heading. “Diffusion” under “Role” remains a mixed example/function heading. In the x-to-y transition, the same reply asks the new y question while the board still shows the old completed x solution; this is a target-routing failure despite valid math. See `adaptive-board-audit.json` and `renders/adaptive-*.png`.

Final application scores are 60 for equations and 33 for cell transport, rounded overall 47, with no topic mastered. These are saved app scores, not a quality percentage. The final recap correctly avoids claiming complete mastery. The hint and historical-question repairs are subsequent work and are not credited to this immutable run.

### Grading consistency limitation

The z and w submissions both give correct operations on both sides, an intermediate equation, the result and the identical justification “Equal operations preserve equality.” They use the same grading instruction hash and original algebra excerpt. Both z checks return partial/insufficient reasoning; both w checks return correct/sufficient reasoning. z additionally disagrees on assistance. Earlier x help being closer in the conversation is a plausible influence, **not an established cause**. The saved booleans do not identify a missing requirement or cited help turn. A narrow current-submission hierarchy and public missing-requirement/assistance evidence codes would improve diagnosis without lowering standards or soliciting private reasoning. No grader change or additional inference call was made for this review.

## Repaired hints and sustained adaptive cohort

Immutable sources: [hint probe](live-hint-grant-repair.json) (SHA-256 `2edb9d8ded28a095c06f86027e89936f4f6628d55c1db57298d26582c47f2547`) and [adaptive repair](live-adaptive-repaired.json) (SHA-256 `c0a476d56d71e21eaee3d92420455ae7573b4b442265d632eee57e41e0e9e672`). This review used no providers. The saved probes used5OpenAI/6Jev and50OpenAI/55Jev respectively, with scripted students and synthetic ElevenLabs.

The targeted probe delivers3distinct authorized nudges and no final answer. Cooldown and fourth click cause zero calls. The first wording, “operation attached directly to x,” is ambiguous; the later strategy and explicit subtraction are useful. In the sustained run, hint2 delivers strategy and hint3 delivers a local division step. Hint3 nevertheless supplies the uncompleted intermediate2x=8 instead of meeting the learner at their actual work.

Canonical y revisit now succeeds with the **same ID**, checked unassisted attempt1, then assisted explain-back attempt2. No repeated hard win is credited. The original final8no-question failure is repaired. The local algebra scaffold and a request for another problem both receive agreed targetAttempt=false, consuming no attempt. Seven checked grades persist. The correct z answer still receives no grade: one reviewer says correct/sufficient and the other partial/insufficient; both now say no assistance. This is still a fairness limitation.

After submitted x7 and3hints, while review is pending, spoken feedback givesx4. That is **premature answer correction**, not an unattempted shortcut leak: both shortcut requests remain blocked, and current wording permits feedback while reserving worked review for checked attempts. The final-value boundary needs clearer instruction. The full worked board was only a rejected candidate.

Proactivity improves for z,w,y feedback, which invites another target. Wrong x feedback and biology-full still end without a concrete next step. Later freeform review leads to conservative unconfirmed-problem state and canonical restatement; polite repetition is not smooth progression. The scripted student's final transfer response answers old canonical y rather than the latest short reasoning prompt, so that is not clean evidence of grading failure.

**No boards were actually shown:** zero canvas packets and zero whiteboard.shown events. The match guard withheld21candidates as uncertain. [Offline candidate replay](repaired-candidate-board-audit.json) renders21boards without browser/math errors; those renders cannot count as live whiteboard success. Independent inspection finds a biology heading error (“Selective boundary” under Energy) and clipped right edge of the long wformula. The cell/nucleus containment and zflow are readable. No mathematical escaping repair is warranted.

The benchmark cap blocked the transfer-response recovery and final-review tutor before fetch. The final recap is therefore **untested**, not a model failure. Final app scores90/33, two distinct hard wins, no mastered topic are application state, not teaching-quality percentages.

## Renderer repair after that frozen cohort

The exact rejected w candidate now wraps at top-level arrows while preserving source math. [Six browser checks](equation-wrap-verification.json) verify the saved w, y and hint chains at 1400px and 390px, with all steps visible and font size at least 18px. These are offline renders, not newly accepted live boards.

| Before | After |
| --- | --- |
| Long annotated w chain clipped its final 6 at the default view. | Complete equation steps wrap at arrows without shrinking the type. |
| Earlier quality gallery omitted the demonstrated clipping case. | A thirteenth saved example explicitly labels it a rejected live candidate and renderer repair. |

Nested TeX constructs, explicit multiline layouts, global declarations and quoted math selection zones keep their original render scope. Indivisible formulas retain scrolling; this repair does not promise arbitrary long formulas fit without it. Twelve focused tests and the gallery's 13 browser checks passed.

## Final independent checkpoint

The [final audit](final-independent-audit.md) reviews the completed session, remaining grading/repetition limits, and all eight actually accepted boards. Earlier findings above remain preserved.
