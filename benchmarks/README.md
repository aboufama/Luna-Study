# Luna voice latency experiments

Measured October 1, 2026 in New York (October 2 UTC), using the already signed-in Codex CLI and `gpt-5.6-luna`. Every request used synthetic study notes. No microphone, speakers, browser playback, or saved audio was used. Provider credentials remained in the existing environment; CLI authentication was not copied or changed.

These are bounded exploratory samples, not a production percentile benchmark. Network/provider variation is substantial. Changing several stages together cannot establish each stage's independent contribution.

## Results and chosen settings

| Experiment | Observed result | Decision |
| --- | --- | --- |
| Actual loopback speech pipeline, final input PCM to first returned audio | Exec + 1.0s VAD: 5.37s, 5.67s. Streaming + 0.5s VAD: 5.05s, 3.43s. Mean approximately 5.52s to 4.24s, 23% lower in these four trials. | Use streaming, preopen TTS while thinking, and 0.5s VAD. This excludes physical recording/playback latency. |
| Scribe VAD alone, same synthesized phrase | 1.0s setting mean commit delay 1064ms; 0.5s setting 707ms after final PCM. All four transcripts matched. | 0.5s is supported by this limited test; natural pauses and noisy rooms remain untested. |
| Eleven v4 Turbo TTS alone | First received audio 123–164ms after sending text; opening socket approximately 98–106ms. | Open TTS concurrently with text generation; model generation is the larger delay. |
| Exec text baseline, `low` | First available complete message 3080/2664ms; subprocess completion 4231/3046ms. JSONL did not expose text deltas. | Keep exec for structured guides; use app-server text deltas for live voice. |
| Persistent app-server, fresh ephemeral thread per response, `low` | First delta 2946/2805/2314ms; first sentence 3113/3037/2498ms; completion 3270/3231/2585ms. Startup 474ms, which can overlap STT startup. | Default text path. Stream complete sentences to TTS without waiting for process exit. |
| Single `none` effort probe | Request accepted; first delta 2597ms, completion 2882ms, correct reply. Local model catalog lists `low` as its minimum. | Keep `low`. Acceptance does not prove that internal reasoning was disabled, and one sample did not establish a speed advantage. Production adapter continues to validate catalog-supported effort values. |
| Concurrent `low` voice and `high` planner, two pairs | Standalone voice first deltas 2119/3573ms; concurrent voice 1900/3013ms. Planner summaries completed 4322/2976ms. | Optional event-driven planner only. No demonstrated content or latency benefit; never await it on the voice response path or run an endless loop. |
| Reused ephemeral thread, three turns | Fresh thread first deltas 3853/1903/3077ms. Reuse first turn 2101ms, later turns 4976/1102ms. Warm means: fresh 2490ms, reuse 3039ms, two observations each. | Keep `reuseThread:false`. Retain explicit experimental option; substantial variance prevents a benefit claim. |

All six reuse-experiment answers correctly matched the synthetic facts. Planner output was checked as a brief teaching summary, not private reasoning. A completed hint is optional data for a later turn, must be checked against the original sources, and may already be stale. These simple questions do not establish tutoring quality on real material.

The end-to-end baseline selects the current server's exec path and 1.0s VAD; it is not a checkout of the complete historical app. Read `voice-pipeline-results.json` for the precise method and individual transcripts.

## Adapter contract

`createLunaFast({env, mode:'voice', reuseThread:false})` returns a synchronous session object:

- `ready()` prewarms the private stdio app-server using the existing signed-in CLI.
- `respond(input, {onText, signal, timeoutMs, effort:'low'})` returns `{reply, timings}`. `onText(delta)` receives plain spoken-text deltas. Caller accumulates sentence boundaries. Source materials and conversation are data; the adapter uses immutable source-grounded voice instructions rather than accepting arbitrary caller instructions.
- `createLunaFast({env, mode:'planner'})` uses an immutable bounded teaching-summary prompt. Call `respond(..., {effort:'high'})` on this separate session only when explicitly enabling the optional planner.
- `close()` aborts work, terminates the owned CLI process, and removes its temporary directory. The owning live conversation must close both sessions on disconnect/end.

Authentication stays with the CLI. Child environment filters API keys and unrelated secrets. Effective configuration is read only in memory to explicitly disable inherited MCP servers; it is never logged or persisted. Tools, plugin loading, hooks, and code-mode execution are disabled; the sandbox remains read-only. Unknown tool events and approval requests fail the turn. Text is bounded to 1800 characters, and response cancellation suppresses stale deltas.

Experimental reuse requires identical source hashes and matching completed history, resets on error/interruption/source edits/history rewrites, and recycles after twelve completed turns. It never shares threads across voice sessions. Its default is intentionally off after the measurements above.

## Reproduction

Run only when bounded synthetic provider requests are authorized. Each script uses real account allowance; no script plays audio.

```sh
node --env-file-if-exists=.env benchmarks/luna-text-latency.mjs low
node --env-file-if-exists=.env benchmarks/luna-stream-latency.mjs
node --env-file-if-exists=.env benchmarks/luna-none-probe.mjs
node --env-file-if-exists=.env benchmarks/luna-planner-latency.mjs
node --env-file-if-exists=.env benchmarks/luna-reuse-latency.mjs
node --test tests/luna-fast.test.mjs tests/codex.test.mjs
```

Text scripts save the corresponding `luna-*-results.json` files (the none probe uses singular `luna-none-result.json`). Planner runs append one standalone/concurrent pair; the other scripts replace their own result file. The none probe modifies only its diagnostic subprocess request; it does not modify the production effort whitelist. Unit tests use fake subprocesses and make no provider calls.

Tests cover secret stripping, inherited MCP isolation, cancellation and immediate next-turn reservation, forbidden tools, output size, timeout, matching source/history reuse, and UTF-8 characters split across subprocess buffers.
