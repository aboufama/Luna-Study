# Independent whiteboard visual audit

Ten selected existing outputs from the final, repaired and initial-current runs. All ten were independently re-rendered and visually inspected. This is not a new ten-request success rate, not blinded, and not a statistical estimate of all-subject reliability. Nine selected cases pass the requested visual task; the parabola is qualified because its curve interpolates five exact supplied points.

The four checks are **semantic placement**, **legibility**, **overlap/clipping**, and **useful rather than redundant text**. Browser checks alone were insufficient: the early graph and prose matrix were schema-valid but visibly wrong.

| Scenario | Before / intermediate finding | Latest rendered result | Verdict |
| --- | --- | --- | --- |
| hydraulic-legend | Fail: the legend exposed literal \rho; the first current matrix concatenated prose in math mode. | [Render](renders/audit-latest-hydraulic-legend.png). Formula and all five symbol meanings are correct. Prose preserves spaces; symbols remain mathematical. | pass |
| biology-process | Qualified: named processes and direction are correct, but arrow captions overlap node outlines. | [Render](renders/audit-latest-biology-process.png). DNA → RNA → Protein, with transcription and translation attached to separate visible directed connectors. No repeated paragraph. | pass |
| chemistry-process | Pass for the original scene. The first current typed flow clipped the Gas box. | [Render](renders/audit-latest-chemistry-process.png). All three complete nodes fit. Solid → Liquid → Gas and melting/vaporization map to the correct transitions. | pass |
| programming-branch | Qualified: return and outgoing arrows share routes and make the older scene hard to scan; intermediate repair interrupted the shared crossbar. | [Render](renders/audit-latest-programming-branch.png). Shared crossbar is continuous. Three labeled target branches correctly map equal to found, smaller to left and larger to right. | pass |
| grammar-annotation | Fail for visual targeting: approximate brackets/arrows do not attach precisely to the words. First current output repeats both clauses in boxes against the request. | [Render](renders/audit-latest-grammar-annotation.png). One exact sentence; nested labels distinguish After, Maya, dependent clause and main clause without crossing labels or duplicated sentence text. | pass |
| history-timeline | Pass: correct order, dates and approximately proportional gaps. | [Render](renders/audit-latest-history-timeline.png). 1776,1787,1791 are in order. Horizontal distances400:145 approximate11:4 within0.4%; labels and tick targets remain separate. | pass |
| physics-forces | Fail: the original response did not produce an accepted board. | [Render](renders/audit-latest-physics-forces.png). Weight mg downward, normal N upward, applied F right and friction f_k left. Labels do not cross arrow strokes; no invented numerical values. | pass |
| math-parabola | Fail: old tick labels were misplaced and several point markers did not lie on the graph. First current scene still misaligned numeric ticks. | [Render](renders/audit-latest-math-parabola.png). Typed plot correctly locates all five supplied points, origin and tick values; symmetric smooth interpolation has a minimum at the vertex. | qualified |
| probability-tree | Pass: two levels, readable branch probabilities and four correct outcomes. | [Render](renders/audit-latest-probability-tree.png). H/T branching at each level has1/2 labels; HH,HT,TH,TT each carry1/4. No connector-label collision obscures a path. | pass |
| game-table | Pass: all four values and row/column labels are in correct order. | [Render](renders/audit-latest-game-table.png). 2×2 grid preserves (3,2),(0,1),(1,0),(2,3), row/column strategy names and no marked equilibrium. Short payoff-order key is useful rather than a transcript wall. | pass |

The final curve is not a symbolic graph engine. Its five source points, origin, direction and ticks are exact; its shape between points is monotone interpolation. The branch diagram intentionally shows a single comparison step, and the force-arrow lengths are schematic.

All ten latest replays have one board button (Close), zero selection/zoom controls, zero math errors, and 0px measured icon-center error. The exact raw-LaTeX regression also passes on desktop and 390px mobile. Full per-image hashes and source-run provenance are in [independent-visual-audit.json](independent-visual-audit.json); [independent-browser-audit.json](independent-browser-audit.json) contains the offline render measurements.

## Mobile and playground changes

| Before | After |
| --- | --- |
| Mobile dock followed the 888px-tall rigid mosaic below the 844px viewport. | `src/hint.css`: viewport-fixed dock, safe-area bottom spacing, translucent backing and compact touch controls; controls remain reachable without scrolling. The mosaic itself retains its geometry. |
| The allowance count beside Library took space needed by controls. | `src/hint.css`: hide the decorative mobile source count and reduce horizontal button padding while retaining 40px targets. |
| Pause card centered over the whole tall board rather than the visible screen. | `src/session-paused.css`: viewport-bound frost below the header, scrollable overlay and compact short-screen card; Resume is visible and 44px tall. |
| Practice toggle could be 38px and an expanded desktop panel stayed open after entering mobile. | `src/PracticeTrail.jsx` and `src/practice-trail.css`: 44px toggle, bounded narrow panel, collapse on mobile breakpoint entry; X stays unobstructed. |
| Scripted playground invited selection and pan/zoom, with a selection details panel. | `src/BoardDemo.jsx`: production read-only board, current-example description, truthful scripted copy; step/note/hide/reopen/reset stay outside the board. |

Validation: 15 mocked hint/presence browser checks, 12 mocked image-import checks, 9 read-only playground checks and production build pass. [Mobile measurements](../../artifacts/hint-presence/results.json) confirm the dock is inside the viewport and the X is centered inside its 40px circle and the mosaic frame on desktop and mobile. Screenshot previews still fit their drawer. No paid calls or real microphone were used in this audit.

Limits: selected outputs are drawn from several rounds, so this report is not a fresh ten-call success rate or a matched latency comparison. Static correctness is not a guarantee for arbitrary future content, every mobile board, live speech or grading.
