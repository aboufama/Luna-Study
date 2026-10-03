import test from 'node:test';
import assert from 'node:assert/strict';
import { createMosaicField } from '../src/mosaic-field.mjs';
import { measureStageLayout, createMosaicStageTargets, compileMosaicScene } from '../src/mosaic-stage.mjs';

const finiteTargets = targets => targets.every(target => ['x', 'y', 'rotation', 'scale'].every(key => Number.isFinite(target[key])));
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const field = createMosaicField().tiles;
const stageFor = request => createMosaicStageTargets(field, measureStageLayout(request));
const tutorBounds = tutor => ({ x: tutor.x - tutor.radius, y: tutor.y - tutor.radius, width: tutor.radius * 2, height: tutor.radius * 2 });
const assertSafeLayout = layout => {
  const { board, tutor, captions } = layout;
  const corner = tutorBounds(tutor);
  assert.equal(layout.arrangement, 'integrated');
  assert.ok(board.x >= layout.margin - 1e-8);
  assert.ok(board.y >= 28 - 1e-8);
  assert.ok(board.x + board.width <= layout.width - layout.margin + 1e-8);
  assert.ok(board.y + board.height < layout.dockTop);
  assert.ok(corner.x >= board.x && corner.y >= board.y);
  assert.ok(corner.x + corner.width <= board.x + board.width + 1e-8);
  assert.ok(corner.y + corner.height <= board.y + board.height + 1e-8);
  assert.ok(!overlaps(captions, corner));
  assert.ok(!overlaps(captions, board));
  assert.ok(captions.y + captions.height <= layout.dockTop + 1e-8);
  assert.ok(layout.courses >= 2 && layout.courses <= 4);
  assert.equal(layout.frameInset, layout.courses * layout.pitch + 3);
  assert.equal(layout.content.x, board.inner.x + 16);
  assert.equal(layout.content.width, board.inner.width - 32);
};

const polygonAt = (tile, pose) => {
  const cosine = Math.cos(pose.rotation), sine = Math.sin(pose.rotation);
  return tile.vertices.map(vertex => ({ x: pose.x + vertex.x * cosine - vertex.y * sine,
    y: pose.y + vertex.x * sine + vertex.y * cosine }));
};

const polygonsOverlap = (a, b) => {
  for (const polygon of [a, b]) for (let index = 0; index < polygon.length; index++) {
    const next = polygon[(index + 1) % polygon.length];
    const normal = { x: polygon[index].y - next.y, y: next.x - polygon[index].x };
    const project = points => points.map(point => point.x * normal.x + point.y * normal.y);
    const first = project(a), second = project(b);
    if (Math.min(...first) >= Math.max(...second) - 1e-8 || Math.min(...second) >= Math.max(...first) - 1e-8) return false;
  }
  return true;
};

test('content grows its board while the tutor stays within the continuous frame', () => {
  for (const viewport of [{ width: 1440, height: 856 }, { width: 390, height: 716 }, { width: 800, height: 500 }]) {
    const small = stageFor({ ...viewport, contentWidth: 230, contentHeight: 80 });
    const large = stageFor({ ...viewport, contentWidth: 1100, contentHeight: 1000 });
    assert.ok(large.layout.board.width >= small.layout.board.width);
    assert.ok(large.layout.content.width >= small.layout.content.width);
    assert.equal(small.layout.maxContentWidth, large.layout.maxContentWidth, 'intrinsic measurement width is independent of content/allocation');
    for (const { layout } of [small, large]) {
      assert.equal(layout.height, Math.max(viewport.height, layout.requiredHeight));
      assertSafeLayout(layout);
    }
  }
});

