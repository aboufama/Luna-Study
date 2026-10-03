# Tutor-session quality experiment

## What this measures

Two loopback sessions replay the same scripted student over a **30-minute virtual timeline**. Terra produces actual tutor replies, Jev makes actual intent and canvas decisions, and Luna independently grades each eligible answer twice. The production canonical question bank and persisted mastery store are used, with deterministic academic question fixtures. ElevenLabs recognition and synthesis are simulated; there are no paid voice calls, recorded people, or measured learning gains.

The script contains roughly nine minutes of concentrated interactions, an explicit absence, and a return at minute 28. It is not 30 minutes of sustained human study. Actual user-activity packets maintain presence during the working periods; the absence period sends none. The current implementation’s injected clock controls presence, cooldowns and session limits. Old controls that did not exist in the baseline are recorded as unavailable rather than sent as invalid packets.

Both arms receive the same complete short algebra and biology originals, including worked solutions. Retrieval prefetch is disabled in both arms to isolate tutoring policy. The baseline snapshots voice instructions and orchestration; common provider/grading modules remain shared with the current application. This is a controlled behavior comparison, not a reconstruction of every historical dependency.

## Initial live checkpoint: a genuine failure was found

Raw results remain unchanged in `live-paired-results.json` and its `.before.json` / `.current.json` sidecars. Each arm used a frozen instruction string and recorded public responses, validated boards, decisions, source hashes, usage, diagnostics and mastery.

| Observation | Before | Initial current |
|---|---|---|
| Requests | 16 OpenAI + 23 Jev | 14 OpenAI + 24 Jev |
| First spoken-text median | 0.904 s, 12 replies | 1.071 s, 12 replies |
| First synthetic-audio median | 1.027 s, 12 turns | 1.168 s, 13 turns |
| Eligible answers sent to double grading | 2 | 1 |
| Accepted double grades | 2 | 0; independent decisions disagreed |
| Public-rate model cost estimate | $0.084590412 | $0.073345862 |

These timings describe different generated behavior in a small sequential sample. They do not establish a latency improvement. The listed first-text clock starts at tutor generation, after incoming intent classification. Synthetic-audio timing measures the point where a speech chunk enters the fake adapter, not ElevenLabs generation or browser playback. Later accounting also records committed-student-to-response timing, which includes semantic routing but still excludes actual speech recognition and user speaking duration.

The baseline answered the unattempted problem in full when the student said, “I don’t know. Can you just solve it for me?” It gave `x = 4` and every solving step. The initial current prompt avoided that complete answer, but it failed the more important permission/lifecycle test:

1. Welcome correctly asked and tracked the canonical `2x + 3 = 11` question.
2. On the next turn, the tutor asked an unqueued scaffold: “What equal operation would you try first, and what would the equation become?”
3. Strict question tracking cleared the active question. That also removed the Hint button’s working-problem identity.
4. All three intended Hint clicks and the cap/cooldown clicks had `no-question`; the live run therefore **did not demonstrate working hint quotas**.
5. The “no calculator” turn then gave an unsolicited solving scaffold without a Hint click. The deterministic help gate had no active question to protect.
6. Algebra answers were never sent for grading. Later, a spontaneous nucleus question caused the same loss after a biology answer.
7. Clearing only the optional quiz date independently cleared the current question and hint state.

Strict grading correctly refused the one current biology attempt when the two judgments disagreed. No arbitrary scaffold was promoted to a canonical graded answer. The repair must retain that conservatism while preserving a separate working problem for conversation and hint permissions.

The one paid Q-notation probe classified “What does Q mean?” as an answer request when defining Q was itself the target. The contrasting clarification probe hit the wrapper’s cap **before fetch** and supplies no model evidence. A neutral welcome with unknown exam date was not present in the initial pair; late date removal is not a substitute for that scenario.

## Accounting correction

`initial-live-audit.json` is an explicit offline correction derived from the production usage callbacks already present in the raw artifacts. All **30 OpenAI and 47 paid Jev calls** have observed token counts. The original benchmark’s cloned SSE whole-body observer aborted when the production adapter finished, so its initial request-level cost subtotal omitted streamed tutor requests. Raw files were not rewritten.

