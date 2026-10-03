# Astra latency report

**This pass is complete. Production is unchanged.** I did not reduce reasoning, switch models, remove context, shorten the requested answer, weaken factual checks, or adopt more aggressive speech chunks or silence detection. The new prewarming experiment is saved for reproducibility but is not enabled in the app.

## What has improved so far

| Measurement | Before → after | Observed reduction | Evidence and limits |
| --- | --- | --- | --- |
| Retained speech-buffer fix | 4,370.3 → 2,752.3 ms to first returned audio | **37.0%, or 1,618.0 ms** | Two trials per condition replayed the **same model trace, words, and arrival times** through real TTS. Closing `</say>` now releases pending speech without waiting for board JSON to finish. |
| Earlier combined voice pipeline | 5,524.1 → 4,239.1 ms from end of input PCM to first returned audio | **23.3%, or 1,285.0 ms** | Two trials per condition compared exec/1.0-second silence detection with streaming/0.5-second silence detection. All four synthetic transcriptions were exact. This predates the current onboarding and persistent-board app. |

**These percentages are not additive.** They measure different boundaries, configurations, and stages.

The 37.0% result is the strongest isolated evidence: the input to speech synthesis was identical, and the changed behavior was when the existing speech buffer was released. The complete validated board still arrived at **4,218 ms** in that trace. Hearing “Consider this” earlier does not mean the full visual problem became ready earlier.

No microphone or speakers were used. Returned PCM was discarded. Consequently, these tests establish timing and text preservation, **not independently verified listening quality, pronunciation, prosody, or physical speaker latency**. The earlier silence-detection comparison also does not establish behavior in noisy rooms or during natural pauses.

## Current-app profile

I first profiled the current persistent-board app twice, using full synthetic study sources, conversation history, selected matrix cell, private question bank, and mastery context.

| Stage | Run 1 | Run 2 |
| --- | ---: | ---: |
| First meaningful model text | 4,072.3 ms | 4,280.1 ms |
| First returned PCM | 4,443.1 ms | 4,491.5 ms |
| Complete validated board | 6,183.3 ms | 6,370.5 ms |
| TTS connection ready | 90 ms | 161 ms |
| Fresh thread setup RPC | 65.3 ms | 60.3 ms |

The TTS connection was already ready well before speech text arrived. Preconnecting it earlier would therefore not remove the dominant waiting time in these runs. Most remaining time was in model generation, which I left unchanged.

## New experiment: prepare a fresh conversation while idle

The candidate prepared the next blank ephemeral conversation before the next user turn. It used a fresh conversation for every answer and sent the same complete input; it did not reuse or omit previous context. I compared **five pairs**, alternating condition order, with the same model, reasoning effort, source input, and production TTS settings.

| Mean measured stage, five runs per condition | Current | Prewarming candidate | Observed difference |
| --- | ---: | ---: | ---: |
| First meaningful model text | 4,301.7 ms | 3,614.6 ms | 687.1 ms, 16.0% |
| First returned PCM | 4,753.0 ms | 4,100.0 ms | **653.0 ms, 13.7%** |
| Complete validated board | 6,899.1 ms | 5,772.1 ms | 1,127.0 ms, 16.3% |

**Rejected for production in this pass.** The observed 653 ms is not a cleanly attributable structural saving:

- The local setup operation normally took **55–68 ms**, about **1%** of first-audio latency. Moving that operation off the turn path can explain that small span; it does not by itself explain 653 ms.
- Model wording, first-sentence length, and board-patch length varied. Those differences affect both speech-buffer timing and board completion. The same full inputs were supplied, but this was not an identical-output replay.
- The largest first-audio pair favored the candidate by 2,126.2 ms. Excluding the first pair, the observed mean first-audio difference fell to **284.7 ms, or 6.1%**. One of the five pairs favored the current implementation.
- In one immediately consecutive candidate turn, preparation was still running and delayed turn dispatch by **467.4 ms**. Prewarming was not reliably free on the critical path.
- Each condition used its own persistent local app-server process. Provider/session variability cannot be fully separated from the candidate with this small sample.

All ten comparison replies retained the correct conclusions: Defect gives 5 rather than 3 against Cooperate, and 1 rather than 0 against Defect. Every applied patch preserved the original payoff matrix. This is a useful semantic check, not a general guarantee of response quality.

“First meaningful text” here is a text-side timing heuristic after introductory wording. It is **not measured time to hearing the first substantive word**. TTS audio alignment and playback were not measured. Board-ready times exclude Jev routing, browser transfer, and rendering; the current-app profile excludes speech recognition entirely.

## Usage, decision, and artifacts

This pass used exactly **24 generation/stream requests: 12 Luna generations and 12 TTS connections**. There were no provider errors and no automatic retries. No raw audio, microphone input, playback, or credentials were saved. I stopped at the agreed request budget. Monetary cost was not measured.

The configuration remained **GPT-5.6 Luna, low reasoning effort**, with complete supplied sources, board/selection, history, private question bank, and mastery context. The same factual boundaries and natural speech settings stayed in place. **No additional production speedup is claimed from this pass.** The previously retained speech-buffer fix remains active.

- [Exact round-two results](latency-round2-results.json): synthetic inputs, outputs, timing traces, paired differences, and limitations.
- [Current-app profile harness](latency-round2.mjs) and [prewarming comparison harness](latency-round2-prewarm.mjs).
- [Experimental adapter snapshot](latency-round2-experimental.mjs): benchmark-only; the application does not import it.
- [Previous isolated buffer measurements](latency-iteration-notes.md) and [earlier pipeline results](voice-pipeline-results.json).

The final mocked adapter, decoder, speech-stream, and experimental-context checks passed **33/33**. They verify intact context, unchanged reasoning settings, cancellation boundaries, and speech/board separation without live providers. The parent task runs the full application checks separately.
