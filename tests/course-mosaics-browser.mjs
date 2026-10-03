// Isolated browser proof. All provider requests, microphones and sockets are mocked.
// Start the local app, then run: node tests/course-mosaics-browser.mjs
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const origin = process.env.LUNA_QA_ORIGIN || 'http://127.0.0.1:5188';
const browser = await chromium.launch({ headless: true });
const contexts = [], errors = [], releases = [];
const report = { origin, realProviderCalls: 0, realMicrophoneCalls: 0, checks: [], screenshots: [] };
const temporary = await mkdtemp(path.join(tmpdir(), 'luna-course-mosaics-'));
await mkdir('artifacts', { recursive: true });
const check = name => { report.checks.push(name); console.log(`PASS ${name}`); };

async function isolatedPage({ viewport = { width: 1440, height: 1050 }, reducedMotion = 'reduce', classify } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion, acceptDownloads: true });
  contexts.push(context);
  await context.addInitScript(() => {
    window.__mosaicQA = { microphoneMocks: 0, microphoneTimes: [], audioMocks: 0, transitions: [], nativeTransitions: typeof document.startViewTransition === 'function' };
    if (document.startViewTransition) {
      const startViewTransition = document.startViewTransition.bind(document);
      document.startViewTransition = update => {
        const record = { startedAt: performance.now(), readyAt: null, finishedAt: null, audioMocksAtStart: window.__mosaicQA.audioMocks };
        window.__mosaicQA.transitions.push(record);
        const transition = startViewTransition(update);
        void transition.ready.then(() => { record.readyAt = performance.now(); }, error => { record.readyError = error.message; });
        void transition.finished.then(() => { record.finishedAt = performance.now(); }, error => { record.finishedError = error.message; });
        return transition;
      };
    }
    const node = () => ({ connect() {}, disconnect() {} });
    class SilentContext {
      constructor() { window.__mosaicQA.audioMocks++; this.currentTime = 0; this.state = 'running'; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; }
      async resume() { this.state = 'running'; } async close() { this.state = 'closed'; }
      createMediaStreamSource() { return node(); }
      createGain() { return { ...node(), gain: { value: 1 } }; }
      createBuffer(_channels, length, sampleRate) { const data = new Float32Array(length); return { getChannelData: () => data, duration: length / sampleRate }; }
      createBufferSource() { return { ...node(), start() {}, stop() {} }; }
    }
    window.AudioContext = window.webkitAudioContext = SilentContext;
    window.AudioWorkletNode = class { constructor() { Object.assign(this, node()); this.port = {}; } };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
      window.__mosaicQA.microphoneMocks++; window.__mosaicQA.microphoneTimes.push(performance.now());
      return { getTracks: () => [{ stop() {} }] };
    } } });
    HTMLMediaElement.prototype.play = async function () { throw Error('Real media playback is disabled in course mosaic QA.'); };
  });
  const calls = [], packets = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && !['blob:', 'data:'].includes(url.protocol)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/course-mosaic') {
      const body = route.request().postDataJSON(); calls.push(body);
      const response = classify ? await classify(body) : { source: 'fallback', reason: 'unavailable', courseId: null, classifiedTitle: body.title };
      return route.fulfill({ json: response });
    }
    if (url.pathname === '/api/status') return route.fulfill({ json: { mode: 'live', organizer: 'gpt-5.6-luna', voice: 'elevenlabs' } });
    return route.fulfill({ json: {} });
  });
  await context.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).pathname !== '/api/live-voice') return socket.close();
    socket.onMessage(data => {
      const packet = JSON.parse(data.toString()); packets.push(packet);
      if (packet.type === 'start') socket.send(JSON.stringify({ type: 'ready', sampleRate: 16000 }));
    });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { page, context, calls, packets };
}

async function storedTests(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('keyval-store');
    const database = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const read = database.transaction('keyval').objectStore('keyval').get('study-board-v2');
    const value = await new Promise((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); });
    database.close(); return value;
  });
}

