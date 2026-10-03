// Silent stage QA: HTTP APIs, the voice socket, microphone and playback are mocked.
// Start the local app separately, then run: node tests/mosaic-stage-browser.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const equation = {
  revision: 'stage-equation',
  blocks: [{
    id: 'equation', type: 'latex', content: 'x^2 + y^2 = r^2',
    zones: [{ id: 'equation-whole', label: 'Circle equation', anchor: { kind: 'content' } }],
  }],
};
const diagram = {
  revision: 'stage-hydrostatics',
  blocks: [
    {
      id: 'tank', type: 'diagram', elements: [
        { type: 'rect', x: 37, y: 12, width: 26, height: 72 },
        { type: 'line', x1: 37, y1: 36, x2: 63, y2: 36 },
        { type: 'line', x1: 37, y1: 62, x2: 63, y2: 62 },
        { type: 'arrow', x1: 23, y1: 19, x2: 23, y2: 78 },
        { type: 'text', x: 50, y: 5, text: 'p_top = 1 bar' },
        { type: 'text', x: 50, y: 24, text: 'Oil' },
        { type: 'text', x: 79, y: 23, text: '850 kg/m³' },
        { type: 'text', x: 79, y: 29, text: 'h = 2 cm' },
        { type: 'text', x: 50, y: 48, text: 'Water' },
        { type: 'text', x: 79, y: 47, text: '1000 kg/m³' },
        { type: 'text', x: 79, y: 53, text: 'h = 4 cm' },
        { type: 'text', x: 50, y: 93, text: 'p_bottom = ?' },
      ],
    },
    { id: 'pressure', type: 'latex', content: String.raw`\Delta p = \rho_{oil}gh_{oil} + \rho_{water}gh_{water}` },
  ],
};
const matrix = {
  revision: 'stage-matrix',
  blocks: [{
    id: 'payoffs', type: 'matrix', label: 'Eight by ten payoff matrix',
    rowLabels: Array.from({ length: 8 }, (_, row) => `R${row + 1}`),
    columnLabels: Array.from({ length: 10 }, (_, col) => `C${col + 1}`),
    rows: Array.from({ length: 8 }, (_, row) => Array.from({ length: 10 }, (_, col) => `${row + 1}, ${col + 1}`)),
  }],
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [], packets = [], captures = {}, screenshots = [], blockedRequests = [];
let voiceSocket, started, readyTimeout, messageId = 0, tilePool, referenceTilePaint;
const ready = new Promise(resolve => { started = resolve; });
page.setDefaultTimeout(12000);
page.on('pageerror', error => errors.push(error.message));
await mkdir('artifacts', { recursive: true });
await context.route('**/api/**', route => {
  blockedRequests.push(route.request().url());
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  // Inspect the renderer's actual sprite transforms, rather than trusting target
  // geometry: a parent/canvas transform could otherwise shrink every stone.
  const clearRect = CanvasRenderingContext2D.prototype.clearRect;
  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  window.__stageTilePaint = { frame: 0, tiles: [] };
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (this.canvas.matches('canvas.voice-canvas')) {
      window.__stageTilePaint = { frame: window.__stageTilePaint.frame + 1, tiles: [] };
    }
    return clearRect.apply(this, args);
  };
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (this.canvas.matches('canvas.voice-canvas') && args.length === 9) {
      const matrix = this.getTransform(), ratio = Math.min(devicePixelRatio || 1, 2);
      const bounds = this.canvas.getBoundingClientRect();
      const cssX = bounds.width / (this.canvas.width / ratio);
      const cssY = bounds.height / (this.canvas.height / ratio);
      window.__stageTilePaint.tiles.push({
        id: `${args[1]}:${args[2]}`,
        scaleX: Math.hypot(matrix.a * cssX, matrix.b * cssY) / ratio,
        scaleY: Math.hypot(matrix.c * cssX, matrix.d * cssY) / ratio,
        width: args[7], height: args[8],
      });
    }
    return drawImage.apply(this, args);
  };
  const node = () => ({ connect() {}, disconnect() {} });
  window.__stageVoiceMock = { requests: 0, stops: 0, closedContexts: 0, audioTime: 0, playbackStarts: 0 };
  class SilentContext {
    constructor() {
      this.state = 'running';
      this.destination = {};
      this.audioWorklet = { addModule: async () => {} };
    }
    get currentTime() { return window.__stageVoiceMock.audioTime; }
    async resume() {}
    async close() { this.state = 'closed'; window.__stageVoiceMock.closedContexts++; }
    createMediaStreamSource() { return node(); }
    createGain() { return { ...node(), gain: { value: 1 } }; }
    createBuffer(channels, length, sampleRate) {
      const samples = new Float32Array(length);
      return { duration: length / sampleRate, getChannelData: () => samples };
    }
    createBufferSource() {
      return { ...node(), start() { window.__stageVoiceMock.playbackStarts++; }, stop() {} };
    }
  }
  window.AudioContext = SilentContext;
  window.webkitAudioContext = SilentContext;
  window.AudioWorkletNode = class {
    constructor() { Object.assign(this, node()); this.port = {}; }
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => {
        window.__stageVoiceMock.requests++;
        return { getTracks: () => [{ stop() { window.__stageVoiceMock.stops++; } }] };
      },
    },
  });
});
await context.routeWebSocket('**/api/live-voice', socket => {
  voiceSocket = socket;
  socket.onMessage(data => {
    const packet = JSON.parse(data.toString());
    packets.push(packet);
    if (packet.type === 'start') {
      socket.send(JSON.stringify({ type: 'ready', sampleRate: 16000 }));
      started();
    }
  });
});

