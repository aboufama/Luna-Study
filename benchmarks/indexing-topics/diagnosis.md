# Current topic-only indexing: pre-repair diagnosis

Two real cold attempts on the same three original game-theory PDFs failed before readiness. This does **not** establish indexing under ten seconds.

| Attempt | Result | Elapsed | Actual requests | Peak parallel requests |
|---|---|---:|---:|---:|
| Initial cold | Pset5 map evidence rejected; other map canceled | 6.504s | 2 | 2 |
| Unchanged-input diagnostic retry | Pset5 map evidence rejected; other map canceled | 9.727s | 2 | 2 |

The corpus has 25,681 characters in 13 already-extracted pages: 4,366 / 10,412 / 10,903 characters across the three files. Original PDF hashes were rechecked. Fresh production `createMaterialIndexer` uses its 24,000-character direct threshold, so this input becomes two concurrent map batches followed by a merge. Neither attempt reached that merge or produced a validated topic index. A complete-index cache result could therefore not be measured.

The second run retains the exact returned map JSON. Its source chunk ID is correct, but it selects **6,209 unique quote characters**, above the 4,000-character limit. Two of sixteen quotes are not exact original substrings, including after whitespace normalization. One introduces a `P` character where the original has a space; another alters text while crossing a PDF page marker. These are copy/count protocol failures, not evidence that the source is absent. Exact verification correctly rejected them.

The first run retained provider metadata and stage events but not raw map JSON, so the second run's exact failure details must not be attributed retroactively to the first. `quote-differences.json` uses approximate alignment only to explain the second failure; no fuzzy match was accepted as evidence.

The repair direction is immutable server-owned source excerpt IDs: models select from supplied original spans and the server resolves and bounds those spans deterministically. Every input chunk and source must remain represented, and original text remains available. No invented text should become accepted merely to make indexing finish.

Four paid GPT-6 Luna calls were made, below the initial five-call cap. Two sibling requests were canceled before usage was returned. Reported usage/cost therefore covers only completed responses and must not be presented as the total billed cost. There were no Jev, question-bank, audio or voice calls. `artifacts/indexing-smoke.json` is unchanged.

Files:

- `results.json`: first cold attempt, hashes, stage events, observed usage.
- `diagnostic-retry.json`: unchanged-input retry, exact map response, detailed quotation audit.
- `quote-differences.json`: diagnostic character differences, never used to relax verification.
- `dry-run.json`: offline scheduling/cache fixture only; its timings are not provider measurements.

The clock excludes original PDF extraction, UI upload, provider-slot wait, and subsequent background question preparation. The cold label means an empty application cache, not a guarantee of cold provider prompt cache. No pre-repair retries remain planned; repaired runs will use distinct artifacts.
