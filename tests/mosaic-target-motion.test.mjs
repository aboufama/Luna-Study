import test from 'node:test';
import assert from 'node:assert/strict';
import { createMosaicTargetMotion } from '../src/mosaic-target-motion.mjs';
import { createMosaicField } from '../src/mosaic-field.mjs';
import { compileMosaicScene } from '../src/mosaic-stage.mjs';

const target = (x, y, extra = {}) => ({ x, y, rotation: 0, scale: 1, role: 'board', ...extra });
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);

test('first assignment is immediate, defaults are finite, and source targets are untouched', () => {
  const motion = createMosaicTargetMotion(2);
  const targets = [target(20, 40, { id: 'one' }), { x: 80, y: 100, role: 'tutor', id: 'two' }];
  const saved = structuredClone(targets);
  const poses = motion.setTargets(targets);
  assert.equal(poses, motion.poses);
  assert.deepEqual(poses[0], { ...targets[0], tutorMix: 0 });
  assert.deepEqual(poses[1], { ...targets[1], rotation: 0, scale: 1, tutorMix: 1 });
  targets[0].x = 999;
  assert.equal(motion.step(100)[0].x, 20, 'sources are not retained');
  assert.deepEqual(saved[1], targets[1]);
  assert.deepEqual(Object.keys(targets[1]).sort(), ['id', 'role', 'x', 'y']);
});

test('raw field scenes pass directly from the compiler to motion with numeric tile IDs', () => {
  const tiles = createMosaicField().tiles;
  const scene = compileMosaicScene(tiles, { version: 1, groups: [
    { id: 'tutor', shape: { type: 'circle', x: 400, y: 300, radius: 160 } },
  ] });
  const motion = createMosaicTargetMotion(tiles.length);
  const poses = motion.setTargets(scene.targets);
  assert.equal(poses.length, tiles.length);
  poses.forEach((pose, index) => {
    assert.equal(pose.id, index);
    assert.equal(pose.x, scene.targets[index].x);
    assert.equal(pose.y, scene.targets[index].y);
    assert.equal(pose.scale, 1);
    assert.equal(pose.tutorMix, 1);
  });
  assert.throws(() => motion.setTargets(scene.targets.map((pose, index) => index ? pose : { ...pose, id: Infinity })), TypeError);
});

test('viewport resize eases to exact new poses within 600 ms and preserves references', () => {
  const motion = createMosaicTargetMotion(2);
  const poses = motion.setTargets([target(20, 50), target(800, 650, { role: 'tutor' })]);
  const references = [...poses], before = structuredClone(poses);
  const resized = [target(12, 50), target(320, 540, { role: 'tutor' })];
  assert.equal(motion.setTargets(resized), poses);
  assert.deepEqual(motion.step(0), before, 'retargeting never jumps');
  for (let frame = 0; frame < 37; frame++) {
    assert.equal(motion.step(16), poses);
    for (let index = 0; index < poses.length; index++) {
      assert.equal(poses[index], references[index]);
      assert.equal(poses[index].scale, 1, 'viewport resizing must not resize a tile');
      for (const field of ['x', 'y', 'rotation', 'scale', 'tutorMix']) assert.ok(Number.isFinite(poses[index][field]));
    }
  }
  assert.notEqual(poses[1].x, resized[1].x, 'motion has not completed early');
  motion.step(8);
  for (let index = 0; index < poses.length; index++) {
    assert.equal(poses[index].x, resized[index].x);
    assert.equal(poses[index].y, resized[index].y);
    assert.equal(poses[index].scale, resized[index].scale);
  }
});

test('rapid retargeting preserves displayed position and incoming velocity', () => {
  const motion = createMosaicTargetMotion(1);
  motion.setTargets([target(0, 0)]);
  motion.setTargets([target(100, 200)]);
  motion.step(32);
  const before = { ...motion.poses[0] };
  motion.setTargets([target(-100, -200)]);
  assert.deepEqual(motion.step(0)[0], before);
  motion.step(.001);
  assert.ok(motion.poses[0].x > before.x, 'existing forward velocity survives reversal');
  assert.ok(Math.abs(motion.poses[0].x - before.x) < .01);
  motion.step(600);
  assert.equal(motion.poses[0].x, -100);
  assert.equal(motion.poses[0].y, -200);
});

