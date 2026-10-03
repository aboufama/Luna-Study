# ElevenLabs credit audit — October 2, 2026

**The account shows 9,991 of 10,000 credits used, with 9 remaining. Recorded latency benchmarks account for approximately 24% of that balance. Including earlier prototype/demo speech brings the attributable or strongly inferred testing share to approximately 35%.** These are different confidence levels, not two exact totals.

This audit made no generation, transcription, or voice requests. It read existing benchmark artifacts, private local session metadata, and the first-party history/request exports fetched by the parent task. Private transcripts and raw provider exports are not copied into this report.

## Account totals

The first-party current-period usage response reconciles all 9,991 credits:

| Model | Credits |
| --- | ---: |
| V4 Turbo speech | 6,099 |
| Scribe Realtime transcription | 2,728 |
| Earlier V4 speech | 1,104 |
| Flash synthetic input clips | 60 |
| **Total** | **9,991** |

Historical usage of 4,720 V4 credits before this current-period window is excluded. Provider “request” and history-item counts can refer to chunks within a connection; they must not be described as separate tutoring conversations.

## Exact recorded benchmark speech charges

These charges are summed from `character_count_change_to - character_count_change_from` in first-party history, matched to the synthetic text and benchmark time windows. They are not estimated by multiplying characters by a price. The fields come from the [official history API](https://elevenlabs.io/docs/api-reference/history/list).

| Benchmark, UTC | Speech connections/generations | Submitted characters matched | Exact credits |
| --- | ---: | ---: | ---: |
| Initial TTS comparison, 03:44:07–03:44:15 | 3 Turbo | 339 | 171 |
| Synthetic input clip for STT, 03:45:12 | 1 Flash | 60 | 30 |
| Synthetic input clip for pipeline, 03:47:32 | 1 Flash | 60 | 30 |
| Pipeline spoken replies, 03:47:31–03:48:11 | 4 Turbo | 734 | 366 |
| Speech-buffer iteration, 04:20:52–04:21:59 | 12 Turbo | 1,652 | 828 |
| Latest current-app/prewarm experiment, 04:31:13–04:34:01 | 12 Turbo | 1,813 | 908 |
| **Recorded benchmark speech total** | **33: 31 Turbo + 2 Flash** | **4,658** | **2,333** |

That is **23.35% of the 9,991 used credits**, before benchmark transcription. It comprises 78 billed history items because ElevenLabs split some writes into multiple chunks. One coincident app utterance matching the generic “Consider this” text at 04:21:53 UTC was excluded: its eight credits occurred outside the four benchmark visual-phrase replays, which ended by 04:21:14 UTC. Other app speech in overlapping time windows was also excluded.

The latest pass's **24 requests were 12 Luna generations plus 12 ElevenLabs TTS connections**. Luna calls do not consume ElevenLabs credits. Its exact ElevenLabs speech charge was **908 credits**, or **9.09% of the depleted allowance**. Silent playback does not make synthesized audio free: these were real billed voice generations even though all PCM was discarded.

## Benchmark transcription estimate

Eight synthetic Scribe connections match the two stored benchmark windows exactly:

- Four standalone STT streams, beginning 03:45:12–03:45:25 UTC.
- Four pipeline STT streams, beginning 03:47:32–03:48:03 UTC.

Provider request logs total **56.38 seconds of connection duration**. Local benchmark counters total **31.96 seconds of submitted audio including silence**. The exported request rows do not give individual credit charges, so the exact Scribe allocation cannot be reconstructed from these exports alone.

The account aggregate is 2,728 credits over 35.2127 reported minutes, about 77.47 credits per minute. Applying that observed rate gives approximately **41 credits using submitted-audio time or 73 credits using connection time**. This is a sensitivity estimate, not a confirmed per-stream billing calculation; rounding and the provider's billing-duration definition may differ.

Recorded latency benchmarks therefore total approximately **2,374–2,406 credits, or 23.8–24.1%**. “About 24%” is the supportable rounded answer, not an exact per-request invoice allocation.

## Earlier prototype/demo speech

Two earlier V4 generations account for another 1,104 credits:

- **76 credits at 02:58:26 UTC:** the exact Luna welcome phrase, corroborated by the existing `examples/elevenlabs-dry-run.mp3` timestamp. This is an identifiable development dry run.
- **1,028 credits at 03:01:32 UTC:** a synthetic biology overview consistent with the app's built-in demonstration material. The text is strongly consistent with an early prototype/demo generation, but no exact benchmark fixture was found for that call, so this attribution remains an inference.

Including both gives approximately **3,478–3,510 credits, or 34.8–35.1%**, for recorded latency tests plus earlier development/demo audio. The 1,028-credit inference is why this broader figure should be presented as “about 35%, including early demo audio,” not as a fully exact benchmark total.

## App sessions and missing coverage

The local history file begins at **04:29:47 UTC**, after substantial earlier use. At this audit it contains eight sessions totaling about **5.23 minutes**, with 18 recorded final assistant utterances totaling **1,719 characters**, and about **93.17 seconds of generated assistant audio**. Four sessions recorded a greeting but generated zero PCM. The count increased by one short, zero-audio session during this read-only audit. A final transcript is not proof that all its text was synthesized or charged, and partial/canceled speech may not have a matching final transcript.

This history cannot account for the entire account period. Earlier app conversations, repeated greetings, retries, and interrupted speech are outside or incompletely represented in that local log. The remainder must not automatically be labeled ordinary completed lessons or testing solely by subtraction.

## Sustainable usage illustration

Using the [official API pay-as-you-go rates](https://elevenlabs.io/pricing/api) checked by the parent task, a **30-minute session with 8,000 synthesized characters** would be approximately:

- Scribe: 0.5 hour × $0.39/hour = **$0.195**.
- V4 Turbo during the stated promotion: 8 × $0.011 per 1,000 characters = **$0.088**.
- **Voice total: about $0.283 per session during the promotion.**

At the stated regular Turbo rate of $0.04 per 1,000 characters, the same example is **$0.515**. This is an assumption-based illustration, not a charge inferred from the free account. It excludes Luna/model usage, hosting, subscriptions/minimums, and any other services. The present CLI sign-in is a development arrangement, not a production funding model.

Free-tier credits and pay-as-you-go dollar prices are distinct accounting systems. The account's observed Turbo history charges were roughly half a credit per character with per-item rounding; that does not imply a universal dollar value per free credit.
