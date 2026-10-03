# Tutor and whiteboard: implementation and measured results

October 2, 2026 · Local Luna Study implementation

**Historical checkpoint.** The later [teaching-quality report](tutor-quality-report.md) supersedes this report’s current-state descriptions: the live board is now read-only, screenshots retain original pixels, and hints, proactive study transitions, presence pause, computed plots/flows, and exact text annotations have been added. The measurements below remain the original experiment results.

The tutor now uses GPT-5.6 Terra for the conversation, with GPT-6 Luna for background work. The board supports a general retained scene: editable objects, useful teaching text and math, sparse updates, local pan/zoom, and exact selection. Jev can close an obsolete board before the tutor finishes thinking. Question delivery and grading evidence now use server-resolved IDs, removing two fragile copying tasks from the models while retaining strict mastery rules.

This is a functional improvement with measured latency gains in specific paths. It is not a claim of perfect tutoring, flawless layout, or guaranteed sub-second drawing. Detailed source-backed architecture and the color-coded flowchart are in [the current tutor context](tutor-context.md).

## Results that held up in testing

| Measurement | Before | Current | Evidence and scope |
| --- | --- | --- | --- |
| Three game-theory PDFs, median server indexing | 12.630 s with verified parallel map/merge | **4.461 s** | Three cold trials per path; full 25,681 original characters; dispatch and catalog prompt changed |
| Blank 8×10 matrix, median accepted board | 2.418 s | **1.768 s** | 26.9% lower; three paired real Terra calls per condition, same full prompt except matrix encoding |
| Matrix output tokens / board bytes | 228 / 529 | **187 / 313** | Medians; 18.0% fewer output tokens, 40.8% fewer wire bytes |
| Matrix first spoken text | 1.124 s | 1.182 s | No demonstrated speech improvement in this comparison |
| Obsolete board: biology → history | 2.218 s | **136 ms** | Real Terra/Jev, simulated speech transport |
| Obsolete board: verbal algebra detour | 2.029 s | **316 ms** | Same scenario in both conditions |
| Obsolete board: grammar → forces | Still open when reply completed | **133 ms** | The early decision succeeded; no finite legacy close time |
| Final board relevance safety cohort | — | **24/24**, zero false hides | Four explicit closes and twenty keeps, including missing active-question context |
| Generic subject content | — | **8/8 accepted and correct requested source content** | Biology, algebra, physics, grammar, two calls each; remaining geometry issues below |
| Sparse edits | — | **2/2 exact** | One existing object moved; all other objects retained; 1.494 s and 1.958 s |
| Real renderer browser checks | — | **12/12** | Selection, camera, updates, hide/reopen, mobile, reduced motion, no browser errors |

The matrix timing starts at prepared input and ends at production validation/merge. Board-close timing starts at a simulated committed transcript. These clocks must not be pooled. The closure comparison disables semantic source prefetch to isolate visibility; the final implementation additionally has regression tests proving a slow prefetch cannot delay the close event. The new board follows completed generation and validation, rather than exposing partially generated objects.

Full evidence: [production generation](../benchmarks/retained-scene/results.md), [Jev lifecycle](../benchmarks/jev-board-results.md), [browser checks](../benchmarks/retained-scene/browser-verification.json).

## What changed in the product

| Area | Before | Current behavior |
| --- | --- | --- |
| Board content | Narrow diagrams/matrices; useful written explanations could be discarded | Generic positioned text, math, shapes, arrows and polylines, plus matrices and existing diagrams |
| Repetition | Eighty blank cell strings for an 8×10 grid | Dimensions plus optional known cells; server creates exact blank cells |
| Board updates | Primarily block replacement | Stable object IDs, sparse upserts, explicit object/block deletion, transactional validation |
| Viewpoint | Board updates or reopening could lose the learner's view | Camera stays local and survives sparse updates and hide/reopen within the app session |
| Selection | Coarse block/diagram targets | Exact authored phrases, math ranges and objects; unrelated edits preserve selection |
| Relevance | Obsolete scene waits for completed tutor reply | Existing Jev intent call can close it early; confirmed help/answers veto closing; stale decisions cannot override manual actions |
| Redundant text | Spoken question text could become a board | Duplicate question-only content is suppressed; useful notes and worked steps remain allowed |
| Scored questions | Model retypes question wording | `<ask>` selects a valid offered bank ID; server streams canonical public wording |
| Grading evidence | Model retypes source/answer quotations | Model selects server-owned excerpt IDs; server resolves exact original text and applies the existing checks |
| Larger-file indexing | Model copies quotations and estimates their combined size | Full original excerpt catalogs, exact IDs and structurally bounded selections; every chunk remains required |
| Debugging | Limited explanation of board behavior | Public scene revisions, decision reasons, latency, object-change counts, grade decisions and per-test provider usage |

