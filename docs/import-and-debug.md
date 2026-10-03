# Import, tutoring, and debug flow

This describes the implementation after the October 2, 2026 changes. Imports do not currently use Jev to check topic relevance.

## When a file is dropped

1. `dropMaterials` in `src/main.jsx` reads the file list and starts one import job for the selected test. Another import for that same test is ignored while it is running.
2. Up to five browser workers prepare files concurrently, checking the 20 MB limit, reading bytes, and calculating a SHA-256 fingerprint. A sixth file waits until a slot opens. Identical previously imported bytes are skipped before extraction. Results are accepted in the original drop order, so duplicate and collection-limit decisions stay deterministic.
3. `src/imports.js` extracts text locally from those already-read bytes. TXT/Markdown use TextDecoder, DOCX uses Mammoth, and PDF uses PDF.js page by page. PDFs are limited to 250 pages. PNG/JPEG/WebP use the screenshot route described below; scanned PDFs without a text layer still fail. Null characters are removed and text is trimmed.
4. A second duplicate check catches normalized TXT/Markdown text and older saved sources without fingerprints. Different PDFs or DOCX files with identical extracted text are retained because their diagrams could differ.
5. The growing source list is validated: at most 100 files and 500,000 extracted characters per test. Invalid files produce individual errors; other valid files continue importing.
6. Accepted sources are saved in browser IndexedDB: database `keyval-store`, object store `keyval`, key `study-board-v2`. The old generated guide and whiteboard are cleared because their source context changed. The particle intake animation starts.
7. If a voice session is active, its source context is updated immediately. Stale speech, generation, planning, and grading are canceled. The new source list is marked `indexing`.
8. The browser cancels any older indexing job and posts the **entire current source list**, not only the new file, to `/api/organize`.
9. The API reuses an exact per-test cached guide if available. Up to 32,000 characters use one direct Luna request. Larger collections split into approximately 18,000-character chunks, batch small chunks, and analyze up to five batches concurrently; queued work starts as soon as a slot opens. Unchanged chunks are cached; verified original excerpts from every chunk feed one final merge after all required analyses finish. New indexing produces only an overview and source-linked topics, without generating questions, answers, or a script. No partial chunk set becomes ready. See [indexing details](indexing.md) for cache limits, cancellation, and excerpt limitations. The browser saves the validated guide, marks the matching source revision `ready`, and tells the active voice session that indexing finished. A stale response cannot unlock a different source revision. On failure, the files remain saved and Library offers Retry.
10. After sending the indexing response, the server schedules the existing private question bank from the indexed topics. An idle worker later fills it with questions and reference answers from the original sources. Bank generation never gates index readiness. It is separate from the public guide and is never sent to the whiteboard as a private answer bank.

### Stored test/source structure

```js
{
  id, title, className, difficulty, date, createdAt,
  materials: [{ id, name, text, type, size, fingerprint }],
  indexStatus: 'empty' | 'indexing' | 'ready' | 'error',
  indexError, indexedAt,
  guide: { overview, topics: [{ title, summary, sourceIds }] },
  whiteboard, whiteboardSelection, whiteboardVisible,
  mastery
}
```

For text, DOCX and PDF sources, the browser stores extracted text and metadata rather than the original binary document. Screenshot sources also retain their original Blob and extraction metadata; originals are available to the model through the server image store. Optional fields appear as the corresponding operation completes. Older saved guides with the complete `questions` and `script` fields remain accepted for compatibility; new imports generate the topic-only shape above.

The source library and guide persist in browser IndexedDB. Server indexing caches are separate RAM-only data: up to 256 entries or approximately two million serialized characters, with a 30-minute idle expiry. The private question bank is also RAM-only, with up to eight entries and a 30-minute idle expiry by default. Server restart clears these caches and bank entries, not the browser's saved source text and guide.

### Indexing request and result

```js
// POST /api/organize
{ testId, title, materials: [{ id, name, text }] }

// Successful response
{ mode: 'live', guide: {
  overview,
  topics: [{ title, summary, sourceIds }]
} }
```

The organizer returns a concise overview and topics; validation permits 1–12 topics. Every reference must match a supplied source ID. Academic study requires readable material and successful indexing of the current source list, not a completed private question bank. The exam deadline is optional planning information. Setup conversation is allowed earlier.

