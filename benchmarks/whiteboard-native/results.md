# Native Excalidraw and Vega-Lite benchmark

2026-10-02T07:54:29.455Z to 2026-10-02T07:59:07.169Z (UTC). 12 bounded GPT-6 Luna requests, low reasoning; no paid voice or production changes.

These are actual pinned library renderers: Excalidraw 0.18.1 `restoreElements` plus `exportToSvg`, and Vega-Lite 6.4.3 compilation plus Vega 6.4.0 SVG rendering in Chromium. Native Excalidraw import supplies administrative defaults and refreshes text measurements using its font metrics; the model supplies object positions and initial text dimensions. Native scene JSON and the unmodified library export are preserved. The comparison frame translates the cropped native export back into its original world coordinates inside 800×500; it does not perform additional diagram layout or repair. Vega owns chart layout from the declarative specification.

## Results

| Representation | Rendered | Raw checks pass | Audited content checks pass | Median first output | Median valid render |
|---|---:|---:|---:|---:|---:|
| Excalidraw native scene | 8/8 | 6/8 | 7/8 | 3.95 s | 8.84 s |
| Vega-Lite native chart | 4/4 | 4/4 | 4/4 | 3.88 s | 8.18 s |

Pooled medians combine different tasks and are not a head-to-head ranking. Excalidraw has one sample per scene. Vega’s function plot is the only repeated native case (three samples). These runs occurred later than the original format experiment; shared locking prevents concurrent benchmark API load but does not control time, caching, model variance, or backend load.

| Scene | Representation | Sample | Valid render | Output tokens | Recorded failures |
|---|---|---:|---:|---:|---|
| payoff-matrix | Excalidraw native scene | 1 | 9.00 s | 1305 | none recorded |
| blank-grid | Excalidraw native scene | 1 | 35.40 s | 6211 | none recorded |
| line-city | Excalidraw native scene | 1 | 7.06 s | 871 | none recorded |
| game-tree | Excalidraw native scene | 1 | 16.54 s | 2236 | exactActionLabels, manual visual finding |
| function-plot | Excalidraw native scene | 1 | 17.42 s | 2535 | none recorded |
| process | Excalidraw native scene | 1 | 7.70 s | 960 | none recorded |
| patch-city | Excalidraw native scene | 1 | 4.87 s | 728 | unchangedNativeObjects |
| function-plot | Vega-Lite native chart | 1 | 7.55 s | 785 | none recorded |
| function-plot | Vega-Lite native chart | 2 | 7.05 s | 718 | none recorded |
| function-plot | Vega-Lite native chart | 3 | 8.81 s | 884 | none recorded |
| biology-cell | Excalidraw native scene | 1 | 8.68 s | 1000 | none recorded |
| multiseries-chart | Vega-Lite native chart | 1 | 9.12 s | 996 | none recorded |

An offline correction changes only the city-edit evaluator: the original check incorrectly assumed A element IDs began with A. The actual source labels identify vendor-a-marker and vendor-a-label; only their x coordinates and A’s numeric text changed. Raw results remain unchanged. `evaluation-corrections.json` records the exact differences. The genuine L/R to left/right tree-label error remains a failure. Audited content counts do not award semantic selection, complete requirement compliance or production readiness.

Recorded checks inspect values, native identity, blank matrix dimensions, visible labels and overlap/clipping, city geometry, and unchanged native objects on the city edit. They are incomplete: connected process arrow geometry, plot interpolation, all label placement, and teaching accuracy require visual review. A successful native render is not the same as a correct teaching board.

## Native identity and editing

Excalidraw restores native element IDs, including each rectangle in the 8×10 grid. Its standard SVG exporter strips those semantic IDs from DOM elements. This experiment does not mount the full interactive Excalidraw editor, so it does not establish cell hit testing, editor selection, touch interaction, or accessibility. Native scene JSON can support those features in a separate integration; a static export alone cannot claim them.

The Excalidraw city edit returns a complete scene. Stable ID and unchanged coordinate checks are reported separately from factual geometry. No incremental command stream, app camera persistence, scene revision conflict resolution, hide/reopen, or active-question/grade identity is exercised here.

Vega renders real scenegraph data, and post-timing point-click probes record the actual datum ID. Coincident points can select only the topmost mark; preserving distinct data IDs does not make overlapping targets independently clickable.

- function-plot-vega-1: 5/5 point-center probes returned their expected datum ID. 
- function-plot-vega-2: 5/5 point-center probes returned their expected datum ID. 
- function-plot-vega-3: 5/5 point-center probes returned their expected datum ID. 
- multiseries-chart-vega-1: 5/6 point-center probes returned their expected datum ID. Expected A-1, received B-1.

## Scope beyond economics

The native chart arm is limited to suitable plots rather than forcing a chart grammar to draw arbitrary cells, game trees, or notes. The added animal-cell scene explicitly asks for labels, leader lines and a short teaching note; the multiseries chart checks separate series, units, domains and six exact values. Those cases illustrate subject diversity, not a complete evaluation of scientific explanation, rich mathematical typesetting, chemistry, annotation editing or general pedagogy. Teaching text is allowed when it is the requested content.

