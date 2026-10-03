// Isolated debug-viewer QA. Provider requests, voice sockets, and microphone are mocked.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const baseUrl = process.env.USAGE_QA_URL || 'http://127.0.0.1:5188';
const startedAt = '2026-10-02T14:00:00.000Z';
const activityMeasurement = 'Server events describe generated or transmitted content, not confirmed speaker playback. Client import events are browser-reported.';
const persistenceFailure = 'Debug history could not be saved; current events are available in memory only.';
let activityStorageError = false;
let estimatedFixture = false, usageStorageStatus = 'ok', estimateVersion = 0, unknownEstimate = false;
const empty = { requests: 0, reportedCostRequests: 0, unpricedRequests: 0, pendingRequests: 0, providerReportedUsd: null, exactUsd: null, complete: false, units: {} };
const fixture = testId => ({
  testId, trackingStartedAt: startedAt, scope: 'since-tracking-started', currency: 'USD',
  totals: { requests: 5, reportedCostRequests: 2, unpricedRequests: 3, pendingRequests: 1, providerReportedUsd: .0191111101, exactUsd: null, complete: false, units: {} },
  categories: [
    { id: 'jev', label: 'Jev', requests: 1, reportedCostRequests: 1, unpricedRequests: 0, pendingRequests: 0, providerReportedUsd: .000345678, exactUsd: .000345678, complete: true, units: { inputTokens: 12, outputTokens: 4 } },
    { id: 'llm', label: 'Thinking / LLM', requests: 3, reportedCostRequests: 1, unpricedRequests: 2, pendingRequests: 1, providerReportedUsd: .0187654321, exactUsd: null, complete: false, units: { inputTokens: 42, outputTokens: 23 } },
    { id: 'voice', label: 'Voice', requests: 1, reportedCostRequests: 0, unpricedRequests: 1, pendingRequests: 0, providerReportedUsd: null, exactUsd: null, complete: false, units: { characters: 160 } },
  ],
  notes: ['Synthetic provider-returned cost fixtures.'],
});
const estimatedUsageFixture = testId => {
  const value = fixture(testId);
  const sources = [
    { rateId: 'synthetic-llm-rate', source: 'https://openai.com/api/pricing/', verifiedAt: '2026-10-02', notes: ['Synthetic QA assumption: measured token usage only.'] },
    { rateId: 'synthetic-voice-rate', source: 'https://elevenlabs.io/pricing/api', verifiedAt: '2026-10-02', notes: ['Synthetic QA assumption: generated audio does not prove playback.'] },
  ];
  Object.assign(value, { storage: { status: usageStorageStatus }, unattributed: { requests: 2, estimatedUsd: 99 } });
  Object.assign(value.totals, { estimatedUsd: .025 + estimateVersion * .01, estimatedRequests: 3, unestimatedRequests: 2, partialEstimatedRequests: 1, estimateComplete: false, missingUsageRequests: 1, estimateSources: sources });
  Object.assign(value.categories[0], { estimatedUsd: 7, estimatedRequests: 1, estimateComplete: true });
  Object.assign(value.categories[1], { estimatedUsd: unknownEstimate ? null : .024654322 + estimateVersion * .01, estimatedRequests: unknownEstimate ? 0 : 2, unestimatedRequests: unknownEstimate ? 3 : 1, partialEstimatedRequests: 1, estimateComplete: false, missingUsageRequests: 1 });
  Object.assign(value.categories[2], { estimatedUsd: null, estimatedRequests: 0, unestimatedRequests: 1, estimateComplete: false, units: { characters: 160, audioInputMs: 1500, audioOutputMs: 2450 } });
  if (estimateVersion) {
    Object.assign(value.categories[1], { estimatedUsd: unknownEstimate ? null : .026654322 });
    Object.assign(value.categories[2], { estimatedUsd: .008, estimatedRequests: 1, unestimatedRequests: 0, estimateComplete: true });
    Object.assign(value.totals, { estimatedRequests: 4, unestimatedRequests: 1 });
  }
  if (unknownEstimate) Object.assign(value.totals, { estimatedUsd: .008345678, estimatedRequests: 2, unestimatedRequests: 3 });
  return value;
};
const activityFixture = testId => ({
  testId, trackingStartedAt: startedAt, truncated: false, storageError: activityStorageError ? persistenceFailure : null, measurement: activityMeasurement,
  events: [
    { id: 'recovered', at: '2026-10-02T14:00:04.000Z', origin: 'server', type: 'whiteboard.recovery-completed', turnId: 4, details: { latencyMs: 241.5 } },
    { id: 'later', at: '2026-10-02T14:00:02.000Z', origin: 'server', type: 'whiteboard.decision', turnId: 4, details: { needsCanvas: true, probability: .86, visible: false, hasBoard: false, reason: 'visual-explanation' } },
    { id: 'earlier', at: '2026-10-02T14:00:01.000Z', origin: 'client', type: 'import.completed', details: { added: 1, duplicates: 1, failed: 0 } },
    { id: 'recovery', at: '2026-10-02T14:00:03.000Z', origin: 'server', type: 'whiteboard.recovery-started', turnId: 4, details: { reason: 'missing-board', model: 'gpt-6-luna' } },
  ],
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [], requests = [], counts = { usage: 0, activity: 0 };
let firstTestId, secondTestId, failUsage = false, releaseSecond;
const secondResponse = new Promise(resolve => { releaseSecond = resolve; });
page.on('pageerror', error => errors.push(error.message));
await mkdir('artifacts', { recursive: true });
await page.addInitScript(() => {
  const node = () => ({ connect() {}, disconnect() {} });
  class SilentContext {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { return node(); }
    createGain() { return { ...node(), gain: { value: 1 } }; }
  }
  window.AudioContext = SilentContext;
  window.webkitAudioContext = SilentContext;
  window.AudioWorkletNode = class { constructor() { Object.assign(this, node()); this.port = {}; } };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
});
await context.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  requests.push(path);
  if (path === '/api/debug/usage' || path === '/api/debug/activity') {
    assert.equal(route.request().method(), 'POST');
    const { testId } = route.request().postDataJSON();
    assert.match(testId, /^[0-9a-f-]{36}$/i);
    firstTestId ||= testId;
    if (path.endsWith('/activity')) { counts.activity++; return route.fulfill({ json: activityFixture(testId) }); }
    counts.usage++;
    if (failUsage) return route.fulfill({ status: 503, json: { error: 'Synthetic usage service unavailable.' } });
    if (testId !== firstTestId) {
      secondTestId = testId;
      await secondResponse;
      return route.fulfill({ json: { ...fixture(testId), totals: empty, categories: ['jev', 'llm', 'voice'].map(id => ({ id, ...empty })) } });
    }
    return route.fulfill({ json: estimatedFixture ? estimatedUsageFixture(testId) : fixture(testId) });
  }
  if (path === '/api/debug/event') return route.fulfill({ json: { ok: true } });
  if (path === '/api/status') return route.fulfill({ json: { mode: 'live', organizer: 'synthetic', voice: 'synthetic' } });
  return route.abort('blockedbyclient');
});
await context.routeWebSocket('**', socket => {
  if (!new URL(socket.url()).pathname.endsWith('/api/live-voice')) { socket.close(); return; }
  socket.onMessage(data => {
  if (JSON.parse(data.toString()).type === 'start') socket.send(JSON.stringify({ type: 'ready', sampleRate: 16000 }));
  });
});