async function seedTests(page, tests) {
  await page.goto(origin);
  await page.getByRole('button', { name: 'New test', exact: true }).waitFor();
  await page.evaluate(async tests => {
    const request = indexedDB.open('keyval-store');
    const database = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction('keyval', 'readwrite');
    transaction.objectStore('keyval').put(tests, 'study-board-v2');
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
    database.close();
  }, tests);
  await page.reload();
  await expect(page.locator('.course-test-tile')).toHaveCount(tests.length);
}

const canvasHash = locator => locator.evaluate(canvas => {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261, painted = 0;
  for (let index = 0; index < data.length; index++) { hash = Math.imul(hash ^ data[index], 16777619); if (index % 4 === 3 && data[index]) painted++; }
  return { hash: hash >>> 0, painted, width: canvas.width, height: canvas.height };
});
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal overflow');
const titleOnly = body => {
  assert.deepEqual(Object.keys(body).sort(), ['testId', 'title'], 'classification contains only the name and local identity');
  assert.match(body.testId, /^[0-9a-f-]{36}$/i);
  assert.equal(JSON.stringify(body).includes('PRIVATE SYNTHETIC MATERIAL'), false);
};
const synthetic = (name, index, extra = {}) => ({
  id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
  title: name, className: name, date: `2026-10-${String(15 + index).padStart(2, '0')}`,
  difficulty: ['test', 'quiz', 'final'][index % 3], materials: [], indexStatus: 'empty', guide: null,
  createdAt: '2026-10-02T14:00:00.000Z', ...extra,
});