The corrected estimates use the repository’s recorded public rates and measured cache read/write counts. Reasoning tokens are already included in output tokens. Estimates exclude the synthetic ElevenLabs events, account credits, taxes and negotiated prices; they are not invoices.

## Deterministic coverage and its limit

The offline harness verifies three graduated button permits, a 45-second cooldown, no fourth same-question hint, cancellation/refund behavior, assisted retry exclusion, topic/source scoping, pause/resume, and automatic continuation after new indexing. An extended session earns algebra mastery only after three distinct unassisted hard wins; one biology win leaves total mastery at 65, not complete. New source coverage resets that aggregate appropriately.

Those tests originally used exact canonical tutor replies and passed while the actual model paraphrased a scaffold. The live failure is retained as evidence for adding a realistic working-problem regression; a green deterministic suite alone is not proof of natural tutoring quality.

## Repair validation

The first repair used `tutor-quality-repair.mjs`, with one shared ceiling of **30 OpenAI + 30 Jev requests** across its scenarios. It repeated the spoken script and added a source-ready neutral welcome with no exam date, immediate uncertainty/refusal, and notation-classifier cases. One instruction hash was frozen across the arm. Initial results above remain the first checkpoint, including every failure.

The first repair checkpoint completed with **19 OpenAI and30 Jev** calls (cost estimate **$0.105207868**). Its frozen prompt hash is `0a7968755273a6400007b7db9ffe501f46d0a515c76fc433a27e9cb7a56208d4`. Raw results are in `live-repair-results.json` and the named scenario sidecars. All paid usage is now captured directly by the corrected observer.

The working-problem repair improved concrete behavior: the same algebra identity survived the scaffold; three button hints were delivered at the intended levels; the immediate repeat was blocked by cooldown; the fourth same-problem hint was blocked; a new canonical biology question received a fresh quota; pause/resume and a date-only edit retained the working target. Confirmed spoken requests for a solution and for calculator help received deterministic button invitations. They made no tutor-model request.

It is **not a complete pass**:

- The neutral unknown-date welcome still chose a problem without asking about the quiz. After uncertainty/refusal it accepted the preference but embedded an unauthorized strategy nudge (“undo the plus3”).
- Algebra’s wrong and complete correct responses still did not reach grading, although the model input retained the confirmed working problem. The prior observer did not save raw Jev answer probabilities, so the exact semantic rejection cannot be reconstructed or asserted. Subsequent runs record public classifier states/answers explicitly.
- Wrong-answer feedback again falsely attributed a successful intermediate value8 to the student, who had said `x = 7`.
- An initial suspicion of overescaped LaTeX was withdrawn: exact decoded character codes show one backslash per command and no adjacent backslashes. Nested JSON serialization caused the mistaken reading. No math normalization is justified by those two boards; independent browser review checks their actual presentation.
- Q meaning was correctly treated as assistance when it was the target; the calculation-context counterpart remained uncertain, so it did not establish a successful clarification.
- One last post-reply relation/canvas request was blocked **before fetch** by the shared30-Jev ceiling. The resulting final unconfirmed state is a cap effect, not evidence of a production classification failure.

The one biology attempt reached the two original-source graders and produced validated agreement (`correct`, unassisted). No algebra credit was silently substituted. The initial grader observer retained usage and the production agreement diagnostic, not each full structured decision; that instrumentation limit is explicit, and future artifacts save both actual public decisions.

## Sustained state stress

`offline-sustained-results.json` adds30 interactions spread throughout the full half hour, including24+ academic utterances, the last at minute29, and only a30-second controlled break. It completed without runtime errors and exercised13 attempted grading jobs with deterministic decision doubles. The initial four session tests covered the measured scaffold, a rejected local-substep grade, original-question hint attribution, calendar retention, new canonical replacement, and rejection of stale hints after a different unqueued nucleus question. A fifth later added provisional target review.

This offline trace establishes state and evidence-handling properties, not actual model teaching quality. A separately bounded adaptive live trace is prepared. Its student answers follow the actual public working question; an unrecognized target leads to clarification rather than an answer guessed from a planned sequence. It was held at this checkpoint while the grading and coaching findings above were investigated; later live results are recorded below.