const region = page.getByRole('region', { name: 'Study whiteboard', exact: true });
const open = page.getByRole('button', { name: 'Open whiteboard', exact: true });
const close = page.getByRole('button', { name: 'Close whiteboard', exact: true });
const presence = page.getByRole('button', { name: 'Return to voice view', exact: true });
const latest = type => packets.filter(packet => packet.type === type).at(-1);
const overlaps = (a, b) => a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1;

async function showCaption() {
  // Exercise the real caption pipeline with a silent mock PCM buffer and clock.
  const turnId = 'stage-caption';
  voiceSocket.send(JSON.stringify({ type: 'transcript', role: 'assistant', turnId, text: 'Compare the first row with the next, then choose the best payoff.' }));
  voiceSocket.send(JSON.stringify({ type: 'audio', turnId, audio: 'AAAAAA==', sampleRate: 1 }));
  await page.waitForFunction(() => window.__stageVoiceMock.playbackStarts === 1);
  await page.evaluate(() => { window.__stageVoiceMock.audioTime = 0.5; });
  await page.locator('.assistant-captions-board:not(.is-hidden)').waitFor();
}

async function settle() {
  await region.waitFor();
  await page.waitForFunction(() => {
    const stage = document.querySelector('.study-screen');
    return stage && Number(stage.dataset.mosaicBoardTiles) > 0 && Number(stage.dataset.mosaicTutorTiles) > 0;
  });
  await page.evaluate(() => document.fonts.ready);
  // Allow the longest opening transition and intrinsic content measurement to settle.
  await page.waitForTimeout(1150);
}

async function sendBoard(board) {
  voiceSocket.send(JSON.stringify({ type: 'canvas', visible: true, id: ++messageId, board, selection: null }));
  const block = board.blocks[0];
  if (block.type === 'matrix') await region.getByRole('table', { name: block.label }).waitFor();
  else await region.locator(`[data-board-block="${block.id}"]`).waitFor();
  await settle();
}