test('phone layout grows vertically to conserve the fixed-size pool in at most four courses', () => {
  const { layout } = stageFor({ width: 390, height: 716, contentWidth: 880, contentHeight: 760, unit: 360 / 440 });
  assert.equal(layout.unit, 1, 'responsive viewport never changes tile size');
  assert.equal(layout.board.width, 358);
  assert.ok(layout.content.height > 180 && layout.content.height < 760);
  assert.equal(layout.tutor.radius, 44);
  assert.ok(layout.requiredHeight > 716);
  assert.ok(layout.captions.width > 180);
  assertSafeLayout(layout);
});

test('short landscape reports enough scroll space for a quiet frame and the actual dock', () => {
  const { layout } = stageFor({ width: 844, height: 318, contentWidth: 1000, contentHeight: 900 });
  assert.ok(layout.height > 318);
  assert.equal(layout.height, layout.requiredHeight);
  assert.equal(layout.dockTop, layout.height - 71);
  assert.equal(layout.contentTopGap, 40);
  assert.equal(layout.content.y, layout.board.inner.y + 40);
  assert.ok(layout.content.height > 50);
  assertSafeLayout(layout);
});

test('small equations get material-sized breathing room without thickening beyond four courses', () => {
  for (const viewport of [{ width: 320, height: 220 }, { width: 844, height: 318 }, { width: 1440, height: 856 }]) {
    const { layout, targets } = stageFor({ ...viewport, contentWidth: 200, contentHeight: 80 });
    assert.equal(layout.height, Math.max(viewport.height, layout.requiredHeight));
    assert.ok(layout.board.height >= 210);
    assert.equal(layout.courses, 4);
    assert.ok(layout.frameInset < 35);
    assert.ok(targets.every(target => target.scale === 1));
    assertSafeLayout(layout);
  }
});

test('intrinsic measurement capacity remains stable across content and frame course changes', () => {
  for (const width of [320, 390, 520, 560, 600, 720, 800, 844, 1440, 1920]) {
    const preliminary = measureStageLayout({ width, height: 1400 });
    const narrow = stageFor({ width, height: 1400, contentWidth: 20, contentHeight: 40 }).layout;
    const wide = stageFor({ width, height: 1400, contentWidth: 1000, contentHeight: 1000 }).layout;
    assert.equal(preliminary.maxContentWidth, narrow.maxContentWidth);
    assert.equal(narrow.maxContentWidth, wide.maxContentWidth);
    assert.ok(wide.maxContentWidth <= wide.content.width + 1e-8);
    assert.equal(wide.content.y, wide.board.inner.y + 56);
    assertSafeLayout(narrow);
    assertSafeLayout(wide);
  }
});

test('every original stone belongs to the same frame with tutor roles only at its lower-right corner', () => {
  const tiles = createMosaicField().tiles;
  const before = structuredClone(tiles);
  const small = createMosaicStageTargets(tiles, measureStageLayout({ width: 1440, height: 856, contentWidth: 230, contentHeight: 80 }));
  const large = createMosaicStageTargets(tiles, measureStageLayout({ width: 1440, height: 856, contentWidth: 1000, contentHeight: 1000 }));
  for (const stage of [small, large]) {
    assert.equal(stage.targets.length, tiles.length);
    assert.equal(stage.boardCount + stage.tutorCount, tiles.length);
    assert.ok(stage.tutorCount > 0 && stage.tutorCount <= 60);
    assert.equal(new Set(stage.targets.map(target => target.id)).size, tiles.length);
    assert.equal(stage.targets.filter(target => target.role === 'board').length, stage.boardCount);
    assert.equal(stage.targets.filter(target => target.role === 'tutor').length, stage.tutorCount);
    assert.ok(finiteTargets(stage.targets));
    assert.ok(stage.targets.every(target => target.scale === 1));
    const { board, tutor, content } = stage.layout;
    const contentPolygon = [{ x: content.x, y: content.y }, { x: content.x + content.width, y: content.y },
      { x: content.x + content.width, y: content.y + content.height }, { x: content.x, y: content.y + content.height }];
    for (const target of stage.targets) {
      if (target.role === 'tutor') {
        assert.ok(target.x >= tutor.x - tutor.radius && target.y >= tutor.y - tutor.radius);
        assert.ok(target.x <= board.x + board.width && target.y <= board.y + board.height);
      }
      const polygon = polygonAt(tiles[target.id], target);
      for (const point of polygon) {
        assert.ok(point.x >= board.x - 1e-8 && point.y >= board.y - 1e-8);
        assert.ok(point.x <= board.x + board.width + 1e-8 && point.y <= board.y + board.height + 1e-8);
      }
      // The rounded inner edge legitimately enters corners of its rectangular
      // bounds. The actual content rectangle must stay clear of every polygon.
      assert.ok(!polygonsOverlap(polygon, contentPolygon), 'every stone remains outside the content surface');
    }
  }
  assert.deepEqual(tiles, before, 'source vertices, colors, sizes and identities stay intact');
  assert.deepEqual(small, createMosaicStageTargets(tiles, measureStageLayout({ width: 1440, height: 856, contentWidth: 230, contentHeight: 80 })), 'allocation is deterministic');
});