The final topic-only catalog benchmark indexed 25,681 original extracted characters from three game-theory PDFs in 3.517–4.961 seconds across three cold trials, with a 4.461-second median. Each retained all original text in one Luna request; cached repeats used no provider calls. These are server indexing times after extraction, not a universal drag-to-ready guarantee. [Current measurements, preserved failures and limits](indexing.md).

### How sources are retrieved

Library search remains a case-insensitive substring match over each source's filename and extracted text. For the OpenAI live tutor, a session-local passage index now replaces the complete source dump on each turn. Source text is split into deterministic approximately 2,000-character passages with exact source IDs and offsets. A local lexical shortlist supplies up to 20 passage previews to Jev; Jev selects useful evidence in parallel with student-intent classification. The tutor normally receives up to 16,000 original passage characters, neighboring context when space permits, a compact source catalog, and explicit coverage/revision metadata. Active-question sources are prioritized. Jev selects original passages; it does not write a replacement summary.

If the selection is uncertain, bounded original passages matching the current query join pinned and prior working evidence, and the context stays explicitly unresolved. Luna can use only `search_materials` and `read_materials` before speaking, with at most two retrieval rounds and five total tool calls. Search is lexical; reads use exact chunk IDs and reject stale revisions. Original full sources remain on the server for checked grading, question preparation, and whiteboard recovery. The CLI compatibility transport still receives full sources. This is bounded passage retrieval, not a vector database. The complete existing question roster remains available; reference answers for unattempted questions are now masked by the hint policy. See [the exact tutor context](tutor-context.md).

The generated topics describe the combined test material rather than assigning a category or relevance decision to each file. Retrieval does not change import acceptance, indexing readiness, or question preparation's background scheduling.

## Screenshot imports and authoritative pixels

PNG, JPEG and WebP files can be dragged, picked or pasted into the active test. Pasting into a text input is left alone. Files pass MIME/signature, dimension and full native decode checks; animated images are rejected. Limits are 20 MB per image, 24 million pixels and 16,384 pixels per side. At most five import workers run at once. Same-batch duplicate images share a single read; successful extraction is cached per test and byte hash.

The browser posts raw bytes to `POST /api/material-images?testId=UUID&name=filename`. Original files and metadata live in `data/material-images/<testId>/`, with restricted local filesystem permissions. Their source ID is immutable `img-<SHA-256>`. These are private server files, not static URLs; both development and production deny direct `/data` and Vite absolute-file access. IndexedDB retains the original Blob for source preview, derived text and dimensions. Deleting a source from a test removes it from active context; automatic garbage collection of old server images is not implemented.

GPT-6 Luna reads visible text and visual structure without solving the material. Its derived notes are labeled fallible. Indexing receives those notes together with the original image to discover topics; the derived notes are not authoritative academic evidence. Selected image sources attach their original pixels to the main tutor request and to subsequent local retrieval results. The background question bank and both independent graders receive original pixels, too. Typed `image:<sourceId>` citations bind a grade to that exact image; missing or mismatched originals fail closed. A summary cannot silently replace missing pixels.

A source-ready event now makes the tutor continue automatically when it is free to speak. Readiness does not wait for background questions, a date, or another student utterance. Original-image work is recorded as `image-extract` in the existing per-test Thinking/LLM usage category.

## Dynamic whiteboard

The current retained-scene architecture and measured comparisons are documented in [the teaching-quality report](tutor-quality-report.md). On a committed student transcript, the existing Jev intent call can also identify an obsolete visible board. A confident close applies immediately, independently of source prefetch. Current turn, source, board revision and manual visibility guards must match; confirmed help/answer attempts veto closing. The saved scene remains available to reopen. `LUNA_EARLY_BOARD_HIDE=off` restores the previous timing.

The tutor receives original source passages, conversation, readiness, public board state, and applicable private teaching context. It generates `<say>spoken text</say>`, canonical scored questions via `<ask>question-id</ask>`, and, when useful, `<board>{validated JSON}</board>`. The server resolves a valid offered question ID to exact public wording for TTS and captions. Speech streams separately and does not wait for visual routing.

