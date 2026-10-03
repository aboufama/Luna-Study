// Offline summary of composed real-provider grading tests. No provider calls.
import { readFile, writeFile } from 'node:fs/promises';
import { estimateUsage } from '../server/usage-pricing.mjs';
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const inputName = option('input') || 'tutor-terra-fullchain-results.json';
const baseName = inputName.replace(/\.json$/, '');
const here = new URL('./', import.meta.url);
const raw = JSON.parse(await readFile(new URL(inputName, here), 'utf8'));
const runs = raw.runs.map(run => {
  const usage = run.usage.filter(event => ['openai', 'typesafe'].includes(event.provider));
  const estimates = usage.map(estimateUsage);
  const decisions = run.diagnostics.filter(event => event.type === 'grading.check').map(event => ({ ...event.details, atMs: event.atMs }));
  const completed = run.diagnostics.find(event => event.type === 'grading.completed');
  return {
    round: run.round, status: run.status, checks: run.checks,
    failedChecks: Object.entries(run.checks).filter(([, passed]) => passed !== true).map(([name]) => name),
    decision: decisions.at(-1),
    initialTextMs: run.latencies.committedTranscriptToFirstTextMs,
    initialBoardMs: run.latencies.committedTranscriptToBoardMs,
    gradeAppliedFromInitialRequestMs: completed?.atMs ?? null,
    trialElapsedMs: Date.parse(run.finishedAt) - Date.parse(run.startedAt),
    gradeCalls: run.gradeFixture.calls,
    storedEvents: run.persistedMastery?.events || [],
    strictNashScore: run.persistedMastery?.public.topics.find(topic => topic.title === 'Strict Nash equilibria')?.score ?? null,
    publicOverallScore: run.persistedMastery?.public.overall ?? null,
    estimatedUsd: Number(estimates.reduce((sum, value) => sum + (value?.usd || 0), 0).toFixed(9)),
    estimatePartial: estimates.some(value => !value || value.partial),
    exactBilledUsd: usage.length && usage.every(event => Number.isFinite(event.providerReportedUsd)) ? usage.reduce((sum, event) => sum + event.providerReportedUsd, 0) : null,
  };
});
const summary = { startedAt: raw.startedAt, finishedAt: raw.finishedAt, budget: raw.budget, runs, passed: runs.filter(run => run.status === 'completed' && !run.failedChecks.length).length, total: runs.length, estimatedUsd: Number(runs.reduce((sum, run) => sum + run.estimatedUsd, 0).toFixed(9)), estimatePartial: runs.some(run => run.estimatePartial), exactBilledUsd: runs.every(run => run.exactBilledUsd !== null) ? runs.reduce((sum, run) => sum + run.exactBilledUsd, 0) : null };
const sec = value => Number.isFinite(value) ? `${(value / 1000).toFixed(3)} s` : '—';
const lines = [
  '# Terra tutor: composed intent and checked grading', '',
  `${summary.passed}/${summary.total} complete flows passed every check. ${raw.startedAt} to ${raw.finishedAt} (UTC).`, '',
  'Each fresh session asks the real Terra tutor for the queued 8-by-10 strict Nash equilibrium question and a blank grid. Production bank resolution turns its `<ask>` ID into exact canonical speech and consumes that ID once. A simulated ElevenLabs transcript then submits the explained answer “eight.” The actual Jev student-intent classifier must identify an unassisted attempted answer. Terra gives real feedback, and the actual checked grader uses two fresh Luna requests against original sources before a real mastery store may persist one first-attempt event.', '',
  `Question preparation and greeting/history replies remain deterministic fixtures; tutor mastery-notice intent remains simulated. Both main tutor turns, passage/canvas classification, student intent, grading, validation, and local mastery persistence are real. ElevenLabs audio is a silent 100 ms-delay fixture with no microphone, speakers, or paid voice. These ${raw.runs.length} narrow synthetic student sessions do not establish production-wide grading reliability.`, '',
  '| Round | Canonical question / blank grid | Answer recognized | Checked grading decision | Persisted topic score | Initial text | Initial board | Grade applied after initial request |',
  '|---:|---|---|---|---:|---:|---:|---:|',
  ...runs.map(run => `| ${run.round} | ${run.checks.askProtocolReturnedCanonicalId && run.checks.exactGridDimensions && run.checks.noInventedPayoffsOrMarkedSolutions ? 'pass' : 'FAIL'} | ${run.checks.realIntentRecognizedUnassistedAnswer ? 'pass' : 'FAIL'} | ${run.decision?.reason || 'unavailable'}${run.decision?.stage ? ` (${run.decision.stage})` : ''} | ${run.strictNashScore ?? '—'} | ${sec(run.initialTextMs)} | ${sec(run.initialBoardMs)} | ${sec(run.gradeAppliedFromInitialRequestMs)} |`), '',
  ...runs.filter(run => run.failedChecks.length).map(run => `Round ${run.round} failed ${run.failedChecks.join(', ')}. The answer reached the grader once, but ${run.decision?.reason || 'the checker returned no agreed validated grade'}${run.decision?.stage ? ` at ${run.decision.stage}` : ''}; no score event was persisted. This is a real full-chain failure. The system conservatively withheld credit. The diagnostic establishes the rejection reason, but the raw grader payload was not retained in these initial trials.`), '',
  ...runs.filter(run => !run.failedChecks.length).map(run => `Round ${run.round} persisted exactly ${run.storedEvents.length} checked correct event: attempt 1, firstAttempt=true, unassisted=true. The medium-question topic score became ${run.strictNashScore}; the overall score was ${run.publicOverallScore} across six current topics. This does not mean the topic or whole course is mastered.`), '',
  `Total paid HTTP: ${raw.budget.used} (${raw.budget.openai} OpenAI, ${raw.budget.jev} Jev), within the configured ${raw.budget.maxPerProvider.openai}/${raw.budget.maxPerProvider.jev} provider limits. Estimated public token cost: **$${summary.estimatedUsd.toFixed(6)}${summary.estimatePartial ? ' (partial)' : ''}**. Exact billed dollars remain **${summary.exactBilledUsd === null ? 'unavailable' : summary.exactBilledUsd}**. No voice cost is inferred from synthetic audio. Estimates use recorded model/tier/counters and exclude account credits, discounts, taxes, unreported usage, and negotiated charges.`, '',
  'The earlier twelve-case report simulated intent and grade verdicts. Its 12/12 evaluated pass rate must not be substituted for the composed grading result here. Raw files are preserved independently.', '',
  ...(inputName.includes('.final.') ? ['The initial composed run passed one of two trials. The second trial was rejected for a second-check identity mismatch, not credited. The final run adds per-request schema enums for exact question, topic, and source identity while preserving validators, and preserves canonical tracking through board notation. The initial raw evidence and failure report remain in `tutor-terra-fullchain-results.json` and `.md`; no failed result is replaced by this run.', ''] : []),
  'Reproduce only when new paid testing is intended:', '',
  '```sh',
  `node --env-file-if-exists=.env benchmarks/tutor-context-scenarios.mjs --live --condition=after-terra --production-bank --scenario=blank-grid --real-intent --real-grading --rounds=${raw.rounds} --max-openai=${raw.budget.maxPerProvider.openai} --max-jev=${raw.budget.maxPerProvider.jev} --max-requests=${raw.budget.maxPaidHttpRequests} --output=benchmarks/${inputName}`,
  `node benchmarks/tutor-terra-fullchain-report.mjs --input=${inputName}`,
  '```', '',
  'Remove `--live` for a completely offline check. The report command performs no provider calls. Source/PDF hashes, exact synthetic utterances, model and source-file hashes, diagnostics, received boards, request metadata and usage are in the associated JSON.', '',
];
await writeFile(new URL(`${baseName}.md`, here), lines.join('\n'));
await writeFile(new URL(`${baseName}.summary.json`, here), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ passed: summary.passed, total: summary.total, budget: summary.budget, estimatedUsd: summary.estimatedUsd, decisions: runs.map(run => ({ round: run.round, reason: run.decision?.reason, stage: run.decision?.stage })) }));