async function createTest(name) {
  await page.getByRole('button', { name: 'New test', exact: true }).click();
  await page.getByLabel('Class', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Test usage and activity (debug)', exact: true }).waitFor();
}
async function checkOverflow(drawer) {
  const size = await drawer.evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth, rect: element.getBoundingClientRect().width, viewport: innerWidth, body: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.width + 1, `drawer horizontal overflow: ${JSON.stringify(size)}`);
  assert.ok(size.rect <= size.viewport + 1 && size.body <= size.viewport + 1, `page horizontal overflow: ${JSON.stringify(size)}`);
}

try {
  await page.goto(baseUrl);
  await createTest('Usage QA');
  assert.deepEqual(counts, { usage: 0, activity: 0 }, 'debug polling is opt-in');
  await page.getByRole('button', { name: 'Test usage and activity (debug)', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Test usage and activity debug', exact: true });
  await drawer.getByText('$0.000345678', { exact: true }).waitFor();
  await drawer.getByText('$0.0187654321 partial', { exact: true }).waitFor();
  assert.equal(await drawer.locator('.usage-unavailable').count(), 3, 'missing voice/LLM/total cost is unavailable');
  assert.equal(await drawer.locator('dd').filter({ hasText: /^\$0\.00$/ }).count(), 0, 'unknown costs are never fabricated as zero');
  assert.match(await drawer.locator('.usage-row').filter({ hasText: 'Thinking / LLM' }).innerText(), /1 pending/);
  assert.equal(counts.activity, 0, 'inactive activity view does not poll');
  await drawer.getByText('Usage details', { exact: true }).click();
  assert.match(await drawer.locator('.usage-details pre').innerText(), /"characters": 160/);
  await drawer.getByText('Usage details', { exact: true }).click();
  await checkOverflow(drawer);
  await page.screenshot({ path: 'artifacts/usage-debug-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await checkOverflow(drawer);
  await page.screenshot({ path: 'artifacts/usage-debug-mobile.png', fullPage: true });

  failUsage = true;
  await drawer.getByRole('button', { name: 'Refresh test usage', exact: true }).click();
  await drawer.getByRole('alert').waitFor();
  assert.match(await drawer.getByRole('alert').innerText(), /Showing the last successful update/);
  assert.equal(await drawer.getByText('$0.000345678', { exact: true }).count(), 1, 'failed refresh retains last good data');
  failUsage = false;
  await drawer.getByRole('button', { name: 'Refresh test usage', exact: true }).click();
  await drawer.getByRole('alert').waitFor({ state: 'detached' });

  estimatedFixture = true;
  usageStorageStatus = 'write-error';
  await drawer.getByRole('button', { name: 'Refresh test usage', exact: true }).click();
  await drawer.getByText('≈ $0.025', { exact: true }).waitFor();
  assert.equal(await drawer.getByText('Partial estimate', { exact: true }).count(), 2);
  assert.equal(await drawer.getByText('$0.000345678', { exact: true }).count(), 1, 'billed Jev amount takes precedence over its estimate');
  assert.equal(await drawer.getByText('≈ $7.00', { exact: true }).count(), 0);
  assert.equal(await drawer.locator('.usage-unavailable').count(), 1, 'unknown voice cost remains unavailable beside estimates');
  assert.equal(await drawer.locator('dd').filter({ hasText: /^(?:≈ )?\$0\.00$/ }).count(), 0);
  const llm = drawer.locator('.usage-row').filter({ hasText: 'Thinking / LLM' });
  assert.match(await llm.innerText(), /1 unestimated.*1 missing usage/);
  assert.match(await llm.innerText(), /42 input tokens.*23 output tokens/);
  const voice = drawer.locator('.usage-row').filter({ hasText: /^Voice/ });
  assert.match(await voice.innerText(), /160 characters sent.*1\.5s audio sent.*2\.5s audio generated/);
  assert.match(await drawer.getByRole('alert').innerText(), /could not be saved.*retry automatically/);
  assert.match(await drawer.innerText(), /2 app request\(s\) have no test assignment/);
  assert.equal(await drawer.getByText('≈ $99.00', { exact: true }).count(), 0, 'unattributed usage never enters this test total');
  await drawer.getByText('Pricing sources and assumptions', { exact: true }).click();
  for (const [name, href] of [['synthetic-llm-rate', 'https://openai.com/api/pricing/'], ['synthetic-voice-rate', 'https://elevenlabs.io/pricing/api']]) {
    const link = drawer.getByRole('link', { name, exact: true });
    assert.equal(await link.getAttribute('href'), href);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noreferrer');
  }
  assert.equal(await drawer.getByText('Verified 2026-10-02', { exact: true }).count(), 2);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await drawer.evaluate(element => { element.scrollTop = 0; });
  await checkOverflow(drawer);
  await page.screenshot({ path: 'artifacts/usage-debug-estimated-desktop.png', fullPage: true });
  await drawer.getByRole('link', { name: 'synthetic-voice-rate', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/usage-debug-pricing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await drawer.evaluate(element => { element.scrollTop = 0; });
  await checkOverflow(drawer);
  await page.screenshot({ path: 'artifacts/usage-debug-estimated-mobile.png', fullPage: true });
  await drawer.getByRole('link', { name: 'synthetic-voice-rate', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/usage-debug-pricing-mobile.png', fullPage: true });
  usageStorageStatus = 'read-error';
  await drawer.getByRole('button', { name: 'Refresh test usage', exact: true }).click();
  await drawer.getByRole('alert').filter({ hasText: 'existing file is preserved' }).waitFor();
  usageStorageStatus = 'ok';
  await drawer.getByRole('button', { name: 'Refresh test usage', exact: true }).click();
  await drawer.getByRole('alert').waitFor({ state: 'detached' });
  const beforeEstimatePoll = counts.usage;
  estimateVersion = 1;
  await drawer.getByText('≈ $0.035', { exact: true }).waitFor({ timeout: 5000 });
  assert.ok(counts.usage > beforeEstimatePoll, 'open estimates refresh automatically');
  assert.equal(await voice.getByText('≈ $0.008', { exact: true }).count(), 1);
  assert.equal(await voice.getByText('Estimated usage cost', { exact: true }).count(), 1, 'complete estimated coverage is distinguished from a partial estimate');
  unknownEstimate = true;
  await drawer.getByRole('button', { name: 'Refresh test usage', exact: true }).click();
  await llm.getByText('Unavailable', { exact: true }).waitFor();
  assert.equal(await llm.locator('strong').count(), 0, 'losing measured usage clears the previous estimate rather than retaining it or substituting zero');
  assert.match(await llm.innerText(), /3 unestimated.*1 missing usage/);

  await drawer.getByRole('button', { name: 'Activity', exact: true }).click();
  await drawer.getByText('4 recorded events', { exact: true }).waitFor();
  assert.deepEqual(await drawer.locator('.usage-event-heading>span').allTextContents(), ['import completed', 'whiteboard decision', 'whiteboard recovery started', 'whiteboard recovery completed'], 'activity is chronological');
  assert.equal(await drawer.getByRole('alert').count(), 0, 'healthy persistence does not show an alert');
  assert.equal(await drawer.getByText(activityMeasurement, { exact: true }).count(), 1, 'endpoint measurement limitations are visible');
  const decision = drawer.locator('.usage-events>li').filter({ hasText: 'whiteboard decision' });
  await decision.getByText('Event details', { exact: true }).click();
  assert.match(await decision.locator('pre').innerText(), /"needsCanvas": true/);
  assert.match(await decision.locator('pre').innerText(), /"probability": 0.86/);
  await decision.getByText('Event details', { exact: true }).click();
  const recovery = drawer.locator('.usage-events>li').filter({ hasText: 'whiteboard recovery started' });
  await recovery.getByText('Event details', { exact: true }).click();
  assert.match(await recovery.locator('pre').innerText(), /"reason": "missing-board"/);
  assert.match(await recovery.locator('pre').innerText(), /"model": "gpt-6-luna"/);
  await recovery.getByText('Event details', { exact: true }).click();
  await drawer.locator('.usage-events>li').last().getByText('Event details', { exact: true }).click();
  assert.match(await drawer.locator('.usage-events>li').last().locator('pre').innerText(), /"latencyMs": 241.5/);
  await checkOverflow(drawer);
  await page.screenshot({ path: 'artifacts/usage-debug-activity-mobile.png', fullPage: true });
  activityStorageError = true;
  await drawer.getByRole('button', { name: 'Refresh test activity', exact: true }).click();
  await drawer.getByRole('alert').waitFor();
  assert.equal(await drawer.getByRole('alert').innerText(), persistenceFailure, 'storage failures remain visible even when HTTP succeeds');
  activityStorageError = false;
  await drawer.getByRole('button', { name: 'Refresh test activity', exact: true }).click();
  await drawer.getByRole('alert').waitFor({ state: 'detached' });
  const usageAtActivity = counts.usage, activityBeforePoll = counts.activity;
  await page.waitForTimeout(3200);
  assert.equal(counts.usage, usageAtActivity, 'switching tabs stops old endpoint polling');
  assert.ok(counts.activity > activityBeforePoll, 'active tab refreshes automatically');
  await drawer.getByRole('button', { name: 'Close test usage', exact: true }).click();
  await drawer.waitFor({ state: 'detached' });
  const afterClose = { ...counts };
  await page.waitForTimeout(3200);
  assert.deepEqual(counts, afterClose, 'closing stops both polling loops');

  await page.getByRole('button', { name: 'Back to tests', exact: true }).click();
  await createTest('Empty usage QA');
  await page.getByRole('button', { name: 'Test usage and activity (debug)', exact: true }).click();
  await drawer.getByRole('status').waitFor();
  assert.equal(await drawer.getByText('$0.000345678', { exact: true }).count(), 0, 'previous test costs do not leak while another test loads');
  assert.equal(await drawer.locator('strong').filter({ hasText: '≈' }).count(), 0, 'previous test estimates do not leak while another test loads');
  await page.waitForFunction(() => document.querySelector('.usage-message[role=status]')?.textContent.includes('Loading usage'));
  releaseSecond();
  await drawer.locator('.usage-row').first().getByText('No requests yet', { exact: true }).waitFor();
  assert.notEqual(firstTestId, secondTestId);
  assert.equal(await drawer.locator('.usage-unavailable').count(), 4, 'empty test shows unavailable rather than zero');
  assert.equal(await drawer.getByText('No requests yet', { exact: true }).count(), 4);
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });

  assert.deepEqual(errors, []);
  assert.ok(requests.every(path => ['/api/status', '/api/debug/usage', '/api/debug/activity', '/api/debug/event'].includes(path)), `unexpected API path: ${requests}`);
  console.log(JSON.stringify({ ok: true, counts, checks: ['opt-in', 'precise reported amounts', 'exact cost takes precedence over estimate', 'partial and complete estimates', 'unknown costs never zero', 'pending and missing usage', 'visible usage units', 'unattributed usage excluded', 'pricing links and assumptions', 'estimate live refresh', 'usage storage read/write failure and recovery', 'raw details', 'refresh failure recovery', 'chronological activity', 'whiteboard decision/recovery fields', 'activity measurement note', 'activity storage recovery', 'tab polling cleanup', 'close polling cleanup', 'cross-test estimate isolation', 'empty test', 'Escape close', 'desktop/mobile overflow'], screenshots: ['artifacts/usage-debug-desktop.png', 'artifacts/usage-debug-mobile.png', 'artifacts/usage-debug-activity-mobile.png', 'artifacts/usage-debug-estimated-desktop.png', 'artifacts/usage-debug-estimated-mobile.png', 'artifacts/usage-debug-pricing-desktop.png', 'artifacts/usage-debug-pricing-mobile.png'], providerCalls: 0, realMicrophone: false, realPlayback: false }));
} finally {
  releaseSecond();
  await browser.close();
}
