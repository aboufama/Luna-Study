import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { prepareMaterials } from '../src/prepare-materials.mjs';
import { readMaterial } from '../src/imports.js';
import { MAX_FILE_BYTES, validateMaterials } from '../src/study.js';
import { duplicateMaterial } from '../src/material-dedup.mjs';

const file = (name, text = name) => new File([text], name, { type: 'text/plain' });
const fakeMaterial = value => ({ id: value.name, name: value.name, text: value.name, type: 'txt', size: value.size });

test('file preparation is bounded while results retain input order despite out-of-order completion', async () => {
  const files = ['first.txt', 'second.txt', 'third.txt', 'fourth.txt'].map(name => file(name));
  const waiting = new Map(), events = [];
  let active = 0, peak = 0;
  const work = prepareMaterials(files, {
    concurrency: 2,
    onEvent: event => events.push(event),
    fingerprintImpl: async bytes => new TextDecoder().decode(bytes),
    readMaterialImpl: async value => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => waiting.set(value.name, resolve));
      active--; return fakeMaterial(value);
    },
  });
  while (waiting.size < 2) await setImmediate();
  assert.deepEqual([...waiting.keys()], ['first.txt', 'second.txt']);
  waiting.get('second.txt')();
  while (waiting.size < 3) await setImmediate();
  waiting.get('third.txt')();
  while (waiting.size < 4) await setImmediate();
  waiting.get('fourth.txt')(); waiting.get('first.txt')();
  const results = await work;
  assert.equal(peak, 2);
  assert.deepEqual(results.map(result => result.material.name), files.map(value => value.name));
  assert.deepEqual(events.map(event => event.completed), [1, 2, 3, 4]);
  assert.deepEqual(events.slice(0, 2).map(event => event.index), [1, 2]);
  assert.ok(events.every(event => event.total === 4 && event.type === 'prepared'));
});

for (const [label, settings] of [['default', {}], ['oversized requested concurrency', { concurrency: 50 }]]) {
  test(`${label} runs five file extractions together and queues the sixth`, async () => {
    const files = Array.from({ length: 7 }, (_, index) => file(`file-${index + 1}.txt`));
    const waiting = new Map();
    let active = 0, peak = 0;
    const work = prepareMaterials(files, {
      ...settings,
      fingerprintImpl: async bytes => new TextDecoder().decode(bytes),
      readMaterialImpl: async value => {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => waiting.set(value.name, resolve));
        active--; return fakeMaterial(value);
      },
    });
    const waitForStarted = async count => {
      for (let turn = 0; waiting.size < count && turn < 100; turn++) await setImmediate();
      assert.equal(waiting.size, count);
    };
    await waitForStarted(5);
    assert.deepEqual([...waiting.keys()], files.slice(0, 5).map(value => value.name));
    assert.equal(active, 5);
    assert.equal(waiting.has('file-6.txt'), false, 'sixth file waits while all five slots are occupied');
    waiting.get('file-2.txt')();
    await waitForStarted(6);
    assert.equal(active, 5);
    assert.equal(waiting.has('file-7.txt'), false);
    waiting.get('file-3.txt')();
    await waitForStarted(7);
    assert.equal(active, 5);
    for (const resolve of waiting.values()) resolve();
    const results = await work;
    assert.equal(peak, 5, 'no extraction wave exceeds five active files');
    assert.equal(active, 0);
    assert.deepEqual(results.map(result => result.material.name), files.map(value => value.name));
  });
}

test('oversized files are never read and existing byte duplicates are never parsed', async () => {
  let reads = 0, parses = 0;
  const tooLarge = { name: 'large.pdf', size: MAX_FILE_BYTES + 1, async arrayBuffer() { reads++; throw Error('must not read'); } };
  const existing = [{ id: 'saved', name: 'old.pdf', text: 'Old source', fingerprint: 'same' }];
  const results = await prepareMaterials([tooLarge, file('renamed.pdf')], {
    existing, fingerprintImpl: async () => 'same',
    readMaterialImpl: async () => { parses++; throw Error('must not parse'); },
  });
  assert.equal(reads, 0); assert.equal(parses, 0);
  assert.match(results[0].error.message, /larger than 20 MB/);
  assert.deepEqual(results[1], { duplicate: true, reason: 'identical-bytes', fingerprint: 'same' });
  assert.equal(existing.length, 1);
});

test('failed reads or parsers do not discard successful files or stop later work', async () => {
  const files = [
    { name: 'unreadable.txt', size: 1, async arrayBuffer() { throw Error('read failed'); } },
    file('corrupt.docx'), file('good.txt'),
  ];
  const events = [];
  const results = await prepareMaterials(files, {
    concurrency: 1,
    fingerprintImpl: async () => 'fingerprint',
    readMaterialImpl: async value => { if (value.name === 'corrupt.docx') throw Error('parser failed'); return fakeMaterial(value); },
    onEvent(event) { events.push(event); throw Error('progress observer failed'); },
  });
  assert.match(results[0].error.message, /read failed/);
  assert.match(results[1].error.message, /parser failed/);
  assert.equal(results[2].material.name, 'good.txt');
  assert.deepEqual(events.map(event => event.type), ['failed', 'failed', 'prepared']);
});

test('default text extraction reuses bytes and ordered acceptance still skips within-batch duplicates', async () => {
  const values = [file('first.md', 'Notes about diffusion.'), file('renamed.txt', 'Notes about diffusion.')];
  for (const value of values) value.text = () => { throw Error('must not reread text'); };
  const results = await prepareMaterials(values);
  const accepted = [];
  for (const { material } of results) if (!duplicateMaterial(material, accepted)) {
    validateMaterials([...accepted, material]); accepted.push(material);
  }
  assert.equal(accepted.length, 1); assert.equal(accepted[0].name, 'first.md');
  assert.equal(results[0].material.fingerprint, results[1].material.fingerprint);
  assert.equal(accepted[0].text, 'Notes about diffusion.');
});

test('provided text bytes preserve UTF-8 decoding, BOM handling and NUL cleanup', async () => {
  const value = file('notes.md', '\ufeff# π and θ\nA\u0000B');
  const original = await readMaterial(value);
  value.text = () => { throw Error('second read forbidden'); };
  const reused = await readMaterial(value, { arrayBuffer: await value.arrayBuffer() });
  assert.equal(reused.text, original.text);
  assert.equal(reused.text, '# π and θ\nAB');
});

test('empty batches create no preparation work or progress events', async () => {
  const results = await prepareMaterials([], { onEvent() { throw Error('unexpected event'); }, readMaterialImpl() { throw Error('unexpected read'); } });
  assert.deepEqual(results, []);
});