## Targeted coaching checkpoint

`live-coaching-repair.json` uses a separate8-OpenAI/12-Jev ceiling. It actually used **5 OpenAI +9 Jev**, with no blocked requests and no grader calls. The refusal was combined with an explicit request for the equation, leaving headroom for recovery. The wrong answer also asked “Is that right?” to test a submitted attempt alongside a feedback request. This scenario change is recorded rather than presented as an identical replay.

The tutor now naturally asked, “When is your test, if you know? We can start practicing now either way.” On uncertainty/refusal it immediately asked the exact queued equation. The no-calculator reply stayed neutral; asking for the solution produced the deterministic Hint invitation; a button granted one incremental hint. Wrong-answer feedback no longer falsely claimed the student had obtained8 or revealed the completed answer.

The remaining missing-grade cause is now measured: `answer_attempt=0.89` against the special0.90 threshold after a scaffold, with `requests_help=0.30` (unknown), a confirmed working identity, and post-reply continuation0.98. The eligibility diagnostic is `uncertain-attempt`. Thus this run does **not** demonstrate successful grading of that wrong attempt. It demonstrates conservative classifier gating; no lost question identity or source-grader failure occurred. The scores are model outputs, not established calibrated probabilities. They do not justify silently changing a threshold just to pass the test.

The server agent’s later grader wording refinement arrived after this run started, but no grade was invoked, so the run supplies no evidence for or against that refinement. Future live grading records both exact structured decisions. Adaptive live execution was held at this checkpoint until the next repair was reviewed.

## Provisional target review: fresh live checkpoint

The independent review and final production gate preceded `live-provisional-coaching.json`; no earlier raw results were overwritten. This separate run used **7 OpenAI + 9 Jev** calls, with measured usage for every request, no cap blocks, and an estimated **$0.034474745** in model charges. The frozen voice instruction hash was `8820e911c35cd7ac1f20083e39c7486e85719fff0ce253b807d80679f948f340`.

The wrong answer scored `answer_attempt=0.88`, below the unchanged0.90 threshold. This time the two independent original-source graders explicitly assessed whether it attempted the canonical target. Both returned `targetAttempt:true`, authentic evidence identities, and `assistanceUsed:true`. Their substantive verdicts differed (`incorrect` versus `partial`), so production recorded **recognized attempt1 but no accepted checked grade and no scoring event**. This demonstrates the intended distinction between identifying a submission and awarding credit; uncertain classifier output is not itself permission to score.

The tutor asked for the unknown test date naturally, respected refusal, restored the exact queued question, retained the hint allowance, and gated a solution request. A Hint click consumed one permit. Wrong-answer feedback accurately addressed the actual `x = 7` answer without inventing prior student success or giving the final solution. Independent transcript review agreed with these findings. It also noted that the first hint was vague and immediately invited another Hint while its cooldown had just started; this small naturalness issue remains visible in the raw trace.

The five deterministic session regressions also cover provisional local-substep rejection, later whole-target attempt numbering, and unchanged double-grade scoring checks. Review jobs, recognized attempts, accepted checked grades, and persisted scoring events are now reported separately; their counts need not match.

## First sustained adaptive live session: improved state, two remaining defects

`live-adaptive-results.json` records **25 spoken student turns, three Hint clicks, and a30-second controlled break**, with meaningful study interactions throughout30 virtual minutes. It took108.970 seconds of wall time, used **41 OpenAI +52 Jev** calls, and encountered no runtime error, missing usage, or request-cap block. The main prompt hash matched the fresh coaching checkpoint. Estimated model charges were **$0.225726005**. Median first text was1.329 seconds from tutor generation; median committed-student-to-first-text, including incoming semantic routing, was1.466 seconds. Synthetic speech remains a pipeline-boundary measurement.

The real production pipeline performed **7 review jobs /14 grader requests**, recognized6 attempts, and persisted5 agreed grade events. A local algebra substep was provisionally reviewed and rejected by both graders as not yet a target answer, consuming no attempt. Subsequent wrong and corrected whole-target answers became attempts1 and2. The corrected assisted answer earned ordinary progress but no unassisted hard win. Biology’s partial and later full answers were graded as assisted; the independent `w` answer earned the only unassisted hard win. The correct `z` answer was not accepted: both graders returned partial/insufficient reasoning and disagreed on assistance. This conservative rejection remains in the evidence rather than being rewritten as a pass.

