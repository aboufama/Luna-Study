# Jev whiteboard routing

Each completed assistant response is independently classified for whether its teaching content benefits from a companion whiteboard. Classification runs alongside speech, so it never delays audio. The voice session guards turn, source, and session identity before displaying a result; superseded decisions must be discarded.

`createJevCanvasRouter({env, fetchImpl}).classify(reply, context)` returns `needsCanvas`, `reason`, `source`, and measured `latencyMs`. A successful service result also includes its yes probability. The completed reply and proposed public board text are submitted, with allowlisted `title`, `topic`, `phase`, visibility flags, the existing public scene summary, and the last six public conversation entries. Source documents, the private question bank, expected answers, and grading records are not accepted as routing context. The browser's whiteboard receives the public assistant response, never private planning data.

The integration uses the official TypeSafe API: `POST https://api.typesafe.ai/v1/systemone`, with a `needs_canvas` question of type `noul`. Its answer is `answers.needs_canvas.noul`, a probability between zero and one. The default model is `jev-latest`; `TYPESAFE_MODEL` can select another supported account model. No remote function registration is required. `TYPESAFE_API_KEY` remains on the server and is sent only to the fixed official API origin; redirects are rejected.

The deadline is 850 ms for headers and body combined. Requests are aborted on timeout. A missing key, outage, malformed result, timeout, or uncertain probability between 0.4 and 0.6 uses deterministic local rules. Equations, calculations, concrete spatial explanations, and meaningful multi-step teaching can show the board. Greetings, logistics, readiness checks, and simple recall stay in the conversation. Setup-phase responses remain conversational. Closing an existing board requires a separate contextual close decision. A valid structured equation, matrix, or diagram is displayed during study even when the usefulness classifier underpredicts. A separate `reopen_canvas` question can bring back a matching saved scene (threshold 0.7) without requiring Luna to regenerate it; unrelated or uncertain saved scenes remain hidden.

TypeSafe model discovery was authenticated successfully on 2026-10-02; the account exposed `jev-latest` and `jev-preview`. Model names are service aliases and may evolve. Runtime `latencyMs` measures that individual request, not a guaranteed provider latency. No pricing claim is inferred from this integration.

Two synthetic, text-only live checks on that date returned actual Jev decisions: a worked linear equation selected the whiteboard with probability 0.72 in 232 ms; a brief conversational acknowledgment declined it with probability 0.03 in 139 ms. These are individual smoke-test timings, not a representative latency benchmark. No audio, student material, or private question data was submitted.

Official references, checked 2026-10-02:

- [API reference](https://api.typesafe.ai/redoc)
- [OpenAPI schema](https://api.typesafe.ai/openapi.json)
- [TypeSafe console](https://console.typesafe.ai/home)

Run `node --test tests/jev.test.mjs` for request/schema, minimal-context, repeated-response, fallback, deadline, and malformed-result checks.

The development Activity panel records candidates, board parse status, Jev scores and fallback reasons, and shown/reopened/closed/not-shown outcomes. See [import and debugging details](import-and-debug.md).

Scene relevance is distinct from usefulness. `close_canvas >= 0.85` hides a visible scene when the teaching concretely moves to a different problem/topic, even if that new problem also needs a visual. `replace_canvas >= 0.7` forces a proposed new problem to replace existing objects, whether the saved scene is visible or hidden. Same-problem hints/corrections keep patch behavior. Missing, malformed, or uncertain scene decisions do not erase or replace the saved scene. A confident scene decision survives an ambiguous usefulness score.

Jev cannot draw. When `needsCanvas` is true but Luna omitted a usable board and no matching saved board reopened, the live server now makes one silent, source-grounded visual recovery attempt. Successful output uses the same validator and scene routing; failures and cancellations are logged. Speech continues independently. The recovery is separately attributed to Thinking / LLM usage.