try {
  const creation = await isolatedPage({ classify: body => ({ courseId: 'chemistry', source: 'jev', classifiedTitle: body.title }) });
  await creation.page.goto(origin);
  await creation.page.getByRole('button', { name: 'New test', exact: true }).click();
  await creation.page.getByLabel('Class', { exact: true }).fill('Organic chemistry');
  await creation.page.getByRole('button', { name: 'Create', exact: true }).click();
  await creation.page.getByRole('button', { name: 'Back to tests', exact: true }).waitFor();
  await expect.poll(() => creation.calls.length).toBe(1);
  titleOnly(creation.calls[0]);
  assert.equal(creation.calls[0].title, 'Organic chemistry');
  await expect.poll(async () => (await storedTests(creation.page))?.[0]?.courseMosaic?.courseId).toBe('chemistry');
  await creation.page.getByRole('button', { name: 'Back to tests', exact: true }).click();
  await expect(creation.page.locator('.course-test-tile')).toHaveAttribute('data-course-id', 'chemistry');
  await creation.page.reload();
  await expect(creation.page.locator('.course-test-tile')).toHaveAttribute('data-course-id', 'chemistry');
  await creation.page.waitForTimeout(250);
  assert.equal(creation.calls.length, 1, 'saved course avoids another provider call after reload');
  check('Creating a test sends only its title and ID, selects the correct card, and persists across reload');

  const examples = [
    ['Math 1920', 'mathematics'], ['Cell biology', 'biology'], ['World literature', 'literature'],
    ['Behavioral economics', 'economics'], ['The night sky', 'astronomy'], ['Music & harmony', 'music-theory'],
  ];
  let active = 0, maxActive = 0;
  const pending = [];
  const backfill = await isolatedPage({ classify: async body => {
    titleOnly(body); active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => { pending.push(resolve); releases.push(resolve); });
    active--;
    return { source: 'jev', courseId: examples.find(([name]) => name === body.title)[1], classifiedTitle: body.title };
  } });
  await seedTests(backfill.page, examples.map(([name], index) => synthetic(name, index, index === 0 ? {
    materials: [
      { id: 'synthetic-lecture', name: 'Linear maps — lecture notes.txt', type: 'txt', size: 205,
        text: 'Linear maps preserve addition and scalar multiplication. A matrix represents a linear map in a chosen basis. Review kernels, images, and rank before working through the examples. PRIVATE SYNTHETIC MATERIAL' },
      { id: 'synthetic-practice', name: 'Eigenvalues — practice.txt', type: 'txt', size: 157,
        text: 'Find the eigenvalues of a diagonal matrix. Verify each eigenvector by multiplying A v. Explain how the determinant and trace relate to the eigenvalues.' },
    ],
    indexStatus: 'ready',
    guide: { topics: [{ id: 'algebra', title: 'Linear maps and eigenvalues', summary: 'Represent linear maps, find eigenvectors, and explain rank.', sourceIds: ['synthetic-lecture', 'synthetic-practice'] }] },
    mastery: { overall: 67, topics: [{ id: 'algebra', score: 67 }] },
  } : {})));
  await expect.poll(() => backfill.calls.length).toBe(3);
  await backfill.page.waitForTimeout(180);
  assert.equal(backfill.calls.length, 3, 'only the first three backfills start while requests are held');
  pending.splice(0).forEach(release => release());
  await expect.poll(() => backfill.calls.length).toBe(6);
  assert.deepEqual(backfill.calls.map(body => body.title).sort(), examples.map(([name]) => name).sort(), 'each of the six existing test titles is classified exactly once');
  pending.splice(0).forEach(release => release());
  await expect(backfill.page.locator('.course-test-tile:not([data-course-id="unassigned"])')).toHaveCount(6);
  assert.equal(maxActive, 3, 'backfill concurrency is capped at three');
  await expect.poll(async () => (await storedTests(backfill.page)).filter(test => test.courseMosaic?.source === 'jev').length).toBe(6);
  await backfill.page.reload();
  await expect(backfill.page.locator('.course-test-tile:not([data-course-id="unassigned"])')).toHaveCount(6);
  await backfill.page.waitForTimeout(250);
  assert.equal(backfill.calls.length, 6, 'backfilled assignments survive reload');
  const cardProgress = backfill.page.locator('.course-test-tile [role="progressbar"]');
  await expect(cardProgress).toHaveCount(1);
  await expect(cardProgress).toHaveAttribute('aria-valuenow', '67');
  await expect(backfill.page.locator('.course-test-tile').first().locator('.course-card-paper')).toHaveCount(2);
  await expect(backfill.page.locator('.course-test-tile').first().getByRole('img', { name: /^2 imported documents:/ })).toBeVisible();
  assert.equal(await backfill.page.locator('.course-test-tile').nth(1).getByRole('progressbar').count(), 0, 'empty cards do not invent a mastery value');
  for (const canvas of await backfill.page.locator('.course-card-canvas').all()) {
    await canvas.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await canvasHash(canvas)).painted).toBeGreaterThan(1000);
  }
  await backfill.page.evaluate(() => scrollTo(0, 0));
  await backfill.page.screenshot({ path: 'artifacts/course-test-cards.png', fullPage: true });
  report.screenshots.push('artifacts/course-test-cards.png');
  await backfill.page.setViewportSize({ width: 390, height: 844 });
  for (const card of await backfill.page.locator('.course-test-tile').all()) await card.scrollIntoViewIfNeeded();
  await backfill.page.evaluate(() => scrollTo(0, 0));
  await noOverflow(backfill.page);
  await backfill.page.screenshot({ path: 'artifacts/course-test-cards-mobile.png', fullPage: true });
  report.screenshots.push('artifacts/course-test-cards-mobile.png');
  check('Existing tests backfill with at most three requests, exclude materials, persist, and render six mobile-safe course cards');
  check('Math 1920 displays two imported document previews and its public 67% score; the five empty cards have no progress ring');

  const navigation = await isolatedPage({ reducedMotion: 'no-preference', classify: body => ({ source: 'jev', courseId: 'mathematics', classifiedTitle: body.title }) });
  await seedTests(navigation.page, [synthetic('Math 1920', 10)]);
  await expect(navigation.page.locator('.course-test-tile')).toHaveAttribute('data-course-id', 'mathematics');
  assert.equal(await navigation.page.evaluate(() => window.__mosaicQA.nativeTransitions), true, 'Chromium exposes native view transitions for the normal-motion proof');
  await navigation.page.locator('.course-test-tile').click();
  await expect(navigation.page.locator('.study-screen')).toBeVisible();
  await expect(navigation.page.getByRole('button', { name: 'Back to tests', exact: true })).toBeVisible();
  await expect.poll(() => navigation.packets.filter(packet => packet.type === 'start').length).toBe(1);
  await expect.poll(() => navigation.page.evaluate(() => window.__mosaicQA.transitions[0]?.finishedAt ?? null)).not.toBeNull();
  const entered = await navigation.page.evaluate(() => window.__mosaicQA);
  assert.equal(entered.transitions.length, 1, 'one native transition opens the selected test');
  assert.equal(entered.transitions[0].readyError, undefined);
  assert.ok(entered.transitions[0].readyAt >= entered.transitions[0].startedAt, 'entry transition reaches ready');
  assert.ok(entered.transitions[0].finishedAt >= entered.transitions[0].readyAt, 'entry transition finishes');
  assert.equal(entered.microphoneMocks, 1);
  assert.equal(entered.transitions[0].audioMocksAtStart, 1, 'audio setup begins in the original card click');
  assert.ok(entered.microphoneTimes[0] < entered.transitions[0].finishedAt, 'microphone setup runs before the visual transition finishes');
  assert.equal(navigation.packets.find(packet => packet.type === 'start').title, 'Math 1920');
  await navigation.page.getByRole('button', { name: 'Back to tests', exact: true }).click();
  await expect(navigation.page.locator('.course-test-tile')).toBeVisible();
  await expect.poll(() => navigation.page.evaluate(() => window.__mosaicQA.transitions[1]?.finishedAt ?? null)).not.toBeNull();
  const returned = await navigation.page.evaluate(() => window.__mosaicQA);
  assert.equal(returned.transitions.length, 2, 'Back uses its own native transition');
  assert.equal(returned.transitions[1].readyError, undefined);
  assert.equal(navigation.packets.filter(packet => packet.type === 'start').length, 1, 'one click starts exactly one voice session');
  report.navigationTransition = {
    count: returned.transitions.length,
    entryDurationMs: Math.round(entered.transitions[0].finishedAt - entered.transitions[0].startedAt),
    microphoneBeforeFinishMs: Math.round(entered.transitions[0].finishedAt - entered.microphoneTimes[0]),
    voiceSessions: 1,
  };
  check('Normal-motion card entry and Back complete native transitions; microphone setup overlaps entry and starts exactly one voice session');

  const fallback = await isolatedPage({ classify: body => ({ source: 'fallback', reason: 'provider-error', courseId: null, classifiedTitle: body.title }) });
  await seedTests(fallback.page, [synthetic('Independent study', 8)]);
  await expect.poll(async () => (await storedTests(fallback.page))?.[0]?.courseMosaic?.source).toBe('fallback');
  await expect(fallback.page.locator('.course-test-tile')).toHaveAttribute('data-course-id', 'unassigned');
  await expect.poll(async () => (await canvasHash(fallback.page.locator('.course-card-canvas'))).painted).toBeGreaterThan(1000);
  await fallback.page.getByRole('button', { name: 'New test', exact: true }).click();
  await fallback.page.getByRole('button', { name: 'Close new test', exact: true }).click();
  await fallback.page.reload();
  await expect(fallback.page.locator('.course-test-tile')).toHaveAttribute('data-course-id', 'unassigned');
  await fallback.page.waitForTimeout(350);
  assert.equal(fallback.calls.length, 1, 'a failed classifier cannot enter an immediate retry loop');
  check('Classifier failure leaves a rendered neutral card and persists its retry cooldown');

  const gallery = await isolatedPage({ viewport: { width: 1800, height: 2200 }, reducedMotion: 'no-preference' });
  await gallery.page.goto(`${origin}/course-mosaics`);
  await expect(gallery.page.locator('.cm-grid .cm-canvas')).toHaveCount(12);
  for (const canvas of await gallery.page.locator('.cm-grid .cm-canvas').all()) {
    await canvas.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await canvasHash(canvas)).painted).toBeGreaterThan(1000);
  }
  await gallery.page.evaluate(() => scrollTo(0, 0));
  const first = gallery.page.locator('.cm-grid .cm-canvas').first();
  await gallery.page.waitForTimeout(200);
  const moving = await canvasHash(first);
  await gallery.page.waitForTimeout(420);
  assert.notEqual((await canvasHash(first)).hash, moving.hash, 'motion changes canvas pixels');
  await gallery.page.getByRole('button', { name: 'Pause mosaic movement', exact: true }).click();
  await gallery.page.waitForTimeout(100);
  const paused = await canvasHash(first);
  await gallery.page.waitForTimeout(300);
  assert.deepEqual(await canvasHash(first), paused, 'pause freezes the artwork');
  await gallery.page.getByRole('button', { name: 'Graphite', exact: true }).click();
  await expect(gallery.page.getByRole('button', { name: 'Graphite', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await canvasHash(first)).hash).not.toBe(paused.hash);
  await gallery.page.getByRole('button', { name: 'Mineral color', exact: true }).click();
  check('All twelve gallery canvases paint; movement changes pixels, pause freezes them, and palette selection changes artwork');

  await gallery.page.getByRole('button', { name: 'Explore Mathematics mosaic', exact: true }).click();
  await expect(gallery.page.getByRole('dialog')).toBeVisible();
  await expect(gallery.page.getByRole('dialog').getByRole('heading', { name: 'Mathematics', exact: true })).toBeVisible();
  await gallery.page.keyboard.press('ArrowRight');
  await expect(gallery.page.getByRole('dialog').getByRole('heading', { name: 'Physics', exact: true })).toBeVisible();
  await gallery.page.keyboard.press('ArrowLeft');
  await expect(gallery.page.getByRole('dialog').getByRole('heading', { name: 'Mathematics', exact: true })).toBeVisible();
  const [pngDownload] = await Promise.all([
    gallery.page.waitForEvent('download'), gallery.page.getByRole('button', { name: 'Save PNG', exact: true }).click(),
  ]);
  assert.equal(pngDownload.suggestedFilename(), 'luna-mathematics.png');
  const pngPath = path.join(temporary, 'mathematics.png'); await pngDownload.saveAs(pngPath);
  const pngBytes = await readFile(pngPath);
  assert.equal(pngBytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(pngBytes.readUInt32BE(16), 1800); assert.equal(pngBytes.readUInt32BE(20), 1800);
  const [svgDownload] = await Promise.all([
    gallery.page.waitForEvent('download'), gallery.page.getByRole('button', { name: /^Save SVG/ }).click(),
  ]);
  assert.equal(svgDownload.suggestedFilename(), 'luna-mathematics.svg');
  const svgPath = path.join(temporary, 'mathematics.svg'); await svgDownload.saveAs(svgPath);
  const svgText = await readFile(svgPath, 'utf8');
  assert.match(svgText, /<svg/); assert.match(svgText, /Mathematics/); assert.ok(svgText.length > 1000);
  await gallery.page.keyboard.press('Escape');
  await expect(gallery.page.getByRole('dialog')).toHaveCount(0);
  check('Detail supports keyboard navigation and Escape; PNG and SVG downloads contain the selected artwork');

  await gallery.page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(gallery.page.getByRole('button', { name: 'Motion disabled by reduced-motion preference', exact: true })).toBeDisabled();
  await gallery.page.waitForTimeout(100);
  const reduced = await canvasHash(first);
  await gallery.page.waitForTimeout(300);
  assert.deepEqual(await canvasHash(first), reduced, 'reduced motion is stable');
  await gallery.page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(gallery.page);
  await gallery.page.screenshot({ path: 'artifacts/course-mosaics-mobile.png', fullPage: true });
  report.screenshots.push('artifacts/course-mosaics-mobile.png');
  assert.equal(gallery.calls.length, 0, 'gallery does not classify test names or call a provider');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  check('Reduced motion is stable, the mobile gallery fits, and every external/provider/device interaction was isolated');
  report.result = 'PASS'; report.maximumBackfillConcurrency = maxActive;
  await writeFile('artifacts/course-mosaics-browser-results.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  releases.forEach(release => release());
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