Final progress was **Equations60, Cell transport33, overall47**, with neither topic mastered and no completion announcement. Spoken solution requests stayed behind the Hint invitation. Setup clarification, a topic switch, and pause/resume retained or changed the working target appropriately during the first part of the session.

This full session is still **not a quality pass**:

- The first Hint gave orientation. The second consumed a permit but repeated the previous no-calculator reassurance instead of providing the authorized strategy. The third also consumed a permit but said all hints were used. Its actual input simultaneously had `hintAllowed:true`, `hintNumber:3`, `hintsRemaining:0`, and `requiresAttempt:true`. Exact request/output projections are preserved in `live-adaptive-hint-evidence.json`.
- The tutor had already canonically asked the `3y - 6 = 9` question, then followed the student’s request to try a different equation. When it revisited that earlier skipped question after `w`, the consumed question was absent from the queued bank and current working anchor. Repeated prose restatements did not restore canonical tracking. **Three adaptive answer opportunities became clarifications because the public current target was absent; all eight final tutor replies remained untracked.** This is a historical canonical-question revisit failure, not evidence that an arbitrary freeform question should receive credit.
- The student policy conservatively asks for a canonical question when tracking is absent. That makes the resulting repeated-restatement loop explicit; a real student might instead answer the visible prose, but the current trace cannot demonstrate safe grading for that untracked answer.

The adaptive student’s correct answers are copied from the supplied synthetic originals. This tests conversational and scoring behavior under known evidence; it is not a measured learning benefit. The corpus is two short sources,745 characters total, and the trace does not establish robustness on large documents or natural audio. Targeted repairs and another separately bounded sustained run must retain this first full-session artifact unchanged.

## Current-grant repair: live Hint checkpoint

After804 tests, a production build, and independent transition/provisional reviews passed, `live-hint-grant-repair.json` used a separate ceiling of5 OpenAI/8 Jev calls. Actual usage was **5 OpenAI +6 Jev**, all observed, estimated **$0.03791386**. The frozen prompt hash was `36092e765c8783f73136bd4504cfd88e436ee73a42272c237dca1ef4b27ef461`.

All three button presses produced a hint for the established equation; each had an explicit current `deliver-authorized-hint` task. The model's remaining allowance included its valid current grant, while the UI correctly showed future remaining hints2,1,0. The second hint described undoing the constant before multiplication. The third wrote the equal subtraction on both sides and asked the student to simplify. Neither disclosed the final value. An immediate repeat was blocked by cooldown, and a fourth request was exhausted; neither made a provider call or consumed another permit.

The first orientation still used somewhat vague wording about the operation “attached directly to x”; later hints clarified the intended order. The targeted run demonstrates current-grant delivery and quota enforcement for this equation, not uniformly excellent pedagogical wording across all subjects. Every raw board and reply remains available for review. A second sustained adaptive run follows under a distinct50/60 ceiling.

## Second sustained trace: question revisit repaired, display gate too restrictive

`live-adaptive-repaired.json` reached30 virtual minutes using its full **50 OpenAI +55 Jev** allowance, all measured, with estimated charges **$0.232888703**. It recorded10 review jobs /20 grader calls,8 recognized attempts,7 agreed grade events, and two rejected provisional non-attempts. Earlier skipped `y` practice was restored through its original encountered-question identity, answered, and graded. None of the adaptive answer slots lacked a public question ID. Two later freeform prompts left the relationship unconfirmed until the tutor explicitly restored the canonical question.

The review cap was reached before a late recovery request and the final review reply; both were blocked **before fetch**. The harness's `completed` status means it finished its scripted loop, not that the final teaching turn succeeded. The final review was therefore not observed in this cohort. Raw failures remain unchanged.

Three Hint grants were delivered. The pending wrong-answer reply did, however, give the final `x = 4` result before its independent review completed, instead of first inviting a repair. This followed an actual submitted wrong target answer, so it differs from the still-blocked unattempted solution shortcuts. Its full solved board was generated but **not displayed**. Some academic replies also ended in acknowledgment without a concrete next step. These are coaching limitations rather than false mastery awards.

