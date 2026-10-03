# Whiteboard generation formats

Measured 2026-10-02T07:31:51.627Z using gpt-6-luna, low reasoning. 36 paid OpenAI requests; no paid voice.

## Measured results

| Format | Rendered | Recorded checks pass | Median first output | Median valid render | Median output tokens |
|---|---:|---:|---:|---:|---:|
| Current JSON | 6/7 | 3/7 | 2.90s | 5.30s | 473 |
| Restricted SVG | 13/13 | 11/13 | 1.68s | 8.01s | 994 |
| Compact scene DSL | 13/13 | 12/13 | 1.22s | 2.17s | 213 |
| Mermaid | 3/3 | 2/3 | 2.76s | 3.22s | 211 |

Medians above pool different scene types and are descriptive, not a fair head-to-head ranking. Use the repeated matched-scene rows below. Failed outputs remain in the denominator; valid-render time has no value for failures. Output tokens include any reported reasoning tokens.

## Repeated matched scenes

| Scene | Format | Samples | Rendered | Recorded checks pass | Median first output | Median valid render | Range valid render |
|---|---|---:|---:|---:|---:|---:|---|
| blank-grid | Compact scene DSL | 3 | 3 | 3/3 | 1.22s | 1.97s | 1.90s–2.02s |
| blank-grid | Restricted SVG | 3 | 3 | 3/3 | 2.22s | 17.43s | 17.06s–19.41s |
| line-city | Compact scene DSL | 3 | 3 | 3/3 | 1.68s | 2.81s | 2.17s–3.08s |
| line-city | Restricted SVG | 3 | 3 | 3/3 | 1.30s | 5.55s | 5.30s–5.68s |
| game-tree | Compact scene DSL | 3 | 3 | 3/3 | 1.17s | 2.59s | 2.02s–2.66s |
| game-tree | Restricted SVG | 3 | 3 | 1/3 | 1.54s | 8.55s | 5.62s–9.75s |

Recorded checks combine retained automated content/geometry checks and explicit manual failure findings. They are a lower bound on known problems, not a guarantee of full visual or mathematical correctness. A rendered sample can fail these checks. The SVG tree changed the exact root labels L/R to left/right in two samples; this explains its 1/3 result.

## Recommendation

Prototype a compact semantic scene contract compiled into retained SVG. Keep direct restricted SVG as an optional escape hatch for unusual geometry, and Mermaid for narrowly suited flowcharts. The evidence favors moving repetitive layout out of the model: the DSL repeatedly produced correct blank grids, city positions and game trees with fewer emitted tokens and shorter completed-render times. It does not establish a universal fastest format or production latency guarantee.

This can evolve from the existing JSON contract. Current diagrams already render as SVG, and current matrices use HTML with KaTeX. Replacing JSON with XML alone does not create an open canvas. The benchmark DSL is also JSON; its advantage is semantic instructions such as an 8-by-10 blank matrix or a positioned number line, followed by deterministic layout, instead of dozens of empty strings or individual SVG rectangles.

The initial blank grid illustrates the tradeoff: current JSON emitted unequal row lengths and was rejected; direct SVG correctly emitted all 80 cells but took 19.41 seconds; the compact DSL expressed the same blank grid in 155 output tokens and rendered in 1.97 seconds. This is one initial example, supported by the three matched repetitions above, rather than an extrapolation from token counts alone.

## What the drawings actually showed

| Representation | Strength observed | Failure or limit observed |
|---|---|---|
| Current JSON | Existing validation, semantic matrices, stable block IDs and patching | Initial blank grid had three 11-cell rows. City markers and process boxes/arrows were split into independent diagram surfaces, losing their shared geometry. Small plot labels touch markers/axes. |
| Restricted SVG | Precise custom geometry; correct city and whole-scene update; full blank cell hit regions | Verbose 80-cell output. Two of three game trees changed required action labels. A full replacement re-emits unaffected objects. |
| Compact scene DSL | All repeated grid/city/tree checks passed; deterministic layout; small outputs | Generic payoff lines/text were mathematically correct but lacked semantic matrix/full-cell targets. The sampled plot duplicated labels and overlapped its title because model and renderer both owned labels. City patch replaced the whole axis object rather than only A. |
| Mermaid | Compact connected process/tree layouts; useful specialist renderer | Tree rewrote exact L/R labels. Generated DOM identity needs a mapping to semantic IDs. The plot theme had poor contrast; this is a theme issue. Exact matrix selection and coordinate-preserving city edits were outside this restricted contract, so they were not benchmarked as unsuitable substitutes. |

All plotted curves connect five supplied samples; this experiment does not demonstrate smooth calculus plotting. Text-presence checks alone initially missed the disconnected JSON city/process, so actual browser geometry and screenshot review were added. The payoff DSL's four tuples were independently verified in the correct row/column positions; its missing full-cell hit areas are an interaction limitation, not a factual error.

### Incremental edits and selection

The single city edit moved A from 0.2 to 0.3. SVG completed in 4.74 seconds and DSL in 1.69 seconds, with B/endpoints/IDs and their geometry retained. JSON completed in 2.18 seconds but retained an already incorrect split layout. These are single-sample edit timings, not repeated edit benchmarks. Neither successful candidate proved an ideal leaf-only edit: SVG replaced the entire markup, while DSL replaced the complete axis object. A next contract should support small operations such as `move point A to 0.3`, with expected scene revision and validation of unchanged objects.

The viewer demonstrates ID selection and local camera motion, not production grading or accessibility. DSL and JSON derived IDs are potential cell/node anchors; raw SVG needs authoring rules that provide the same semantic identity. Generic text labels must not substitute for full-cell hit targets. The renderer should own title/axis placement to prevent the observed DSL label collision.

## The open, continuously changing board

