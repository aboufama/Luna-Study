# Indexing comparison: readiness, grounding and speed

Latest catalog trial times: **4.461s, 3.517s, 4.961s**. All three return a validated topic-only index; source IDs cover all three files. 3/3 pass the recorded independent catalog audit.

| Stage | Trials | Ready | Under 10s | Median elapsed | Requests | Audit passes |
|---|---:|---:|---:|---:|---:|---:|
| Exact copied quotes | 1 | 0/1 | 0/1 | 6.504s to rejection | 2 | — |
| Exact copied quotes, diagnostic retry | 1 | 0/1 | 0/1 | 9.727s to rejection | 2 | — |
| ID-backed map + merge v4 | 3 | 3/3 | 0/3 | 12.630s | 9 | 3/3 |
| Full-source direct 32k v4 | 3 | 3/3 | 3/3 | 5.916s | 3 | 2/3 |
| Full-source direct 32k v5 | 3 | 3/3 | 3/3 | 5.008s | 3 | 2/3 |
| Full-source direct 32k catalog v6 | 3 | 3/3 | 3/3 | 4.461s | 3 | 3/3 |

Failures are preserved. The two original map attempts rejected unauthentic or over-budget copied quotes before readiness. Immutable excerpt IDs fixed that protocol: the mapped path then succeeded 3/3 but took 11.824–12.925s. It expanded back to 92–93% of original text before merge, so the 25,681-character corpus paid two serial model stages with little compression.

After these measurements and the independent v6 audit, production adopts a 32,000-character direct threshold, with larger inputs retaining exact-ID mapping. The benchmark used an explicit override before adoption; no production default was changed during the measured trials. The 32k direct override sends all original source text through the existing single-call topic-only path. It reduced the measured latency without dropping original evidence. This is a different dispatch algorithm, not a speed gain attributable solely to the quote repair. Larger corpora still need the exact-ID map path and its coverage checks.

An initial direct summary omitted an essential even-bid restriction. The next generic prompt preserved that condition but one output misattributed a result to the wrong problem set in prose. Those failures remain visible and count against their phases. The final catalog prompt asks for concepts, techniques and study activities rather than solved conclusions; source attribution lives in structured sourceIds rather than retyped document names. This fits import categorization while the tutor and graders retain the original academic material.

Independent final audit: 3/3 ready under ten seconds and 3/3 grounded catalogs in this bounded review. Catalogs remain fallible metadata, not authoritative teaching or a general semantic success-rate guarantee. Comparable coarse coverage of 5–6 topics, not exhaustive. Chess/zero-sum and individual variants are omitted in some or all guides. Independently recomputed full input hashes for all 25,681 original characters and confirmed identical cold/cached guides in all three trials. Actual instruction hash is the same v6 prompt across all three.

## Measurement scope

All phases use the same three original PDFs, verified hashes, 13 pages and 25,681 extracted characters. All use GPT-6 Luna, low reasoning. The clock includes production indexing, provider calls, strict validation and ready result; it excludes already-completed PDF extraction/upload, provider-slot waiting, frontend display and asynchronous question preparation. Each cold run creates a fresh application indexer. Each cached repeat uses the same input and instance and makes zero requests. Final cache times: 0.4ms, 0.4ms, 0.6ms.

Three runs of one corpus are evidence for this dispatch choice, not an under-ten-second SLA or a general semantic success rate. Structural source coverage is not exhaustive concept coverage. The final catalog is fallible metadata; teaching and grading still need original evidence. These sequential phases were not time-interleaved, so provider load/cache effects remain a limitation.

## Observed usage

| Stage | Reported input | Reported output | Reported cached input | Estimated USD | Missing usage requests |
|---|---:|---:|---:|---:|---:|
| Exact copied quotes | 3255 | 900 | 0 | $0.000857 | 1 |
| Exact copied quotes, diagnostic retry | 3255 | 1667 | 3252 | $0.000866 | 1 |
| ID-backed map + merge v4 | 52843 | 5266 | 0 | $0.009238 | 0 |
| Full-source direct 32k v4 | 22121 | 1785 | 0 | $0.003657 | 0 |
| Full-source direct 32k v5 | 22250 | 1447 | 0 | $0.003505 | 0 |
| Full-source direct 32k catalog v6 | 22304 | 1297 | 0 | $0.003436 | 0 |

Actual calls: 22. Two canceled pre-repair requests did not return usage. Costs use observed counters and the project’s verified public rates; they are not invoices, and missing canceled usage prevents a complete bill estimate. No Jev, paid speech, microphone or question-bank calls were made by these harnesses.

## Reproduction and provenance

- results.json: Exact copied quotes; source hashes, stage events and observed usage; raw map JSON was not retained.
- diagnostic-retry.json: Exact copied quotes, diagnostic retry; raw map response, quote audit, source/schema/instruction hashes, timings and usage.
- repaired-results.json: ID-backed map + merge v4; raw responses, instruction/schema/code hashes, sources, timings and observed usage.
- direct-results.json: Full-source direct 32k v4; raw responses, instruction/schema/code hashes, sources, timings and observed usage.
- direct-final-results.json: Full-source direct 32k v5; raw responses, instruction/schema/code hashes, sources, timings and observed usage.
- direct-catalog-results.json: Full-source direct 32k catalog v6; raw responses, instruction/schema/code hashes, sources, timings and observed usage.
- Original maps: diagnosis.md and quote-differences.json.
- Independent reviews: manual-review.json, direct-manual-review.json, direct-final-manual-review.json, direct-catalog-manual-review.json.
- comparison.json: consolidated numbers without overwriting earlier artifacts.
- Offline report regeneration: node benchmarks/indexing-topics-compare.mjs.

The catalog run has an inherited runner metadata string mentioning v5; its explicit catalogFollowup, captured v6 code hashes and actual instruction hashes identify the real prompt. This metadata typo did not affect provider input. The harness is corrected for future runs; the original raw artifact remains unchanged.
