# Topic-only indexing: measured repair validation

The repaired index returned a valid topic-only guide in **3/3 real trials**, but **0/3 finished under 10 seconds**. Median cold readiness was **12.630s**. Each same-test repeat used the complete-guide cache with zero provider calls.

| Trial | Cold readiness | Cached | Actual calls | Max concurrent | Map critical path | Merge | Source IDs represented |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 11.824s | 0.5ms | 3 | 2 | 5.719s | 6.101s | 3/3 |
| 2 | 12.925s | 0.5ms | 3 | 2 | 6.533s | 6.389s | 3/3 |
| 3 | 12.630s | 0.3ms | 3 | 2 | 5.368s | 7.260s | 3/3 |

Every guide contains only overview and topics; there is no blocking question or script generation in this measurement. Each has five topics. All three original PDF hashes were checked before calling the provider. The same 25,681 extracted characters and 13 pages were used in all trials.

## What changed

The old map stage asked the model to copy exact quotes and count their combined length. Two pre-repair runs failed at6.504s and9.727s, so neither produced readiness. The diagnostic response selected6,209 quote characters against a4,000 cap and altered two quotations. Strict evidence validation correctly rejected it. Those failures remain in results.json and diagnostic-retry.json.

The repaired stage receives complete, ordered, lossless original excerpts with immutable server-owned IDs. It returns one selected ID per topic rather than copied text. Server resolution, exact span validation and bounded paragraph expansion preserve source identity, mathematical signs and original wording. Every input chunk must still be present. This removes model copying/counting as a prerequisite without accepting invented evidence.

## Grounding and coverage audit

All three completed guides checked against all three original PDF texts. No unsupported numeric or conceptual claim found. Each five-topic index reasonably represents all three files but is not exhaustive; chess/zero-sum and some individual exercise variants are omitted.
All nine original chunk catalogs recomputed losslessly. All 51 selected IDs checked against exact source and chunk identity. All same-test cached guides identical to their cold guide.
Some Pset2 source references are broader than specific Pset5 sequential/repeated-game examples; no false source identity was found.

The source-linked index is an overview, not exhaustive course coverage. All original materials remain available to the tutor. Source IDs appearing in a topic is a structural coverage check; the independent manual review checks the actual academic claims separately.

## Remaining timing bottleneck

Two map requests run concurrently, followed by one merge. This corpus produces only two map batches despite the five-request concurrency ceiling. Bounded paragraph expansion sends 23,616–23,993 characters to the merger, about92–93% of the25,681 originals. Thus this small corpus pays two serial model stages with little compression. Increasing concurrency alone does not remove the merge dependency. A slightly larger direct-input threshold could avoid mapping for this corpus while retaining all originals; that is a proposed optimization until separately measured.

## Scope and usage

Nine actual GPT-6 Luna low-reasoning calls, with shared provider serialization around each cold+cached pair. Each cold run used a fresh application indexer; cached repeats reused that instance and exact test input. Provider cache counts are recorded separately. There were no Jev, speech, audio, or question-bank calls.
52,843 input tokens (0 cached) and5,266 output tokens were reported. Estimated cost $0.009238 uses the project's verified public rates and observed usage, not a provider invoice. The four pre-repair calls are separate; their canceled siblings did not report usage, so their complete bill cannot be reconstructed.

Timing starts after existing PDF text is prepared and the shared provider lock is acquired. It includes map scheduling, real API calls, strict evidence validation, merge and topic validation. It excludes PDF extraction, upload, frontend rendering, background question generation and provider-lock wait. These are three runs of one corpus, not percentiles or an under-ten-second guarantee.

## Reproduction and artifacts

- repaired-results.json: all three trials, raw selected-ID responses, original catalogs, guides, timings and usage.
- summary.json: concise comparison and observed cost inputs.
- manual-review.json: independent source/claim review.
- diagnosis.md: original failures and exact limitations.
- ../../server/index-citations.mjs and indexing.mjs: production repair; hashes captured per run.

Run node benchmarks/indexing-topics-report.mjs to regenerate this report without calls. The live generator refuses to overwrite existing results. artifacts/indexing-smoke.json remains unchanged.