The production renderer uses trusted React, SVG and KaTeX. No generated HTML or JavaScript executes in the tutor. The model chooses a small validated data representation; the renderer handles interaction and repeated structure. No new production rendering dependency was added.

## Natural conversation and strict mastery

Ordinary conversation, explanations and follow-ups remain free-form. Scored questions retain the complete existing prepared bank context, including its existing builder budget; retrieval does not relevance-filter that bank. The model selects a question ID, and the server confirms it still belongs to the exact offered/current bank before sending its canonical wording. Same-turn silent visual recovery cannot consume it twice or clear tracking.

An answer is reserved once. Two independent Luna evaluations receive the original sources, question, answer and public help history, including shown board text. They select immutable evidence IDs rather than copying quotations. The server checks identities, source membership, exact resolved evidence, agreement, first-attempt status, assistance, duplicates and source revision. Citation identity does not itself prove correctness: the model still has to judge the answer and its reasoning.

Mastery requires three distinct qualifying hard-question wins per indexed topic. Correct assisted practice can increase the ordinary score but cannot count as an unassisted hard win. Scores otherwise cap at 90 until mastery is earned. Mastering the current indexed topics does not certify that the whole course is covered.

A fresh pre-citation run exposed a real quote-copy rejection: two of three full chains passed, while one otherwise favorable grade failed exact answer evidence. That failure is preserved. After the citation repair, all six grader outputs in the three-round terse-answer run passed identity/evidence checks. Semantic judgments still varied: one pair disagreed, one agreed on partial credit (+3), and one agreed on correct (+20). The server withheld a grade on disagreement. This is an unresolved semantic consistency limitation, not a protocol failure or a reason to weaken the rubric.

Separate real correct/incorrect/assisted smoke cases passed **3/3** using six grader calls. A distinct fully reasoned answer fixture then passed **3/3 full chains**, with all six independent judgments agreeing on correct, sufficient, unassisted reasoning. Each persisted one checked event, with no duplicate or premature mastery. Initial board arrival was 2.383–2.646 seconds. Changing the answer does not prove the terse-answer disagreement was fixed.

Across all six composed citation trials, all twelve grader responses passed exact identity/evidence validation. One terse-answer trial also recorded a failed Jev visual request; the existing validated-visual fallback still displayed the correct blank grid. Its missing usage is preserved as partial rather than fabricated. [Full grading report, fixtures, failures, timings and usage](../benchmarks/grade-citations-results.md).

## Why this whiteboard medium

The investigation made **99 real GPT-6 Luna calls across nine representations**: existing JSON, restricted SVG, compact scene DSL, Mermaid, HTML/CSS, React/JSX, Canvas 2D, Excalidraw JSON and Vega-Lite. It included non-economics teaching content and actual rendering, screenshot review, selection checks where available, and preserved failures.

There was no universal winning language. HTML handled written explanations well, but repeated grids were verbose. React and Canvas could use loops, yet introduced executable-code and selection complexity, with observed clipping, overlapping content, changed labels and invisible text. Excalidraw exposed a useful native scene model but emitted 6,211 tokens for one blank grid. Vega-Lite was strong for charts, not a general board. The narrow benchmark DSL was quick on grids and trees but inadequate across subjects.

The implemented choice combines generic retained objects with compact repeated structures. It takes the measured output-size benefit without restricting the board to an economics template or letting model-generated code control the application. A specialist chart renderer remains a possible future addition; it is not silently claimed as shipped.

A separate earlier parallel-renderer prototype was slower for both drawing cases and used extra model requests. It remains disabled. Jev's early relevance check demonstrated a useful benefit and is enabled, using the existing call rather than another serial decision stage.

[Nine-format report and raw evidence](../benchmarks/whiteboard-formats/results.md) · [parallel-renderer comparison](../benchmarks/parallel-whiteboard-results.md).

## Imports, retrieval and context

Up to five browser import workers run concurrently; additional files queue. Extracted source text and metadata persist in browser IndexedDB, rather than retaining original binary files. Indexing produces source-linked topics and an overview. Small collections use one Luna call; larger collections use up to five parallel analysis calls followed by a dependent merge. Private question preparation starts separately and never blocks index readiness.

The direct threshold is now **32,000 characters**. In the measured 25,681-character corpus, the map/merge route fed 92–93% of the originals into a second serial model stage. Sending the complete corpus once removed that redundant work: final cold times were **4.461, 3.517 and 4.961 seconds**, with one call each; exact cached repeats took 0.4–0.6 ms and no calls. All three final catalogs passed independent source review. This is indexing after extraction, not browser drag-to-ready time, and larger inputs are not guaranteed under ten seconds.