The most consequential architecture change is a retained scene with stable semantic objects. Keep the active problem/question ID, source revision, scene revision and visibility explicit. Store camera position and selection separately from scene content. A same-problem explanation updates the relevant objects; a new problem replaces the active group or hides the board when no visual is useful. Hiding and reopening must preserve the correct scene without generating a new question or recording an attempt.

Pan/zoom runs locally without a model request. Preserve the camera during small edits, retain unaffected IDs, and avoid redraw animation that moves everything. The local comparison includes a camera demonstration, but a fixed SVG viewBox in a generated patch alone does not prove application camera persistence. A production implementation would need to test persistence across actual scene revisions and hide/reopen.

The conversation can remain natural while deterministic scoring stays underneath it: rendering references the already established public problem and selected object IDs, while active-question consumption, help eligibility and grading remain separate. A renderer must not invent the next question or obtain private answer keys. Late updates need turn/source/revision guards so an interrupted answer cannot draw an obsolete scene.

If partial drawing is pursued, stream complete validated object operations into the retained scene, rather than expose unfinished raw SVG. This experiment waited for the full output and validation in every format, so it does not measure that future streaming design.

## Reproduce and inspect

From the project root:

```sh
node --test tests/whiteboard-formats-render.test.mjs
node benchmarks/whiteboard-formats.mjs
node benchmarks/whiteboard-formats-audit.mjs
node benchmarks/whiteboard-formats-report.mjs
python3 -m http.server 8796 --bind 127.0.0.1 --directory benchmarks/whiteboard-formats
```

The default benchmark command is an offline fixture check; add `--live` only when intentionally authorizing a new paid run. The retained `results.json` preserves every actual output, failure, usage counter and timing; re-analysis and the viewer make no provider requests. Mermaid is pinned locally, and render validation blocks external requests and unsafe SVG markup.

Open the loopback-only [interactive comparison](http://127.0.0.1:8796/comparison.html). The source file is [comparison.html](comparison.html), raw results [results.json](results.json), and representative screenshots are [city geometry](screenshots/line-city.png), [blank grid](screenshots/blank-grid.png), [tree](screenshots/game-tree.png), [function plot](screenshots/function-plot.png), [process](screenshots/process.png), [payoff matrix](screenshots/payoff-matrix.png), and [city edit](screenshots/patch-city.png).


## Observed usage and estimated cost

| Format | Requests | Input tokens | Output tokens | Estimated total USD |
|---|---:|---:|---:|---:|
| Current JSON | 7 | 3624 | 3305 | $0.002015 |
| Restricted SVG | 13 | 7664 | 18717 | $0.010155 |
| Compact scene DSL | 13 | 7611 | 2968 | $0.002245 |
| Mermaid | 3 | 1237 | 677 | $0.000462 |

All 36 requests together: 20136 input tokens and 25667 output tokens; estimated $0.014877. These are list-price estimates from actual reported token counts, not provider bills. Different formats have different numbers and mixes of cases; compare matching cases for per-task cost.

Uses the [official GPT-6 Luna rates](https://developers.openai.com/api/docs/models/gpt-6-luna) verified October 2, 2026: $0.10 input, $0.01 cache reads, $0.125 cache writes, and $0.50 output per million tokens. Standard global processing is assumed because the harness did not retain an explicit service tier. Actual cache counters are preserved and used; reasoning tokens are already included in output. Credits, tax, account rates, regional premiums and other session work are excluded. No paid voice was used.

## Method

Prepared drawing request submitted to OpenAI, through complete validation and two animation frames in real Chromium. No speech, STT, intent, retrieval or scene routing is included.

All representations are rendered in an 800×500 SVG comparison frame. Current production diagrams already use SVG; production matrices are HTML+KaTeX. The benchmark normalizes rendering surfaces and compares generation syntax plus each format’s layout machinery.

One initial sample per eligible scene/format, then two further samples per top-two general formats on three representative scenes. Initial selection is exploratory; individual failures and raw outputs are retained.

All model-generated output waits for completion and validation. No unsafe partially streamed SVG is displayed.

Identical explicit source facts and public request within each scene. Synthetic facts are labeled. No answer keys or expected output are sent.

Only tree, function plot, and process cases: flowchart layout/xychart are appropriate; exact matrix-cell selection and coordinate-preserving city edits are outside this restricted Mermaid contract.

Benchmark-only scripts, SVGs and local viewer. No production UI/provider changes, no paid voice, no external deployment.

## Limitations

- Three samples per repeated scene/format are exploratory, not production percentiles. Cache/reasoning and backend latency vary. Initial ranking selected the repeated formats, so selection bias is explicit.
- Generation syntax and layout responsibility are coupled: the compact DSL and Mermaid delegate geometry to deterministic renderers; direct SVG asks the model to emit detailed geometry. This difference is part of the engineering tradeoff.
- The local comparison normalizes output to an SVG frame; it does not measure the existing React/HTML matrix renderer or actual ElevenLabs, retrieval, Jev routing, UI opening animation, or network-to-screen WebSocket delivery.
- Automatic text/identity/bounds checks are incomplete semantic or visual evaluation. Screenshots and manual inspection are recorded separately; failed content checks are not silently repaired.
- A stable DOM id is only a candidate interaction anchor. Scoring IDs and active-question state must remain independent of rendering identifiers.

## Local comparison

Open `comparison.html` through the loopback-only static server. It offers case and repetition selectors, selection IDs, and a camera-only pan/zoom demonstration. No model is called by that page.

## Sources

- [SVG viewBox](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/viewBox)
- [Mermaid flowchart syntax](https://mermaid.js.org/syntax/flowchart.html)
- [Mermaid security level](https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html)
- [Mermaid XY charts](https://mermaid.js.org/syntax/xyChart.html)
