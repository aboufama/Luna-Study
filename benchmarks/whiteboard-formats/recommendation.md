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
