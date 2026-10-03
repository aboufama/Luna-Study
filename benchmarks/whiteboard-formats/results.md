# Whiteboard generation formats

Measured 2026-10-02T07:31:51.627Z using gpt-6-luna, low reasoning. 99 paid OpenAI requests; no paid voice.

## Measured results

| Format | Rendered | Recorded checks pass | Median first output | Median completed render | Median output tokens |
|---|---:|---:|---:|---:|---:|
| Current JSON | 6/7 | 3/7 | 2.90s | 5.30s | 473 |
| Restricted SVG | 13/13 | 11/13 | 1.68s | 8.01s | 994 |
| Compact scene DSL | 19/19 | 12/19 | 1.39s | 2.66s | 263 |
| Mermaid | 3/3 | 2/3 | 2.76s | 3.22s | 211 |
| Static HTML/CSS | 19/19 | 14/19 | 4.45s | 9.92s | 1111 |
| Canvas 2D code | 13/13 | 11/13 | 3.85s | 8.35s | 871 |
| React/JSX | 13/13 | 9/13 | 3.52s | 7.26s | 912 |
| Excalidraw scene JSON | 8/8 | 7/8 | 3.95s | 8.84s | 1152.5 |
| Vega-Lite chart | 4/4 | 4/4 | 3.88s | 8.18s | 834.5 |

Medians above pool different scene types and are descriptive, not a fair head-to-head ranking. Use the repeated matched-scene rows below. Failed outputs remain in the denominator; valid-render time has no value for failures. Output tokens include any reported reasoning tokens.

## Repeated matched scenes

| Scene | Format | Samples | Rendered | Recorded checks pass | Timed renders | Median first output | Median completed render | Range valid render |
|---|---|---:|---:|---:|---:|---:|---:|---|
| blank-grid | Compact scene DSL | 3 | 3 | 3/3 | 3 | 1.22s | 1.97s | 1.90s–2.02s |
| blank-grid | Restricted SVG | 3 | 3 | 3/3 | 3 | 2.22s | 17.43s | 17.06s–19.41s |
| blank-grid | Static HTML/CSS | 3 | 3 | 3/3 | 2 | 6.57s | 22.81s | 19.06s–26.57s |
| line-city | Compact scene DSL | 3 | 3 | 3/3 | 3 | 1.68s | 2.81s | 2.17s–3.08s |
| line-city | Restricted SVG | 3 | 3 | 3/3 | 3 | 1.30s | 5.55s | 5.30s–5.68s |
| line-city | Static HTML/CSS | 3 | 3 | 2/3 | 3 | 3.66s | 8.16s | 6.89s–11.23s |
| game-tree | Compact scene DSL | 3 | 3 | 3/3 | 3 | 1.17s | 2.59s | 2.02s–2.66s |
| game-tree | Restricted SVG | 3 | 3 | 1/3 | 3 | 1.54s | 8.55s | 5.62s–9.75s |
| game-tree | Static HTML/CSS | 3 | 3 | 3/3 | 3 | 7.30s | 16.19s | 15.92s–18.48s |

Recorded checks combine retained automated content/geometry checks and explicit manual failure findings. They record known problems, not a guarantee of full visual or mathematical correctness. Check coverage differs across representations: native scene IDs do not establish the same interaction behavior as measured DOM cell hits. These counts cannot rank interchangeable production success rates. A rendered sample can fail these checks. The SVG tree changed the exact root labels L/R to left/right in two samples; this explains its 1/3 result.

## Recommendation: retain objects, delegate repeated layout

Use a generic retained scene with stable IDs for text, math, shapes and arrows, plus compact components for repetitive structures such as matrices. Keep charts as a specialist renderer where useful. The experiment does not identify a universal best markup language. It shows that concise semantic structure can reduce generation work, while generic spatial primitives and good text layout are necessary across subjects.

Current production diagrams already use SVG, and matrices use HTML with KaTeX. JSON versus SVG versus HTML is the model's output contract; SVG/DOM/Canvas is the drawing surface; the retained scene, camera, selection and problem identity are application state. Those three decisions should not be conflated. A retained semantic JSON scene can render SVG shapes, accessible HTML text and specialist charts together.

The old compact DSL repeatedly handled grids, city positions and trees quickly. Its narrow object vocabulary then struggled with cell compartments, force arrows, timelines and sentence annotation. Its universal results therefore rule out shipping that benchmark DSL unchanged. A generic text/math/shape/arrow layer is the relevant next step, rather than an economics-specific template set.

## What the nine representations showed

