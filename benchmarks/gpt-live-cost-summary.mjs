import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const round = value => Math.round(value * 1e12) / 1e12;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const sum = values => round(values.reduce((total, value) => total + (finite(value) ? value : 0), 0));
const mergeUnits = values => {
  const result = {};
  for (const units of values) for (const [key, value] of Object.entries(units || {})) if (finite(value)) result[key] = sum([result[key], value]);
  return result;
};

// These two paid probes ran directly through exec rather than the benchmark
// runner. Preserve only facts printed by those completed tool calls. This is a
// reconstruction from session output, not a raw provider-event archive.
const directProbes = [
  { id: 'initial-approved-greeting', at: '2026-10-02T17:54:31.707Z', evidence: 'completed exec session60526', provenance: 'reconstructed-from-tool-output', providerFinalSeconds: 4, finalized: true, backendRequests: 0, firstDeliveredAudioFromApprovedCommentaryMs: 904, actualTextMatched: true, limitation: 'Continuous silent PCM; fixed approved greeting; excludes speech recognition and tutor reasoning.' },
  { id: 'revised-approved-utterances', at: '2026-10-02T18:00:36.131Z', evidence: 'completed exec session82998', provenance: 'reconstructed-from-tool-output', providerFinalSeconds: 13, finalized: true, backendRequests: 0, trials: [
    { id: 'greeting', firstDeliveredAudioFromApprovedCommentaryMs: 1087, completeMs: 5886, actualTextMatched: true },
    { id: 'membrane-question', firstDeliveredAudioFromApprovedCommentaryMs: 883, completeMs: 7039, actualTextMatched: true },
  ], limitation: 'Continuous silent PCM; fixed approved replies; excludes speech recognition and tutor reasoning.' },
];
const environmentExceptions = {
  'gpt-live-policy-02.json:gpt-live': { status: 'invalid-for-performance', reason: 'Host entered Idle Sleep during the measured request.', source: 'pmset -g log, independently checked 2026-10-02', sleepAt: '2026-10-02T14:11:01-04:00', wakeAt: '2026-10-02T14:12:58-04:00', sleepingSeconds: 117 },
};

