# Strict grading: citation transport and answer sufficiency

The exact-evidence protocol now worked for all 12 grader responses across six composed trials. Semantic sufficiency is still model judgment: the concise answer yielded disagreement, partial credit, and correct credit in its three rounds. A separate answer with a uniqueness proof and explicit payoff construction passed all three rounds. The latter is a different fixture, not evidence that the concise-answer disagreement was fixed.

The preserved earlier run had one `answer-quote-mismatch` on its first grading check: the model said correct/sufficient/unassisted, but its returned quote did not match the student answer under strict validation. That trial received no score event. The old artifact did not retain the quote string, so the exact erroneous wording cannot be reconstructed. This was an evidence-transport rejection, not a disagreement between two semantic checks.

The server now partitions the complete original answer and question-scoped source documents into immutable, content-bound excerpt IDs. The grader selects answer/source IDs; the server resolves them to verbatim text and runs the existing strict identity, source-membership, and evidence checks. Unknown, duplicate, altered, cross-source, or wrong-type IDs are rejected. Two fresh independent semantic requests remain mandatory. Valid citations cannot turn an incorrect, assisted, insufficient, or disputed answer into a correct unassisted result.

| Fixture / round | Independent semantic judgments | Final checker decision | Persisted events | Topic score |
|---|---|---|---:|---:|
| Concise 1 | partial/insufficient + correct/sufficient | independent-checks-disagree | 0 | 0 |
| Concise 2 | partial/insufficient + partial/insufficient | validated-agreement | 1 | 3 |
| Concise 3 | correct/sufficient + correct/sufficient | validated-agreement | 1 | 20 |
| Reasoned 1 | correct/sufficient + correct/sufficient | validated-agreement | 1 | 20 |
| Reasoned 2 | correct/sufficient + correct/sufficient | validated-agreement | 1 | 20 |
| Reasoned 3 | correct/sufficient + correct/sufficient | validated-agreement | 1 | 20 |

Concise round 2 persisted one checked partial event (+3), despite failing the harness expectation of correct credit. Its two graders agreed on partial; the legacy check named `twoIndependentRealGradesAgreed` specifically expects both to say correct. Concise round 1 persisted no event because the graders disagreed. Concise round 3 and each reasoned round persisted exactly one checked correct event (+20), attempt 1, firstAttempt=true, unassisted=true. Overall score was 3/100 across six topics after correct credit; neither the topic nor the whole course was marked mastered.

Concise input, unchanged from the original fixture: “My answer is eight: strict equilibria cannot share a row or column, and eight disjoint pairs can attain it.”

Separate reasoned input: “My answer is eight. In a strict Nash equilibrium each player has a unique best response to the other player’s strategy. Two equilibria cannot share a column, because that would require two distinct strict best-response rows against the same column; similarly they cannot share a row. Thus there can be at most eight, since there are only eight rows. To attain eight, put payoff (1,1) in cells (i,i) for i from one through eight and (0,0) in every other cell, including columns nine and ten. At each of those eight diagonal cells either player loses payoff by deviating alone, so all eight are strict equilibria.”

The separate real grading smoke test passed 3/3: correct, incorrect, and correct-after-assistance. Each used two real Luna calls. Assistance was retained, so assisted correctness was not eligible as an unassisted hard win.

All six composed trials used a fresh production question bank and loopback WebSocket session, real Terra for the question and feedback, real Jev student intent/material selection/board routing, real Luna checked grading, strict validators, and a real temporary mastery store. Every initial board was a blank 8×10 grid; its exact canonical queued question was resolved/consumed by ID once. Public bank context never exposed private reference answers. Original source documents remained available for grading; the corpus was 25,681 characters from three local game-theory PDFs.

Question preparation, greeting/history replies, and tutor mastery-notice intent were deterministic fixtures. ElevenLabs STT was simulated with exact committed transcripts; TTS was silent PCM after a fixed 100 ms fixture delay. No real microphone, voice provider, or STT/TTS quality was tested. These small fixed-order synthetic cases do not establish a production pass rate or general semantic reliability across subjects.