| Representation | Strength observed | Failure or limit observed |
|---|---|---|
| Current JSON | Existing validators, semantic matrices and stable block patches | Initial blank grid had uneven rows. Separate diagram blocks disconnected city markers and process connectors. This adapter is not the exact React frontend. |
| Restricted SVG | Precise arbitrary geometry, full-cell targets, correct city edit | Explicit 80-cell markup was verbose. Two of three trees changed L/R to left/right. Whole-scene replacement re-emits unaffected objects. |
| Compact scene DSL | Repeated grid/city/tree all passed; small output and deterministic layout | Horizontal graph arrowheads disappeared behind nodes; plot labels collided; generic subject scenes exposed missing shape/arrow/text-layout capabilities. |
| Static HTML/CSS | Readable notes, subscripts, worked steps and native full-cell table targets | Verbose blank grid. Some connections/positions were wrong. Inline-block whitespace altered an exact sentence; a proportional timeline was slightly off. |
| React/JSX | Loops describe repeated grids compactly; real DOM layout and identities | Executable generated code needs stronger isolation. A tree changed action labels, chemistry overlapped, a timeline clipped, and sentence spacing changed. |
| Canvas 2D code | Loops and free geometry avoid explicitly serializing every cell | Text/accessibility/selection need separate hit metadata. One physics output painted its labels white and a tree duplicated hit IDs. |
| Excalidraw scene JSON | Actual native export, familiar free spatial objects and retained native IDs | 8×10 grid took 35.40s and 6,211 output tokens in one sample. Exported SVG loses semantic DOM IDs; the full editor was not tested. One tree changed exact labels. |
| Vega-Lite | Accurate native charts from data, including all three sampled-curve repeats | A specialist, not a general whiteboard. Coincident series points returned the topmost datum for one of six hit probes. |
| Mermaid | Compact connected process/tree layouts | Exact tree labels changed. Renderer-generated identity needs a semantic mapping. Matrix editing and position-preserving city patches were outside this restricted contract. |

The React and Canvas blank grids show another way to reduce repetition: loops. Their one-shot render times were 5.62s and 8.48s, respectively, versus the compact DSL's three-sample median 1.97s and direct SVG's 17.43s. These are descriptive samples with different layout contracts and different collection times, not proof of a permanent ranking. HTML's repeated valid grids took 19–27s; one additional output was only accepted offline after an allowlist correction and has no reconstructed historical render time.

## Fairness, safety and audit corrections

The original 36 outputs are immutable. Static HTML added 13 later calls, generic HTML/DSL subjects 12, Canvas/React 26 and Excalidraw/Vega 12: 99 total. The extensions used matching facts and the same GPT-6 Luna low reasoning setting, but were not time-interleaved with the originals. Provider load, cache and warm runtimes may differ. Within newer parallel workstreams a shared lock serialized generation. Reported times start after acquiring that lock.

Output contract and layout responsibility differ. DSL/Mermaid/Vega delegate geometry; direct SVG/HTML ask the model for it; React/Canvas can program loops. The comparison measures each complete contract, not encoding alone. No produced JavaScript is run by the gallery: React/Canvas are static recorded previews, while their original isolated test harness performed execution with timeouts and blocked network access.

Static HTML uses a safe inert subset, not all web features: no scripts, events, forms, URLs, external resources, arbitrary CSS, SVG or Canvas. One grid used harmless colgroup/col tags missing from the initial allowlist. The contract was expanded to those and other inert text/table tags, and the identical saved raw output was revalidated offline. Original rejection and timing remain recorded; no paid output was silently rewritten. Native Excalidraw's patch initially failed an evaluator ID assumption; the explicit offline correction confirms only vendor A moved. Canvas font and grid-heading evaluator corrections are likewise retained separately from real visual failures.

All seven initial scenes and all cross-subject outputs received screenshot review. Automatic label presence originally missed disconnected diagrams, hidden white text, wrong plot segments and spacing collapse. Recorded passes combine tests and explicit manual findings; they are not interchangeable production accuracy estimates. The strict bar includes requested proportional geometry, exact labels and readable layout, while notes distinguish layout failures from wrong facts.

Five supplied samples form each y=x² polyline; this does not test smooth calculus plotting. Vega's native hit tests passed 15/15 across three curve outputs; the multiseries overlap case passed 5/6. Excalidraw preserves IDs in native scene data, but static export strips DOM identities, so no cell-selection success is inferred.

## Edits, selection and the open board

The single city patch moved A from 0.2 to 0.3. Direct SVG completed in 4.74s and DSL in 1.69s, retaining B, endpoints and their geometry. JSON completed in 2.18s while preserving its already disconnected scene. These are one-sample edit timings. SVG replaced the full markup; DSL replaced the entire axis object. Stable IDs alone do not prove sparse edits, camera persistence, click targets or grading continuity.

An open board needs retained objects and explicit problem/source/scene revisions. Store visibility, camera and selection separately. Same-problem explanations patch relevant objects; a new problem replaces the active scene, and a purely verbal topic hides an unrelated board. Reopening should restore the right scene without consuming another question or recording an attempt. Pan and zoom stay local; small edits preserve unaffected objects and the camera.

Natural tutoring and strict scoring can coexist. The renderer uses established public facts and stable selected-object IDs; canonical question consumption, help eligibility and grading remain separate. Private answer keys must not enter an independent renderer. Turn/source/revision guards suppress late output after interruption. The comparison gallery demonstrates local camera motion and potential object IDs, not the production scoring lifecycle.

