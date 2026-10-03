import test from 'node:test';
import assert from 'node:assert/strict';
import { createParticleDynamics } from '../src/particle-dynamics.mjs';

test('measured speech attacks quickly, releases softly, and returns to a smaller idle form', () => {
  const dynamics = createParticleDynamics();
  let value = dynamics.step({ now: 0 });
  assert.equal(value.envelope, 0);
  assert.ok(value.scale < 1);
  for (let now = 33; now <= 495; now += 33) value = dynamics.step({ state: 'speaking', rms: .12, now });
  assert.ok(value.envelope > .98);
  assert.ok(value.scale > 1.03);
  assert.ok(value.ripples.length > 0);
  const beforeRelease = value.envelope;
  value = dynamics.step({ rms: 0, now: 528 });
  assert.ok(value.envelope < beforeRelease && value.envelope > .8);
  for (let now = 561; now <= 3000; now += 33) value = dynamics.step({ rms: 0, now });
  assert.ok(value.envelope < .001);
  assert.ok(value.scale < .98);
  assert.equal(value.ripples.length, 0);
});

test('envelope behavior is consistent across display frame rates', () => {
  const simulate = interval => {
    const dynamics = createParticleDynamics();
    let value = dynamics.step({ now: 0 });
    for (let now = interval; now <= 990; now += interval) value = dynamics.step({ rms: .04, state: 'speaking', now });
    return value.envelope;
  };
  assert.ok(Math.abs(simulate(15) - simulate(33)) < .001);
});

test('cursor influence eases in and decays after leaving without moving the resting cloud', () => {
  const dynamics = createParticleDynamics();
  dynamics.step({ now: 0 });
  let value;
  for (let now = 33; now <= 330; now += 33) value = dynamics.step({ pointer: { x: 50, y: 25, active: true }, now });
  assert.ok(value.pointer.influence > .8);
  value = dynamics.step({ pointer: { x: 100, y: 25, active: true }, now: 363 });
  assert.equal(value.pointer.force, 1);
  for (let now = 396; now <= 2400; now += 33) value = dynamics.step({ pointer: { x: 100, y: 25, active: false }, now });
  assert.ok(value.pointer.influence < .001);
  assert.ok(value.pointer.force < .001);
});

test('document dragging reaches toward its position and settles smoothly on release', () => {
  const dynamics = createParticleDynamics();
  let value;
  for (let now = 0; now <= 990; now += 33) value = dynamics.step({ dragging: true, dragPoint: { x: 280, y: -80 }, pointer: { x: 50, active: true }, now });
  assert.ok(value.drag.reach > 58 && value.drag.reach <= 60);
  assert.ok(value.drag.x > 275 && value.drag.y < -75);
  assert.equal(value.pointer.influence, 0);
  value = dynamics.step({ dragging: false, now: 1023 });
  assert.ok(value.drag.reach > 45 && value.drag.reach < 58);
  for (let now = 1056; now < 3500; now += 33) value = dynamics.step({ dragging: false, now });
  assert.ok(value.drag.reach < .02);
});

test('reduced motion freezes geometric responses while preserving semantic drag state', () => {
  const dynamics = createParticleDynamics({ reducedMotion: true });
  let value;
  for (let now = 0; now < 1000; now += 33) value = dynamics.step({ state: 'speaking', rms: .2, pointer: { x: now, active: true }, dragging: true, dragPoint: { x: 240 }, now });
  assert.equal(value.phase, 0);
  assert.equal(value.scale, .97);
  assert.equal(value.pointer.influence, 0);
  assert.equal(value.pointer.force, 0);
  assert.equal(value.ripples.length, 0);
  assert.equal(value.drag.active, true);
  assert.equal(value.drag.reach, 0);
});

test('invalid audio input and stale timestamps remain bounded', () => {
  const dynamics = createParticleDynamics();
  dynamics.step({ rms: NaN, now: 100 });
  const value = dynamics.step({ rms: Infinity, now: 50, pointer: { x: NaN, y: Infinity, active: true } });
  assert.equal(value.envelope, 0);
  assert.ok(Number.isFinite(value.phase));
  assert.ok(Number.isFinite(value.pointer.x));
});
