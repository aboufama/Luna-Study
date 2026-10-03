// Isolated, silent browser proof. All speech devices and API traffic are mocked.
import { chromium } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { createMosaicField } from '../src/mosaic-field.mjs';
import { mosaicBorderTargets } from '../src/mosaic-motion.mjs';
import * as original from '../src/mosaic-lab/original.mjs';
import * as palimpsest from '../src/mosaic-lab/palimpsest.mjs';
import * as filigree from '../src/mosaic-lab/filigree.mjs';
import { createMosaicChoreography } from '../src/mosaic-choreography.mjs';
import { createMosaicTransition } from '../src/mosaic-transition.mjs';

const origin = process.env.LUNA_QA_ORIGIN || 'http://127.0.0.1:5188';
const output = 'artifacts';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], report = { origin, providerRequests: 0, microphoneHardwareRequests: 0, checks: [] };
const check = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const hashCanvas = page => page.locator('.lab-canvas').evaluateAll(canvases => canvases.map(canvas => {
  const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261, painted = 0;
  for (let i = 0; i < bytes.length; i++) { hash = Math.imul(hash ^ bytes[i], 16777619); if (i % 4 === 3 && bytes[i]) painted++; }
  return { hash: hash >>> 0, painted, width: canvas.width, height: canvas.height };
}));
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal document overflow');
async function isolatedPage(viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, recordVideo: { dir: `${output}/.lab-video`, size: { width: 1440, height: 1000 } } });
  await context.addInitScript(() => {
    window.__silentQA = { microphoneRequests: 0, audioContexts: 0 };
    const node = () => ({ connect() {}, disconnect() {} });
    class SilentContext {
      constructor() { window.__silentQA.audioContexts++; this.currentTime = 0; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; }
      async resume() {} async close() {} createMediaStreamSource() { return node(); }
      createGain() { return { ...node(), gain: { value: 1 } }; }
      createBuffer(_channels, length, sampleRate) { const data = new Float32Array(length); return { getChannelData: () => data, duration: length / sampleRate }; }
      createBufferSource() { return { ...node(), start() {}, stop() {} }; }
    }
    window.AudioContext = window.webkitAudioContext = SilentContext;
    window.AudioWorkletNode = class { constructor() { Object.assign(this, node()); this.port = {}; } };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
      window.__silentQA.microphoneRequests++; return { getTracks: () => [{ stop() {} }] };
    } } });
    HTMLMediaElement.prototype.play = async function () { throw Error('Audio/video playback is forbidden in silent QA'); };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort('blockedbyclient');
    return route.continue();
  });
  return { context, page };
}

