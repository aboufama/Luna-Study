import test from 'node:test';
import assert from 'node:assert/strict';
import { createVariant } from '../src/mosaic-lab/palimpsest.mjs';
import { createMosaicField } from '../src/mosaic-field.mjs';
import { mosaicBorderTargets } from '../src/mosaic-motion.mjs';

const tiles = createMosaicField().tiles;
const border = mosaicBorderTargets(tiles, { width: 560, height: 460, top: 44, bottom: 44, inset: 30 });
const build = seed => createVariant({ tiles, border, width: 560, height: 460, seed });
const frame = { dt: 32, state: 'thinking', level: 0, pointer: { x: 0, y: 0, active: false }, boardProgress: 0, reduced: false };

test('Palimpsest repeats exactly for a seed and fixed input sequence, with individual stone poses', () => {
  function replay(seed) { const variant = build(seed); let output; for (let index = 0; index < 120; index++) output = variant.step(frame); return { output: Array.from(output), tilt: Array.from(variant.tiltX) }; }
  const first = replay(123456);
  assert.deepEqual(replay(123456), first);
  assert.notDeepEqual(replay(654321), first);
  const active = first.output.filter((value, index) => index % 4 === 2 && Math.abs(value) > .0001);
  assert.ok(active.length > 100, 'the pen leaves a visible wake of individually active stones');
  assert.ok(new Set(active.map(value => value.toFixed(7))).size > active.length * .98, 'active stones have individual turns, not shared plate rotations');
  assert.ok(first.tilt.some(value => Math.abs(value) > .02));
});

test('idle and reduced motion retain the production circle; moving stones stay bounded and finite', () => {
  const original = structuredClone(tiles), variant = build(23);
  const resting = variant.step({ ...frame, state: 'idle', dt: 0 });
  for (let index = 0; index < tiles.length; index++) {
    assert.ok(Math.abs(resting[index * 4] - (280 + tiles[index].x * .97)) < .00005);
    assert.ok(Math.abs(resting[index * 4 + 1] - (230 + tiles[index].y * .97)) < .00005);
    assert.equal(resting[index * 4 + 2], 0);
  }
  const buffer = resting;
  for (const state of ['thinking', 'speaking', 'listening', 'idle']) {
    for (let tick = 0; tick < 90; tick++) {
      const result = variant.step({ ...frame, state, level: .04 + Math.sin(tick / 9) * .03, pointer: { active: true, x: 275, y: 190 } });
      assert.equal(result, buffer);
      for (let index = 0; index < tiles.length; index++) {
        const offset = index * 4;
        assert.ok(result.subarray(offset, offset + 4).every(Number.isFinite));
        assert.ok(Math.hypot(result[offset] - 280 - tiles[index].x * .97, result[offset + 1] - 230 - tiles[index].y * .97) < 5);
        assert.ok(Math.abs(result[offset + 2]) < .35);
        assert.ok(Math.hypot(variant.tiltX[index], variant.tiltY[index]) <= .300001);
        assert.ok(result[offset + 3] >= 0 && result[offset + 3] <= 1);
      }
    }
  }
  const reduced = Array.from(variant.step({ ...frame, reduced: true, state: 'speaking', level: 1 }));
  assert.deepEqual(Array.from(variant.step({ ...frame, reduced: true, state: 'thinking', level: .6 })), reduced);
  assert.ok(variant.tiltX.every(value => value === 0) && variant.tiltY.every(value => value === 0));
  assert.deepEqual(tiles, original, 'tile vertices and source geometry remain untouched');
});

test('board endpoints are exact and paused frames remain unchanged', () => {
  const variant = build(9);
  for (let tick = 0; tick < 50; tick++) variant.step(frame);
  const paused = Array.from(variant.step({ ...frame, dt: 0 }));
  assert.deepEqual(Array.from(variant.step({ ...frame, dt: 0 })), paused);
  const output = variant.step({ ...frame, boardProgress: 1 });
  for (let index = 0; index < tiles.length; index++) {
    assert.ok(Math.abs(output[index * 4] - border[index].x) < .00005);
    assert.ok(Math.abs(output[index * 4 + 1] - border[index].y) < .00005);
    assert.ok(Math.abs(output[index * 4 + 2] - border[index].rotation) < .000001);
    assert.equal(variant.tiltX[index], 0); assert.equal(variant.tiltY[index], 0);
  }
  assert.ok(build(1).step({ dt: NaN, level: Infinity, boardProgress: NaN, pointer: { active: true, x: NaN, y: Infinity } }).every(Number.isFinite));
});
