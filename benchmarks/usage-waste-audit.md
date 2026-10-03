# Avoidable usage audit — October 2, 2026

**The logs identify 118 credits spent on greetings immediately after reopening the same test. Of that, 50 credits repeated exactly the same greeting. Background or idle transcription waste cannot be reconstructed exactly from the historical logs.** It would be inaccurate to label the entire 2,728-credit transcription bill as waste.

This audit made one read-only [history API](https://elevenlabs.io/docs/api-reference/history/list) request and inspected existing session counters. It generated no speech, transcriptions, model answers, or audio. No private transcript is reproduced here. The history response still contained 171 items and no further page; eight recent failed sessions had added no matching billed speech entries.

## Greeting costs that can be isolated

The local session-start markers were matched to billed provider history by time and text. All times below are UTC.

| Event | Previous session ended → reopened | Gap | Billed greeting credits | Interpretation |
| --- | --- | ---: | ---: | --- |
| Rapid reopen 1 | 04:30:49.633 → 04:30:50.709 | 1.076 s | 68 | Another automatic welcome/setup message for the same test. Its wording changed, so this is not an exact duplicate. |
| Rapid reopen 2 | 04:43:04.529 → 04:43:05.629 | 1.100 s | 50 | Exact 100-character greeting repeated about 54 seconds after the prior greeting. |
| **Rapid-reopen total** | | | **118** | A concrete target for a short same-test greeting cooldown. |

Against the previously audited 9,991 used credits:

- **50 credits, or 0.50%,** are confirmed repeated identical greeting text.
- **118 credits, or 1.18%,** are the broader rapid-reopen greeting cost that could have been avoided by resuming silently.

These are observed charges. Calling every one unwanted is still a product judgment, but a one-second reopen has no need for another full greeting to maintain the active study context.

The four sessions that actually generated assistant audio had 223 credits of initial greetings in total. The other 105 credits were initial or substantially later session greetings; this audit does not call them waste.

Eight subsequent failed sessions each recorded an intended 100-character greeting in local history but generated zero PCM and had **no matching billed speech history item**. Do not charge those eight transcript records again in the retrospective calculation. An intended/final transcript alone is not proof of synthesis or billing.

## Listening time: what is measured and what is not

The current local history covers twelve sessions beginning at 04:29:47 UTC. Its audio counters total:

| Counter | Time |
| --- | ---: |
| Received microphone PCM | 313.2 s, or 5.22 min |
| Frames above the recorded RMS threshold | 31.6 s |
| Remaining low-energy frames | 281.6 s, or 4.69 min |
| Generated assistant PCM | 93.17 s |

About **89.9% of the received microphone audio was below the RMS threshold**. This does **not** establish that 89.9% of the call was waste:

- RMS is an energy estimate, not validated speech recognition. Quiet speech can fall below it; other audio can exceed it.
- Pauses, thinking, and listening to the tutor are normal parts of an intentional live conversation.
- The old records contain no document-visibility, window-focus, user-idle, pause-reason, or playback-completion events.
- The 93.17 seconds of generated tutor audio cannot simply be subtracted: the log does not establish precisely when it was heard or whether its intervals overlap every low-energy microphone interval.
- Earlier activity is outside local session-history coverage. The full provider period reports 35.2127 Scribe minutes and 2,728 credits; these twelve sessions cover only about 5.22 minutes of received PCM.

A deliberately generous scenario illustrates the scale, but is **not a measured loss**: if all 4.69 minutes of low-energy audio could have been removed, and billing followed the account-wide observed average of 77.47 credits per minute, that would correspond to about **364 credits**. Normal conversational pauses make that an unrealistic complete saving, and provider billing-duration rules and rounding may differ. It is not a defensible exact upper bound on background-tab waste.

The only unconditional account-level ceiling is the entire 2,728-credit Scribe bill, and that includes useful transcription and eight known synthetic benchmark streams. It is far too broad to present as an estimate of avoidable waste.

## Controls that address the demonstrated risks

The parent task is implementing these controls separately; this document is an audit, not evidence that the controls have already passed tests:

1. Close the paid listening and speaking transports when a study tab becomes hidden or when the inactivity timeout fires. Muting playback or merely stopping microphone uploads is insufficient if a provider connection remains open.
2. Require an explicit user action to resume a paused session; avoid reopening paid streams automatically after visibility changes or errors.
3. Apply a short cooldown to a same-test quick reopen so it resumes without resynthesizing the full greeting. Do not suppress necessary announcements when the setup or sources have genuinely changed.
4. Bound provider benchmarks with explicit request/credit budgets and stop immediately on quota failures. Repeated failed greeting attempts should not trigger endless reconnects.
5. Persist pause reason, start/stop timestamps, tab visibility at pause, and cumulative received/generated audio counters. This will make future background-versus-intentional-use audits possible without recording more raw audio.

No historical log can guarantee that every silent interval was unnecessary. The prevention goal is to stop paid work when the app is clearly inactive and prevent duplicate setup work, while preserving intentional pauses, the full model context, reasoning, and normal speech behavior.

## Relationship to the previous audit

The approximately **24% recorded latency-benchmark share** and **35% including earlier prototype/demo speech** in [the credit audit](credit-audit.md) are separate classifications. Those tests were real billed provider calls, but their authorized experimental cost should not be silently relabeled as background-tab waste. Likewise, the 118-credit quick-reopen figure must not be added to the prior report's account total a second time: it is a subset of already-accounted app speech.
