# Production retained-scene experiment

21 bounded real GPT-5.6 Terra low-reasoning calls: six controlled matrix calls, five initial scene/edit calls, then ten follow-up calls. No paid voice. Raw source facts, prompts, instruction hashes, usage, outputs, failures and exact timings are retained.

## Controlled matrix wire comparison

| Condition | Samples | Exact blank 8×10 + canonical question | Median spoken text | Synthetic audio marker | Median accepted board | Median output tokens | Median board JSON bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| Dense rows | 3 | 3/3 | 1.124s | 1.225s | 2.418s | 228 | 529 |
| Compact dimensions | 3 | 3/3 | 1.182s | 1.282s | 1.768s | 187 | 313 |

Median accepted-board time was 2.418s → 1.768s (26.9% lower in these samples), while output tokens were 228 → 187 and board JSON bytes 529 → 313. First spoken text was slightly later at the median, so this does not demonstrate faster speech. All six outputs preserved empty cells, the queued question ID and exact canonical wording, without revealing the answer. Real React rendering confirmed all 80 physical cells in every matrix.

Both conditions use the full saved 11,945-character baseline prompt. Only the matrix shape example and blank-grid instruction change; the public request, full private bank and prepared input are identical. Request order alternates. First rounds had no input cache hits; subsequent pairs had almost fully cached input in both arms. There are three samples per condition, insufficient for production percentiles or a general speed guarantee.

## Final cross-subject and edit follow-up

| Case | Round | Spoken text | Accepted board | Output tokens | Result |
|---|---:|---:|---:|---:|---|
| biology-cell | 1 | 1.804s | 6.621s | 585 | Correct source content |
| algebra-steps | 1 | 1.662s | 3.727s | 315 | Correct source content |
| physics-forces | 1 | 1.775s | 3.756s | 353 | Correct source content |
| grammar-annotation | 1 | 1.720s | 3.992s | 409 | Correct content; approximate marks |
| biology-cell | 2 | 1.194s | 4.850s | 573 | Correct source content |
| algebra-steps | 2 | 0.647s | 1.632s | 129 | Correct source content |
| physics-forces | 2 | 1.693s | 3.629s | 374 | Correct source content |
| grammar-annotation | 2 | 1.494s | 3.582s | 363 | Correct content; approximate marks |
| object-patch | 1 | 0.821s | 1.494s | 88 | Exact sparse edit |
| object-patch | 2 | 1.273s | 1.958s | 123 | Exact sparse edit |

All eight subject requests produced accepted boards with correct requested source content. Seven used retained scenes; one algebra output correctly used text/LaTeX blocks. Both sparse updates moved exactly one existing object and preserved the remaining objects and equations. Current browser rendering has zero page or KaTeX errors, and keyboard selection works. This does not imply flawless layout: grammar underlines remain approximate, some biology leaders stop short, and one physics line crosses its block label.

The first five scene/edit calls exposed real protocol problems: an empty optional label was rejected, quote-anchor fields were misplaced, and a patch omitted title and speech. Only biology and physics produced accepted boards. Those outputs remain in production-results.json. The final two rounds use the repaired 11,955-character production prompt plus repaired schema. This is a functional follow-up, not a controlled latency comparison against the initial five.

Both final physics outputs used separate LaTeX equations, so the original scene-text patch selector found no target and made no paid call. The two remaining authorized calls instead moved the existing block rectangle down 12px. This adaptation is recorded. It tests literal sparse edit preservation, not whether that movement is a sensible physics explanation.

## Actual rendering and measurement scope

Saved canonical boards were injected into the real React Whiteboard/TeachingScene preview. Original matrix renders and all ten final outputs were checked, with screenshots and separate browser injection times. Physics equation 2 is below the initial viewport but visible by normal scrolling. The old benchmark merge mistakenly retained visualOnly:true after live production had removed that filter; offline correction restores the two algebra annotations without changing raw output or original latency. The pre-left-alignment browser audit is also retained. Generic text now follows its top-left layout box. Actual DOM Range measurements still show model-authored grammar marks extending beyond their exact phrases, so geometry is not certified from text presence.

The timed path is prepared context → real streaming OpenAI adapter → production decoder/validator → canonical merge. Shared provider-lock wait is excluded. The fixed 100ms synthetic audio timer is fed by the production speech buffer, and is not real ElevenLabs latency. Browser injection occurs later and is reported separately; do not add it as if measured in the original end-to-end call. STT, Jev, retrieval, WebSocket transit, actual playback, question consumption and grading are outside this harness. Separate production lifecycle tests cover interruption, source revisions, question/selection continuity and strict mastery.

## Usage

57,806 actual input tokens (42,857 cached) and 6,303 output tokens across 21 calls. Estimated total $0.121548 at verified standard global public rates, including observed cache reads. This is not a provider invoice; missing cache-write premiums, regional/account rates, credits and tax are excluded.

Rates: [official Terra model page](https://developers.openai.com/api/docs/models/gpt-5.6-terra), as recorded by the project pricing module on October 2, 2026.

## Files

- production-results.json: original eleven calls, including all failures.
- production-final-results.json: ten final calls, raw outputs and usage.
- production-final-browser-results.json: corrected canonical merge, actual React measurements and screenshot paths.
- production-final-browser-before-left-align.json: pre-layout-repair browser record.
- grammar-geometry-audit.json: exact quote ranges versus authored line endpoints.
- summary.json: aggregate metrics, explicit quality notes and cost calculation inputs.
- production-comparison.html: static local screenshot comparison; no provider or generated code execution.

Re-analysis: node benchmarks/retained-scene-production-report.mjs. Offline real-browser rendering: node benchmarks/retained-scene-production-render.mjs --final. The generator defaults to dry fixtures; --live is a new paid run and must not be used to reproduce an already completed report unintentionally.