If incremental drawing is pursued, stream complete validated object operations rather than expose unfinished markup. Every format here waited for complete output and validation. Production decoder, routing and retained-scene measurements are a separate experiment under `benchmarks/retained-scene/`, with actual Terra prompts and the production React renderer; do not pool those timings with this 99-call Luna comparison.

## Reproduce and inspect

Offline commands from the project root:

```sh
node --test tests/whiteboard-formats-render.test.mjs tests/whiteboard-html.test.mjs
node benchmarks/whiteboard-formats-report.mjs
node benchmarks/whiteboard-formats-verify.mjs
python3 -m http.server 8796 --bind 127.0.0.1 --directory benchmarks/whiteboard-formats
```

The benchmark generators default to offline fixture checks; `--live` creates paid requests and must be an intentional new run. The loopback-only [comparison](http://127.0.0.1:8796/comparison.html) contains all retained source outputs, measurements and known concerns, with per-scene/per-repeat selectors. Camera controls do not call a model. Original and extension result files, audit sidecars, screenshots, instruction hashes and raw usage counters remain available alongside the generated report.


## Observed usage and estimated cost

| Format | Requests | Input tokens | Output tokens | Estimated total USD |
|---|---:|---:|---:|---:|
| Current JSON | 7 | 3624 | 3305 | $0.002015 |
| Restricted SVG | 13 | 7664 | 18717 | $0.010155 |
| Compact scene DSL | 19 | 11169 | 6701 | $0.004467 |
| Mermaid | 3 | 1237 | 677 | $0.000462 |
| Static HTML/CSS | 19 | 12712 | 24024 | $0.013310 |
| Canvas 2D code | 13 | 6149 | 11241 | $0.006235 |
| React/JSX | 13 | 5875 | 11109 | $0.006142 |
| Excalidraw scene JSON | 8 | 5352 | 15846 | $0.008490 |
| Vega-Lite chart | 4 | 1851 | 3383 | $0.001877 |

All 99 requests together: 55633 input tokens and 95003 output tokens; estimated $0.053154. These are list-price estimates from actual reported token counts, not provider bills. Different formats have different numbers and mixes of cases; compare matching cases for per-task cost.

Uses the [official GPT-6 Luna rates](https://developers.openai.com/api/docs/models/gpt-6-luna) verified October 2, 2026: $0.10 input, $0.01 cache reads, $0.125 cache writes, and $0.50 output per million tokens. Standard global processing is assumed where a service tier was not reported; newer arms retain provider-reported tier when available. Actual cache counters are preserved and used; reasoning tokens are already included in output. Credits, tax, account rates, regional premiums and other session work are excluded. No paid voice was used.

## Cross-subject checks

These later samples allow purposeful teaching text, provided worked steps and annotations. Each row is one request per tested format, except the specialist native biology sample. Missing cells mean untested, not failure. Content and layout concerns are distinct in the retained review notes.

| Subject | HTML/CSS | Compact DSL | Canvas | React | Excalidraw |
|---|---|---|---|---|---|
| biology-cell | Pass · 7.12s | Concern · 12.13s | Pass · 8.35s | Pass · 9.57s | Pass · 8.68s |
| chemistry-equation | Pass · 13.88s | Concern · 8.27s | Pass · 10.26s | Concern · 13.02s | — |
| algebra-steps | Pass · 5.66s | Pass · 3.32s | Pass · 4.16s | Pass · 8.96s | — |
| physics-forces | Pass · 8.60s | Concern · 4.74s | Concern · 8.19s | Pass · 8.48s | — |
| history-timeline | Concern · 6.54s | Concern · 5.51s | Pass · 7.92s | Concern · 13.40s | — |
| grammar-annotation | Concern · 5.90s | Concern · 4.20s | Pass · 6.90s | Concern · 6.99s | — |

Strict recorded-quality passes include requested layout, spelling/spacing and object identity where tested. A proportional timeline offset or text clipping can fail that bar while every source fact remains correct. This small, heterogeneous sample does not establish subject-wide reliability.

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
- The original JSON/DSL comparison uses a benchmark SVG renderer. HTML, React, Canvas and native libraries use their separately documented actual renderers, with static previews in the gallery. This 99-call experiment does not measure the existing production React/HTML matrix renderer or actual ElevenLabs, retrieval, Jev routing, UI opening animation, or network-to-screen WebSocket delivery.
- Automatic text/identity/bounds checks are incomplete semantic or visual evaluation. Screenshots and manual inspection are recorded separately; failed content checks are not silently repaired.
- A stable DOM id is only a candidate interaction anchor. Scoring IDs and active-question state must remain independent of rendering identifiers.

## Local comparison

Open `comparison.html` through the loopback-only static server. It offers case and repetition selectors, selection IDs, and a camera-only pan/zoom demonstration. No model is called by that page.

## Sources

- [SVG viewBox](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/viewBox)
- [Mermaid flowchart syntax](https://mermaid.js.org/syntax/flowchart.html)
- [Mermaid security level](https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html)
- [Mermaid XY charts](https://mermaid.js.org/syntax/xyChart.html)