async function geometry() {
  return page.evaluate(() => {
    const stage = document.querySelector('.study-screen');
    const content = document.querySelector('.board-content');
    const matrix = document.querySelector('.board-matrix-scroll');
    const caption = document.querySelector('.assistant-captions-board:not(.is-hidden)');
    const tutorTarget = document.querySelector('.tutor-presence');
    const style = getComputedStyle(stage);
    const rect = element => {
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const variables = Object.fromEntries([
      'board-x', 'board-y', 'board-width', 'board-height', 'tutor-x', 'tutor-y', 'tutor-radius', 'required-height',
    ].map(name => [name, parseFloat(style.getPropertyValue(`--stage-${name}`))]));
    const bounds = rect(stage), radius = variables['tutor-radius'];
    const firstCell = matrix?.querySelector('tbody .board-cell');
    let firstCellVisibleHeight = null;
    if (firstCell) {
      const cellBounds = rect(firstCell), contentBounds = rect(content), matrixBounds = rect(matrix);
      firstCellVisibleHeight = Math.max(0, Math.min(cellBounds.bottom, contentBounds.bottom, matrixBounds.bottom, innerHeight) - Math.max(cellBounds.y, contentBounds.y, matrixBounds.y, 0));
    }
    // The presence target follows the two frame edges. Its rectangular DOM
    // bounds must not turn the empty inner corner into an invisible button.
    const targetBounds = rect(tutorTarget), contentBounds = rect(content);
    const interceptedContentPoints = [];
    let sampledContentPoints = 0;
    const overlapLeft = Math.max(targetBounds.x, contentBounds.x, 0) + 2;
    const overlapTop = Math.max(targetBounds.y, contentBounds.y, 0) + 2;
    const overlapRight = Math.min(targetBounds.right, contentBounds.right, innerWidth) - 2;
    const overlapBottom = Math.min(targetBounds.bottom, contentBounds.bottom, innerHeight) - 2;
    for (let y = overlapTop; y < overlapBottom; y += 8) {
      for (let x = overlapLeft; x < overlapRight; x += 8) {
        sampledContentPoints++;
        if (document.elementFromPoint(x, y)?.closest('.tutor-presence')) interceptedContentPoints.push({ x, y });
      }
    }
    const cutoutPoint = { x: targetBounds.x + targetBounds.width * .25, y: targetBounds.y + targetBounds.height * .25 };
    const cutoutVisible = cutoutPoint.x >= 0 && cutoutPoint.x < innerWidth && cutoutPoint.y >= 0 && cutoutPoint.y < innerHeight;
    return {
      viewport: { width: innerWidth, height: innerHeight, scrollY },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      stage: bounds,
      // The section is a full-stage gesture surface; these are its visible frame bounds.
      board: {
        x: bounds.x + variables['board-x'],
        y: bounds.y + variables['board-y'],
        width: variables['board-width'],
        height: variables['board-height'],
        right: bounds.x + variables['board-x'] + variables['board-width'],
        bottom: bounds.y + variables['board-y'] + variables['board-height'],
      },
      tutor: {
        x: bounds.x + variables['tutor-x'] - radius,
        y: bounds.y + variables['tutor-y'] - radius,
        right: bounds.x + variables['tutor-x'] + radius,
        bottom: bounds.y + variables['tutor-y'] + radius,
        radius,
      },
      tutorTarget: targetBounds,
      tutorClipPath: getComputedStyle(tutorTarget).clipPath,
      tutorInterceptsCutout: cutoutVisible && Boolean(document.elementFromPoint(cutoutPoint.x, cutoutPoint.y)?.closest('.tutor-presence')),
      sampledContentPoints,
      interceptedContentPoints,
      dock: rect(document.querySelector('.study-dock')),
      caption: caption && rect(caption),
      firstCellVisibleHeight,
      variables,
      boardTiles: Number(stage.dataset.mosaicBoardTiles),
      tutorTiles: Number(stage.dataset.mosaicTutorTiles),
      frameCourses: Number(stage.dataset.mosaicFrameCourses),
      content: { width: content.clientWidth, scrollWidth: content.scrollWidth },
      matrix: matrix && { width: matrix.clientWidth, scrollWidth: matrix.scrollWidth },
    };
  });
}

async function inspect(name, { screenshot = false } = {}) {
  const layout = await geometry(), diagnostic = `${name}: ${JSON.stringify(layout)}`;
  for (const [key, value] of Object.entries(layout.variables)) assert.ok(Number.isFinite(value), `${key} must be finite; ${diagnostic}`);
  assert.ok(layout.board.width > 0 && layout.board.height > 0 && layout.tutor.radius > 0, diagnostic);
  for (const [key, rect] of [['board', layout.board], ['tutor', layout.tutor]]) {
    assert.ok(rect.x >= layout.stage.x - 1 && rect.y >= layout.stage.y - 1, `${key} starts outside the stage; ${diagnostic}`);
    assert.ok(rect.right <= layout.stage.right + 1 && rect.bottom <= layout.stage.bottom + 1, `${key} exceeds the stage; ${diagnostic}`);
  }
  assert.ok(layout.document.width <= layout.viewport.width + 1, `horizontal page overflow; ${diagnostic}`);
  assert.ok(layout.document.height <= Math.max(layout.viewport.height, layout.stage.bottom + layout.viewport.scrollY) + 1, `page extends beyond the declared stage; ${diagnostic}`);
  if (layout.document.height > layout.viewport.height + 1) {
    assert.ok(layout.variables['required-height'] > layout.viewport.height - (layout.stage.y + layout.viewport.scrollY), `scrolling requires an explicitly larger stage; ${diagnostic}`);
  }
  assert.ok(layout.tutor.x >= layout.board.x - 1 && layout.tutor.y >= layout.board.y - 1 && layout.tutor.right <= layout.board.right + 1 && layout.tutor.bottom <= layout.board.bottom + 1, `tutor must be contained in the board frame; ${diagnostic}`);
  assert.ok(Math.abs(layout.tutor.right - layout.board.right) <= 1 && Math.abs(layout.tutor.bottom - layout.board.bottom) <= 1, `tutor must occupy the board's lower-right corner; ${diagnostic}`);
  assert.notEqual(layout.tutorClipPath, 'none', `tutor target must follow the corner's L shape; ${diagnostic}`);
  assert.equal(layout.tutorInterceptsCutout, false, `tutor must not intercept its empty inner corner; ${diagnostic}`);
  assert.deepEqual(layout.interceptedContentPoints, [], `tutor must not intercept whiteboard content; ${diagnostic}`);
  assert.ok(!overlaps(layout.tutorTarget, layout.dock), `tutor hit target must not overlap dock controls; ${diagnostic}`);
  if (layout.caption) {
    assert.ok(!overlaps(layout.caption, layout.tutorTarget), `visible captions must not overlap tutor hit target; ${diagnostic}`);
    assert.ok(!overlaps(layout.caption, layout.dock), `visible captions must not overlap dock controls; ${diagnostic}`);
    assert.ok(layout.caption.x >= layout.stage.x - 1 && layout.caption.y >= layout.stage.y - 1 && layout.caption.right <= layout.stage.right + 1 && layout.caption.bottom <= layout.stage.bottom + 1, `captions exceed the stage; ${diagnostic}`);
  }
  assert.ok(Number.isInteger(layout.boardTiles) && layout.boardTiles > 0, diagnostic);
  assert.ok(Number.isInteger(layout.tutorTiles) && layout.tutorTiles > 0, diagnostic);
  assert.ok(Number.isInteger(layout.frameCourses) && layout.frameCourses >= 2 && layout.frameCourses <= 4, `frame must keep a restrained number of tile courses; ${diagnostic}`);
  tilePool ??= layout.boardTiles + layout.tutorTiles;
  assert.equal(layout.boardTiles + layout.tutorTiles, tilePool, `tiles must be conserved; ${diagnostic}`);
  assert.ok(layout.content.scrollWidth <= layout.content.width + 1, `wide content must scroll in its own block; ${diagnostic}`);
  assert.equal(await region.locator('.katex-error').count(), 0, `${name}: no math rendering errors`);
  assert.equal(await presence.count(), 1, `${name}: tutor presence remains available`);
  assert.deepEqual(errors, [], `${name}: browser errors`);
  captures[name] = layout;
  if (screenshot) {
    const path = `artifacts/mosaic-stage-${name}.png`;
    await page.screenshot({ path, fullPage: true });
    screenshots.push(path);
  }
  return layout;
}

async function inspectClosedCircle() {
  await page.waitForTimeout(1150);
  const circle = await page.evaluate(() => {
    const stage = document.querySelector('.study-screen'), style = getComputedStyle(stage);
    const bounds = stage.getBoundingClientRect(), dock = document.querySelector('.study-dock').getBoundingClientRect();
    const unit = parseFloat(style.getPropertyValue('--stage-orb-unit'));
    const x = parseFloat(style.getPropertyValue('--stage-orb-x'));
    const y = parseFloat(style.getPropertyValue('--stage-orb-y'));
    return { unit, x, y, radius: unit * 146, width: bounds.width, height: bounds.height, dockY: dock.top - bounds.top };
  });
  const diagnostic = JSON.stringify(circle);
  assert.ok(Object.values(circle).every(Number.isFinite) && circle.unit > 0, `closed circle geometry must be finite; ${diagnostic}`);
  assert.ok(circle.x - circle.radius >= 0 && circle.y - circle.radius >= 0, `closed landscape circle must not clip against the canvas top or left; ${diagnostic}`);
  assert.ok(circle.x + circle.radius <= circle.width && circle.y + circle.radius <= Math.min(circle.height, circle.dockY), `closed landscape circle must fit above dock; ${diagnostic}`);
  captures['closed-landscape'] = circle;
}

async function inspectConstantTileSize(name) {
  await page.waitForFunction(() => window.__stageTilePaint.tiles.length > 0);
  const paint = await page.evaluate(() => window.__stageTilePaint);
  const ids = new Set(paint.tiles.map(tile => tile.id));
  assert.equal(ids.size, paint.tiles.length, `${name}: each tile is drawn once`);
  if (tilePool !== undefined) assert.equal(paint.tiles.length, tilePool, `${name}: entire tile pool remains visible`);
  referenceTilePaint ??= Object.fromEntries(paint.tiles.map(tile => [tile.id, { width: tile.width, height: tile.height }]));
  assert.equal(paint.tiles.length, Object.keys(referenceTilePaint).length, `${name}: tile pool remains complete`);
  let maxScaleError = 0;
  for (const tile of paint.tiles) {
    const reference = referenceTilePaint[tile.id];
    assert.ok(reference, `${name}: sprite ${tile.id} must exist in the original circle`);
    assert.equal(tile.width, reference.width, `${name}: sprite ${tile.id} width must remain unchanged`);
    assert.equal(tile.height, reference.height, `${name}: sprite ${tile.id} height must remain unchanged`);
    // Canvas backing dimensions round to device pixels; allow only that
    // subpixel discrepancy, never a layout-dependent stone scale.
    const error = Math.max(Math.abs(tile.scaleX - 1), Math.abs(tile.scaleY - 1));
    maxScaleError = Math.max(maxScaleError, error);
    assert.ok(error < 0.001, `${name}: sprite ${tile.id} must retain unit scale; ${JSON.stringify(tile)}`);
  }
  captures[`${name}-tile-size`] = { count: paint.tiles.length, maxScaleError };
}

try {
  await page.goto(process.env.WHITEBOARD_QA_URL || 'http://127.0.0.1:5188');
  await page.getByRole('button', { name: 'New test', exact: true }).click();
  await page.getByLabel('Class', { exact: true }).fill('Adaptive mosaic stage QA');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await Promise.race([ready, new Promise((_, reject) => { readyTimeout = setTimeout(() => reject(new Error('Mock voice session did not start')), 12000); })]);
  clearTimeout(readyTimeout);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  await inspectConstantTileSize('voice-circle');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await sendBoard(equation);
  const small = await inspect('equation', { screenshot: true });
  await region.getByRole('button', { name: 'Circle equation', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-board-zone="equation-whole"]')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(latest('canvas-select'), { type: 'canvas-select', boardRevision: equation.revision, targets: [{ blockId: 'equation', zoneId: 'equation-whole' }] });

  await sendBoard(diagram);
  await region.locator('[data-board-block="pressure"] .katex').waitFor();
  await inspect('diagram', { screenshot: true });

  await sendBoard(matrix);
  assert.equal(await region.locator('tbody tr').count(), 8);
  assert.equal(await region.locator('tbody td').count(), 80);
  const large = await inspect('matrix', { screenshot: true });
  assert.ok(large.board.width * large.board.height > small.board.width * small.board.height * 1.25, 'larger content must meaningfully increase the board footprint');
  assert.ok(large.frameCourses <= small.frameCourses, 'a larger board should need no more frame courses to accommodate the same stones');
  const lastCell = region.getByRole('button', { name: 'R8, C10', exact: true });
  await lastCell.click();
  await page.waitForFunction(() => document.querySelector('[data-board-zone="cell-7-9"]')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(latest('canvas-select'), { type: 'canvas-select', boardRevision: matrix.revision, targets: [{ blockId: 'payoffs', zoneId: 'cell-7-9' }] });

  await showCaption();
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  const mobile = await inspect('mobile', { screenshot: true });
  assert.ok(mobile.matrix.scrollWidth > mobile.matrix.width, 'large matrices scroll locally on narrow screens');
  await region.getByRole('button', { name: 'R1, C1', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-board-zone="cell-0-0"]')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(latest('canvas-select'), { type: 'canvas-select', boardRevision: matrix.revision, targets: [{ blockId: 'payoffs', zoneId: 'cell-0-0' }, { blockId: 'payoffs', zoneId: 'cell-7-9' }] });

  const voiceBefore = await page.evaluate(() => ({ ...window.__stageVoiceMock }));
  const stopPacketsBefore = packets.filter(packet => packet.type === 'stop').length;
  const presenceBounds = await presence.boundingBox();
  await presence.click({ position: { x: presenceBounds.width - 12, y: presenceBounds.height - 12 } });
  await region.waitFor({ state: 'detached' });
  assert.equal(latest('canvas-visibility')?.visible, false, 'presence closes the board');
  assert.equal(await page.getByRole('button', { name: 'Stop microphone', exact: true }).count(), 1, 'presence leaves the microphone session active');
  assert.equal(packets.filter(packet => packet.type === 'stop').length, stopPacketsBefore, 'presence does not stop the voice socket');
  assert.deepEqual(await page.evaluate(() => window.__stageVoiceMock), voiceBefore, 'presence does not close audio or microphone');
  await open.click();
  await settle();
  assert.equal(await region.locator('tbody td').count(), 80);
  assert.equal(await region.locator('[data-board-zone="cell-0-0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await region.locator('[data-board-zone="cell-7-9"]').getAttribute('aria-pressed'), 'true');
  await inspect('reopened');
  await presence.focus();
  await page.keyboard.press('Enter');
  await region.waitFor({ state: 'detached' });
  assert.equal(latest('canvas-visibility')?.visible, false, 'keyboard activation closes the board');
  assert.equal(packets.filter(packet => packet.type === 'stop').length, stopPacketsBefore, 'keyboard presence activation keeps the voice session active');
  await open.click();
  await settle();
  assert.equal(await region.locator('[data-board-zone="cell-0-0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await region.locator('[data-board-zone="cell-7-9"]').getAttribute('aria-pressed'), 'true');

  await page.setViewportSize({ width: 844, height: 390 });
  await settle();
  const landscape = await inspect('landscape', { screenshot: true });
  assert.ok(landscape.firstCellVisibleHeight >= 32, `landscape must show at least 32px of the first matrix cell without scrolling; ${JSON.stringify(landscape)}`);
  await close.click();
  await region.waitFor({ state: 'detached' });
  await inspectClosedCircle();
  await open.click();
  await settle();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settle();
  await sendBoard({ ...equation, revision: 'stage-equation-again' });
  const contracted = await inspect('contracted');
  assert.ok(contracted.board.width * contracted.board.height < large.board.width * large.board.height * 0.8, 'replacing content with one equation must shrink the board');
  assert.equal(contracted.boardTiles, small.boardTiles, 'returning to the same content restores its allocation');
  assert.equal(await region.locator('table').count(), 0, 'replacement removes the previous matrix');

  // Reverse transitions before they finish; the last requested state must win.
  for (let index = 0; index < 4; index++) {
    await close.click();
    await region.waitFor({ state: 'detached' });
    await open.click();
    await region.waitFor();
  }
  await settle();
  await inspect('rapid-reopen');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sendBoard({ ...equation, revision: 'stage-equation-fixed-size' });
  await inspect('reduced-motion-equation');
  await inspectConstantTileSize('equation-frame-and-tutor');
  await sendBoard(matrix);
  await inspect('reduced-motion', { screenshot: true });
  await inspectConstantTileSize('matrix-frame-and-tutor');
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  await inspect('reduced-motion-mobile');
  await inspectConstantTileSize('mobile-frame-and-tutor');
  await close.click();
  await region.waitFor({ state: 'detached' });
  await page.waitForTimeout(100);
  await inspectConstantTileSize('mobile-voice-circle');
  await open.click();
  await settle();
  await inspect('reduced-motion-reopened');
  await inspectConstantTileSize('mobile-reopened-frame-and-tutor');
  assert.equal(await region.locator('tbody td').count(), 80);
  assert.deepEqual(errors, []);
  assert.equal(packets.filter(packet => packet.type === 'start').length, 1, 'all stage changes share the original voice session');
  assert.equal(packets.filter(packet => packet.type === 'stop').length, 0);
  console.log(JSON.stringify({
    ok: true,
    checks: ['constant rendered tile size in voice and integrated corner frame across content and viewport changes', 'content-driven growth and shrink', 'shared tile-pool conservation', 'two to four frame courses', 'desktop fit and explicit logical stage height on small screens', 'readable landscape matrix', 'corner tutor target leaves content interactive', 'separate tutor presence and dock hit targets', 'visible captions avoid controls', 'closed landscape circle fits', 'selection through resize and reopen', 'presence returns to live voice by click and keyboard', 'rapid transition reversal', 'reduced motion'],
    tilePool, captures, screenshots, blockedApiRequests: blockedRequests.length,
    providerCalls: 0, realMicrophone: false, realPlayback: false,
  }));
} finally {
  clearTimeout(readyTimeout);
  await browser.close();
}
