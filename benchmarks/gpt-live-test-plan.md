# GPT-Live 1 comparison protocol

Status: protocol prepared; this document is not a results report. The quick preview is deliberately delivered before the longer experiments. Existing production voice remains the control until measurements support a change.

## Comparison arms

1. Current app: Scribe v2 Realtime input → Jev intent/retrieval → streamed GPT-5.6 Terra tutor → ElevenLabs v4 Turbo output. Real production `attachLiveVoice`, canonical question bank, hint policy, independent checked grader and board router.
2. GPT-Live 1 client delegation: GPT-Live listens/speaks; the same app-owned tutor, question, hint and mastery machinery handles delegated academic work. This is `/v1/live/sessions`, not the older Realtime API. Log the exact delegate model, resolved voice model, transport, prompt hash and adapter revision.

The GPT-Live layer must not produce substantive academic help before the application authorizes it. Direct acknowledgements are measured separately from a useful tutor response. Images remain in the backend vision path because GPT-Live 1 itself does not accept image input.

## Actual audio latency cohort

Generate each synthetic student clip once, save its hash/format/duration in the report, replay the same PCM to both arms at real-time cadence. Use 16 kHz signed little-endian mono PCM. No microphone, speaker or playback device is used. Drain and record startup speech before the first measured utterance. Open an isolated loopback server so the user's live preview can remain open.

The first policy cohort uses four total fresh sessions (A/B/B/A), three shared utterances per session, with no silent retries and a hard 90-second session lifetime. A whole-run timer closes active sessions and aborts backend requests at eight minutes. The one-utterance smoke retains its 60-second limit. Start with a verified native session before the paired policy cohort and stop at the first fidelity or runtime failure. Report failure denominators. Do not publish p95 as a stable estimate with this sample size. Keep cold connection/startup separate from a warm conversational turn.

Record monotonic timestamps for input speech-energy end, final PCM send, committed user transcript, first assistant text, first received nonempty audio packet, delegation start/end, final assistant transcript and audio-end. The primary audio comparison is estimated speech-energy end → first received PCM. Also show commitment → first PCM and input PCM end → first PCM. A result may be negative when speech overlaps; never clamp that away. Hardware/network playback latency is excluded.

Save every public assistant transcript and delivered board. First PCM can be filler. Report first useful audio only when an aligned transcript or reviewed audio identifies it; otherwise mark it unmeasured. Never compare GPT-Live audio timing with the old synthetic-input first-text median and call that an audio speedup.

## Quality and state matrix

| Scenario | Required observation |
| --- | --- |
| Enter prepared study session | Tutor initiates one canonical practice question without giving its solution. Optional unknown date is asked naturally and a refusal is not repeatedly challenged. |
| Ask for the answer before an attempt | Full solution withheld; one actionable request to attempt the question. No background voice-model answer bypass. |
| Ask what question is active | Exact original givens/task restated without a disguised hint or extra operations. |
| Request help without clicking Hint | No substantive hint. Explain available hint control; hint count does not change. |
| Three hints + cooldown/cap | Only an opaque server permit grants one hint. Duplicate/cooldown/cap requests grant none. Delivered hints count; canceled undelivered hints refund. |
| Wrong / partial / corrected answer | Repair first, no premature solution unlock. Two source-cited independent grade checks; disagreements withhold score. Original attempt and hard mastery rules remain intact. |
| Change problem during delegation | Old audio and board are canceled/suppressed; new canonical question binding wins. Late delegate results cannot revive the prior scene. |
| Interrupt speech mid-response | Measure interrupt → final old audio. New student utterance remains intact. Do not replay old completed backend work. |
| Overlapping speech / backchannel | Brief student acknowledgement does not accidentally create a fresh scored answer; intentional correction interrupts. |
| Equation, geometry, biology, history, code | Inspect native notation, source correctness, layout and board usefulness. Cross-subject fixture coverage avoids an economics-only pass. |
| Screenshot source | Original pixels retained through delegated backend; unreadable image results in clarification, not invention. |
| No visual needed / topic switch | Previous unrelated board hides promptly. Board-only updates add no hidden answer content. |
| Silence and explicit pause | Check-in, then session pause; stop billable voice session/mic. Explicit resume creates a clean generation/session. |
| Reconnect and source replacement | Persist delivered hint exposure for same test/revision/question; no stale question IDs, grading, audio or scenes cross source epochs. |
| Provider failure / expired session | Safe recoverable UI state, bounded cleanup, actual session close. No automatic unbounded paid retry. |

Use existing `tutor-quality-sessions.mjs` virtual 30-minute suite for backend regression, plus a separate real GPT-Live transport cohort for voice behavior. A virtual 30-minute run is state stress, not evidence of 30 minutes of human learning. Semantic grading requires independent source-grounded review; regex presence checks alone cannot establish teaching quality.

## Accounting and reporting

Bound provider requests, session duration and total experiment cost before starting. GPT-Live session minutes and delegated Responses tokens are distinct charges; Eleven STT duration and TTS characters are distinct. Capture session final usage after explicit close. Keep exact reported units separate from published-price estimates and account-wide balance changes. Include failed and canceled billable calls. Never log API secrets, raw imported private materials or private question-bank answers in public UI diagnostics.

A recommendation must separately answer: does it feel faster, does substantive guidance arrive faster, do strict tutoring rules still hold, how does interruption work, what happens to board synchronization, and how much does a realistic quiet 30-minute session cost? A faster acknowledgement is useful but does not by itself establish faster teaching.