- payoff-matrix-excalidraw-1: Saved PNG shows all four three-player payoff tuples in the requested U/D rows and L/R columns, with readable labels. Native cell rectangles exist; native SVG export does not carry semantic DOM IDs.
- blank-grid-excalidraw-1: Saved PNG shows eight physical rows, ten columns, all eighteen axis labels and eighty blank native cell rectangles. No marked solution or invented payoff.
- line-city-excalidraw-1: Saved PNG shows A at 0.2 and B at 0.8 on the shared zero-to-one line, with both names and numeric labels legible.
- game-tree-excalidraw-1: Native tree has the right structure and payoff leaves, but root action labels were changed from exact L/R to left/right. Lower l/r labels are preserved. This is a real content mismatch, not a parser failure.
- function-plot-excalidraw-1: Saved PNG correctly places all five supplied samples and connects them by a polyline, with readable axes/ticks. This is the requested sampled polyline, not a demonstration of smooth calculus plotting.
- process-excalidraw-1: Saved PNG has Observe → Hypothesize → Test with visible arrowheads, plus a directed return to Observe labeled Revise. Arrows do not obscure labels.
- patch-city-excalidraw-1: Saved PNG correctly moves A to 0.3 while B stays at 0.8. Offline native-element comparison corrects an evaluator naming assumption: only vendor-a-marker x and vendor-a-label x/text changed; all other checked coordinates/text and all IDs remain unchanged. The original raw false check is preserved.
- function-plot-vega-1: Saved PNG has the five exact samples, a connected sampled polyline and correct axes. Actual native datum clicks succeed at all five points.
- function-plot-vega-2: Saved PNG preserves all five points, axes and readable labels; all five native point-center clicks identify the expected datum.
- function-plot-vega-3: Saved PNG preserves all five points, axes and readable labels; all five native point-center clicks identify the expected datum.
- biology-cell-excalidraw-1: Saved PNG shows nucleus inside the cell, with leader lines landing on membrane, cytoplasm and nucleus and no text crossings. The exact teaching note is separate and readable. Content passes, but the cytoplasm has label/leader IDs and no independently modeled compartment region; compartment selection is not established.
- multiseries-chart-vega-1: Saved PNG preserves all six values, A/B lines and legend, exact Trial ticks and 0–3 Score range. Native center clicks identify five of six requested data IDs; A-1 and B-1 coincide, so clicking A-1 selects topmost B-1. This is an interaction limitation, not a value error.

## Usage and timing

- Excalidraw native scene: 8 requests, 5352 input tokens, 15846 output tokens; estimated $0.008490.
- Vega-Lite native chart: 4 requests, 1851 input tokens, 3383 output tokens; estimated $0.001877.

Estimated total: **$0.010367**. Actual billed dollars are unavailable. Estimates use reported usage, cached input/write counts and response service tier with [verified GPT-6 Luna public rates](https://developers.openai.com/api/docs/models/gpt-6-luna). Output includes reasoning tokens already. Credits, taxes, negotiated rates, and unreported usage are excluded. Failed or incomplete provider usage remains partial rather than fabricated.

Prepared request start inside shared provider lock through completed response, JSON validation, actual native restore/export or compilation/render, fonts ready and two animation frames. Screenshots and click probes follow the timing boundary. Library initialization is separately recorded and excluded.

Native Excalidraw scene JSON restored and exported with the official library; static native SVG export is framed at original world coordinates in800×500. Native Vega-Lite compilation and Vega SVG rendering only for suitable charts. Biology includes requested teaching text. No production UI/dependencies, speech, routing, retrieval, grading, private answers or provider tools.

Excalidraw native IDs survive restore, but SVG export does not expose them as DOM IDs; editor selection is not tested. Vega click probes use actual native scenegraph datum IDs.

Excalidraw seven original scenes plus labeled biology cell. Vega-Lite three function-plot samples and one multiseries chart. Later sequential matched-input samples, not randomized/counterbalanced with earlier formats. No claims of production percentiles or format-only causation.

Excalidraw city edit is a full native scene replacement. Exact source IDs and coordinates of unaffected elements are checked; fixed export bounds do not prove application camera persistence. Vega has no patch trial here.

Pinned library initialization took 0.86 s outside the measured calls. The browser recorded 0 blocked external resource requests. The benchmark scripts block network requests from generated drawings; credentials are used only for the fixed OpenAI API call and never written into artifacts.

## Reproduction

Temporary dependencies are isolated from the application package files. The saved dependency lock records the installation.

```sh
npm install --prefix /tmp/luna-native-board-deps --no-audit --no-fund --ignore-scripts --save-exact @excalidraw/excalidraw@0.18.1 vega@6.4.0 vega-lite@6.4.3 esbuild@0.25.10
node --test tests/whiteboard-native-render.test.mjs
node benchmarks/whiteboard-native.mjs
# Only when new paid testing is intended:
node --env-file-if-exists=.env benchmarks/whiteboard-native.mjs --live
node benchmarks/whiteboard-native-report.mjs
```

Default harness execution is offline and writes to a separate `offline/` subdirectory, preserving paid evidence. The report generator makes no provider calls. Raw model output, exact request/facts, source hashes, token counts, scene JSON, native SVG export, rendered SVG, screenshots and failed checks remain in this directory.

- [Excalidraw native export](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export)
- [Excalidraw native restore](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/restore)
- [Vega-Lite native compiler](https://vega.github.io/vega-lite/usage/compile.html)
- [Vega View API](https://vega.github.io/vega/docs/api/view/)
