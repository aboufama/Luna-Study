import test from 'node:test';
import assert from 'node:assert/strict';
import { createMosaicRest } from '../src/mosaic-rest.mjs';
import { createMosaicField } from '../src/mosaic-field.mjs';

const tiles = createMosaicField().tiles;
function seeded(seed = 8173) {
  return () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
}
const createRest = (seed = 8173) => createMosaicRest(tiles, { random: seeded(seed) });
const advance = (rest, duration, options = {}) => {
  for (let time = 0; time < duration; time += 20) rest.step({ dt: Math.min(20, duration - time), resting: true, ...options });
};
const snapshot = rest => [Array.from(rest.x), Array.from(rest.y), Array.from(rest.rotation)];
const zero = rest => rest.x.every(value => value === 0) && rest.y.every(value => value === 0) && rest.rotation.every(value => value === 0);

test('rest samples irregular single stones and neighboring pairs/triples with varied outward distances', () => {
  const original = structuredClone(tiles), first = createRest(), second = createRest();
  assert.ok(first.indices.length >= 11 && first.indices.length <= 14);
  assert.deepEqual(first.indices, second.indices, 'a supplied random source makes an arrangement reproducible');
  assert.equal(new Set(first.indices).size, first.indices.length);
  assert.ok(first.groups.some(group => group.length === 1));
  assert.ok(first.groups.some(group => group.length === 2));
  assert.ok(first.groups.some(group => group.length === 3));
  for (const group of first.groups) {
    assert.ok(group.length >= 1 && group.length <= 3);
    for (const index of group) {
      assert.ok(Math.hypot(tiles[index].x, tiles[index].y) >= 128 && Math.hypot(tiles[index].x, tiles[index].y) <= 146);
      assert.ok(tiles[index].edge >= .16);
      if (group.length > 1) assert.ok(group.some(other => other !== index && Math.hypot(tiles[index].x - tiles[other].x, tiles[index].y - tiles[other].y) < 10.5));
    }
  }
  advance(first, 8000); advance(second, 8000);
  assert.deepEqual(snapshot(first), snapshot(second));
  assert.deepEqual(tiles, original);
  const selected = new Set(first.indices), distances = [];
  for (let index = 0; index < tiles.length; index++) {
    if (!selected.has(index)) { assert.equal(first.x[index], 0); assert.equal(first.y[index], 0); assert.equal(first.rotation[index], 0); }
    else {
      const displacement = Math.hypot(first.x[index], first.y[index]); distances.push(displacement);
      assert.ok(displacement >= 2.5 && displacement <= 28);
      assert.ok(Math.abs(first.rotation[index]) <= .1);
      assert.ok(first.x[index] * tiles[index].x + first.y[index] * tiles[index].y > 0, 'drift points outward');
    }
  }
  assert.ok(Math.max(...distances) - Math.min(...distances) > 16, 'some barely leave, others reach farther');
  const angles = first.groups.map(group => Math.atan2(tiles[group[0]].y, tiles[group[0]].x)).sort((a,b) => a-b);
  const gaps = angles.map((angle,i) => (angles[(i+1)%angles.length] - angle + Math.PI*2) % (Math.PI*2));
  assert.ok(Math.max(...gaps) / Math.min(...gaps) > 2, 'fragments have visibly uneven angular spacing');
});

test('each new quiet period chooses new stones and paths only after the previous ones return home', () => {
  const rest = createRest(), initial = [...rest.indices];
  advance(rest, 8000);
  const held = snapshot(rest); advance(rest, 4000);
  assert.deepEqual(snapshot(rest), held, 'no frame noise or wandering after settling');
  advance(rest, 260, { engaged: true }); assert.ok(zero(rest));
  advance(rest, 800); assert.deepEqual(rest.indices, initial, 'do not reassign stones while returning or waiting');
  advance(rest, 8000);
  assert.notDeepEqual(rest.indices, initial);
  for (const index of initial) if (!rest.indices.includes(index)) { assert.equal(rest.x[index], 0); assert.equal(rest.y[index], 0); }
  assert.notDeepEqual(createRest(90).indices, createRest(91).indices, 'different random seeds produce different arrangements');
});