The live board displays useful teaching text, LaTeX, matrices up to 12×12, legacy diagrams, and retained scenes with freely positioned text/math/shapes/arrows. A duplicated spoken question alone does not open the board; useful text-only candidates pass the contextual Jev decision. Compact matrix dimensions expand to canonical cells, with omitted values left blank. Updates patch stable block/object IDs for the same problem; `mode: "replace"` starts a new problem, and explicit removals delete content. The live board is read-only: clicking, selection, pan and zoom controls are disabled. Sparse updates and hide/reopen preserve the board itself. New flow, plot and annotation blocks delegate connector layout, numerical axes and exact phrase placement to the trusted renderer. Only validated public content is rendered. The tutor proactively supplies useful process, comparison, equation, annotation, and diagram visuals instead of waiting for an explicit drawing request.

Jev sees the completed public reply, proposed visible board text, recent public dialogue, and an allowlisted summary of the existing scene. It does not receive source documents, private question banks, or grading records. A valid structured visual opens during study even if Jev underpredicts usefulness from the short spoken cue. A separate contextual decision reopens a hidden saved scene when the current turn needs that same problem. Another decision forces replacement when a new visual belongs to a different concrete problem, even if Luna mistakenly emitted a patch. An unrelated visible scene closes on a concrete problem/topic switch, including when the new problem needs a visual but none has arrived yet. Same-problem hints and logistics do not imply completion.

If Jev requests a visual, no usable board was generated, and no matching scene has reopened, one silent Luna recovery request attempts to draw the already established problem from original sources. An invalid/incomplete model drawing also triggers one repair even if the short spoken cue was classified as verbal. It has a 12-second deadline, does not generate extra speech, receives no private question bank, and cannot recursively retry. If grounding is insufficient it leaves the board closed and logs that outcome. This recovery can add latency and an extra model request; it is separately metered as `whiteboard-recovery`. Stale decisions or drawings cannot override a newer turn, source set, or manual visibility action. Fully validated complete JSON that only lacks the closing board tag is accepted at provider completion with a logged `missing-close-tag` repair; truncated or malformed JSON is never guessed into shape.

[Six simulated voice conversations](whiteboard-verification.md) cover opening, same-problem hints, switching away, replacement, saved-scene reopening, and interruption, using real Luna/Jev and simulated ElevenLabs.

## Model transport

With `LUNA_ORGANIZER=openai-api`, `LUNA_TUTOR_MODEL=gpt-5.6-terra`, `LUNA_API_MODEL=gpt-6-luna`, and server-side API access enabled, live tutoring uses Terra through the OpenAI Responses API stream. Indexing, question preparation, session review, optional voice planning, and separate visual recovery use the background `LUNA_API_MODEL`. The two independent grading checks use `LUNA_GRADING_MODEL`, defaulting to `gpt-5.6-terra`; this selection is separate from the speaking tutor and source-preparation models. Main tutor output can still contain visual JSON; only a separate rendering request uses the background model. If `LUNA_TUTOR_MODEL` is omitted or empty, the main tutor inherits `LUNA_API_MODEL`, which defaults to `gpt-6-luna`. The API key remains in the local `.env` (mode 0600, ignored by Git), never in frontend code. `store:false` is set on these requests. ElevenLabs remains responsible for transcription and speech; Jev remains the classifier.

## Per-test debugging

The small dollar icon in a test opens **Spend** and **Activity**, only in development mode. These local same-origin POST routes serve the panel:

- `/api/debug/usage`: `{testId}` returns Jev, Thinking / LLM, and Voice request counts, observed usage units and coverage, status counts, explicit estimates with rate provenance, separately reported billed charges, unattributed requests, and storage status.
- `/api/debug/activity`: `{testId}` returns the retained timestamped event timeline.
- `/api/debug/event`: accepts only allowlisted browser import/indexing events and labels them client-reported.

`data/usage-ledger.json` persists attempted provider operations, including failures and cancellations, with provider-returned token counts or measured submitted text/PCM duration. Cache reads and writes are disjoint input-token subsets; reasoning is already included in output tokens. TTS counts confirmed sends and received valid PCM; STT counts confirmed submitted PCM. None proves playback or the provider's final billed amount. Missing counters remain unknown, interrupted measurements can be partial, and requests without a test ID remain separately unattributed rather than disappearing or being assigned to the selected test.

