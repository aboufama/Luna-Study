export const meta = {
  id: 'portico',
  title: 'Portico',
  description: 'Quiet masonry courses lift, align, and settle like thoughts taking their places.',
  seed: 214950121,
};

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const follow = (value, target, dt, duration) => value + (target - value) * (1 - Math.exp(-dt / duration));
function randomSource(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = Math.imul(value ^ (value >>> 15), value | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Each horizontal course has one pivot, translation, and turn. Its stones keep
 * their original internal distances and shapes; no radial displacement,
 * independent stone oscillation, scale, or shear is applied. The seeded initial
 * orientation and masonry grouping are immutable throughout a preview.
 */
export function createVariant({ tiles, seed = meta.seed, width = 560, height = 460, border = [] }) {
  const random = randomSource(seed), count = tiles.length;
  const poses = new Float32Array(count * 4), baseX = new Float32Array(count), baseY = new Float32Array(count);
  const memberships = new Uint8Array(count), opacity = new Float32Array(count);
  const pitch = 26 + random() * 4, orientation = (random() - .5) * .13;
  const cos = Math.cos(orientation), sin = Math.sin(orientation), offset = (random() - .5) * pitch * .28;
  const courseCount = 13, courses = Array.from({ length: courseCount }, (_, index) => ({
    x: 0, y: 0, count: 0, phase: random() * .25, direction: index % 2 ? -1 : 1,
    turn: 0, dx: 0, dy: 0, light: 0, hover: 0, delay: .035 * index,
  }));
  const cadence = .00031 + random() * .000035, speechCadence = .0020 + random() * .0003;
  let thinking = 0, speaking = 0, listening = 0, envelope = 0;
  for (let i = 0; i < count; i++) {
    const tile = tiles[i], x = tile.x * cos - tile.y * sin, y = tile.x * sin + tile.y * cos;
    baseX[i] = x; baseY[i] = y;
    const group = Math.max(0, Math.min(courseCount - 1, Math.floor((y + 160 + offset) / pitch)));
    memberships[i] = group; courses[group].x += x; courses[group].y += y; courses[group].count++;
    const edge = Number.isFinite(tile.edge) ? tile.edge : 1;
    opacity[i] = clamp((.51 + (tile.strength ?? .7) * .20 + (tile.motifStrength ?? 0) * .11) * edge);
  }
  for (const course of courses) if (course.count) { course.x /= course.count; course.y /= course.count; }

  return {
    step({ time = 0, dt = 16, state = 'idle', level = 0, pointer, boardProgress = 0, reduced = false } = {}) {
      const elapsed = Number.isFinite(time) ? time : 0;
      const delta = Number.isFinite(dt) ? Math.max(0, Math.min(80, dt)) : 16;
      const board = clamp(Number.isFinite(boardProgress) ? boardProgress : 0);
      const rms = Number.isFinite(level) ? clamp(level * 5) : 0;
      if (reduced) {
        thinking = speaking = listening = envelope = 0;
        for (const course of courses) course.hover = 0;
      } else {
        thinking = follow(thinking, Number(state === 'thinking'), delta, 330);
        speaking = follow(speaking, Number(state === 'speaking'), delta, 140);
        listening = follow(listening, Number(state === 'listening'), delta, 220);
        envelope = follow(envelope, state === 'speaking' || state === 'listening' ? Math.sqrt(rms) : 0, delta, rms > envelope ? 65 : 210);
      }
      const px = Number.isFinite(pointer?.x) ? pointer.x - width / 2 : 0;
      const py = Number.isFinite(pointer?.y) ? pointer.y - height / 2 : 0;
      for (let g = 0; g < courseCount; g++) {
        const course = courses[g];
        // A measured sequence moves from the low foundation toward the lintel.
        // Raised courses return fully to their seats before the next procession.
        const phase = ((elapsed * cadence + g * .092 + course.phase) % 1 + 1) % 1;
        const lift = Math.sin(Math.PI * smooth(phase / .57)) ** 2;
        const voice = Math.sin(elapsed * speechCadence - g * .32 + course.phase);
        const pointerNear = !reduced && pointer?.active && Math.abs(px) < 154
          ? Math.exp(-(((py - course.y) / 23) ** 2)) : 0;
        course.hover = follow(course.hover, pointerNear, delta, pointerNear > course.hover ? 100 : 260);
        course.dx = thinking * course.direction * lift * 1.25
          + speaking * envelope * course.direction * voice * 2.2
          + listening * envelope * course.direction * .7;
        course.dy = -thinking * lift * 3.0 - course.hover * 1.8
          - speaking * envelope * Math.max(0, voice) * .75;
        course.turn = thinking * course.direction * lift * .007
          + speaking * envelope * course.direction * voice * .007
          + course.hover * clamp(px / 150 + .5) * .003;
        course.light = thinking * lift * .045 + speaking * envelope * (.025 + Math.max(0, voice) * .018)
          + listening * (.018 + envelope * .025) + course.hover * .06;
      }
      for (let i = 0; i < count; i++) {
        const course = courses[memberships[i]], target = border[i];
        const angle = reduced ? 0 : course.turn, c = Math.cos(angle), s = Math.sin(angle);
        const x = baseX[i] - course.x, y = baseY[i] - course.y;
        const circleX = width / 2 + course.x + x * c - y * s + (reduced ? 0 : course.dx);
        const circleY = height / 2 + course.y + x * s + y * c + (reduced ? 0 : course.dy);
        // Staged assembly is reversible, and both endpoints are exact.
        const progress = reduced ? Number(board >= .5) : smooth((board - course.delay) / (1 - course.delay));
        const blend = target ? progress : 0, n = i * 4;
        poses[n] = circleX + ((target?.x ?? circleX) - circleX) * blend;
        poses[n + 1] = circleY + ((target?.y ?? circleY) - circleY) * blend;
        poses[n + 2] = (orientation + angle) * (1 - blend) + (target?.rotation ?? 0) * blend;
        poses[n + 3] = clamp(opacity[i] * (1 - blend * .30) + (reduced ? 0 : course.light * (1 - blend)));
      }
      return poses;
    },
  };
}