test('native stone polygons do not overlap across two, three, or four curved frame courses', () => {
  const requests = [
    { width: 1440, height: 856 }, { width: 390, height: 716 },
    { width: 1440, height: 856, contentWidth: 1000, contentHeight: 1000 },
    { width: 1920, height: 1400, contentWidth: 1000, contentHeight: 1000 },
  ];
  const courseCounts = new Set();
  for (const request of requests) {
    const stage = stageFor(request);
    courseCounts.add(stage.layout.courses);
    const polygons = stage.targets.map((pose, index) => polygonAt(field[index], pose));
    for (let first = 0; first < field.length; first++) for (let second = first + 1; second < field.length; second++) {
      const a = stage.targets[first], b = stage.targets[second];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 12) continue;
      assert.ok(!polygonsOverlap(polygons[first], polygons[second]), `stones ${first} and ${second} overlap`);
    }
  }
  assert.deepEqual([...courseCounts].sort(), [2, 3, 4]);
});

test('resolved geometry is deterministic and does not mutate its measurement request', () => {
  const layout = measureStageLayout({ width: 1440, height: 856 });
  const before = structuredClone(layout);
  const stage = createMosaicStageTargets(field, layout);
  assert.deepEqual(layout, before);
  assert.deepEqual(createMosaicStageTargets(field, stage.layout), stage);
});

test('tiny or missing dimensions and small tile pools produce finite destinations', () => {
  const tiles = createMosaicField().tiles;
  for (const viewport of [{ width: 1, height: 1 }, { width: 80, height: 80 }, { width: 320, height: 220 }, { width: NaN, height: Infinity }]) {
    for (const pool of [[], tiles.slice(0, 1), tiles.slice(0, 12), tiles]) {
      const layout = measureStageLayout({ ...viewport, contentWidth: Infinity, contentHeight: NaN });
      const stage = createMosaicStageTargets(pool, layout);
      assert.equal(stage.targets.length, pool.length);
      assert.ok(finiteTargets(stage.targets));
    }
  }
});

test('declarative scenes can address independent paths and explicit tile poses by stable ID', () => {
  const tiles = [
    { id: 'a', x: -10, y: 0, angle: 0 }, { id: 'b', x: 0, y: 0, angle: 0 },
    { id: 'c', x: 10, y: 0, angle: 0 }, { id: 'd', x: 15, y: 0, angle: 0 },
  ];
  const result = compileMosaicScene(tiles, { version: 1, groups: [
    { id: 'line', tileIds: ['a', 'c'], shape: { type: 'path', points: [{ x: 10, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 80 }] } },
    { id: 'handle', tileIds: ['b'], shape: { type: 'poses', poses: [{ x: 40, y: 50, rotation: .25, scale: 1 }] } },
  ] });
  assert.deepEqual(result.targets.map(target => [target.id, target.role, target.x, target.y]), [
    ['a', 'line', 10, 20], ['b', 'handle', 40, 50], ['c', 'line', 100, 80], ['d', 'unassigned', 15, 0],
  ]);
  assert.equal(result.targets[1].rotation, .25);
  assert.equal(result.targets[1].scale, 1);
  assert.equal(result.targets[2].rotation, Math.PI / 2);
});