Display behavior was a clear failure: **21 validated generated candidates, including4 paid recoveries, produced zero visible canvas packets**. The new target-match gate at0.90 rejected useful candidates. Correct `z` reasoning again received disagreeing judgments: one correct/sufficient and one partial/insufficient, both with `assistanceUsed:false`; production awarded no credit. Final progress was Equations90, Cell transport33, overall62, with only two unassisted hard wins and no mastery. A higher number is not evidence of learning gain; it reflects the scripted known answers that this repaired identity path could now assess.

## Board-target calibration and adoption

The separate four-case `live-board-match-structure.json` used4 Jev calls and no OpenAI calls, estimated$0.000225078. A correct blank8×10grid scored0.72, an unlabeled triangle0.70, a wrong7×10grid0.10, and an ellipse for the triangle0.07. Both positives abstained under the original0.90 display threshold.

The broader `live-candidate-calibration.json` then evaluated24 fixed, independently reviewed cases with12 development and12 held-out cases across six subject families. Its predeclared selection rule chose0.70 before held-out calls. At that threshold, **4/6matching scenes opened,0/12wrong or mixed scenes opened, and0/6insufficiently specific scenes opened**. Thresholds0.85and0.90 opened none of the six positives. The two remaining positive misses are preserved; generic incomplete scenes were assessed separately, not mislabeled as semantically false.

The display threshold was changed to0.70 with boundary regressions; grading and working-question confidence thresholds remain unchanged. The complete method, missed-case inspection and limitations are in `candidate-calibration-analysis.md`. This small correlated stress set supports the chosen tradeoff, not a general accuracy guarantee. The final sustained run uses a new upfront65-OpenAI/70-Jev allowance; the earlier capped cohort is not extended or overwritten.

## Third sustained trace: complete interaction loop, assistance false negatives remain

`live-adaptive-final.json` completed the full scripted half hour, including the minute29 review, with **55 OpenAI +56 Jev requests**, zero cap blocks or runtime errors, and measured usage for every request. The65/70 ceilings were declared before the run. Its raw SHA is `a21282087e57ff1c438943937693b4c4cea7be23cbcc94a2f55b124600aeb0ab`; the frozen voice prompt SHA is `2383d9431220276c0250023befd9d28e0d54c035d2ac005143f2d8dbfa9000ed`. Wall time was141.314 seconds and estimated model charges were **$0.271574814**. No earlier trace was rewritten.

All25 scripted spoken turns and three Hint presses occurred on the same30-minute virtual schedule. Every adaptive answer slot had a recognized public canonical question. The three hints were distinct and graduated; the third asked the learner to subtract3 and produce the resulting equation. Wrong-answer feedback now invited a repair without giving `x = 4`. The tutor followed correct work with concrete next tasks, restored previously encountered `w` and `y` identities, and honored the brief break. The final review recommended more cell-transport practice and an equations teach-back, explicitly declining to treat either topic as complete. Late `y` teach-back exchanges still repeated similar prompts; this is improved continuity, not a claim of uniformly natural teaching.

The model returned **16 validated board candidates** (12 main replies and4 silent recoveries) and2 invalid board attempts. The actual route sent **8 visible board updates** and5 hide packets. These are different event counts, not a board-quality percentage: some candidates were rejected, merged, or concerned a question transition. The accepted scenes used current `z`, `w`, and `y` givens; biology used a correct membrane/transport flow; a worked `y` scene followed an actual full submission. `final-board-audit.json` replays all8 accepted packets at desktop and mobile sizes through the production component, retaining exact board hashes and screenshots. No parser errors or horizontal math overflow were found in that replay. It is a read-only component rendering check, not proof of live selection or camera persistence.

Production recorded **12 review jobs /24 grader calls /9 recognized attempts /7 agreed grade events**. Both local-substep disagreement and incorrect/correct disagreements conservatively produced no score. Two non-target provisional jobs were rejected without adding attempts. The independent `z` response now earned one unassisted hard win. Final scores were Equations90, Cell transport33, overall62, with neither topic mastered. `final-grading-audit.json` replays all12 exact captured synthetic grading inputs and outputs through the schema/citation/agreement code without additional provider calls; historical identities and attempt ordinals remain consistent.

