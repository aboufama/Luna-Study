# Terra tutor: functional repair and whiteboard experiments

**Historical first repair report.** The retained-scene implementation, Jev visibility trials and expanded format benchmark are covered in [the current step-change report](tutor-step-change-report.md). Counts and measurements below describe the earlier checkpoint.

October 2, 2026. At that checkpoint, changes were running in the local Luna Study app at http://127.0.0.1:5188. Both `/` and `/api/status` return HTTP 200; status confirms `tutorModel: gpt-5.6-terra`, background organizer `gpt-6-luna`, and ElevenLabs voice.

## Result

The final three composed study sessions passed the complete tested path: canonical queued question → blank diagram → student answer → real Jev intent → Terra feedback → two independent Luna grades → exactly one persisted first unassisted score event. The twelve broader conversation/board scenarios also passed their evaluated checks; their grade verdicts were simulated, so they are separate evidence. The final local gate passed **553 tests and a production build**. The existing bundle-size advisory remains.

This establishes the repaired flow for the exercised cases. It does not establish perfect tutoring, production-wide grading reliability, or measured ElevenLabs latency. The live tests deliberately simulate ElevenLabs, as requested, and use prepared fixture questions drawn from the user's game-theory PDFs.

## Product contract

Conversation should stay natural and adaptive. The tutor chooses explanations, tangents, scaffolding and follow-ups; the server enforces credit rules underneath. Ordinary dialogue is free-form. A scored bank question has a stable identity and canonical wording, so the model does not have to duplicate a string correctly to preserve completion tracking.

The credit rules are deterministic: exact question/topic/source identity, validated evidence, two agreeing checks, first-attempt and assistance eligibility, duplicate prevention, and source revision. Judging the meaning of an answer is still model-based. Ambiguous, unsupported or disputed grades receive no credit; their reason is logged.

The board should follow the current problem: update stable objects during the same problem, replace the scene on a new problem, and hide when it no longer helps. Visibility, retained objects, generation format and camera movement are separate decisions. Continuous awareness does not require a redraw on every utterance.

## What changed

| Demonstrated failure | Repair |
| --- | --- |
| The tutor rephrased a queued question using source wording, breaking completion identity. | `<ask>question-id</ask>` is resolved against the immutable offered bank and current source bank. The server sends canonical wording to captions/TTS and carries the ID into tracking. |
| A diagram label such as `x = ?` looked like a second question and erased tracking. | A canonical spoken question keeps its identity when the same turn displays a board. Board content still enters grading evidence. |
| The real grading API rejected `uniqueItems` in its strict JSON schema. | Removed the unsupported keyword; server validation still rejects duplicate source IDs. |
| PDF line-wrap whitespace caused otherwise valid source quotations to fail validation. | Evidence comparison permits whitespace differences only. Words, numbers, mathematical signs, punctuation and case remain unchanged. |
| A second independent grader copied the wrong question/topic ID. | Per-request JSON schema enums constrain question, topic and source identities. Local validation remains in place. |
| Background failures were hard to distinguish from a missed answer. | Added question-tracking and grading lifecycle logs with IDs, check stage, rejection reason, verdict and eligibility. No private answer keys or hidden reasoning are logged. |

`LUNA_TUTOR_MODEL=gpt-5.6-terra` now selects only the main speaking tutor. `LUNA_API_MODEL=gpt-6-luna` remains the model for indexing, question preparation, grading, optional planning and silent visual recovery. Every model continuation/recovery retains its own accounting record. Terra price estimates and the status endpoint reflect the split.

## Measured functional results

| Test set | Result | Median first text | Median initial blank board |
| --- | --- | ---: | ---: |
| Three rounds × four conversation/board cases, simulated intent/grade verdict | 12/12 evaluated passes | 1.548 s across all 12 | 2.635 s across three grid cases |
| Initial fully composed real intent/grading sessions | 1/2 passes; second-check identity mismatch withheld credit | See raw report | See raw report |
| Final fully composed sessions after identity schema repair | 3/3 passes | 1.365 s | 2.132 s |
| Real grader smoke: correct, incorrect, and previously assisted answer | 3/3 passes, each independently checked twice | Background work | Not applicable |

Each final composed session persisted one event with `checked=true`, `firstAttempt=true`, and `unassisted=true`; the medium-question topic score became **20**, not “mastered.” Across six topics the overall score was 3. Grade application occurred 9.199, 10.646 and 12.108 seconds after the initial question request, including the intervening answer/feedback turn and both grading checks. Grading does not block first speech.

The broader set used source payoff recall, a blank 8×10 game, switching from a payoff table to the line city, and answer feedback. All three feedback cases used visual recovery; its median board arrival was **6.021 seconds**. That is a remaining whiteboard latency limitation, not hidden by the faster speech result.

The real corpus contains 25,681 extracted characters from three game-theory PDFs; hashes are recorded in the raw results. Earlier conversation and original source evidence were preserved. Tests use fixed order and small samples; they do not isolate the causal effect of the model change from the protocol changes and do not establish percentile latency.