export async function collectGptLiveExperiment() {
  const names = (await readdir(directory)).filter(name => /^gpt-live-(?:smoke|policy)-\d+\.json$/.test(name)).sort();
  const reports = await Promise.all(names.map(async name => ({ name, report: JSON.parse(await readFile(path.join(directory, name), 'utf8')) })));
  const selected = new Map(), duplicates = [];
  const inputClips = [], accountObservations = [], runStatus = [];
  for (const { name, report } of reports) {
    runStatus.push({ file: name, startedAt: report.startedAt, finishedAt: report.finishedAt ?? null, status: report.status, providerRequests: report.providerRequests });
    for (const source of report.sources || (report.source ? [report.source] : [])) inputClips.push({ file: name, id: source.id ?? 'transport-practice', ...source, chargedCredits: source.chargedCredits ?? source.providerReportedCredits ?? null, estimatedUsd: source.estimatedUsd ?? null });
    if (report.elevenBudget) accountObservations.push({ file: name, beforeUsed: report.elevenBudget.before?.used ?? null, afterUsed: report.elevenBudget.after?.used ?? null, observedAccountCreditDelta: report.elevenBudget.observedAccountCreditDelta ?? null,
      reservedCredits: report.elevenBudget.reservedCredits, limitation: 'Account-wide and possibly delayed; not attributable input-clip charges. Reservations are limits, not spend.' });
    for (const session of report.sessions || []) {
      if (!session.testId) continue;
      const row = { file: name, testId: session.testId, arm: session.arm, status: session.status, qualityStatus: session.qualityStatus ?? 'not-recorded', error: session.error ?? session.probe?.failure ?? null,
        environment: environmentExceptions[`${name}:${session.arm}`] ?? null,
        usageRecorded: Boolean(session.usage), totals: session.usage?.totals ?? null, categories: session.usage?.categories ?? [],
        trials: (session.probe?.trials || []).map(trial => ({ id: trial.id, status: trial.status, speechEndToCommitMs: trial.energySpeechEndToCommitMs ?? null, speechEndToFirstTextMs: trial.energySpeechEndToFirstTextMs ?? null, speechEndToFirstReceivedAudioMs: trial.energySpeechEndToFirstAudioMs ?? null, commitToFirstAudioMs: trial.commitToFirstAudioMs ?? null, usefulAnswerAudioMs: trial.firstUsefulAudioMs ?? null, error: trial.error ?? null })),
        spokenFidelity: session.spokenFidelity ?? [], snapshotAt: report.finishedAt || report.startedAt,
      };
      const prior = selected.get(session.testId);
      if (prior) {
        duplicates.push({ testId: session.testId, files: [prior.file, name] });
        // Select one latest snapshot, never add repeated cumulative snapshots.
        if (Date.parse(row.snapshotAt) < Date.parse(prior.snapshotAt)) continue;
      }
      selected.set(session.testId, row);
    }
  }
  const rows = [...selected.values()];
  for (const row of rows) {
    if (row.file === 'gpt-live-smoke-04.json') row.qualityStatus = 'failed-independent-fidelity-review';
    const voice = row.categories.find(category => category.id === 'voice');
    row.voiceFinalizationConfirmed = row.arm === 'gpt-live' ? Boolean(voice?.requests > 0 && voice.statusCounts?.completed === voice.requests && finite(voice.units?.sessionDurationMs)) : null;
    row.performanceUsable = row.status === 'complete' && !row.environment && !row.qualityStatus.startsWith('failed');
  }
  const categories = Object.fromEntries(['voice', 'llm', 'jev'].map(id => {
    const entries = rows.flatMap(row => row.categories.filter(category => category.id === id));
    return [id, { requests: sum(entries.map(entry => entry.requests)), estimatedUsd: sum(entries.map(entry => entry.estimatedUsd)), unestimatedRequests: sum(entries.map(entry => entry.unestimatedRequests)), partialEstimatedRequests: sum(entries.map(entry => entry.partialEstimatedRequests)), units: mergeUnits(entries.map(entry => entry.units)), statusCounts: mergeUnits(entries.map(entry => entry.statusCounts)) }];
  }));
  const benchmarkLiveSeconds = sum(rows.filter(row => row.arm === 'gpt-live').map(row => row.categories.find(category => category.id === 'voice')?.units?.sessionDurationMs / 1000));
  const confirmedBenchmarkLiveSeconds = sum(rows.filter(row => row.arm === 'gpt-live' && row.voiceFinalizationConfirmed).map(row => row.categories.find(category => category.id === 'voice')?.units?.sessionDurationMs / 1000));
  const directSeconds = sum(directProbes.map(probe => probe.providerFinalSeconds));
  let access = null;
  try { access = JSON.parse(await readFile(path.join(directory, 'gpt-live-access.json'), 'utf8')); } catch { /* An absent probe is not presumed free. */ }
  const accessSeconds = access?.finalized && finite(access?.usage?.seconds) ? access.usage.seconds : null;
  const directVoiceEstimatedUsd = round(directSeconds * .05 / 60);
  return {
    generatedAt: new Date().toISOString(), scope: 'Numbered GPT-Live smoke/policy benchmark files plus explicitly reconstructed direct transport probes; excludes interactive user demo sessions and all unrelated prior experiments.',
    runStatus, sessions: rows, duplicateSnapshotsIgnored: duplicates,
    aggregate: { benchmarkSessions: rows.length, applicationRequests: sum(rows.map(row => row.totals?.requests)), sessionsFailed: rows.filter(row => row.status === 'failed').length, environmentInvalidSessions: rows.filter(row => row.environment).length, sessionsStillRunning: rows.filter(row => row.status === 'running').length, sessionsWithoutUsage: rows.filter(row => !row.usageRecorded).length,
      benchmarkEstimatedUsd: sum(rows.map(row => row.totals?.estimatedUsd)), directVoiceEstimatedUsd,
      measuredUsageEstimatedUsd: sum([...rows.map(row => row.totals?.estimatedUsd), directVoiceEstimatedUsd, finite(accessSeconds) ? accessSeconds * .05 / 60 : 0]),
      exactBilledUsd: null, inputClipEstimatedUsd: null,
      benchmarkLiveProviderSeconds: benchmarkLiveSeconds, directLiveProviderSeconds: directSeconds, accessProviderSeconds: accessSeconds,
      confirmedBenchmarkLiveProviderSeconds: confirmedBenchmarkLiveSeconds,
      liveSessionsWithoutConfirmedFinalDuration: rows.filter(row => row.arm === 'gpt-live' && !row.voiceFinalizationConfirmed).length,
      allRecordedLiveProviderSeconds: sum([benchmarkLiveSeconds, directSeconds, accessSeconds]),
      liveVoiceListPriceEstimatedUsd: round(sum([benchmarkLiveSeconds, directSeconds, accessSeconds]) * .05 / 60),
      missingUsageRequests: sum(rows.map(row => row.totals?.missingUsageRequests)), unestimatedRequests: sum(rows.map(row => row.totals?.unestimatedRequests)), categories,
      inputClipCalls: inputClips.length, inputClipCharacters: sum(inputClips.map(clip => clip.generationCharacters)),
    },
    inputClips, accountObservations, directProbes, accessProbe: access ? { file: 'gpt-live-access.json', access: access.access, finalized: access.finalized, startMs: access.startMs, providerSeconds: accessSeconds } : null,
    sources: [...new Set(rows.flatMap(row => row.totals?.estimateSources?.map(source => source.source) || []).concat('https://developers.openai.com/api/docs/models/gpt-live-1'))],
    limitations: [
      'All USD figures are public list-price estimates, not invoice charges. Missing failed/canceled backend usage and input-clip synthesis USD remain excluded, not zero.',
      'Session.usage.updated and final session.closed are cumulative snapshots. This report counts each per-test final usage snapshot once and never adds intermediate provider events.',
      'Category totals partition benchmark estimates. Do not add category totals or GPT-Live voice subtotals to the already combined experiment estimate.',
      'Input synthesis reservations do not show charged credits. Account before/after changes can lag or include other activity and cannot be converted into attributable input-clip USD.',
      'First received audio can be filler or an unauthorized continuation. It is not first useful approved-answer latency. Different runs may use different generated PCM even with the same seed.',
      'Direct fixed-text probes test voice transport only and cannot be compared directly with end-to-end student-speech latency.',
      'Normalized transcript equality does not prove that corresponding audio was played. Legacy smoke04 is explicitly quality-failed despite transport complete.',
      'Policy02 Live overlapped an independently verified 117-second host idle sleep. Its timings and timeout are invalid for API performance/reliability inference; its measured cost still belongs in the subtotal and absent final usage remains unknown.',
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await collectGptLiveExperiment();
  await writeFile(path.join(directory, 'gpt-live-cost-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.aggregate, null, 2));
}