test('equivalent repeated targets do not delay completion or reset unchanged tiles', () => {
  const motion = createMosaicTargetMotion(2);
  motion.setTargets([target(0, 0), target(0, 0)]);
  const next = [target(100, 100), target(200, 200)];
  motion.setTargets(next);
  for (let frame = 0; frame < 40; frame++) {
    motion.setTargets(structuredClone(next));
    motion.step(16);
  }
  assert.equal(motion.poses[0].x, 100);
  assert.equal(motion.poses[1].x, 200);
  motion.setTargets([target(300, 300), target(400, 400)]);
  motion.step(300);
  motion.setTargets([target(300, 300), target(600, 600)]);
  motion.step(300);
  assert.equal(motion.poses[0].x, 300, 'unchanged tile keeps its own completion clock');
  assert.notEqual(motion.poses[1].x, 600);
});

test('rotation crosses the angle seam by the shortest path without a final jump', () => {
  const motion = createMosaicTargetMotion(1), radians = degrees => degrees * Math.PI / 180;
  motion.setTargets([target(0, 0, { rotation: radians(179) })]);
  motion.setTargets([target(0, 0, { rotation: radians(-179) })]);
  const after = motion.step(100)[0].rotation;
  assert.ok(after > radians(179) && after < radians(181));
  motion.step(500);
  close(motion.poses[0].rotation, radians(181));
  motion.setTargets([target(0, 0, { rotation: radians(-179) })]);
  close(motion.step(0)[0].rotation, radians(181));
});

test('role switches immediately but tutorMix fades, stays bounded and honors reduced motion', () => {
  const motion = createMosaicTargetMotion(1);
  motion.setTargets([target(0, 0)]);
  motion.setTargets([target(100, 100, { role: 'tutor' })]);
  assert.equal(motion.poses[0].role, 'tutor');
  assert.equal(motion.poses[0].tutorMix, 0);
  motion.step(64);
  assert.ok(motion.poses[0].tutorMix > 0 && motion.poses[0].tutorMix < 1);
  motion.setTargets([target(50, 50)]);
  for (let frame = 0; frame < 40; frame++) {
    motion.step(16);
    assert.ok(motion.poses[0].tutorMix >= 0 && motion.poses[0].tutorMix <= 1);
    assert.equal(motion.poses[0].scale, 1);
  }
  motion.setTargets([target(100, 150, { role: 'tutor' })]);
  motion.step(0, true);
  assert.equal(motion.poses[0].x, 100);
  assert.equal(motion.poses[0].y, 150);
  assert.equal(motion.poses[0].tutorMix, 1);
  motion.setTargets([target(22, 33)], { immediate: true });
  assert.equal(motion.poses[0].x, 22);
  assert.equal(motion.poses[0].tutorMix, 0);
});

test('scale changes are rejected atomically without disturbing a transition', () => {
  const motion = createMosaicTargetMotion(2);
  const control = createMosaicTargetMotion(2);
  for (const engine of [motion, control]) {
    engine.setTargets([target(1, 2), target(3, 4)]);
    engine.setTargets([target(100, 200), target(300, 400, { role: 'tutor' })]);
    engine.step(64);
  }
  const before = structuredClone(motion.poses);
  for (const scale of [0, .3, .8, 1.001, 2, -1, NaN, Infinity, null, undefined, '1']) {
    assert.throws(() => motion.setTargets([target(-100, -200), target(3, 4, { scale })]), /must keep scale 1/);
    assert.deepEqual(motion.poses, before, `rejected scale ${scale} must not change any pose`);
  }
  assert.deepEqual(motion.step(64), control.step(64), 'rejected targets preserve incoming velocities and goals');
  assert.deepEqual(motion.step(600), control.step(600));
  motion.poses.forEach(pose => assert.equal(pose.scale, 1));
});

test('invalid targets fail atomically, fixed pool length is enforced and invalid deltas do not move tiles', () => {
  assert.throws(() => createMosaicTargetMotion(-1), TypeError);
  assert.throws(() => createMosaicTargetMotion(1.5), TypeError);
  assert.deepEqual(createMosaicTargetMotion(0).setTargets([]), []);
  const motion = createMosaicTargetMotion(2);
  motion.setTargets([target(1, 2), target(3, 4)]);
  const before = structuredClone(motion.poses);
  assert.throws(() => motion.setTargets([target(10, 20)]), TypeError);
  assert.throws(() => motion.setTargets([target(10, 20), ,]), TypeError);
  assert.throws(() => motion.setTargets([target(10, 20), target(NaN, 20)]), TypeError);
  assert.throws(() => motion.setTargets([target(10, 20), target(1, 2, { scale: -1 })]), TypeError);
  assert.deepEqual(motion.poses, before);
  motion.setTargets([target(10, 20), target(30, 40)]);
  for (const dt of [-1, NaN, Infinity, undefined]) assert.deepEqual(motion.step(dt), before);
  motion.step(10000);
  assert.equal(motion.poses[0].x, 10);
});
