const TAU = Math.PI * 2;
const PITCH = 7.3;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = value => ((value % TAU) + TAU) % TAU;
const shortest = value => wrap(value + Math.PI) - Math.PI;

function course(left, top, right, bottom, radius) {
  const width = Math.max(1, right - left), height = Math.max(1, bottom - top);
  const r = clamp(radius, 0, Math.min(width, height) / 2);
  const horizontal = Math.max(0, width - 2 * r);
  const vertical = Math.max(0, height - 2 * r);
  const arc = r * Math.PI / 2;
  const perimeter = 2 * horizontal + 2 * vertical + 4 * arc;
  const segments = [
    { length: horizontal, x: left + r, y: top, angle: 0 },
    { length: arc, cx: right - r, cy: top + r, start: -Math.PI / 2 },
    { length: vertical, x: right, y: top + r, angle: Math.PI / 2 },
    { length: arc, cx: right - r, cy: bottom - r, start: 0 },
    { length: horizontal, x: right - r, y: bottom, angle: Math.PI },
    { length: arc, cx: left + r, cy: bottom - r, start: Math.PI / 2 },
    { length: vertical, x: left, y: bottom - r, angle: -Math.PI / 2 },
    { length: arc, cx: left + r, cy: top + r, start: Math.PI },
  ];
  return {
    perimeter,
    at(fraction) {
      // The first polar tile starts above the center, not at a corner.
      let distance = (fraction * perimeter + horizontal / 2) % perimeter;
      for (const segment of segments) {
        if (segment.length <= 0) continue;
        if (distance > segment.length) { distance -= segment.length; continue; }
        if (segment.start !== undefined) {
          const angle = segment.start + distance / r;
          return { x: segment.cx + Math.cos(angle) * r, y: segment.cy + Math.sin(angle) * r, angle: angle + Math.PI / 2 };
        }
        return { x: segment.x + Math.cos(segment.angle) * distance, y: segment.y + Math.sin(segment.angle) * distance, angle: segment.angle };
      }
      return { x: left + width / 2, y: top, angle: 0 };
    },
  };
}

/**
 * Rigid border destinations, in full viewport coordinates and original order.
 * rotation is the shortest turn from each tile's existing tangent orientation.
 * This is a layout calculation only: no animation, random motion, or mutation.
 */
export function mosaicBorderTargets(tiles, { width, height, top = 28, bottom = 112, inset = 24, pitch = PITCH } = {}) {
  if (!Array.isArray(tiles) || !tiles.length) return [];
  const tilePitch = Number.isFinite(pitch) ? clamp(pitch, 4, 10) : PITCH;
  const w = Number.isFinite(width) ? Math.max(1, width) : 440;
  const h = Number.isFinite(height) ? Math.max(1, height) : 700;
  const margin = clamp(Number.isFinite(inset) ? inset : 24, 0, Math.max(0, (w - 1) / 2));
  const yTop = clamp(Number.isFinite(top) ? top : 28, 0, Math.max(0, h - 1));
  const yBottom = clamp(h - (Number.isFinite(bottom) ? bottom : 112), yTop + 1, Math.max(yTop + 1, h));
  const left = margin, right = w - margin;
  const maxLanes = Math.max(1, Math.min(w < 520 ? 4 : 5, Math.floor(Math.min(right - left, yBottom - yTop) / (2 * tilePitch))));
  const outer = course(left, yTop, right, yBottom, 18);
  let laneCount = clamp(Math.ceil(tiles.length * tilePitch / outer.perimeter), Math.min(2, maxLanes), maxLanes);
  const makeCourses = count => Array.from({ length: count }, (_, index) => {
    const offset = index * tilePitch;
    return course(left + offset, yTop + offset, right - offset, yBottom - offset, Math.max(0, 18 - offset));
  });
  let courses = makeCourses(laneCount);
  while (laneCount < maxLanes && courses.reduce((sum, lane) => sum + lane.perimeter, 0) < tiles.length * tilePitch) courses = makeCourses(++laneCount);

  const ordered = tiles.map((tile, index) => ({ index, angle: wrap(Math.atan2(tile.y, tile.x) + Math.PI / 2) }))
    .sort((a, b) => a.angle - b.angle || a.index - b.index);
  const counts = Array.from({ length: laneCount }, (_, lane) => Math.floor((tiles.length + laneCount - 1 - lane) / laneCount));
  const targets = new Array(tiles.length);
  // Interleave courses so every original angular sector unfolds toward the
  // same part of the frame; no sector is sent around a whole separate lap.
  ordered.forEach(({ index }, rank) => {
    const lane = rank % laneCount, position = Math.floor(rank / laneCount);
    const target = courses[lane].at((position + .5) / counts[lane]);
    targets[index] = { x: target.x, y: target.y, rotation: shortest(target.angle - (tiles[index].angle || 0)) };
  });
  return targets;
}