try {
  // Algorithm replay checks use the same real pure modules as the lab, with fixed timestamps.
  const tiles = createMosaicField().tiles;
  const border = mosaicBorderTargets(tiles, { width: 560, height: 460, top: 44, bottom: 44, inset: 30, pitch: 7.3 });
  report.tileCount = tiles.length;
  report.replay = [];
  for (const variant of [original, palimpsest, filigree]) {
    function replay(seed) {
      const instance = variant.createVariant({ tiles, seed, width: 560, height: 460, border });
      let output;
      for (let frame = 0; frame < 100; frame++) output = instance.step({ time: frame * 32, dt: 32, state: 'thinking', level: .65, pointer: { x: 0, y: 0, active: false }, boardProgress: 0, reduced: false });
      return Array.from(output);
    }
    const first = replay(1532474799);
    assert.deepEqual(replay(1532474799), first, `${variant.meta.title} exact deterministic replay`);
    if (variant.meta.id === 'original') assert.deepEqual(replay(1532474800), first, 'Original ignores the seed');
    else assert.notDeepEqual(replay(1532474800), first, `${variant.meta.title} seed affects its formation`);
    report.replay.push({ variant: variant.meta.id, coordinates: first.length, exact: true });
  }
  check('All three variants replay exactly from their seed and fixed frame sequence');
  const faithful = original.createVariant({ tiles, width: 560, height: 460, border });
  const productionMotion = createMosaicChoreography(tiles), productionFrame = createMosaicTransition(tiles.length);
  productionFrame.setTargets(border, 7.3);
  for (let tick = 0; tick < 90; tick++) {
    const state = tick < 30 ? 'thinking' : 'speaking', time = tick * 32, level = .045, boardOpen = tick >= 45 && tick < 70;
    const actual = faithful.step({ time, dt: 32, state, level, boardOpen, boardProgress: 0, pointer: { active: false } });
    const morph = productionFrame.step(boardOpen, 32); productionMotion.step(state, level, time);
    for (let index = 0; index < tiles.length; index++) {
      const tile = tiles[index], turn = productionMotion.rotation[index], angle = Math.atan2(tile.y, tile.x) + turn, radius = Math.hypot(tile.x, tile.y) * .97;
      const x = 280 + Math.cos(angle) * radius, y = 230 + Math.sin(angle) * radius, b = morph[index];
      assert.equal(actual[index * 4], Math.fround(x + (border[index].x - x) * b));
      assert.equal(actual[index * 4 + 1], Math.fround(y + (border[index].y - y) * b));
      assert.equal(actual[index * 4 + 2], Math.fround(turn * (1 - b) + border[index].rotation * b));
      const ink = Math.min(.9, .60 + tile.strength * .18 + tile.seed * .08 + tile.motifStrength * .13) * tile.edge;
      const shade = productionMotion.ink[index] * (1 - b) + productionMotion.borderInk[index] * b;
      assert.equal(actual[index * 4 + 3], Math.fround(Math.min(.94, Math.max(0, ink * (1 - b * .48) + shade * tile.edge))));
    }
  }
  check('Original exactly matches production motion, frame positions, rigid angles and opacity');

  const { context: labContext, page: lab } = await isolatedPage();
  const labApi = [];
  await lab.route('**/api/**', route => { labApi.push(route.request().url()); return route.abort('blockedbyclient'); });
  await lab.routeWebSocket('**/*', socket => { if (new URL(socket.url()).pathname.startsWith('/api/')) labApi.push(socket.url()); socket.close(); });
  await lab.goto(`${origin}/mosaic-lab?seed=805502294`);
  await lab.getByRole('heading', { name: 'A closer study.' }).waitFor();
  await lab.waitForTimeout(300);
  assert.equal(await lab.locator('.lab-canvas').count(), 3);
  assert.ok((await hashCanvas(lab)).every(canvas => canvas.painted > 15000));
  assert.equal(new URL(lab.url()).searchParams.get('seed'), '805502294');
  await noOverflow(lab);
  check('Three nonempty canvases and shareable seeded URL');
  await lab.evaluate(async () => {
    localStorage.setItem('luna-teacher-hat-v1', 'beret');
    const { set } = await import('/node_modules/.vite/deps/idb-keyval.js');
    await set('study-board-v2', [{ id: 'qa-sentinel', title: 'Study data stays unchanged', materials: [] }]);
  });
  const beforeChoice = await lab.evaluate(() => ({ ...localStorage }));
  for (const name of ['Resting', 'Thinking', 'Talking', 'Listening']) {
    if (name === 'Talking') await lab.getByRole('button', { name: 'Restart animation', exact: true }).click();
    await lab.getByRole('button', { name, exact: true }).click();
    assert.equal(await lab.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true');
    await lab.waitForTimeout(name === 'Talking' ? 3200 : 1800);
    assert.ok((await hashCanvas(lab)).every(canvas => canvas.painted > 15000));
  }
  check('Resting, thinking, talking and listening controls render all three concepts');
  await lab.getByRole('button', { name: 'Thinking', exact: true }).click();
  await lab.getByRole('button', { name: 'Pause animations', exact: true }).click();
  await lab.waitForTimeout(150);
  const frozen = await hashCanvas(lab);
  await lab.waitForTimeout(300);
  assert.deepEqual(await hashCanvas(lab), frozen);
  assert.equal(await lab.getByRole('button', { name: 'Add documents', exact: true }).isDisabled(), true);
  check('Pause freezes canvas pixels and disables document intake');
  await lab.getByRole('button', { name: 'Play animations', exact: true }).click();
  await lab.getByRole('button', { name: 'Reduced motion off', exact: true }).click();
  await lab.waitForTimeout(120);
  const reduced = await hashCanvas(lab);
  await lab.waitForTimeout(300);
  assert.deepEqual(await hashCanvas(lab), reduced);
  check('Reduced motion produces static rigid formations');
  await lab.getByRole('button', { name: 'Reduced motion on', exact: true }).click();
  await lab.getByRole('button', { name: 'Add documents', exact: true }).click();
  await lab.waitForTimeout(320);
  await lab.screenshot({ path: `${output}/mosaic-lab-intake.png`, fullPage: true });
  await lab.waitForTimeout(900);
  await lab.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  assert.equal(await lab.getByRole('button', { name: 'Whiteboard', exact: true }).getAttribute('aria-pressed'), 'true');
  await lab.waitForTimeout(1500);
  await lab.screenshot({ path: `${output}/mosaic-lab-board.png`, fullPage: true });
  assert.ok((await hashCanvas(lab)).every(canvas => canvas.painted > 15000));
  await lab.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await lab.waitForTimeout(1500);
  check('Document intake and whiteboard transitions retain all three formations');
  const previousSeed = new URL(lab.url()).searchParams.get('seed');
  await lab.getByRole('button', { name: 'New seed', exact: true }).click();
  await lab.waitForFunction(seed => new URL(location.href).searchParams.get('seed') !== seed, previousSeed);
  const newSeed = Number(new URL(lab.url()).searchParams.get('seed'));
  assert.ok(Number.isInteger(newSeed) && newSeed >= 0 && newSeed <= 4294967295);
  const beforeRestart = await lab.locator('.lab-canvas').first().elementHandle();
  await lab.getByRole('button', { name: 'Restart animation', exact: true }).click();
  await lab.waitForTimeout(50);
  assert.equal(await beforeRestart.evaluate(canvas => canvas.isConnected), false, 'restart recreates motion instances and their internal phase');
  await beforeRestart.dispose();
  check('Restart resets the canvas and internal per-stone animation state');
  const palimpsestCard = lab.locator('.lab-card').filter({ has: lab.getByRole('heading', { name: 'Palimpsest', exact: true }) });
  await palimpsestCard.getByRole('button', { name: 'Choose this', exact: true }).click();
  assert.equal(await palimpsestCard.getByRole('button', { name: 'Selected', exact: true }).getAttribute('aria-pressed'), 'true');
  const saved = await lab.evaluate(async () => {
    const { get } = await import('/node_modules/.vite/deps/idb-keyval.js');
    return { storage: { ...localStorage }, study: await get('study-board-v2') };
  });
  const choice = JSON.parse(saved.storage['mosaic-lab-choice']);
  assert.equal(choice.id, 'palimpsest'); assert.equal(choice.seed, newSeed);
  delete saved.storage['mosaic-lab-choice']; assert.deepEqual(saved.storage, beforeChoice);
  assert.deepEqual(saved.study, [{ id: 'qa-sentinel', title: 'Study data stays unchanged', materials: [] }]);
  report.choice = choice;
  check('New seed and favorite persist only lab preference, leaving study data and skins unchanged');
  await lab.screenshot({ path: `${output}/mosaic-lab-desktop.png`, fullPage: true });
  await lab.getByRole('button', { name: 'Enlarge Palimpsest', exact: true }).click();
  assert.equal(await lab.locator('.lab-canvas').count(), 1);
  await noOverflow(lab); await lab.screenshot({ path: `${output}/mosaic-lab-enlarged.png`, fullPage: true });
  await lab.getByRole('button', { name: 'Show all concepts', exact: true }).click();
  assert.equal(await lab.locator('.lab-canvas').count(), 3);
  report.fullSize = [];
  for (const title of ['Original', 'Palimpsest', 'Filigree']) {
    await lab.getByRole('button', { name: `Enlarge ${title}`, exact: true }).click();
    await lab.getByRole('button', { name: 'Thinking', exact: true }).click();
    await lab.waitForTimeout(1300);
    await lab.screenshot({ path: `${output}/mosaic-lab-${title.toLowerCase()}-thinking.png`, fullPage: true });
    const first = (await hashCanvas(lab))[0].hash;
    await lab.waitForTimeout(1600);
    assert.notEqual((await hashCanvas(lab))[0].hash, first, `${title} visibly animates while thinking`);
    await lab.getByRole('button', { name: 'Restart animation', exact: true }).click();
    await lab.getByRole('button', { name: 'Talking', exact: true }).click();
    await lab.waitForTimeout(950);
    await lab.screenshot({ path: `${output}/mosaic-lab-${title.toLowerCase()}-talking.png`, fullPage: true });
    await lab.waitForTimeout(1650);
    const bounds = await lab.locator('.lab-canvas').boundingBox();
    for (let step = 0; step <= 18; step++) {
      const fraction = step / 18;
      await lab.mouse.move(bounds.x + bounds.width * (.30 + fraction * .40), bounds.y + bounds.height * (.52 + Math.sin(fraction * Math.PI) * .11));
      await lab.waitForTimeout(32);
    }
    await lab.screenshot({ path: `${output}/mosaic-lab-${title.toLowerCase()}-hover.png`, fullPage: true });
    await lab.mouse.move(5, 5); await lab.waitForTimeout(500);
    await lab.getByRole('button', { name: 'Show all concepts', exact: true }).click();
    report.fullSize.push({ title, thinkingPixelsChanged: true, recordedTalkingAndHover: true });
  }
  check('Full-size recordings cover individual thinking, speaking and cursor-pass motion for every concept');
  await lab.setViewportSize({ width: 390, height: 844 });
  await lab.waitForTimeout(150); await noOverflow(lab);
  await lab.screenshot({ path: `${output}/mosaic-lab-mobile.png`, fullPage: true });
  await lab.getByRole('button', { name: 'Enlarge Palimpsest', exact: true }).click();
  await noOverflow(lab);
  const deviceCounts = await lab.evaluate(() => window.__silentQA);
  assert.deepEqual(deviceCounts, { microphoneRequests: 0, audioContexts: 0 });
  assert.deepEqual(labApi, []);
  check('Enlarged and mobile layouts have no overflow; lab invokes no API or audio device');
  const video = lab.video();
  await labContext.close();
  await video.saveAs(`${output}/mosaic-lab-comparison.webm`);
  report.video = `${output}/mosaic-lab-comparison.webm`;

  assert.deepEqual(errors, []);
  check('No browser runtime errors; no actual microphone, playback or provider traffic');
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack; throw error;
} finally {
  report.browserErrors = errors;
  await writeFile(`${output}/mosaic-lab-browser-results.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