test('small clusters remain rigid during departure and lock-in across randomized arrangements', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rest = createRest(seed);
    assert.ok(rest.groups.length >= 7);
    assert.ok(rest.groups.some(group => group.length === 3));
    const faint = rest.groups.filter(group => group.every(index => tiles[index].edge < .74));
    assert.ok(faint.some(group => group.length === 1) && faint.some(group => group.length === 2), 'each quiet arrangement includes faint singles and a neighboring pair');
    assert.ok(rest.indices.filter(index => tiles[index].edge >= .74).length >= 9, 'opaque fragments remain present');
    assert.ok(faint.flat().length <= 4, 'the translucent rim remains mostly intact');
    for (const options of [{ duration: 2400 }, { duration: 5600 }, { duration: 120, engaged: true }]) {
      advance(rest, options.duration, options);
      for (const group of rest.groups) for (const index of group) for (const other of group) {
        const before = Math.hypot(tiles[index].x - tiles[other].x, tiles[index].y - tiles[other].y);
        const after = Math.hypot(tiles[index].x + rest.x[index] - tiles[other].x - rest.x[other], tiles[index].y + rest.y[index] - tiles[other].y - rest.y[other]);
        assert.ok(Math.abs(before - after) < .00001, 'a shared rigid transform preserves distances inside each fragment');
        assert.equal(rest.rotation[index], rest.rotation[other]);
      }
    }
  }
});

test('quiet delay and slow stagger prevent a sudden detached ring', () => {
  const rest = createRest();
  advance(rest, 700); assert.ok(zero(rest));
  advance(rest, 300);
  const started = rest.indices.filter(index => Math.hypot(rest.x[index], rest.y[index]) > .0001);
  assert.ok(started.length > 0 && started.length < rest.indices.length);
  assert.ok(rest.indices.every(index => Math.hypot(rest.x[index], rest.y[index]) < .2));
});

test('faint outer-rim fragments travel less and resample alongside the opaque stones', () => {
  const rest = createRest();
  const arrangements = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    advance(rest, 9000);
    const faint = rest.indices.filter(index => tiles[index].edge < .74);
    assert.ok(faint.length >= 3 && faint.length <= 4);
    for (const index of faint) {
      assert.ok(Math.hypot(tiles[index].x, tiles[index].y) >= 140, 'only the translucent outer course uses the faint treatment');
      const distance = Math.hypot(rest.x[index], rest.y[index]);
      assert.ok(distance >= 3.5 && distance <= 15, 'faint stones loosen gently without joining the long opaque departures');
    }
    arrangements.push(faint);
    advance(rest, 260, { engaged: true });
    assert.ok(zero(rest), 'both textures return exactly in the same 260ms');
  }
  assert.notDeepEqual(arrangements[0], arrangements[1]);
  assert.notDeepEqual(arrangements[1], arrangements[2]);
});

test('engagement returns continuously without overshoot and locks exactly by 260ms', () => {
  const rest = createRest();
  advance(rest, 5600);
  let previous = snapshot(rest);
  rest.step({ dt: 0, resting: false, engaged: true });
  assert.deepEqual(snapshot(rest), previous, 'paused engagement cannot teleport a tile');
  for (let elapsed = 20; elapsed <= 260; elapsed += 20) {
    rest.step({ dt: 20, resting: false, engaged: true });
    for (const index of rest.indices) {
      assert.ok(Math.hypot(rest.x[index], rest.y[index]) <= Math.hypot(previous[0][index], previous[1][index]) + .00001);
      assert.ok(rest.x[index] * previous[0][index] + rest.y[index] * previous[1][index] >= 0, 'no crossing past home');
      assert.ok(Math.abs(rest.rotation[index]) <= Math.abs(previous[2][index]) + .00001);
    }
    if (elapsed === 20) assert.ok(rest.indices.some(index => Math.hypot(rest.x[index], rest.y[index]) > 13), 'first frame begins the return without snapping home');
    previous = snapshot(rest);
  }
  assert.ok(zero(rest));
  advance(rest, 800, { resting: false, engaged: true }); assert.ok(zero(rest));
});

test('brief activity and interrupted departures finish returning before quiet reentry', () => {
  const rest = createRest();
  advance(rest, 2100);
  rest.step({ dt: 20, resting: true, engaged: true });
  advance(rest, 240); assert.ok(zero(rest), 'a one-frame event completes its full return');
  advance(rest, 800); assert.ok(zero(rest), 'late-activity hold and quiet delay prevent flutter');
  advance(rest, 1000); assert.ok(!zero(rest), 'drift can restart after a genuine quiet interval');
  rest.step({ dt: 20, resting: false });
  advance(rest, 80);
  rest.step({ dt: 20, resting: true, engaged: true });
  advance(rest, 140);
  assert.ok(zero(rest), 'repeated activity does not keep restarting the return clock');
});

