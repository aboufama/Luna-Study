# Luna Study

A local proof of concept for studying through conversation. The monochrome board starts empty with a book illustration rendered through ordered dithering on a browser canvas; each test has its own material, date, and voice session. This app is separate from the CUPI website.

The current local configuration uses **GPT-5.6 Terra through the OpenAI Responses API** for the main tutor and **GPT-6 Luna** for source preparation and visual recovery. `LUNA_TUTOR_MODEL` selects the tutor, defaulting to `LUNA_API_MODEL`; `LUNA_GRADING_MODEL` independently selects the two graders and defaults to **GPT-5.6 Terra**. `LUNA_API_MODEL` selects indexing, question preparation, planning, and rendering. See [the current quality report and measured failures](docs/tutor-quality-report.md) and [the exact import, whiteboard, and debug flow](docs/import-and-debug.md). In development, the small dollar icon inside each test opens measured provider usage, explicitly labeled price estimates, separately reported billed charges, and an activity timeline. Missing costs are never displayed as zero.

## Use it

Open [Luna Study on localhost](http://127.0.0.1:5188/).

1. Press the **plus** button, enter the class in the **Class** box, and select **Quiz**, **Test**, or **Final** on the difficulty slider. There is no date field; the voice conversation asks when your test is and saves your answer.
2. Press **Create**. The test opens directly into the voice circle and requests microphone permission. Opening an existing test also starts this connection. Once connected, Luna speaks a greeting, uses any saved exam deadline without another confirmation, and invites your material when needed.
3. Drag PDF, DOCX, TXT, Markdown, PNG, JPEG, or WebP files onto the study screen, or use the **plus** control. Screenshots can also be pasted into the active test. Material is read and indexed automatically in the background. You can keep talking while indexing runs.
4. Open **Library** to search the extracted text, inspect a source, remove files, see topic summaries, or retry failed indexing. New material is also sent to an active voice session immediately; a completed guide is not required for conversation.
5. Once the current readable sources have finished indexing, talk naturally with Luna. There is no source-completeness confirmation before a session. Ask a question, request practice, or say you need a moment; Luna receives the full conversational turn. The circle responds to voice activity. Assistant subtitles follow spoken playback and can be hidden with the captions control; your own spoken transcript is never displayed. You can interrupt a spoken reply.
6. The circle or microphone control stops the current session; press again to reconnect. Going back to the test board or opening another test closes the current microphone and speech connections. Sessions have a 60-minute cap. After 60 seconds of quiet Luna checks in, then pauses after another 30 seconds without activity. Resume restarts the microphone and keeps the current problem. The Hint button permits three hints per question with a 45-second cooldown; the Practice sidebar shows current and recent problems.

Creating or opening a test is the action that starts microphone setup; the browser still requires permission. If permission or provider access is unavailable, the test and Library remain usable. An empty-material conversation handles test setup only, without inventing study facts. Luna can capture a clearly spoken date such as “tomorrow,” “in two weeks,” “next Monday,” or “October 15.” Relative dates use the browser's local day. Ambiguous dates require clarification.

Only readable source material and successful indexing of the current source list gate study. The session date comes from the clock automatically; the optional exam deadline is separate planning metadata. An unambiguous exam deadline is saved immediately, without an additional confirmation. A ready first or returning session can begin studying even when the exam deadline is unknown. Normal conversation goes directly to Luna, without matching confirmation phrases or asking whether the uploaded source count is enough. Material changes require indexing the new source list; date changes do not restart onboarding. Failed indexing must be retried, and a late indexing result for an older source list cannot unlock the current list.

**The Google avatar in the top-right corner is a logged-in visual preview.** Its account menu labels it as a preview and explains that sign-in is not connected. There is no Google OAuth, cloud account, or cloud sync in this prototype.

## Course artwork

The [course collection](http://127.0.0.1:5188/course-mosaics) contains twelve animated, subject-shaped mosaics: mathematics, physics, chemistry, biology, computer science, astronomy, economics, history, literature, psychology, music theory, and environmental science. They reuse Luna’s hand-cut stone material, with separate silhouettes and restrained mineral pigments. The gallery includes a graphite palette, a motion pause, keyboard-accessible details, and PNG/SVG downloads. Reduced-motion preferences are respected throughout.

When a test receives a name, `POST /api/course-mosaic` asks Jev to choose its artwork from these twelve identities. Only the normalized name is sent to TypeSafe. Classification runs alongside test creation and voice setup, and the result is saved with the test in IndexedDB. Existing unclassified tests are processed three at a time. A changed name invalidates an old choice; late replies cannot overwrite the new name. An unavailable classifier keeps a neutral study-page mosaic and saves a 15-minute retry cooldown. The TypeSafe key remains on the server.

The compact test cards show small previews of imported document text and, when available, the public mastery percentage for indexed topics. This percentage does not certify whole-course coverage. Opening a test uses a brief view transition without waiting to start microphone setup.

Final transparent PNGs, editable SVGs, a contact sheet, and metadata live in `public/course-mosaics/`. Regenerate them with `node scripts/export-course-mosaics.mjs` while the development app is running. Run `node --test tests/course-assignment.test.mjs tests/jev-course.test.mjs tests/server.test.mjs` for classification and persistence guards, and `node tests/course-mosaics-browser.mjs` for isolated browser checks with mocked providers and media devices.

## How it works

- **Browser:** React provides the board, difficulty slider, voice canvas, subtitles, and Library. PDF and DOCX text extraction happens locally. PNG/JPEG/WebP screenshots use Luna vision with original pixels retained. Scanned PDFs without a text layer still require an unsupported OCR step.
- **Automatic indexing:** Every indexing job calls the actual `/api/organize` route. In the configured CLI mode, the local server sends extracted material to the selected Luna model, which returns a validated source-linked guide. The Library shows its topics. There is no local demo-indexing fallback: if configuration or generation fails, imported files remain saved and the Library shows the error with **Retry**. The new flow does not have a separate manual Organize button or practice page.
- **Live input:** Microphone PCM streams through the local server to ElevenLabs Scribe v2 Realtime. The default silence threshold is 0.5 seconds.
- **Live replies:** Luna streams replies through the configured OpenAI or Codex transport while the ElevenLabs speech connection opens concurrently. Greetings and setup replies are model-authored; technical import/index updates change context silently. Jev classifies student intent in public conversation before an answer is reserved for grading or an exam deadline is saved. Help requests are not detected through keywords. Unknown or unavailable intent classification preserves dates and scoring state while conversation continues; it does not use a local intent fallback.
- **Whiteboard:** The tutor streams spoken text separately from validated board data. The read-only board supports text and KaTeX, matrices, retained spatial scenes, computed process/decision flows, numerical plots and exact nested text annotations. Same-problem updates retain stable objects; a new problem replaces or hides the old board. Jev decides relevance and problem continuity alongside existing routing. Clicking/selecting, pan and zoom are disabled; the centered close button remains. Only safe public blocks reach the browser, never private question-bank answers. See the [actual-output lab](http://127.0.0.1:5188/quality-demo.html) in development.
- **Practice and mastery:** A private question bank prepares source-bound practice in the background. Only answers to an actually asked, tracked question can affect progress. The top-left arc shows overall progress; the tutor can announce a newly mastered topic naturally.
- **Source updates:** Replacing or removing material cancels stale speech, generation, and planning, and refreshes the voice session's source context. Repeated identical material snapshots do not trigger repeated acknowledgments.
- **Session continuity:** The server retains public conversation text, displayed board text, practice events, and timing summaries. A later session warms recent reviewed context without delaying listening setup. A returning greeting can recall the previous topic and neutrally invite the next conversation; no session-completeness confirmation is required.
- **Interruptions:** Speaking over a reply clears queued audio and cancels the pending turn. Audio buffers are held in memory. The app does not create recording files.

The page runs locally, but live inference uses external providers. Automatic indexing sends extracted text and original screenshot pixels through the configured OpenAI connection. Live conversation sends audio to ElevenLabs for transcription, source material and conversation to Luna, and reply text to ElevenLabs for speech. Provider retention follows account settings.

## Local storage

The new board uses the IndexedDB key **`study-board-v2`** through `idb-keyval`. It begins with no sample tests. Earlier prototype data under other keys is left intact; it is neither migrated into the new board nor deleted. This is a new application storage key, not a browser database schema upgrade.

Saved test details, extracted source text, topic guides, and indexing status remain in this browser on this device. Original screenshots are saved as browser Blobs and in the test-scoped private server image store. Original PDF/DOCX/text binaries and live conversation audio are not saved. An interrupted indexing job becomes retryable when the app is reopened. Clearing browser data removes saved local work. There is no backup or multi-user account system.

Checked mastery events are stored separately in the ignored server file `data/mastery.json`, keyed by the browser's test ID. Atomic writes retain scores, canonical question hashes, attempt deduplication, and pending spoken mastery notices. This ledger does not contain source text, question answers, student transcripts, or audio. Clearing browser data does not delete the server ledger.

The separate ignored `data/session-history.json` stores completed sessions, bounded public transcripts and displayed board text, problem events, and evidence-linked review notes. Sessions are retained; oversized transcripts or event lists record explicit omission counters. After a session ends, an optional background Luna review produces notes grounded in quoted transcript evidence. Recent context is private to the tutor and cannot supply academic facts in place of the current sources. Duration metrics distinguish received input audio, estimated speaking time from PCM energy, and generated assistant audio; they do not prove what played through the speaker. No raw audio or hidden question-bank reference answers are stored. Deleting browser data also leaves this server history intact.

Scoring is fixed: a checked correct answer adds 10, 20, or 30 points for easy, medium, or hard questions; partial adds 3 and incorrect subtracts 5. Scores stay between 0 and 90 until three distinct hard questions are answered correctly on their first attempt without help, which marks the topic mastered at 100. Mastery remains earned. Overall progress is the rounded mean of all current indexed topics, including unanswered topics at zero. Changing sources can change that topic set.

A full arc means the current indexed topics have been mastered, not that the uploads cover the entire course or test. Once every current topic is mastered, Luna is instructed to naturally review whether any course material remains before suggesting the whole study task is finished. This is an end-of-study scope discussion, not a confirmation gate on each session. Topic mastery is preserved; the prototype does not maintain a verified whole-course completion flag or certify full-course coverage.

Grading uses two independent structured GPT-5.6 Terra reviews by default, selected by `LUNA_GRADING_MODEL`, outside the spoken response path. They must agree, cite exact excerpts from the student's answer and the question's sources, and judge reasoning sufficient for a correct answer. Displayed whiteboard hints are included in their context; an assisted verdict must cite eligible public assistant excerpts. Neutral repeats of a question do not count as help. Unclear, disputed, unsupported, or failed reviews do not update scores. The scoring rules are deterministic; model judgments remain fallible, so this is practice feedback rather than a validated assessment.

## Configuration

Run `npm install` and configure the ignored server-side `.env`. The current API configuration uses:

```dotenv
LUNA_ORGANIZER=openai-api
LUNA_API_MODEL=gpt-6-luna
LUNA_TUTOR_MODEL=gpt-5.6-terra
LUNA_GRADING_MODEL=gpt-5.6-terra
OPENAI_API_KEY=your_key
TYPESAFE_API_KEY=your_key
LUNA_VOICE_TRANSPORT=stream
LUNA_VAD_SILENCE_SECONDS=0.5
LUNA_VOICE_PLANNER=false
LIVE_APIS=true
ELEVENLABS_API_KEY=your_key
ELEVENLABS_REALTIME_MODEL_ID=eleven_v4_turbo
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
PORT=5188
```

Run `npm run dev`. Restart after changing provider configuration. The server binds to loopback and checks the requesting origin. Provider keys remain server-side. A signed-in Codex CLI transport remains available for compatibility through `LUNA_ORGANIZER=codex-cli` and `LUNA_CLI_MODEL`; original-image input requires the API path.

CLI work uses isolated temporary directories, ephemeral conversations, disabled tools, and time limits. Guide generation uses a JSON schema; the fast spoken-response path separates speech from validated board data. Optional high-effort planning is disabled by default. Setting `LUNA_VOICE_TRANSPORT=exec` restores the complete-reply transport for comparison. `TYPESAFE_API_KEY` enables Jev visual routing; without it, a bounded local rule chooses visual responses.

`TYPESAFE_API_KEY` also enables student-intent classification and semantic acknowledgment of mastery milestones. These nonvisual decisions require Jev: missing credentials, uncertainty, or outages leave them unknown, without keyword fallbacks. A public academic answer containing words such as “help” or “explain” is evaluated in context. Intent and board-continuity classification send only bounded public conversation, the public working question and board context, never source files, private reference answers or grading records. The separate retrieval selector receives bounded original passage previews. Deadline intent must be confirmed before calendar parsing; an unsupported date format is returned to Luna for clarification without blocking study. Mastery announcements are acknowledged only after speech completes and Jev recognizes the announcement.

Without provider configuration, local file reading, storage, search, and source previews remain available; indexing reports the configuration error and can be retried. Live voice requires the configured OpenAI or compatible CLI tutor connection and ElevenLabs. API mode supports tutoring, indexing, screenshot reading, question preparation, grading and visual recovery. Google sign-in is unrelated to these provider connections and is not implemented.

## Usage and limits

Live calls use the configured account allowances. A free provider plan does not imply unlimited or cost-free API access; check current pricing and the account's remaining allowance before extended sessions. Luna CLI calls use the ChatGPT/Codex plan allowance.

The local usage ledger retains attempted requests, including failures and interruptions. Estimates apply verified public API rates to recorded tokens, submitted characters, or sent audio duration; they exclude account allowances, credits, discounts, taxes, and unreported usage. Partial measurements are marked, and unmatched requests remain separately unattributed. Signed-in Codex usage is not assigned an API price. Neither an estimate nor generated audio proves a billed charge or playback.

Rates were verified on **October 2, 2026** against the official sources below. Eleven v4/v4 Turbo promotional estimates apply only to recorded requests from October 2 through October 11 UTC; requests from October 12 onward remain unestimated until rates are verified again. Historical eligible requests retain their promotional estimate.

- [GPT-5.6 Terra pricing](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [GPT-6 Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), and [cache accounting](https://developers.openai.com/api/docs/guides/prompt-caching)
- [TypeSafe Jev pricing](https://docs.typesafe.ai/models)
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- [Realtime dialogue documentation](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd)
- [Realtime transcription documentation](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime)

`data/usage-ledger.json` uses coalesced atomic writes and automatically retries transient write failures. Storage trouble is reported; unreadable existing files are preserved. Usage before tracking began cannot be reconstructed, and a crash or interruption can leave usage unreported even when a provider incurred work.

Import limits are 100 files per test, 20 MB per file, 500,000 extracted characters per test, and 250 pages per PDF. Text reading order and equation quality depend on the source. Empty source lists are permitted for voice onboarding only; guide-generation routes still require readable material. Only one live session runs at a time.

## Existing latency measurements

The saved [combined pipeline benchmark](benchmarks/voice-pipeline-results.json) exercised the actual local WebSocket server with a short synthetic question, real Scribe, Luna, and ElevenLabs calls. The same generated PCM clip was reused. Returned speech bytes were counted and discarded: there was no physical microphone, speaker playback, or saved audio.

| Configuration | End of input PCM to first returned audio, two trials | Mean |
| --- | --- | --- |
| Exec transport, 1.0-second VAD | 5.375 s; 5.674 s | 5.524 s |
| Stream transport, 0.5-second VAD | 5.047 s; 3.431 s | 4.239 s |

This small sample observed a 1.285-second, or 23.3%, reduction. All four transcriptions matched the question, and the saved replies correctly contrasted active and passive transport. It does not establish production latency percentiles or physical microphone-to-speaker latency. The baseline used the shared TTS module with exec/VAD 1.0, not a historical application checkout. These measurements predate the new automatic onboarding greeting.

The separate [Scribe benchmark](benchmarks/stt-latency-results.json) measured mean PCM-end-to-commit delays of 1.064 seconds at 1.0-second VAD and 0.707 seconds at 0.5-second VAD, with exact transcriptions in all four trials. Natural pauses and noisy rooms were not tested.

The later [speech-flush experiment](benchmarks/latency-iteration-notes.md) replayed the same visual reply stream with real speech synthesis. Flushing at `</say>` reduced median first returned PCM from 4.370 to 2.752 seconds across two trials per condition. Board completion still took 4.218 seconds. This isolated measurement excludes transcription, Jev, browser scheduling, and physical playback. More aggressive chunk sizes remain experimental.

## Verification

The onboarding, mastery, and voice integration have 36 passing unit/mock checks covering readiness, dates, private question-bank isolation, fixed scoring, independent grading checks, persistence, source replacement, stale-turn cancellation, visual routing, persistent board objects, validated selection, displayed hints, early speech flushing, private session memory, optional planning, and cleanup. These checks use mocked providers and do not capture or play audio. No live provider, microphone, or playback tests were run for these backend checks.

Run `npm run check` for unit/mock checks and a production build. `node tests/browser.mjs` separately exercises the current interface in a headless browser with fake media devices and intercepted provider routes. It covers uploads, indexing, date storage, hidden transcripts, persistent read-only scenes, absence of pointer/keyboard selection packets, removed headings/tools, and mobile layout. Production serving uses `npm run build` followed by `npm start`; development uses `npm run dev`. The saved live-provider latency benchmarks are separate scripts and incur provider usage when explicitly rerun.