The larger-input path also needed a correctness repair: two original trials failed authentic quote/length checks. Immutable excerpt IDs now remove that copying/counting task while preserving full map input and exact source occurrence. Earlier fast direct variants still produced an omitted condition and a wrong inline source label. The final generic prompt describes study concepts and activities, and delegates attribution to exact source IDs. Those failures remain in [the full indexing experiment](../benchmarks/indexing-topics/comparison.md); a topic catalog remains selective metadata rather than a substitute for source evidence.

The OpenAI tutor uses a separate passage-retrieval layer. Full original sources remain in session memory; Jev selects bounded original passages from a local shortlist. Terra receives those passages, source catalog, current problem, recent conversation, losslessly packed earlier public dialogue, mastery metadata and the existing full question-bank context. It can call bounded local search/read tools if needed. There is no vector database or generated-summary replacement for source evidence. Import relevance filtering is not implemented: indexed topics organize the collection rather than reject unrelated files automatically.

Earlier architecture measurements reduced initial context from 31,598.5 to 14,867 bytes (53.0%, four scenarios). They are historical results, not a measurement of every final prompt. The final production instruction block is 11,955 characters versus the saved 11,945-character immediate baseline: this stage adds capabilities without claiming another instruction-length reduction. Total conversation still grows because older public dialogue is retained.

[Exact drag-in structure and storage](import-and-debug.md) · [indexing details](indexing.md) · [historical context experiment](tutor-optimization-report.md) · [six-model first-text/token-rate benchmark](../benchmarks/model-speed-results.md).

## Costs and measurement limits

| Bounded experiment | Observed usage | Estimated cost |
| --- | --- | ---: |
| Nine-format exploration | 99 OpenAI calls; 55,633 input + 95,003 output tokens | $0.053154 |
| Production scene comparison/follow-up | 21 Terra calls; 57,806 input + 6,303 output tokens | $0.121548 |
| Preserved initial/final board relevance trials | 14 OpenAI + 71 Jev calls | $0.052239382 |
| New citation grading validation | 30 OpenAI + 36 Jev attempts | $0.207217, partial |
| Indexing diagnosis and dispatch trials | 22 Luna calls; two canceled calls lack usage | approximately $0.0216, partial |

These are experiment subtotals, not the cost of this whole conversation. They exclude other grading, context, model-speed and indexing investigations. Usage comes from returned counters and public-rate estimates; exact billed dollars are unavailable. The app's development-only dollar button separates Jev, Thinking/LLM and Voice, preserves missing/partial usage, and distinguishes estimates from reported billed charges. The adjacent trace button exposes the event sequence.

The new lifecycle/production benchmarks simulate ElevenLabs STT/TTS. They do not establish real microphone recognition, synthesis latency or playback quality. Small repeated samples do not establish production percentiles. Final grammar boards contain correct text, but freely positioned underline endpoints remain approximate; some leaders and labels could also be better aligned. Source-bound annotation layout is a concrete next improvement. Biology board generation still took 4.85–6.62 seconds in the two final samples, so richer boards are not yet near-instant.

## Run and use it locally

Final validation: **632 automated tests passed**, followed by a successful production build. The existing large-bundle advisory remains. The production renderer passed **12 browser checks** and the interactive playground passed **10**, including all eight examples, keyboard interaction and mobile controls. Real model/Jev chains and their simulated boundaries are documented above. No external deployment was performed.

From `/Users/andreboufama/Documents/Luna-Study`, run `npm run dev` if the local server is not already running.

- [Live tutor](http://127.0.0.1:5188/): real import, source retrieval, conversation, board and mastery paths; uses the configured providers after you start a session.
- [Interactive board demo](http://127.0.0.1:5188/board-demo.html): scripted multi-subject scenarios using the actual production renderer, with local patch/hide/reopen/replace/selection controls. It makes no model calls and does not pretend to assess mastery.
- [Actual production outputs](http://127.0.0.1:5188/benchmarks/retained-scene/production-comparison.html): the measured real Terra boards, including imperfections.
- [Nine-format comparison](http://127.0.0.1:8796/comparison.html): saved experiment outputs. Its separate loopback viewer must be running; generated React/Canvas examples are recorded images here.

Provider keys stay server-side. The board demo is a development entry point; the normal production build remains the tutor application. All work is local to Luna Study; the CUPI website is unchanged.

The finished server was restarted with no active session. The live status endpoint, tutor, board playground and format gallery all returned HTTP 200. The status endpoint confirms Terra tutoring, Luna background work and ElevenLabs live mode. To try the full flow, open the live tutor, add/open a test, drop your materials, then start the voice session. The subtle dollar and trace buttons expose per-test usage and event history in this local development build.
