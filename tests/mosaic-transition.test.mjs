import test from 'node:test';
import assert from 'node:assert/strict';
import { createMosaicTransition, mosaicCircleCenter } from '../src/mosaic-transition.mjs';
import { createMosaicField } from '../src/mosaic-field.mjs';
import { mosaicBorderTargets } from '../src/mosaic-motion.mjs';

test('circle anchor follows fixed normal layout regardless of caption or board button geometry', () => {
  assert.deepEqual(mosaicCircleCenter(1440, 928, 1), { x: 720, y: 389 });
  assert.deepEqual(mosaicCircleCenter(390, 780, 360 / 440), { x: 195, y: 310.90909090909093 });
});

test('top, parallel sides and bottom settle sequentially within one second', () => {
  const targets = [{ x: 300, y: 50 }, { x: 20, y: 250 }, { x: 580, y: 250 }, { x: 300, y: 450 }];
  const transition = createMosaicTransition(targets.length);
  transition.setTargets(targets);
  let frame;
  for (let time = 0; time < 256; time += 16) frame = transition.step(true, 16);
  assert.ok(frame[0] > frame[1] && frame[1] > frame[3]);
  assert.equal(frame[1], frame[2], 'opposing sides advance together');
  for (let time = 256; time < 992; time += 16) frame = transition.step(true, 16);
  assert.deepEqual(Array.from(frame), [1, 1, 1, 1]);
  assert.equal(frame, transition.progress, 'the frame buffer is reused');
});

test('rapid reversal preserves continuous positions and settles without overshoot', () => {
  const transition = createMosaicTransition(3);
  transition.setTargets([{ x: 300, y: 50 }, { x: 20, y: 250 }, { x: 300, y: 450 }]);
  for (let time = 0; time < 320; time += 16) transition.step(true, 16);
  const before = Array.from(transition.progress);
  assert.deepEqual(Array.from(transition.step(false, 0)), before, 'target changes do not jump');
  let previous = before;
  for (let time = 0; time < 2000; time += 16) {
    const frame = Array.from(transition.step(false, 16));
    for (let index = 0; index < frame.length; index++) {
      assert.ok(frame[index] >= 0 && frame[index] <= 1);
      assert.ok(Math.abs(frame[index] - previous[index]) < .08, 'no sudden interpolation jump');
    }
    previous = frame;
  }
  assert.deepEqual(previous, [0, 0, 0]);
});

test('real field reaches exact border targets, preserves geometry and handles reduced motion and resize', () => {
  const tiles = createMosaicField().tiles;
  const original = structuredClone(tiles);
  const transition = createMosaicTransition(tiles.length);
  transition.setTargets(mosaicBorderTargets(tiles, { width: 1440, height: 928, top: 56, bottom: 123, inset: 27 }));
  for (let time = 0; time < 1000; time += 16) transition.step(true, 16);
  assert.ok(transition.progress.every(value => value === 1));
  transition.setTargets(mosaicBorderTargets(tiles, { width: 390, height: 780, top: 52, bottom: 112, inset: 13, pitch: 7.3 * 360 / 440 }));
  assert.ok(transition.step(true, 16).every(value => value === 1));
  assert.ok(transition.step(false, 16, true).every(value => value === 0));
  assert.ok(transition.step(true, 0, true).every(value => value === 1));
  assert.deepEqual(tiles, original, 'no rigid tile vertices or identities are modified');
  for (let time = 0; time < 1000; time += 16) transition.step(false, 16);
  assert.ok(transition.progress.every(value => value === 0), 'closing also finishes exactly within one second');
});
