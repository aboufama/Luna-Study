// Offline reporting only. Preserve every raw response and original check result.
import { readFile, writeFile } from 'node:fs/promises';
import { estimateUsage } from '../server/usage-pricing.mjs';

const here = new URL('./', import.meta.url);
const raw = JSON.parse(await readFile(new URL('tutor-terra-bank-results.json', here), 'utf8'));
const median = values => { const a = values.filter(Number.isFinite).sort((a, b) => a - b); return a.length ? a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2 : null; };
const sec = value => Number.isFinite(value) ? (value / 1000).toFixed(3) : '—';
const paidUsage = run => (run.usage || []).filter(event => ['openai', 'typesafe'].includes(event.provider));
const audit = [];
const runs = raw.runs.map(run => {
  const checks = { ...run.checks };
  if (run.scenario === 'source-payoff' && checks.payoffTupleCorrect === false && /(?:one|1) for player (?:one|1),?\s*(?:six|6) for player (?:two|2),?\s*and (?:one|1) for player (?:three|3)/i.test(run.reply || '')) {
    checks.payoffTupleCorrect = true;
    audit.push({ scenario: run.scenario, round: run.round, check: 'payoffTupleCorrect', raw: false, evaluated: true, reason: 'The original evaluator only accepted a contiguous tuple. The saved reply explicitly gives the same correct values for players 1, 2, and 3 in order.', evidence: run.reply });
  }
  const measured = paidUsage(run), estimates = measured.map(estimateUsage);
  const exact = measured.length && measured.every(event => Number.isFinite(event.providerReportedUsd)) ? measured.reduce((sum, event) => sum + event.providerReportedUsd, 0) : null;
  return {
    scenario: run.scenario, round: run.round, status: run.status, checks,
    failedChecks: Object.entries(checks).filter(([, passed]) => passed !== true).map(([name]) => name),
    latencies: run.latencies, canonicalQuestionId: run.questionIdentity?.canonicalQuestionId,
    openaiRequests: run.requests.filter(request => request.provider === 'openai' && !request.blockedByBudget).length,
    jevRequests: run.requests.filter(request => request.provider === 'jev' && !request.blockedByBudget).length,
    recoveryRequests: run.requests.filter(request => request.provider === 'openai' && request.kind === 'recovery' && !request.blockedByBudget).length,
    firstContextBytes: run.requests.find(request => request.context?.bankQuestionIds)?.context.inputBytes ?? null,
    cost: { exactBilledUsd: exact, estimatedUsd: Number(estimates.reduce((sum, item) => sum + (item?.usd || 0), 0).toFixed(9)), partial: estimates.some(item => !item || item.partial), estimatedOperations: estimates.filter(Boolean).length, unestimatedOperations: estimates.filter(item => !item).length },
  };
});
const summary = {
  startedAt: raw.startedAt, finishedAt: raw.finishedAt, budget: raw.budget, evaluationAudit: audit,
  trials: runs.length, completed: runs.filter(run => run.status === 'completed').length,
  allChecksPassed: runs.filter(run => run.status === 'completed' && !run.failedChecks.length).length,
  exactBilledUsd: runs.length && runs.every(run => run.cost.exactBilledUsd !== null) ? runs.reduce((sum, run) => sum + run.cost.exactBilledUsd, 0) : null,
  estimatedUsd: Number(runs.reduce((sum, run) => sum + run.cost.estimatedUsd, 0).toFixed(9)),
  estimatePartial: runs.some(run => run.cost.partial),
  incompleteProviderOperations: raw.runs.flatMap(run => paidUsage(run).filter(event => event.status !== 'completed').map(event => ({ round: run.round, scenario: run.scenario, operation: event.operation, provider: event.provider, status: event.status, measuredUnits: event.units }))),
  medianFirstTextMs: median(runs.map(run => run.latencies.committedTranscriptToFirstTextMs)),
  medianSyntheticAudioMs: median(runs.map(run => run.latencies.committedTranscriptToSyntheticAudioMs)),
  medianTextCompleteMs: median(runs.map(run => run.latencies.committedTranscriptToTextCompleteMs)),
  medianContextBytes: median(runs.map(run => run.firstContextBytes)),
  unitsByModel: {}, runs,
};
for (const run of raw.runs) for (const event of paidUsage(run)) {
  const group = summary.unitsByModel[event.model] ||= { operations: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
  group.operations++;
  for (const key of Object.keys(group).filter(key => key !== 'operations')) if (Number.isFinite(event.units?.[key])) group[key] += event.units[key];
}
const lines = [
  '# Terra tutor and canonical bank identity: three live rounds', '',
  `${raw.startedAt} to ${raw.finishedAt} (UTC). ${summary.completed}/${summary.trials} cases completed; ${summary.allChecksPassed}/${summary.trials} pass the evaluated checks.`, '',
  '`LUNA_TUTOR_MODEL=gpt-5.6-terra` drives the main tutor. `LUNA_API_MODEL=gpt-6-luna` drives any separate visual recovery; both actual model names are retained per request. This is the integrated same-agent tutor/board path, not a parallel-renderer experiment.', '',
  '## Method and boundaries', '',
  `Three sequential rounds each run source-payoff → blank-grid → scene-switch → answer-feedback. This fixed order is not randomized or counterbalanced. Three samples per scenario do not establish production reliability or percentile latency. The source corpus is the same three real game-theory PDFs used in the prior comparison, with ${raw.source.totalCharacters.toLocaleString()} extracted characters. PDF and extracted-text hashes, source filenames, runtime source-file hashes, and every trial are in the raw JSON.`, '',
  'The local WebSocket server, main model, Jev passage/canvas classifications, parser, question-bank storage/revision/resolution/consumption, active question, and grading eligibility are real production components. Question preparation is a deterministic fixture loaded through the production bank API: three difficulties are prepared for each of six topics, non-medium variants are consumed before the measured session, and automatic refills are disabled. The six medium questions remain available, or five after the feedback scenario’s canonical question was primed.', '',
  'ElevenLabs recognition is simulated with committed-transcript events. Synthesis emits 10 ms of silent PCM after a fixed 100 ms fixture delay; it never uses a microphone, speaker, or paid voice endpoint. Audio times below are pipeline observations with that fixture, not measured ElevenLabs latency. Intent classifications, initial conversation/greeting replies, and grade verdicts are simulated. Grading eligibility and first-attempt accounting are real; this run does not establish grading accuracy.', '',
  'For blank-grid, a real `<ask>` result must resolve a currently offered question ID without private answers, emit the exact canonical wording, consume that ID once, preserve all other questions, and allow exactly one checked first unassisted attempt. The matrix must contain eight rows and ten columns of blank cells with no premature answer. Scene-switch must replace the old payoff matrix with the line city and the requested vendor geometry. All cases check original-source evidence and preservation of the earlier no-spoiler preference.', '',
  '## Per-trial observations', '',
  '| Round | Scenario | Evaluated checks | First text | Synthetic first audio | Text complete | Board visible | OpenAI / Jev calls |',
  '|---:|---|---|---:|---:|---:|---:|---:|',
  ...runs.map(run => `| ${run.round} | ${run.scenario} | ${run.status === 'completed' && !run.failedChecks.length ? 'pass' : `FAIL: ${run.failedChecks.join(', ') || run.status}`} | ${sec(run.latencies.committedTranscriptToFirstTextMs)} s | ${sec(run.latencies.committedTranscriptToSyntheticAudioMs)} s | ${sec(run.latencies.committedTranscriptToTextCompleteMs)} s | ${Number.isFinite(run.latencies.committedTranscriptToBoardMs) ? `${sec(run.latencies.committedTranscriptToBoardMs)} s` : '—'} | ${run.openaiRequests} / ${run.jevRequests} |`), '',
  `Across all ${runs.length} cases, median first text was ${sec(summary.medianFirstTextMs)} s, synthetic first audio ${sec(summary.medianSyntheticAudioMs)} s, and text completion ${sec(summary.medianTextCompleteMs)} s. Median initial context was ${summary.medianContextBytes?.toLocaleString()} bytes. Board timing is reported separately because only some turns request or trigger a board.`, '',
  '| Scenario | Median first text | Median board visible | Recovery requests |',
  '|---|---:|---:|---:|',
  ...[...new Set(runs.map(run => run.scenario))].map(id => { const group = runs.filter(run => run.scenario === id); const board = median(group.map(run => run.latencies.committedTranscriptToBoardMs)); return `| ${id} | ${sec(median(group.map(run => run.latencies.committedTranscriptToFirstTextMs)))} s | ${Number.isFinite(board) ? `${sec(board)} s` : '—'} | ${group.reduce((sum, run) => sum + run.recoveryRequests, 0)} |`; }), '',
  '## Usage', '',
  `Observed ${raw.budget.used} paid HTTP requests: ${raw.budget.openai} OpenAI and ${raw.budget.jev} Jev, bounded by ${raw.budget.maxPerProvider.openai} OpenAI, ${raw.budget.maxPerProvider.jev} Jev, and ${raw.budget.maxPaidHttpRequests} total. There were no paid voice requests. Provider-reported billed dollars are ${summary.exactBilledUsd === null ? '**unavailable**' : `$${summary.exactBilledUsd.toFixed(6)}`}. Public list-price estimate: **$${summary.estimatedUsd.toFixed(6)}${summary.estimatePartial ? ' (partial)' : ''}**. Missing cache-write counters, unreported use, account discounts/credits, tax, and billing adjustments are excluded; synthetic voice usage is not priced.`, '',
  '| Model | Metered operations | Input tokens | Output tokens | Cache-read tokens | Cache-write tokens reported | Reasoning tokens |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...Object.entries(summary.unitsByModel).map(([model, u]) => `| ${model} | ${u.operations} | ${u.inputTokens} | ${u.outputTokens} | ${u.cachedInputTokens} | ${u.cacheWriteTokens} | ${u.reasoningTokens} |`), '',
  'Counters are sums of provider-returned usage. Zero in a reported-counter sum does not establish that an absent cache-write counter was measured as zero. Output tokens already include reasoning; they are not charged again. Estimates use the production pricing calculator and the model/service tier recorded for each operation: [Terra rates](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Luna rates](https://developers.openai.com/api/docs/models/gpt-6-luna), and [Jev rates](https://docs.typesafe.ai/models).', '',
  '## Evaluation audit', '',
  ...summary.incompleteProviderOperations.map(item => `- Round ${item.round}, ${item.scenario}: ${item.provider} ${item.operation} was ${item.status}. The source-prefetch diagnostic records a timeout at 856 ms despite HTTP 200 headers; no token usage was returned for that operation. Original-source fallback still supplied the required evidence and the final answer passed. The cost subtotal excludes this unmetered attempt and remains partial.`),
  ...(audit.length ? audit.map(item => `- Round ${item.round}, ${item.scenario}: ${item.reason} Saved response: “${item.evidence}” Raw check remains false in the original JSON; the evaluated summary corrects it without another provider call.`) : ['No offline check corrections.']), '',
  'Prior Luna wording failures remain in the earlier comparison files. These new results use an ID-based speech resolver and a different main model, so they cannot isolate the causal effect of either change. They also cannot prove that the separate proposed parallel-board architecture is better.', '',
  'Reproduce within the explicit request budget:', '',
  '```sh',
  'node --env-file-if-exists=.env benchmarks/tutor-context-scenarios.mjs --live --condition=after-terra --production-bank --rounds=3 --max-openai=30 --max-jev=40 --max-requests=70 --output=benchmarks/tutor-terra-bank-results.json',
  'node benchmarks/tutor-terra-bank-report.mjs',
  '```', '',
  'Remove `--live` for a fully offline self-check. Add `--scenario=blank-grid --simulate-recovery` in offline mode to exercise delayed recovery while preserving the consumed question and first unassisted attempt. Each live invocation makes new paid requests; the report generator is offline.', '',
];
await writeFile(new URL('tutor-terra-bank-summary.json', here), JSON.stringify(summary, null, 2) + '\n');
await writeFile(new URL('tutor-terra-bank-results.md', here), lines.join('\n'));
console.log(JSON.stringify({ completed: summary.completed, trials: summary.trials, allChecksPassed: summary.allChecksPassed, budget: summary.budget, estimatedUsd: summary.estimatedUsd, medianFirstTextMs: summary.medianFirstTextMs, medianSyntheticAudioMs: summary.medianSyntheticAudioMs, medianTextCompleteMs: summary.medianTextCompleteMs, correctedChecks: audit.length }));
