// Isolated browser regression: all API and voice traffic is intercepted.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { partialPdfBytes } from './fixtures/partial-pdf.mjs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new DOMException('Test microphone remains off', 'NotAllowedError'); } } });
});
await page.routeWebSocket('**/api/live-voice', socket => socket.close());
await page.route('**/api/**', async route => {
  if (new URL(route.request().url()).pathname !== '/api/organize') return route.fulfill({ json: {} });
  const input = route.request().postDataJSON(), sourceIds = input.materials.map(source => source.id);
  await route.fulfill({ json: { guide: { overview: 'Test overview', topics: [{ title: 'Test topic', summary: 'Test summary', sourceIds }], questions: [{ question: 'Test?', answer: 'Test.', sourceIds }], script: 'Test script.' } } });
});

const savedTest = () => ({ id: '11111111-1111-4111-8111-111111111111', title: 'Source QA', className: 'Source QA', date: '', difficulty: 'test', indexStatus: 'ready', materials: [{ id: 'old', name: 'old.txt', text: 'Old readable notes.', type: 'txt', size: 19 }], guide: { topics: [{ title: 'Old topic', summary: 'Old summary', sourceIds: ['old'] }] }, mastery: { overall: 100, topics: [{ id: 'old-topic', score: 100, mastered: true }] } });
async function seed() {
  await page.evaluate(async value => {
    const request = indexedDB.open('keyval-store');
    const database = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction('keyval', 'readwrite');
    transaction.objectStore('keyval').put([value], 'study-board-v2');
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
    database.close();
  }, savedTest());
  await page.reload();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await page.getByRole('button', { name: /Source QA/ }).click();
  await expect(page.getByRole('button', { name: 'Start microphone', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Library/ }).click();
}
try {
  await page.goto(process.env.LUNA_TEST_URL || 'http://127.0.0.1:5188');
  await page.getByRole('button', { name: 'New test', exact: true }).waitFor();
  await seed();
  await page.getByRole('button', { name: 'Remove old.txt' }).click();
  await expect(page.getByRole('progressbar', { includeHidden: true })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Close library' }).click();
  await page.reload();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await seed();
  await page.locator('input[type=file]').setInputFiles({ name: 'mixed-slides.pdf', mimeType: 'application/pdf', buffer: Buffer.from(partialPdfBytes()) });
  await expect(page.getByText('1 of 2 pages had no readable text. Images and scans are not included.', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { includeHidden: true })).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.library-status')).toContainText('Indexed');
  await page.getByRole('button', { name: /mixed-slides.pdf/ }).first().click();
  await expect(page.locator('.source-preview')).toContainText('1 of 2 pages had no readable text');
  await expect(page.locator('.source-preview pre')).toHaveText('Lecture 1');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/material-warning-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/material-warning-mobile.png', fullPage: true });
  assert.equal(await page.locator('.library-drawer').evaluate(element => element.scrollWidth > element.clientWidth), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', checks: ['paused source removal clears mastery', 'mastery reset survives reload', 'paused source import clears mastery', 'real partial PDF warning and preview', 'mobile warning fits'], providerCalls: 0, microphoneUsed: false }));
} finally { await browser.close(); }
