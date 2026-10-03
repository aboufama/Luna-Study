// Offline report only. Preserves raw trials and separates protocol from semantic judgments.
import { readFile, writeFile } from 'node:fs/promises';
import { estimateUsage } from '../server/usage-pricing.mjs';

const here = new URL('./', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, here), 'utf8'));
const names = {
  before: 'tutor-step-change-fullchain-results.json',
  smoke: 'grade-citations-smoke-results.json',
  concise: 'tutor-step-change-citations-final.json',
  reasoned: 'tutor-step-change-reasoned-final.json',
};
const raw = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, name]) => [key, await read(name)])));
const rounded = value => Number(value.toFixed(9));
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summarizeUsage = events => {
  const models = {};
  const estimates = events.map(estimateUsage);
  for (const event of events) {
    const key = `${event.provider}/${event.model}`;
    const entry = models[key] ??= { requests: 0, units: {}, estimatedUsd: 0 };
    entry.requests += 1;
    for (const [name, value] of Object.entries(event.units || {})) {
      if (Number.isFinite(value)) entry.units[name] = (entry.units[name] || 0) + value;
    }
    entry.estimatedUsd = rounded(entry.estimatedUsd + (estimateUsage(event)?.usd || 0));
  }
  return {
    requests: events.length, models,
    unpricedRequests: estimates.filter(value => !value).length,
    incompleteRequests: events.filter(event => event.status !== 'completed').map(event => ({ provider: event.provider, model: event.model, operation: event.operation, status: event.status, units: event.units })),
    estimatedUsd: rounded(estimates.reduce((sum, value) => sum + (value?.usd || 0), 0)),
    estimatePartial: estimates.some(value => !value || value.partial),
    exactBilledUsd: events.length && events.every(event => Number.isFinite(event.providerReportedUsd))
      ? rounded(events.reduce((sum, event) => sum + event.providerReportedUsd, 0)) : null,
  };
};
const eventsFor = value => value.runs.flatMap(run => run.usage.filter(event => ['openai', 'typesafe'].includes(event.provider)));
const smokeEvents = raw.smoke.requests.map(request => ({
  provider: 'openai', model: request.model, status: request.status === 200 ? 'completed' : 'failed',
  units: {
    inputTokens: request.usage.input_tokens, outputTokens: request.usage.output_tokens,
    cachedInputTokens: request.usage.input_tokens_details.cached_tokens,
    cacheWriteTokens: request.usage.input_tokens_details.cache_write_tokens,
    reasoningTokens: request.usage.output_tokens_details.reasoning_tokens,
  },
  providerReportedUsd: null,
}));
const trialSummary = value => {
  const runs = value.runs.map(run => {
    const at = type => run.diagnostics.find(event => event.type === type)?.atMs ?? null;
    const completed = at('grading.completed'), started = at('grading.started'), queued = at('grading.queued');
    return {
      round: run.round,
      failedExpectations: Object.entries(run.checks).filter(([, passed]) => passed !== true).map(([key]) => key),
      grades: run.gradeChecks,
      decisions: run.diagnostics.filter(event => event.type === 'grading.check').map(event => event.details),
      persistedEvents: run.persistedMastery.events,
      topicScore: run.persistedMastery.public.topics.find(topic => topic.title === 'Strict Nash equilibria')?.score ?? null,
      overallScore: run.persistedMastery.public.overall,
      latencies: {
        ...run.latencies,
        gradeAppliedAfterInitialRequestMs: completed,
        checkedGradingMs: completed === null || started === null ? null : Number((completed - started).toFixed(1)),
        queuedToPersistedMs: completed === null || queued === null ? null : Number((completed - queued).toFixed(1)),
      },
    };
  });
  const checks = runs.flatMap(run => run.grades);
  return {
    startedAt: value.startedAt, finishedAt: value.finishedAt, budget: value.budget,
    allExpectationsPassed: runs.filter(run => !run.failedExpectations.length).length,
    total: runs.length,
    evidenceValidated: checks.filter(check => check.evidenceValidated === true).length,
    gradeResponses: checks.length,
    medianInitialTextMs: median(runs.map(run => run.latencies.committedTranscriptToFirstTextMs)),
    medianInitialBoardMs: median(runs.map(run => run.latencies.committedTranscriptToBoardMs)),
    usage: summarizeUsage(eventsFor(value)), runs,
  };
};
const summary = {
  version: 1, artifacts: names,
  before: trialSummary(raw.before),
  smoke: { passed: raw.smoke.cases.filter(value => value.pass).length, total: raw.smoke.cases.length, cases: raw.smoke.cases, usage: summarizeUsage(smokeEvents) },
  concise: trialSummary(raw.concise), reasoned: trialSummary(raw.reasoned),
  newValidationUsage: summarizeUsage([...smokeEvents, ...eventsFor(raw.concise), ...eventsFor(raw.reasoned)]),
  sourceCorpusCharacters: raw.reasoned.source.totalCharacters,
  reasonedAnswer: raw.reasoned.followUpAnswer,
};
const sec = value => Number.isFinite(value) ? `${(value / 1000).toFixed(3)} s` : 'unavailable';
const money = usage => `$${usage.estimatedUsd.toFixed(6)}${usage.estimatePartial ? ' (partial)' : ''}`;
const conciseAnswer = 'My answer is eight: strict equilibria cannot share a row or column, and eight disjoint pairs can attain it.';
const resultsRows = (label, value) => value.runs.map(run => {
  const judgments = run.grades.map(grade => `${grade.verdict}${grade.reasoningSufficient ? '/sufficient' : '/insufficient'}`).join(' + ');
  const decision = run.decisions.at(-1)?.reason || 'unavailable';
  return `| ${label} ${run.round} | ${judgments} | ${decision} | ${run.persistedEvents.length} | ${run.topicScore} |`;
});
const lines = [
  '# Strict grading: citation transport and answer sufficiency', '',
  'The exact-evidence protocol now worked for all 12 grader responses across six composed trials. Semantic sufficiency is still model judgment: the concise answer yielded disagreement, partial credit, and correct credit in its three rounds. A separate answer with a uniqueness proof and explicit payoff construction passed all three rounds. The latter is a different fixture, not evidence that the concise-answer disagreement was fixed.', '',
  'The preserved earlier run had one `answer-quote-mismatch` on its first grading check: the model said correct/sufficient/unassisted, but its returned quote did not match the student answer under strict validation. That trial received no score event. The old artifact did not retain the quote string, so the exact erroneous wording cannot be reconstructed. This was an evidence-transport rejection, not a disagreement between two semantic checks.', '',
  'The server now partitions the complete original answer and question-scoped source documents into immutable, content-bound excerpt IDs. The grader selects answer/source IDs; the server resolves them to verbatim text and runs the existing strict identity, source-membership, and evidence checks. Unknown, duplicate, altered, cross-source, or wrong-type IDs are rejected. Two fresh independent semantic requests remain mandatory. Valid citations cannot turn an incorrect, assisted, insufficient, or disputed answer into a correct unassisted result.', '',
  '| Fixture / round | Independent semantic judgments | Final checker decision | Persisted events | Topic score |',
  '|---|---|---|---:|---:|',
  ...resultsRows('Concise', summary.concise),
  ...resultsRows('Reasoned', summary.reasoned), '',
  'Concise round 2 persisted one checked partial event (+3), despite failing the harness expectation of correct credit. Its two graders agreed on partial; the legacy check named `twoIndependentRealGradesAgreed` specifically expects both to say correct. Concise round 1 persisted no event because the graders disagreed. Concise round 3 and each reasoned round persisted exactly one checked correct event (+20), attempt 1, firstAttempt=true, unassisted=true. Overall score was 3/100 across six topics after correct credit; neither the topic nor the whole course was marked mastered.', '',
  `Concise input, unchanged from the original fixture: “${conciseAnswer}”`, '',
  `Separate reasoned input: “${summary.reasonedAnswer}”`, '',
  `The separate real grading smoke test passed ${summary.smoke.passed}/${summary.smoke.total}: correct, incorrect, and correct-after-assistance. Each used two real Luna calls. Assistance was retained, so assisted correctness was not eligible as an unassisted hard win.`, '',
  'All six composed trials used a fresh production question bank and loopback WebSocket session, real Terra for the question and feedback, real Jev student intent/material selection/board routing, real Luna checked grading, strict validators, and a real temporary mastery store. Every initial board was a blank 8×10 grid; its exact canonical queued question was resolved/consumed by ID once. Public bank context never exposed private reference answers. Original source documents remained available for grading; the corpus was 25,681 characters from three local game-theory PDFs.', '',
  'Question preparation, greeting/history replies, and tutor mastery-notice intent were deterministic fixtures. ElevenLabs STT was simulated with exact committed transcripts; TTS was silent PCM after a fixed 100 ms fixture delay. No real microphone, voice provider, or STT/TTS quality was tested. These small fixed-order synthetic cases do not establish a production pass rate or general semantic reliability across subjects.', '',
  '| Reasoned round | Initial text from transcript | Initial board from transcript | Checked grading duration | Grading queued → persisted |',
  '|---:|---:|---:|---:|---:|',
  ...summary.reasoned.runs.map(run => `| ${run.round} | ${sec(run.latencies.committedTranscriptToFirstTextMs)} | ${sec(run.latencies.committedTranscriptToBoardMs)} | ${sec(run.latencies.checkedGradingMs)} | ${sec(run.latencies.queuedToPersistedMs)} |`), '',
  'Initial-board timing is the received validated server board packet, not a browser paint measurement. Checked-grading duration runs from `grading.started` to the applied event; queued-to-persisted includes the intervening feedback flow. Synthetic-audio time is recorded in raw JSON, but must not be interpreted as ElevenLabs latency. Each run held the shared provider slot to avoid simultaneous benchmark inference. This is not a matched before/after speed experiment; answer length, cache state, and live provider variance differ.', '',
  '| Preserved artifact | Actual OpenAI / Jev requests | List-price token estimate | Exact billed USD |',
  '|---|---:|---:|---|',
  `| Earlier quote-copy run | ${raw.before.budget.openai} / ${raw.before.budget.jev} | ${money(summary.before.usage)} | unavailable |`,
  `| Citation smoke | ${raw.smoke.requests.length} / 0 | ${money(summary.smoke.usage)} | unavailable |`,
  `| Citation concise full chain | ${raw.concise.budget.openai} / ${raw.concise.budget.jev} | ${money(summary.concise.usage)} | unavailable |`,
  `| Citation reasoned full chain | ${raw.reasoned.budget.openai} / ${raw.reasoned.budget.jev} | ${money(summary.reasoned.usage)} | unavailable |`, '',
  `New validation totals: 30 OpenAI + 36 Jev = ${summary.newValidationUsage.requests} actual HTTP requests, estimated ${money(summary.newValidationUsage)}. This excludes the preserved earlier run. Exact billed dollars were not returned; they are unavailable, not zero. Estimates use recorded counters and the repository’s verified public rates, assume standard processing for default/missing tier, include reported cache writes/reads, and exclude discounts, credits, regional premiums, and taxes. Reasoning tokens are already included in output tokens and are not charged twice. No cost is assigned to fake ElevenLabs audio. Per-model input/output/cache/reasoning counters are in the summary JSON.`, '',
  'Concise round 2 also recorded one failed Jev whiteboard-routing request without token usage. Its decision was unavailable, and the existing structured-visual fallback still showed the validated blank grid. The record does not establish the provider failure’s detailed cause. That request is included in the HTTP count and excluded from the partial dollar subtotal; no zero cost is inferred. The reasoned run returned measured usage for all its requests.', '',
  'Offline verification: 143 focused tests passed across mastery, citation resolution, Jev intent, live voice, and new modular lifecycle suites. Tests cover lossless 70,000-character evidence, unknown/foreign/altered IDs, exact mathematical signs and grammar, independent disagreement, prior assistance, first-attempt reservation, duplicate persistence, source changes, stale/canceled turns, scene patches, manual visibility, and topic-level completion constraints. This establishes deterministic credit and transport invariants; semantic judgments remain probabilistic.', '',
  'Raw evidence is preserved separately:', '',
  ...Object.entries(names).map(([name, file]) => `- ${name}: [${file}](${file})`),
  '- Summary: [grade-citations-results.summary.json](grade-citations-results.summary.json)', '',
  'Regenerate this report without provider calls:', '',
  '```sh', 'node benchmarks/grade-citations-report.mjs', '```', '',
  'Reproduce the reasoned fixture only when new paid testing is intended. Use a new output filename to preserve prior evidence:', '',
  '```sh',
  'node --env-file-if-exists=.env --input-type=module -e \'import {withProviderSlot} from "./benchmarks/whiteboard-provider-slot.mjs"; await withProviderSlot(()=>import("./benchmarks/tutor-context-scenarios.mjs"));\' -- --live --condition=after-terra --production-bank --scenario=blank-grid --real-intent --real-grading --answer-variant=reasoned --rounds=3 --max-openai=12 --max-jev=18 --max-requests=30 --output=benchmarks/tutor-citation-reproduction.json',
  '```', '',
  'Remove `--live` for an offline fixture run. Use `--answer-variant=concise` to retain the original shorter answer. The raw artifacts retain source/model hashes, exact scenarios, requested budgets, real usage, decisions, boards, and persisted events. No failed trial has been replaced or relaxed.', '',
];
await writeFile(new URL('grade-citations-results.summary.json', here), JSON.stringify(summary, null, 2) + '\n');
await writeFile(new URL('grade-citations-results.md', here), lines.join('\n'));
console.log(JSON.stringify({ concise: `${summary.concise.allExpectationsPassed}/${summary.concise.total}`, reasoned: `${summary.reasoned.allExpectationsPassed}/${summary.reasoned.total}`, newValidationRequests: summary.newValidationUsage.requests, estimatedUsd: summary.newValidationUsage.estimatedUsd, exactBilledUsd: summary.newValidationUsage.exactBilledUsd }));