| Reasoned round | Initial text from transcript | Initial board from transcript | Checked grading duration | Grading queued → persisted |
|---:|---:|---:|---:|---:|
| 1 | 2.107 s | 2.646 s | 3.877 s | 7.569 s |
| 2 | 1.941 s | 2.444 s | 3.637 s | 4.842 s |
| 3 | 1.724 s | 2.383 s | 7.551 s | 9.963 s |

Initial-board timing is the received validated server board packet, not a browser paint measurement. Checked-grading duration runs from `grading.started` to the applied event; queued-to-persisted includes the intervening feedback flow. Synthetic-audio time is recorded in raw JSON, but must not be interpreted as ElevenLabs latency. Each run held the shared provider slot to avoid simultaneous benchmark inference. This is not a matched before/after speed experiment; answer length, cache state, and live provider variance differ.

| Preserved artifact | Actual OpenAI / Jev requests | List-price token estimate | Exact billed USD |
|---|---:|---:|---|
| Earlier quote-copy run | 11 / 18 | $0.102218 | unavailable |
| Citation smoke | 6 / 0 | $0.001137 | unavailable |
| Citation concise full chain | 12 / 18 | $0.103839 (partial) | unavailable |
| Citation reasoned full chain | 12 / 18 | $0.102241 | unavailable |

New validation totals: 30 OpenAI + 36 Jev = 66 actual HTTP requests, estimated $0.207217 (partial). This excludes the preserved earlier run. Exact billed dollars were not returned; they are unavailable, not zero. Estimates use recorded counters and the repository’s verified public rates, assume standard processing for default/missing tier, include reported cache writes/reads, and exclude discounts, credits, regional premiums, and taxes. Reasoning tokens are already included in output tokens and are not charged twice. No cost is assigned to fake ElevenLabs audio. Per-model input/output/cache/reasoning counters are in the summary JSON.

Concise round 2 also recorded one failed Jev whiteboard-routing request without token usage. Its decision was unavailable, and the existing structured-visual fallback still showed the validated blank grid. The record does not establish the provider failure’s detailed cause. That request is included in the HTTP count and excluded from the partial dollar subtotal; no zero cost is inferred. The reasoned run returned measured usage for all its requests.

Offline verification: 143 focused tests passed across mastery, citation resolution, Jev intent, live voice, and new modular lifecycle suites. Tests cover lossless 70,000-character evidence, unknown/foreign/altered IDs, exact mathematical signs and grammar, independent disagreement, prior assistance, first-attempt reservation, duplicate persistence, source changes, stale/canceled turns, scene patches, manual visibility, and topic-level completion constraints. This establishes deterministic credit and transport invariants; semantic judgments remain probabilistic.

Raw evidence is preserved separately:

- before: [tutor-step-change-fullchain-results.json](tutor-step-change-fullchain-results.json)
- smoke: [grade-citations-smoke-results.json](grade-citations-smoke-results.json)
- concise: [tutor-step-change-citations-final.json](tutor-step-change-citations-final.json)
- reasoned: [tutor-step-change-reasoned-final.json](tutor-step-change-reasoned-final.json)
- Summary: [grade-citations-results.summary.json](grade-citations-results.summary.json)

Regenerate this report without provider calls:

```sh
node benchmarks/grade-citations-report.mjs
```

Reproduce the reasoned fixture only when new paid testing is intended. Use a new output filename to preserve prior evidence:

```sh
node --env-file-if-exists=.env --input-type=module -e 'import {withProviderSlot} from "./benchmarks/whiteboard-provider-slot.mjs"; await withProviderSlot(()=>import("./benchmarks/tutor-context-scenarios.mjs"));' -- --live --condition=after-terra --production-bank --scenario=blank-grid --real-intent --real-grading --answer-variant=reasoned --rounds=3 --max-openai=12 --max-jev=18 --max-requests=30 --output=benchmarks/tutor-citation-reproduction.json
```

Remove `--live` for an offline fixture run. Use `--answer-variant=concise` to retain the original shorter answer. The raw artifacts retain source/model hashes, exact scenarios, requested budgets, real usage, decisions, boards, and persisted events. No failed trial has been replaced or relaxed.