## Whiteboard format experiment

A separate agent ran **36 real GPT-6 Luna generations** across current JSON primitives, restricted direct SVG, a compact scene description language, and Mermaid. The seven scene types were a source payoff matrix, blank 8×10 grid, line city, game tree, function plot, process sequence, and an edit moving only vendor A. Outputs were parsed, rendered in Chromium, inspected for labels/geometry/object identity, and retained, including failures. The best two initial formats were repeated on three matched scenes.

| Matched scene, three samples per format | Compact scene median render | Direct SVG median render | Full quality checks, scene / SVG |
| --- | ---: | ---: | ---: |
| Blank 8×10 grid | 1.97 s | 17.43 s | 3/3 / 3/3 |
| Line city | 2.81 s | 5.55 s | 3/3 / 3/3 |
| Game tree | 2.59 s | 8.55 s | 3/3 / 1/3 |

These are drawing-request-to-validated-render times, excluding retrieval, speech, Jev scene routing and the production WebSocket/UI delivery path. Current production diagrams already render as SVG; matrices use HTML and KaTeX. The experiment normalizes all comparisons to an SVG frame, so it is not a benchmark of the existing React renderer. Small samples, fixed order and selecting the repeated formats from the initial sweep limit generalization.

The compact description is the strongest candidate for the next board iteration. For the blank grid it emitted a median 155 output tokens versus 3,034 for direct SVG. A trusted renderer can create eighty cells from dimensions instead of making the model repeat eighty shapes. Matrices, axes, game trees and processes can have semantic objects with stable IDs; safe free-form primitives can cover unusual drawings. The retained scene then renders to SVG and supports a camera independently.

This is not ready for a wholesale production swap. Current JSON split one line city across independent blocks, losing shared geometry. Direct SVG and Mermaid sometimes renamed action labels. The compact prototype had an overlapping graph label, and a correctly drawn payoff matrix used lines/text without full-cell hit areas. Those are distinct issues from parse success. The scene edit preserved unaffected city objects and IDs, but a fixed viewBox is not proof of camera persistence across production updates.

For the open-world feel, the next architecture should maintain one scene per active problem, stable object IDs, incremental patches and a pan/zoom camera that survives updates. A small public drawing request should identify the problem, source revision, dimensions, known values, blanks and intended scene action. The board controller can decide show/update/replace/hide on every turn while keeping scoring identities separate. Keep useful scenes stable during same-problem hints; hide stale scenes during unrelated conversation; discard drawings produced for superseded turns. This is a proposed next step supported by the experiment, not a newly shipped renderer or parallel agent.

See the [complete format analysis](../benchmarks/whiteboard-formats/results.md), [raw 36-call results](../benchmarks/whiteboard-formats/results.json), and [local interactive comparison](../benchmarks/whiteboard-formats/comparison.html). The comparison offers sample selectors, object IDs and a pan/zoom demonstration without any additional model calls.

## Cost and test boundaries

The three conversation/full-chain datasets used **35 OpenAI and 57 Jev requests** with a public list-price subtotal of **$0.339907**, partial because one prefetch timed out without returned usage. The relevant original source fallback still produced a correct answer. Grading diagnostics and the separate format experiment have separate records; this subtotal is not the total of all investigative calls.

Provider-billed dollars are unavailable. Debug values are measured provider counters plus labeled price estimates, not an invoice. No paid voice calls were made by these simulations. Synthetic first-audio times are not ElevenLabs latency measurements. Terra costs more per token than Luna at the verified public rates; this selection prioritizes the observed conversational latency. [Terra pricing](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna).

Question preparation, greetings/history priming and mastery-notice interpretation remain fixtures in the composed benchmark. Main question/feedback, passage and canvas classification, student intent, structured decoding, question-bank storage/resolution/consumption, grading and persistence are production components with real model calls. Real grading also separately rejected an incorrect answer and marked an assisted correct answer ineligible for unassisted credit. Source changes, interruptions, malformed IDs, duplicate questions, board notation and silent recovery have local regression coverage.

## Evidence and reproduction

- [Final composed report](../benchmarks/tutor-terra-fullchain-results.final.md) and [raw results](../benchmarks/tutor-terra-fullchain-results.final.json).
- [Twelve-case report](../benchmarks/tutor-terra-bank-results.md), including explicitly corrected payoff-format evaluator false negatives and the prefetch timeout.
- [Initial composed failure](../benchmarks/tutor-terra-fullchain-results.md), preserved rather than overwritten.
- [Final real grading smoke](../benchmarks/terra-grading-smoke.json), [rejected schema](../benchmarks/terra-grading-smoke.initial.json), and [PDF quotation diagnostic](../benchmarks/terra-grading-smoke.diagnostic.json).
- [Current architecture and color-coded flow](tutor-context.md).

Benchmark report commands are offline. Commands containing `--live` make new paid requests and have explicit limits; see each report for reproduction instructions.
