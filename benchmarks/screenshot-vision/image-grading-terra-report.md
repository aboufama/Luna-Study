# Production Terra screenshot grading check

**Passed: two independent production grading calls.** Both reported `gpt-5.6-terra`, low effort, and independently judged “Q represents volume flow rate” correct and unassisted. The production operation-specific selector chose Terra; this harness did not override the model or reasoning payload. The result passed normal `checkedGrade` identity, original-image citation and agreement validation. No mastery score was written.

The existing hydraulic symbol-key PNG was reused, with deliberately incorrect derived notes (“Q is heat flux”, “H is a temperature”) and an incorrect private reference answer. Each outbound request included the same original pixels at high detail. Both reviewers cited that immutable image source, rather than turning derived notes into textual evidence. This is one clear synthetic image and one pair, not a general screenshot accuracy estimate.

- Image SHA-256: `91fe21d77e82a1c02a83f27735c4de65c29189e82ebeb13e3ab341d4ca6a0af0` (52039 bytes).
- Evidence SHA-256: `d32fee05c096ecc685a527e8c1c6f14175c47282df84f665f50a6f4cd6fb5b5b`.
- Requests: 2 OpenAI, 0 Jev, 0 voice, 0 extraction, 0 tutor generation.
- Returned usage: 5,718 input tokens, 334 output tokens, 2,856 cache-read tokens and 2,856 cache-write tokens; both requests reported all tracked counters.
- Provider request times: 2144ms and 2057ms. These exclude provider-slot wait and are not live speech latency.
- Estimated total: **$0.0117312**. Actual billed dollars are unavailable.

The estimate uses the repository's October 2 verified global Terra rates: $2 ordinary input, $0.20 cached input, $2.50 cache-write input and $12 output per million tokens. Cache counters are disjoint subsets of input, and reasoning is not charged twice. [Official model source](https://developers.openai.com/api/docs/models/gpt-5.6-terra). Account discounts, credits, taxes and regional premiums are excluded.

[Immutable evidence](image-grading-terra-results.json) records the public structured judgments, exact prepared text context, image identities, production code hashes, model/effort, usage, pricing metadata and a temporary in-memory production ledger. No image base64, credentials or hidden reasoning is stored. The original seven-call screenshot benchmark remains unchanged.

Offline transport verification: `node benchmarks/screenshot-grading-terra.mjs`. The live command requires explicit authorization and refuses to overwrite the saved result; it holds the shared provider slot and caps all provider fetches at two.
