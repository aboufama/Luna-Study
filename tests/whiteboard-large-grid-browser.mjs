// Silent, isolated rendering/selection QA; all voice/provider I/O is mocked.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const board = {
  revision: 'grid-eight-by-ten',
  blocks: [{
    id: 'payoffs', type: 'matrix', label: 'Eight by ten payoff matrix',
    rowLabels: Array.from({ length: 8 }, (_, row) => `R${row + 1}`),
    columnLabels: Array.from({ length: 10 }, (_, col) => `C${col + 1}`),
    rows: Array.from({ length: 8 }, (_, row) => Array.from({ length: 10 }, (_, col) => `${row + 1}, ${col + 1}`)),
  }],
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(), errors = [], packets = [];
let voiceSocket, started;
const ready = new Promise(resolve => { started = resolve; });
page.on('pageerror', error => errors.push(error.message));
await mkdir('artifacts', { recursive: true });
await context.route('**/api/**', route => route.abort('blockedbyclient'));
await page.addInitScript(() => {
  const node = () => ({ connect() {}, disconnect() {} });
  class SilentContext {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; }
    async resume() {}
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { return node(); }
    createGain() { return { ...node(), gain: { value: 1 } }; }
  }
  window.AudioContext = SilentContext;
  window.webkitAudioContext = SilentContext;
  window.AudioWorkletNode = class { constructor() { Object.assign(this, node()); this.port = {}; } };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
});
await context.routeWebSocket('**/api/live-voice', socket => {
  voiceSocket = socket;
  socket.onMessage(data => {
    const packet = JSON.parse(data.toString());
    packets.push(packet);
    if (packet.type === 'start') { socket.send(JSON.stringify({ type: 'ready', sampleRate: 16000 })); started(); }
  });
});

async function geometry() {
  return page.evaluate(() => {
    const content = document.querySelector('.board-content'), wrapper = document.querySelector('.board-matrix-scroll'), board = document.querySelector('.whiteboard');
    return { viewport: innerWidth, document: document.documentElement.scrollWidth, contentWidth: content.clientWidth, contentScroll: content.scrollWidth, wrapperWidth: wrapper.clientWidth, matrixScroll: wrapper.scrollWidth, boardWidth: board.getBoundingClientRect().width };
  });
}

try {
  await page.goto(process.env.WHITEBOARD_QA_URL || 'http://127.0.0.1:5188');
  await page.getByRole('button', { name: 'New test', exact: true }).click();
  await page.getByLabel('Class', { exact: true }).fill('Large payoff matrix QA');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await ready;
  voiceSocket.send(JSON.stringify({ type: 'canvas', visible: true, id: 1, board, selection: null }));
  const region = page.getByRole('region', { name: 'Study whiteboard', exact: true });
  await region.waitFor();
  // The existing mosaic transition settles at 1,000 ms; inspect the final layout.
  await page.waitForTimeout(1100);
  assert.equal(await region.locator('tbody tr').count(), 8);
  assert.equal(await region.locator('tbody td').count(), 80);
  assert.equal(await region.locator('thead th[scope=col]').count(), 10);
  assert.equal(await region.locator('.katex-error').count(), 0);

  const latest = () => packets.filter(packet => packet.type === 'canvas-select').at(-1);
  const lastCell = region.getByRole('button', { name: 'R8, C10', exact: true });
  await lastCell.click();
  await page.waitForFunction(() => document.querySelector('[data-board-zone="cell-7-9"]')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(latest(), { type: 'canvas-select', boardRevision: board.revision, targets: [{ blockId: 'payoffs', zoneId: 'cell-7-9' }] });
  const desktop = await geometry();
  assert.ok(desktop.document <= desktop.viewport + 1 && desktop.boardWidth <= desktop.viewport + 1);
  assert.ok(desktop.contentScroll <= desktop.contentWidth + 1, `matrix must scroll inside its wrapper: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.matrixScroll > desktop.wrapperWidth, 'large matrix has a local horizontal scroll container');
  await page.screenshot({ path: 'artifacts/whiteboard-grid-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await lastCell.click();
  await page.waitForFunction(() => document.querySelector('[data-board-zone="cell-7-9"]')?.getAttribute('aria-pressed') === 'false');
  await region.getByRole('button', { name: 'R1, C1', exact: true }).click();
  await lastCell.click();
  await page.waitForFunction(() => document.querySelector('[data-board-zone="cell-7-9"]')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(latest(), { type: 'canvas-select', boardRevision: board.revision, targets: [{ blockId: 'payoffs', zoneId: 'cell-0-0' }, { blockId: 'payoffs', zoneId: 'cell-7-9' }] });
  const mobile = await geometry();
  assert.ok(mobile.document <= mobile.viewport + 1 && mobile.boardWidth <= mobile.viewport + 1);
  assert.ok(mobile.contentScroll <= mobile.contentWidth + 1, `mobile content overflow: ${JSON.stringify(mobile)}`);
  assert.ok(mobile.matrixScroll > mobile.wrapperWidth);
  await page.screenshot({ path: 'artifacts/whiteboard-grid-mobile.png', fullPage: true });

  await region.getByRole('button', { name: 'Close whiteboard', exact: true }).click();
  await region.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Open whiteboard', exact: true }).click();
  await region.waitFor();
  assert.equal(await region.locator('tbody td').count(), 80);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, cells: 80, desktop, mobile, checks: ['automatic canvas opening', '8 rows and 10 columns', '80 cells', 'last cell selection', 'mobile multi-selection', 'nested horizontal scrolling', 'manual reopen retains all cells'], providerCalls: 0, realMicrophone: false, realPlayback: false, screenshots: ['artifacts/whiteboard-grid-desktop.png', 'artifacts/whiteboard-grid-mobile.png'] }));
} finally { await browser.close(); }