test('circle destinations preserve source geometry and reject resizing through scene commands', () => {
  const tiles = [{ id: 'a', x: -10, y: 0, vertices: [{ x: -2, y: 0 }, { x: 2, y: 0 }] },
    { id: 'b', x: 10, y: 0, vertices: [{ x: -2, y: 0 }, { x: 2, y: 0 }] }];
  const scene = { version: 1, groups: [{ id: 'tutor', shape: { type: 'circle', x: 40, y: 50, radius: 12 } }] };
  const exact = compileMosaicScene(tiles, scene);
  const oversized = compileMosaicScene(tiles, { ...scene, groups: [{ id: 'tutor', shape: { ...scene.groups[0].shape, radius: 100 } }] });
  assert.deepEqual(exact.targets, oversized.targets, 'larger circle bounds cannot enlarge the stones or their spacing');
  assert.deepEqual(exact.targets.map(({ x, y, scale }) => ({ x, y, scale })), [{ x: 30, y: 50, scale: 1 }, { x: 50, y: 50, scale: 1 }]);
  assert.throws(() => compileMosaicScene(tiles, { ...scene, groups: [{ id: 'tutor', shape: { ...scene.groups[0].shape, radius: 11 } }] }), /too small/);
  for (const scale of [0, .5, 2, null, undefined]) {
    assert.throws(() => compileMosaicScene(tiles, { version: 1, groups: [{ id: 'tiles', shape: { type: 'poses', poses: [{ x: 0, y: 0, scale }, { x: 2, y: 2 }] } }] }), /fixed scale/);
  }
  for (const unit of [.5, 2]) assert.throws(() => compileMosaicScene(tiles, { ...scene, unit }), /unit must be 1/);
});

test('scene validation rejects ambiguous IDs, unsupported geometry and unbounded coordinates', () => {
  const tiles = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 2, y: 0 }];
  const circle = { type: 'circle', x: 50, y: 50, radius: 20 };
  const compile = groups => compileMosaicScene(tiles, { version: 1, groups });
  assert.throws(() => compile([{ id: 'first', tileIds: ['a'], shape: circle }, { id: 'second', tileIds: ['a'], shape: circle }]), /assigned twice/);
  assert.throws(() => compile([{ id: 'first', tileIds: ['missing'], shape: circle }]), /must exist/);
  assert.throws(() => compile([{ id: 'first', shape: circle }, { id: 'second', shape: circle }]), /remaining tiles/);
  assert.throws(() => compile([{ id: 'first', role: {}, shape: circle }]), /roles/);
  assert.throws(() => compile([{ id: 'first', role: '', shape: circle }]), /roles/);
  assert.throws(() => compile([{ id: 'first', shape: { type: 'script', code: 'alert(1)' } }]), /Unsupported/);
  assert.throws(() => compile([{ id: 'first', shape: { ...circle, x: Infinity } }]), /circle x/);
  assert.throws(() => compile([{ id: 'first', shape: { type: 'path', points: [{ x: 0, y: 0 }] } }]), /2 to 1024/);
  assert.throws(() => compile([{ id: 'first', tileIds: ['a'], shape: { type: 'poses', poses: [] } }]), /tile count/);
  assert.throws(() => compileMosaicScene(tiles, { version: 2, groups: [] }), /version 1/);
  assert.throws(() => compileMosaicScene([tiles[0], tiles[0]], { version: 1, groups: [] }), /unique/);
});
