import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { LiveVoiceSession } from '../src/live-voice.js';
import { validateVoiceSetup } from '../server/onboarding.mjs';
import { extractPdfText, pdfExtractionWarning } from '../src/pdf-text.mjs';
import { partialPdfBytes } from './fixtures/partial-pdf.mjs';

const setup = () => ({ title: 'Biology', date: '', difficulty: 'test', localToday: '2026-10-02', indexStatus: 'ready', materials: [{ id: 'old', name: 'Old notes', text: 'Old facts' }], topics: [{ title: 'Old topic', summary: 'Old summary', sourceIds: ['old'] }] });

test('removing or replacing sources before voice starts leaves a valid startup snapshot', () => {
  for (const materials of [[], [{ id: 'new', name: 'New notes', text: 'New facts' }]]) {
    const session = new LiveVoiceSession({});
    session.test = setup();
    session.updateMaterials(materials);
    assert.deepEqual(validateVoiceSetup(session.test).topics, []);
    assert.deepEqual(session.test.materials, materials);
  }
});

test('unchanged source snapshots preserve their valid indexed topics', () => {
  const session = new LiveVoiceSession({});
  session.test = setup();
  const topics = session.test.topics;
  session.updateMaterials(session.test.materials);
  assert.deepEqual(validateVoiceSetup(session.test).topics, topics);
});

test('a real mixed PDF retains the page number of raster-only content', async () => {
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: partialPdfBytes(), isEvalSupported: false, useSystemFonts: true });
  try {
    const result = await extractPdfText(await loading.promise);
    assert.equal(result.text.trim(), 'Lecture 1');
    assert.deepEqual(result.extraction, { pageCount: 2, pagesWithoutText: [2] });
    assert.match(pdfExtractionWarning({ type: 'pdf', extraction: result.extraction }), /1 of 2 pages had no readable text/);
  } finally { await loading.destroy(); }
});

test('PDF previews retain a text-only caveat even when every page contains a heading', () => {
  assert.match(pdfExtractionWarning({ type: 'pdf', extraction: { pageCount: 5, pagesWithoutText: [] } }), /images, diagrams, and scanned content are not included/);
  assert.match(pdfExtractionWarning({ type: 'pdf' }), /Text only/);
  assert.equal(pdfExtractionWarning({ type: 'txt' }), '');
});