test('pause, invalid timing, reduced motion and tiny inputs stay safe and exact', () => {
  const rest = createRest();
  advance(rest, 3500);
  const before = snapshot(rest);
  for (const dt of [0, -1, NaN, Infinity]) rest.step({ dt, resting: true });
  assert.deepEqual(snapshot(rest), before);
  const large = createRest(), clamped = createRest();
  large.step({ dt: 10000, resting: true }); clamped.step({ dt: 80, resting: true });
  advance(large, 1000); advance(clamped, 1000); assert.deepEqual(snapshot(large), snapshot(clamped));
  rest.step({ dt: 0, resting: true, reduced: true }); assert.ok(zero(rest));
  advance(rest, 6000, { reduced: true }); assert.ok(zero(rest));
  advance(rest, 700); assert.ok(zero(rest), 'reduced-motion exit still waits before drifting');
  for (const input of [[], [{ x: 0, y: 0 }], [{ x: NaN, y: 135 }], [{ x: 130, y: 0, edge: .1 }]]) {
    const tiny = createMosaicRest(input); advance(tiny, 6000); assert.deepEqual(tiny.indices, []); assert.ok(zero(tiny));
  }
});

test('being caught triggers one staggered rigid focus twist after the fragments return', () => {
  const rest = createRest();
  advance(rest, 8000);
  assert.ok(rest.focusRotation.every(value => value === 0));
  advance(rest, 260, { engaged: true });
  assert.ok(zero(rest));
  assert.ok(rest.focusRotation.every(value => value === 0), 'fragment return precedes the focus accent');
  advance(rest, 100, { engaged: true });
  const courses = new Map();
  for (let index = 0; index < tiles.length; index++) {
    const course = Math.floor((Math.hypot(tiles[index].x, tiles[index].y) - 2.9) / 6.8) + 1;
    if (course < 19 || course > 21) { assert.equal(rest.focusRotation[index], 0); continue; }
    if (courses.has(course)) assert.equal(rest.focusRotation[index], courses.get(course), 'whole courses rotate together');
    courses.set(course, rest.focusRotation[index]);
        assert.ok(Math.abs(rest.focusRotation[index]) <= .061);
  }
  assert.ok(courses.get(21) > .05 && courses.get(21) <= .0601);
  assert.ok(courses.get(20) < -.02 && courses.get(20) >= -.0321);
  assert.ok(courses.get(19) > 0 && courses.get(19) < .0151);
  advance(rest, 400, { engaged: true });
  assert.ok(rest.focusRotation.every(value => value === 0));
  advance(rest, 2000, { engaged: true });
  assert.ok(rest.focusRotation.every(value => value === 0), 'continued pointer or speech activity does not retrigger the spin');
});

test('focus accents never run on an undrifted circle, whiteboard, intake or reduced-motion view', () => {
  const rest = createRest();
  advance(rest, 2000, { engaged: true });
  assert.ok(rest.focusRotation.every(value => value === 0));
  advance(rest, 8000);
  advance(rest, 380, { engaged: true, allowFocus: false });
  assert.ok(zero(rest));
  assert.ok(rest.focusRotation.every(value => value === 0));
  advance(rest, 8000);
  advance(rest, 380, { engaged: true });
  assert.ok(rest.focusRotation.some(value => value !== 0));
  const snapshot = [...rest.focusRotation];
  rest.step({ dt: 0, engaged: true });
  assert.deepEqual([...rest.focusRotation], snapshot, 'pause freezes a focus twist');
  rest.step({ dt: 0, reduced: true });
  assert.ok(rest.focusRotation.every(value => value === 0));
});

test('an in-flight focus twist finishes continuously when a board transition takes over', () => {
  const rest = createRest();
  advance(rest, 8000); advance(rest, 350, { engaged: true });
  const before = [...rest.focusRotation];
  rest.step({ dt: 20, resting: false, allowFocus: false });
  assert.ok(rest.focusRotation.some(value => value !== 0), 'new activity does not snap a rotating band home');
  for (let index = 0; index < tiles.length; index++) assert.ok(Math.abs(rest.focusRotation[index] - before[index]) < .025);
  advance(rest, 400, { engaged: true, allowFocus: false });
  assert.ok(rest.focusRotation.every(value => value === 0));
});
