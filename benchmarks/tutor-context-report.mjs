// Offline evaluation and readable report. Never makes provider requests.
// Initial raw measurements remain unchanged in tutor-context-results.initial.json.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const here = new URL('./', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('tutor-context-fixture.json', here), 'utf8'));
const source = { id: 'econ2801-pset3', name: fixture.source.name, text: fixture.pages.map(page => `[PDF page ${page.page}]\n${page.text}`).join('\n\n') };
const materials = [source, ...fixture.additionalSources.map(item => ({ id: item.id, name: item.name, text: item.pages.map(page => `[PDF page ${page.page}]\n${page.text}`).join('\n\n') }))];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const chunks = new Map();
// Exact original-passages-v1 chunk construction. Logged chunk IDs, source hashes,
// and original offsets allow the initial parser mistake to be corrected offline.
for (const material of materials) {
  const sourceHash = hash(['original-passages-v1', material.id, material.text]);
  for (let start = 0; start < material.text.length;) {
    let end = Math.min(material.text.length, start + 2000);
    if (end < material.text.length) {
      const paragraph = material.text.lastIndexOf('\n\n', end - 2), line = material.text.lastIndexOf('\n', end - 1);
      if (paragraph > start + 1000) end = paragraph + 2;
      else if (line > start + 1000) end = line + 1;
      if (/[\uD800-\uDBFF]/.test(material.text[end - 1]) && /[\uDC00-\uDFFF]/.test(material.text[end])) end--;
    }
    chunks.set(`c_${hash([sourceHash, start, end]).slice(0, 28)}`, { sourceId: material.id, text: material.text.slice(start, end), start, end });
    start = end;
  }
}
function evidenceFor(passages, scenario) {
  const original = passages.filter(p => p.sourceId === source.id).sort((a, b) => a.start - b.start).map(p => p.text).join('\n');
  if (scenario === 'source-payoff') return /1,\s*6,\s*1/.test(original);
  if (scenario === 'scene-switch') return /straight-line city/.test(original) && /point 0 to point 1/.test(original);
  return /8 strategies/.test(original) && /10 strategies/.test(original);
}
const rates = {
  'gpt-6-luna': { input: .1, cacheRead: .01, cacheWrite: .125, output: .5, source: 'https://developers.openai.com/api/docs/models/gpt-6-luna' },
  'gpt-5.6-terra': { input: 2, cacheRead: .2, cacheWrite: 2.5, output: 12, source: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra' },
};
function estimate(event) {
  const u = event.units || {}, rate = rates[event.model];
  if (event.provider === 'typesafe' && Number.isFinite(u.inputTokens)) return { usd: u.inputTokens * .042 / 1e6, partial: event.status !== 'completed', source: 'https://docs.typesafe.ai/models' };
  if (event.provider !== 'openai' || !rate || !Number.isFinite(u.inputTokens) || !Number.isFinite(u.outputTokens)) return null;
  const read = u.cachedInputTokens || 0, write = u.cacheWriteTokens || 0;
  if (read + write > u.inputTokens) return null;
  return { usd: ((u.inputTokens - read - write) * rate.input + read * rate.cacheRead + write * rate.cacheWrite + u.outputTokens * rate.output) / 1e6, partial: !Object.hasOwn(u, 'cacheWriteTokens') || !Object.hasOwn(u, 'cachedInputTokens') || event.status !== 'completed', source: rate.source };
}
function decorate(run) {
  const usage = run.usage || [], estimates = usage.filter(item => ['openai', 'typesafe'].includes(item.provider)).map(estimate);
  run.cost = { exactBilledUsd: usage.length && usage.every(item => Number.isFinite(item.providerReportedUsd)) ? usage.reduce((sum, item) => sum + item.providerReportedUsd, 0) : null, estimatedUsd: Number(estimates.reduce((sum, item) => sum + (item?.usd || 0), 0).toFixed(9)), estimatedPartial: estimates.some(item => !item || item.partial), note: 'Global standard public token rates including reported cache reads/writes. Estimate only; excludes credits, discounts, tax and unreported/in-flight usage. No paid voice calls.', rateSources: [...new Set(estimates.map(item => item?.source).filter(Boolean))] };
  run.openaiTokens = Object.fromEntries(['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'reasoningTokens'].map(key => [key, usage.filter(item => item.provider === 'openai').reduce((sum, item) => sum + (item.units?.[key] || 0), 0)]));
}
function reviewCity(run) {
  if (run.scenario !== 'scene-switch' || !run.board) return;
  const elements = run.board.blocks.filter(block => block.type === 'diagram').flatMap(block => block.elements);
  const line = elements.find(item => item.type === 'line' && Math.abs(item.y1 - item.y2) < 1);
  const a = elements.find(item => item.type === 'circle' && /^A\b/.test(item.label || ''));
  const b = elements.find(item => item.type === 'circle' && /^B\b/.test(item.label || ''));
  if (!line || !a || !b) return;
  const normalizedA = (a.x - line.x1) / (line.x2 - line.x1), normalizedB = (b.x - line.x1) / (line.x2 - line.x1);
  const labels = elements.map(item => item.text || item.label || '').join(' ');
  run.checks.trialPositionsGeometricallyCorrect = Math.abs(normalizedA - .2) < .02 && Math.abs(normalizedB - .8) < .02;
  run.boardDetailObservations = { normalizedA, normalizedB, numericTrialPositionsExplicitlyLabeled: /0\.2/.test(labels) && /0\.8/.test(labels), note: 'Geometry is scored separately from numeric coordinate labels. All source and received board evidence is retained.' };
}
const initial = JSON.parse(await readFile(new URL('tutor-context-results.initial.json', here), 'utf8'));
initial.evaluationAudit = [
  'Raw initial file is retained unchanged. This evaluated copy corrects presence checks without repeating provider calls.',
  'Initial tool-evidence evaluator expected materials, while tool results expose passages. Relevant evidence is reconstructed below from logged chunk IDs and the exact saved source fixture.',
  'The initial feedback keyword check was case-sensitive; Eight was incorrectly scored absent. Corrected using case-insensitive matching.',
  'Initial harness settled in the gap between recovery completion and its second Jev decision. Final board/visibility outcomes for recovery turns are inconclusive, not production failures. First-text, spoken reply, source request and generation usage remain observed.',
  'Later async diagnostics could arrive after trial cleanup. Events with decreasing atMs cannot support latency conclusions.',
];
for (const run of initial.runs) {
  const ids = [...new Set(run.diagnostics.filter(event => event.type === 'retrieval.tool-read').flatMap(event => event.details?.chunkIds || []))];
  if (ids.length) {
    const found = ids.map(id => chunks.get(id)).filter(Boolean);
    run.evidenceReevaluation = { method: 'exact logged chunk IDs reconstructed from saved fixture', loggedChunks: ids.length, reconstructedChunks: found.length, sourceIds: [...new Set(found.map(p => p.sourceId))], relevantOriginalEvidenceProvided: found.length === ids.length ? evidenceFor(found, run.scenario) : null };
    if (run.evidenceReevaluation.relevantOriginalEvidenceProvided === true) run.checks.relevantOriginalEvidenceProvided = true;
  }
  if (run.scenario === 'answer-feedback') run.checks.boundFeedbackPresent = /eight|\b8\b/i.test(run.reply || '') && /row|column/i.test(run.reply || '');
  if (run.diagnostics.some(event => event.type === 'whiteboard.recovery-started')) {
    run.boardOutcome = 'inconclusive-initial-harness-settlement-race';
    run.latencies.committedTranscriptToBoardMs = null;
    for (const key of ['exactGridDimensions', 'noInventedPayoffsOrMarkedSolutions', 'diagramOnlyBoard']) if (run.checks[key] === false || key === 'diagramOnlyBoard') run.checks[key] = null;
  }
  decorate(run);
  reviewCity(run);
}
await writeFile(new URL('tutor-context-results.json', here), JSON.stringify(initial, null, 2) + '\n');
let rerun = null;
try {
  rerun = JSON.parse(await readFile(new URL('tutor-context-results.rerun.json', here), 'utf8'));
  rerun.evaluationAudit = ['The initial geometry checker also required numeric coordinate labels. Geometry is corrected offline from the actual received line/circle coordinates; omitted numeric labels remain a separate observation.'];
  for (const run of rerun.runs) { decorate(run); reviewCity(run); }
  for (const condition of rerun.conditions) if (!condition.additionalSourceHashesAfterRun) condition.additionalSourceHashesAfterRun = { capturedAt: new Date().toISOString(), note: 'Production files held stable during this run; these additional files were hashed immediately after completion.', files: await Promise.all(['server/material-retrieval.mjs', 'server/tutor-context.mjs'].map(async file => ({ file, sha256: createHash('sha256').update(await readFile(new URL(`../${file}`, here))).digest('hex') }))) };
  await writeFile(new URL('tutor-context-results.rerun.json', here), JSON.stringify(rerun, null, 2) + '\n');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const median = values => { const a = values.filter(Number.isFinite).sort((a, b) => a - b); return a.length ? a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2 : null; };
const sec = value => Number.isFinite(value) ? (value / 1000).toFixed(3) : '—';
const first = run => run.requests.find(request => request.provider === 'openai' && request.context?.bankQuestionIds)?.context;
const datasets = [{ label: 'Initial', report: initial }, ...(rerun ? [{ label: 'Corrected rerun', report: rerun }] : [])];
const lines = ['# Tutor context scenario measurements', '', `Original run: ${initial.startedAt} to ${initial.finishedAt} (UTC).`, '', 'Twelve initial cases compare the frozen original Luna implementation, retrieval-enabled Luna, and retrieval-enabled Terra. A condition is run once per scenario, in source-payoff → blank-grid → scene-switch → answer-feedback order; within each scenario: before Luna → after Luna → after Terra. The saved JSON retains every response, board, provider request, context hash, token counter and check.', '', '## Source and method', '', `Three real ECON 2801 PDFs from Downloads contain ${initial.source.totalCharacters.toLocaleString()} extracted characters:`, '', ...initial.source.corpus.map(item => `- ${item.name}: ${item.characters.toLocaleString()} characters; SHA-256 of extracted text: ${item.textSha256}.`), '', 'The Pset 3 two-page source was visually verified, including both payoff tables and the 8-by-10 question. Pset 2 and corrected Pset 5 solutions provide the surrounding corpus. Pset 1 and 4 solution files were excluded because extraction was mostly incomplete. This is an extracted-text test, not an OCR accuracy evaluation.', '', 'The real local WebSocket/live-voice pipeline receives simulated ElevenLabs committed transcripts. OpenAI and Jev are real; intent classification, greetings/history, and grade verdicts are explicit fixtures. Returned silent PCM is generated after a fixed 100 ms fixture delay and never played. Audio numbers below do not measure ElevenLabs, microphone or device playback latency.', '', 'Five fixture exchanges preserve an early no-spoiler preference. During that priming only, simulated passage decisions initialize a previous working context with Pset 2 passages. Measured requests use real Jev; an unresolved selection must use original-source tools rather than treat the previous passage as sufficient.', '', '## Measured timing', '', '| Run | Condition | Cases | Median first text | Median synthetic first audio | Median text complete | Median initial context bytes | Total OpenAI input tokens |', '|---|---|---:|---:|---:|---:|---:|---:|'];
if (rerun) {
  lines.splice(2, 0,
    'The corrected rerun selected relevant original passages in all eight cases and retained every pending bank question and the earlier learner preference. Median initial context fell from 31,598.5 to 14,867 bytes. This did not make Luna consistently faster: its median first text was 2.282 seconds versus the original 1.647 seconds. Terra reached 1.203 seconds in this small rerun, with substantially higher token rates.', '',
    '**Remaining failure:** Luna twice substituted the source document’s wording for the queued question’s wording. The recovered blank grid was correct, but that question did not become eligible for automatic grading. The lower-level forced-recovery regression is fixed; the model’s queued-question selection/wording reliability is still unresolved. No loose question matching or unearned grade is used to hide this result.', '',
    'Terra passed the target checks in these four cases. Its city diagram placed A and B correctly but omitted explicit 0.2/0.8 coordinate labels. Its answer-feedback board also took 7.010 seconds, so it was not faster on every visual. These cases do not establish a general model-quality ranking or justify an automatic model switch.', '');
}
for (const dataset of datasets) for (const condition of dataset.report.conditions) {
  const rows = dataset.report.runs.filter(run => run.condition === condition.id);
  lines.push(`| ${dataset.label} | ${condition.id} | ${rows.length} | ${sec(median(rows.map(r => r.latencies.committedTranscriptToFirstTextMs)))} s | ${sec(median(rows.map(r => r.latencies.committedTranscriptToSyntheticAudioMs)))} s | ${sec(median(rows.map(r => r.latencies.committedTranscriptToTextCompleteMs)))} s | ${median(rows.map(r => first(r)?.inputBytes))} | ${rows.reduce((n, r) => n + r.openaiTokens.inputTokens, 0)} |`);
}
lines.push('', 'First text means committed simulated transcript to the first spoken-text latency message at the local client, including prefetch and source-tool rounds. Text complete includes final model output. Board time means a validated visible canvas received at the local client, not browser paint. Cached counts vary between calls; none of these small-sample medians is a production percentile.', '', 'When the question is not tracked, dependent grading-evidence checks also fail because grading was never invoked; those flags do not mean source text or history was discarded.', '', '| Run | Condition / scenario | First text | Synthetic audio | Board received (s) | Failed / inconclusive checks |', '|---|---|---:|---:|---:|---|');
for (const dataset of datasets) for (const r of dataset.report.runs) lines.push(`| ${dataset.label} | ${r.condition} / ${r.scenario} | ${sec(r.latencies.committedTranscriptToFirstTextMs)} s | ${sec(r.latencies.committedTranscriptToSyntheticAudioMs)} s | ${sec(r.latencies.committedTranscriptToBoardMs)} | ${Object.entries(r.checks).filter(([, value]) => value !== true).map(([key, value]) => `${key}${value === null ? ' (inconclusive)' : ''}`).join(', ') || 'None'}${r.boardOutcome ? '; recovery board outcome inconclusive' : ''} |`);
lines.push('', '## Usage and limitations', '');
for (const dataset of datasets) {
  const estimated = dataset.report.runs.reduce((sum, run) => sum + run.cost.estimatedUsd, 0);
  lines.push(`${dataset.label}: **${dataset.report.budget.openai} OpenAI + ${dataset.report.budget.jev} Jev requests** attempted; no paid voice. Provider-reported billed USD is unavailable. Estimated token cost is **$${estimated.toFixed(6)}${dataset.report.runs.some(run => run.cost.estimatedPartial) ? ' (partial)' : ''}**, using the documented standard model rates and actual returned token counters.`, '');
}
lines.push('Estimates include reported cache-read discounts and cache-write premiums, and count reasoning once within output tokens. They exclude credits, discounts, taxes, regional premiums and unavailable usage. Rates: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Jev](https://docs.typesafe.ai/models).', '', 'The initial harness had two evaluation defects: tool results expose passages rather than materials, and one keyword check missed capitalized “Eight”. Both checks are repaired offline with the original evidence. Its recovery-settlement race also canceled pending final board decisions, so four initial recovery board outcomes remain inconclusive. The original JSON is preserved; first-text timings and generated replies remain valid observations.', '', 'A separate forced-recovery offline case found a server eligibility issue: replaying the already-consumed queued question during visual recovery cleared the active question. This is distinct from the initial Luna paraphrase of the queued question. The corrected rerun, when present above, uses the final production fix and the repaired quiet-window settlement check.', '', 'Passing source-evidence checks proves the required original passage was available to the model, not that its hidden computation used it. A correct tuple alone cannot prove grounding because private question-bank references also exist. Grading checks verify server eligibility and full original evidence retention; the grading verdict itself is simulated. No bank entries or older learner requests are intentionally removed.', '', '## Reproduction', '', 'The baseline source snapshot is in `benchmarks/baselines/tutor-before-retrieval`; it contains source files and hashes, without credentials or node_modules. The source fixture is `benchmarks/tutor-context-fixture.json`. The offline harness defaults to no provider calls:', '', '```sh', 'node benchmarks/tutor-context-scenarios.mjs', 'node benchmarks/tutor-context-scenarios.mjs --condition=after-luna --scenario=blank-grid --simulate-recovery --output=/tmp/luna-recovery-check.json', 'node benchmarks/tutor-context-report.mjs', '```', '', 'Live benchmarking is explicit and bounded; it reads environment configuration in memory. Do not run it again accidentally:', '', '```sh', 'node --env-file-if-exists=.env benchmarks/tutor-context-scenarios.mjs --live --max-openai=24 --max-jev=24 --max-requests=48', '```', '');
await writeFile(new URL('tutor-context-results.md', here), lines.join('\n'));
console.log(JSON.stringify({ datasets: datasets.map(d => ({ label: d.label, requests: d.report.budget, cases: d.report.runs.length })), report: 'benchmarks/tutor-context-results.md' }));