That audit also found a **remaining substantive grading defect**. The `w` submission had no prior target-specific hint or worked solution, and server eligibility was unassisted. Both model graders nevertheless called it assisted after a neutral restatement and an unsolved given equation. The first `y` answer was correct and sufficient in both decisions but disagreed on assistance. The prompt phrase “including a prior restatement” was ambiguous about repeating a question versus repeating a solution. This trace is therefore a completed interaction loop with conservative false negatives, **not a complete grading-quality pass**. The exact failures remain unchanged while a separate controlled assistance experiment and later sustained verification are prepared.

Median first text was782ms after generation began, or850ms from committed synthetic student text including incoming intent classification. Median synthetic audio was917ms/1,040ms at the corresponding boundaries. The fake speech adapters deliberately exclude real microphone recognition, ElevenLabs synthesis and playback latency. Sequential cohorts changed prompts and state handling; these numbers do not establish a controlled speed improvement.

`session-cohort-accounting.json` totals the session/coaching and candidate-relevance experiments through this checkpoint: **212 OpenAI +292 Jev requests, estimated $1.100912823**, with measured usage for every paid request. It excludes the separately owned grading-effort, visual-format, image and indexing experiments. Later cohorts must be added explicitly rather than silently changing this subtotal's scope. All experiments use short synthetic originals and known scripted answers; none measures human learning gain or general semantic reliability.

The separately owned `grade-restatement-results.json` tested the wording-only intervention with16 OpenAI calls and no Jev or voice calls (estimate$0.002994415). **It did not fix the neutral `w`/`y` assistance judgments**: both remained assisted after the clarification. Concrete hint, renamed target after a hint, unrelated teaching, and worked-then-restated controls behaved as expected. This rejects a wording-only success claim. A subsequent diagnostic requires exact prior-assistant citation IDs for any assistance assertion while preserving the full history; it must be evaluated before another sustained run. Its provenance authenticates the cited public words, not their semantic relevance to the current target.

## Fourth sustained trace: fairer independent grading, partial-review permission defect

After837 tests and the build passed, `live-adaptive-final-verified.json` completed the same adaptive30-minute schedule with **51 OpenAI +58 Jev calls**, zero errors or cap blocks, all usage observed, and estimated charges **$0.473874821**. Wall time was142.972 seconds. Its raw SHA is `8530e9b3af7fec302f85557db5be391c9c5b397542acefe12005b9b7e0abd056`. Every listed inference/renderer file had identical start/end hashes; the voice instructions were frozen once for the run. The incoming/post-turn Jev thresholds, original evidence validation, and two-independent-check agreement rules remained unchanged.

This cohort uses the separately controlled **Terra grading route** and explicit assistance citations. Main tutoring also uses Terra; visual recovery remains Luna. It does not isolate model choice from the evidence-schema improvement. Actual grading was20 Terra requests across10 review jobs; all10 yielded agreed checked outcomes and10 recognized attempts. Correct first answers to the distinct `z`, `y`, and `w` problems each received two `correct`, sufficient-reasoning, `assistanceUsed:false` judgments with empty assistance citations. Those three original-target first attempts legitimately satisfied the configured hard-win rule. Earlier assisted `x` work and repeated solutions did not provide extra hard wins. The exact decisions and source identities are in `adaptive-final-verified-audit.json` and the immutable raw inputs.

The final persisted state was Equations100/mastered, Cell transport63/not mastered, overall82. Biology had assisted partial/full/repeated answers and no unassisted hard win. Finishing the question queue did not mark both topics complete. The final reply prioritized independent cell-transport recall and a later mixed-equation check. All adaptive answer slots had a public canonical target; all three Hint grants were delivered. There were **12 actual visible board updates**,17 validated generated candidates and1 invalid attempt, again separate event counts rather than a quality fraction. Median first text was959.5ms from generation start and1,079ms from committed synthetic student text. The synthetic audio boundary median was1,167ms; this is not real speech-service latency.