Spend separates **list-price estimates** from **provider-reported billed charges**. Estimates use measured usage and the recorded model/service tier, with explicit assumptions and partial-coverage flags. Unknown models or required counters remain unestimated; Codex plan usage is never priced as OpenAI API usage. Rates were verified on **October 2, 2026** against [OpenAI Terra pricing](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [OpenAI Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), [OpenAI cache accounting](https://developers.openai.com/api/docs/guides/prompt-caching), [TypeSafe Jev pricing](https://docs.typesafe.ai/models), and [ElevenLabs API pricing](https://elevenlabs.io/pricing/api). Each estimate exposes its source and verification date. Eleven v4/v4 Turbo promotional rates are restricted to requests dated October 2–11 UTC; later requests remain unestimated pending re-verification. Scribe uses [audio sent for transcription](https://elevenlabs.io/docs/overview/capabilities/speech-to-text), with no invented duration minimum. Estimates exclude account allowances, credits, negotiated discounts, taxes, unreported usage, and unverified rounding or add-ons. Missing billed amounts stay unavailable even when an estimate exists.

Ledger writes are coalesced and atomic, with automatic retries after transient write failures. Storage status exposes unsaved changes or persistence errors; unreadable existing files are preserved. Interrupted requests retain the counters received before interruption, which may omit provider work that was never reported. Tracking begins with the recorded start time: earlier usage and costs cannot be reconstructed from old transcripts.

`tutor.context-built` records source/retrieved/context/bank character counts, recent/older turn counts, and the source revision. Retrieval events record selection status, source IDs, passage counts, lookup operation, and latency without storing original excerpts. Each additional Responses continuation is separately metered as `tutor-retrieval`; Jev prefetch is `material-prefetch`.

`grading.eligibility` records the working question ID, canonical-prompt state, current-problem relationship, normalized attempt/help/deadline decisions, attempt probability and threshold, and the reason a response was queued or skipped. Asking the tutor to check a submitted answer does not discard that attempt. A narrow scaffold does not itself replace the canonical target. Uncertain submissions require two agreeing target-attempt judgments before they consume an attempt; semantic judgments can still err. These records explain routing; the separate independent grades still decide whether evidence supports any credit.

`data/diagnostics.json` records import outcomes, indexing request IDs, source counts, setup gates, model/transport, first-text and first-audio timing, completed public replies, validated boards, Jev usefulness/close/reopen/replace scores, show/hide/reopen outcomes, visual recovery attempts, and superseded decisions. Rejected board output is classified as invalid/incomplete without retaining its raw contents. Events correlate by test, session, and turn. It keeps at most 500 events per test and 4,000 overall, explicitly reporting truncation. Storage errors are returned by the endpoint and existing corrupt files are preserved. Writes are coalesced, not performed synchronously in the audio path.

Existing public transcripts and source-grounded session memories remain in `data/session-history.json`. Diagnostics do not include credentials, raw source documents, microphone recordings, private question-bank answers, or hidden model reasoning. Events distinguish generated/transmitted audio from actual playback. New logging starts with this update; missing old routing decisions cannot be inferred from the old transcript alone.


### Current-event and transition diagnostics

The server records `hint.requested` (accepted or denied reason and future allowance), `hint.delivered` (first exposed text/audio), and the current `taskKind`/`encounteredCount` in tutor context measurements. An opaque Hint permit is never logged. `grading.eligibility` retains `provisional` alongside the attempt threshold, normalized intent and current question ID.

Whiteboard decisions retain `candidateMatchesQuestion`, `candidateMatchProbability` and `continuesWorkingProblem`, including an explicit unknown (`null`) judgment. A canonical target switch is distinguished from a same-problem patch. These are public control decisions and source-independent identifiers, not private model reasoning or document bodies.


Assistance checks now attach bounded public evidence to `grading.check`: the resolved assistant-turn citation IDs, whether help was alleged, and up to four original assistant excerpts with their history indexes. The diagnostics store caps each excerpt at 600 characters and rejects client-supplied versions of these fields. These are public tutoring statements or shown-board content; source documents, private reference answers and hidden model reasoning are excluded. An assistance claim can therefore be traced to what was actually said or displayed before the answer.

Checked partial credit does not authorize a full worked solution or expose the private reference answer. Requested review is available after a checked correct or incorrect target answer. Delivered Hint exposure follows the normalized target across regenerated IDs within the same test/source revision; the shared 24-hour/512-question process-local cache does not survive server restart.
