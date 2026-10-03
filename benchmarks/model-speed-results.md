# OpenAI model speed benchmark

Run: 2026-10-02T06:07:50.803Z to 2026-10-02T06:09:19.059Z (UTC). Synthetic introductory biology explanation, approximately 200 words.

All calls use the Responses API, default service tier, low reasoning, no tools, and a 1,200 output-token cap. Three sequential rotating rounds; no retries or warmups.

| Model | Completed | Median first text | Approx. visible tok/s | Observed tok/s range | Median total | Median output tokens* | Median words |
|---|---:|---:|---:|---:|---:|---:|---:|
| gpt-6-luna | 3/3 | 2.10 s | 114.9 | 114.0–118.3 | 4.14 s | 217 | 177 |
| gpt-5.6-luna | 3/3 | 1.47 s | 104.2 | 100.4–120.7 | 3.97 s | 229 | 186 |
| gpt-6-sol | 3/3 | 1.07 s | 88.8 | 81.9–98.8 | 4.07 s | 225 | 193 |
| gpt-5.6-terra | 3/3 | 0.57 s | 79.8 | 77.7–83.6 | 3.57 s | 230 | 191 |
| gpt-6-astra | 3/3 | 1.64 s | 46.6 | 45.1–47.2 | 6.84 s | 245 | 203 |
| gpt-6.1-sol | 3/3 | 1.01 s | 44.8 | 44.2–55.6 | 6.71 s | 245 | 205 |

*Output tokens here subtract reported reasoning tokens. This approximates visible content tokens: provider usage can include non-visible formatting tokens that are not separately itemized. Rates divide that count by the time from first to last nonempty text delta. The first delta may contain several tokens, and network buffering affects observed rates. TTFT is request start to the first nonempty text delta; total is request start to the terminal completed event.

These are three samples per available model on one short task, not production percentiles or a quality evaluation. Differences in answer length, server load, routing, tokenization, connection setup, and caching can affect comparisons. Cached input and reasoning counts, every trial, delta timestamps, response model IDs, failures, and service tiers are retained in the JSON.

No failures or unavailable models were observed.

Official references: [Streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses); [Understand output token counts](https://developers.openai.com/api/docs/guides/token-counting); [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning).