The run is **not a complete coaching pass**. The student's generic partial response (“use the same reversible operation on both sides,” explicitly without a variable value) received two `partial` target judgments. The existing hint policy treated any checked partial as sufficient to unlock full worked review. At the later “just tell me the final answer” request, `allowAnswerReview:true` permitted the tutor to state the entire `x = 4` solution. That is a review-permission defect even though the submission can reasonably receive limited partial credit. It must not be conflated with an unassisted hard win, nor hidden by the successful grader comparison. The first pure unattempted help request remained gated. A narrow subsequent policy fix separates partial scoring/local feedback from permission to expose the complete worked answer; this raw cohort remains unchanged.

Independent scoring replay confirmed all10 raw decision pairs and persisted events, including the three distinct hard wins. It also identified a clarification boundary: the biology restatement introduced gradient/energy cues without a Hint permit. The graders cited those actual cues and treated subsequent biology work as assisted, preventing an unassisted win. This trace therefore does not establish that every unsolicited hint is prevented; setup clarification can still shade into useful guidance.

Delivered Hint exposure now survives real reconnects and regenerated bank IDs for the same conservatively normalized question, test and original-source revision. The UI still reports the current public question ID. Tests distinguish committed exposure from canceled reservations, preserve date-only continuity, isolate new sources, reject ID reuse for another target, and retain the eligibility snapshot from before later help. This is bounded process-local TTL/LRU retention, not restart durability or arbitrary paraphrase matching. The reconnect repair was tested offline; this live cohort keeps one WebSocket and therefore does not independently establish reconnect behavior.

## Release sustained trace

The final release cohort, `live-adaptive-release.json`, ran after839 tests and the build passed. It repeats the same25 spoken turns, three Hint presses and30-second pause over30 virtual minutes. **51 OpenAI +56 Jev calls** completed with no errors or cap blocks, measured usage for every request, and estimated charges **$0.486700138**. Wall time was151.508 seconds. The raw SHA is `786c3b10d603a3f48d86dfef557e8fd53db27917e283dd0f5a275e8f6b84f21b`; all listed inference and renderer start/end hashes were unchanged. Earlier failed cohorts and their accounting snapshots remain intact.

The observed permission failure was repaired: the same generic partial response still earned checked partial credit, but **the later answer shortcut made zero OpenAI requests and returned the Hint-button invitation**. It did not reveal the result. All three actual button grants supplied graduated hints. The biology clarification restated only why the membrane is selective and how passive and active transport differ; it supplied no gradient/energy comparison criteria. The first partial biology answer was therefore judged unassisted partial, while the later completed answer after feedback was assisted. These are specific observed improvements, not a guarantee about every semantic help request.

Production performed **11 review jobs /22 grader calls**, recognized11 attempts and persisted10 agreed checked events. Independent first answers to `z`, `w` and `y` again earned the three distinct unassisted hard wins required by the configured rule. Assisted `x` work and repeated answers did not add wins. Equations reached100/mastered; Cell transport remained63/not mastered; overall was82. One general-method recap received two partial judgments that disagreed on assistance, so its recognized attempt earned **no scoring event**. That conservative disagreement is retained; the grader is not presented as infallible.

All adaptive answer opportunities had a public canonical target. The final review was delivered and recommended cell transport plus a later mixed equation review. The route sent **13 visible board updates** from15 validated generated candidates, with1 invalid board attempt; actual accepted-packet browser review is recorded separately. These counts are not a quality denominator. Median first text was1,019ms from generation start and1,128ms from committed synthetic student text. The synthetic audio boundary median was1,273ms. Fake STT/TTS, short synthetic originals and known scripted answers remain important limits; this is no claim of human learning gain or real ElevenLabs performance.

Exact public dialogue is in `adaptive-release-transcript.md`; `adaptive-release-audit.json` contains the raw-source hash, both hard-win judgments, the blocked shortcut evidence, hint replies, neutral clarification and the unresolved review. `session-cohort-accounting-release.json` totals this agent's session/coaching plus candidate-calibration work through this cohort: **314 OpenAI +406 Jev calls, estimated $2.061487782**. It deliberately excludes the separately owned grading component comparisons, planning probe, images, indexing and visual-format experiments. The consolidated project report should add those distinct groups once each, using their own measured accounting.
