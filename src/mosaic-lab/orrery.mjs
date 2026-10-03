export const meta = {
  id: 'orrery',
  title: 'Orrery',
  description: 'A stone instrument indexes with thought; six quiet plates articulate speech and attention.',
  seed: 657311267,
};

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const follow = (value, target, dt, duration) => value + (target - value) * (1 - Math.exp(-dt / duration));
const wrap = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
function randomSource(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = Math.imul(value ^ value >>> 15, value | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

// All stones in a plate receive the same rigid transform around its centroid.
// The shared index is a whole-medallion rotation, never a radial displacement.
// Atlas geometry remains untouched; even the frame transition moves only poses.
export function createVariant({ tiles, seed = meta.seed, width = 560, height = 460, border = [] }) {
  const random = randomSource(seed), count = tiles.length, plateCount = 6;
  const poses = new Float32Array(count * 4), membership = new Uint8Array(count), opacity = new Float32Array(count);
  const orientation = (random() - .5) * .18, seam = random() * TAU;
  const cadence = 2600 + random() * 400, indexStep = (.037 + random() * .009) * Math.PI;
  const plates = Array.from({ length: plateCount }, (_, index) => ({
    x: 0, y: 0, count: 0, direction: index % 2 ? -1 : 1,
    angle: seam + (index + .5) * TAU / plateCount,
    hover: 0, c: 1, s: 0, dx: 0, dy: 0, rotation: 0, light: 0,
    delay: index * .035,
  }));
  for (let i = 0; i < count; i++) {
    const tile = tiles[i], angle = (Math.atan2(tile.y, tile.x) - seam + TAU * 2) % TAU;
    const group = Math.min(plateCount - 1, Math.floor(angle / TAU * plateCount));
    membership[i] = group;
    plates[group].x += tile.x; plates[group].y += tile.y; plates[group].count++;
    opacity[i] = clamp((.50 + (tile.strength ?? .7) * .22 + (tile.motifStrength ?? 0) * .1) * (tile.edge ?? 1));
  }
  for (const plate of plates) if (plate.count) { plate.x /= plate.count; plate.y /= plate.count; }
  let thinking = 0, speaking = 0, listening = 0, envelope = 0, mechanismTime = 0;

  return {
    step({ time = 0, dt = 16, state = 'idle', level = 0, pointer, boardProgress = 0, reduced = false } = {}) {
      const elapsed = Number.isFinite(time) ? time : 0;
      const delta = Number.isFinite(dt) ? Math.max(0, Math.min(80, dt)) : 16;
      const board = clamp(Number.isFinite(boardProgress) ? boardProgress : 0);
      const loudness = Number.isFinite(level) ? Math.sqrt(clamp(level * 5)) : 0;
      if (reduced) {
        thinking = speaking = listening = envelope = mechanismTime = 0;
      } else {
        thinking = follow(thinking, Number(state === 'thinking'), delta, 300);
        speaking = follow(speaking, Number(state === 'speaking'), delta, 150);
        listening = follow(listening, Number(state === 'listening'), delta, 240);
        envelope = follow(envelope, state === 'speaking' || state === 'listening' ? loudness : 0, delta, loudness > envelope ? 60 : 230);
        mechanismTime += delta * thinking * (1 - board);
      }
      // One measured advance followed by a long hold. No opposite ring spins.
      const cycle = mechanismTime / cadence, fraction = cycle % 1;
      const indexedAngle = indexStep * (Math.floor(cycle) + smooth((fraction - .18) / .42));
      const pointerValid = !reduced && pointer?.active && Number.isFinite(pointer.x) && Number.isFinite(pointer.y);
      const px = pointerValid ? pointer.x - width / 2 : 0, py = pointerValid ? pointer.y - height / 2 : 0;
      const pointerRadius = Math.hypot(px, py), pointerAngle = Math.atan2(py, px);
      const nearMedallion = pointerValid ? 1 - smooth((pointerRadius - 146) / 40) : 0;
      const commonAngle = orientation + (reduced ? 0 : indexedAngle + Math.sin(elapsed * .00028) * .0025 * (1 - thinking));
      const c = Math.cos(commonAngle), s = Math.sin(commonAngle);
      const hoverLeanX = nearMedallion * Math.max(-1, Math.min(1, px / 146)) * 1.2;
      const hoverLeanY = nearMedallion * Math.max(-1, Math.min(1, py / 146)) * 1.2;
      for (const plate of plates) {
        const attention = nearMedallion * Math.exp(-((wrap(pointerAngle - commonAngle - plate.angle) / .46) ** 2));
        plate.hover = reduced ? 0 : follow(plate.hover, attention, delta, attention > plate.hover ? 120 : 280);
        const voiceBeat = Math.sin(elapsed * .0024 + plate.direction * .48);
        // Speaking rocks paired plates at their own fixed pivots. Listening
        // settles the instrument and gently lifts the addressed sector.
        const articulation = speaking * envelope * voiceBeat * plate.direction;
        plate.rotation = reduced ? 0 : articulation * .009 + listening * envelope * plate.direction * .002;
        plate.c = Math.cos(plate.rotation); plate.s = Math.sin(plate.rotation);
        const tangent = reduced ? 0 : articulation * 1.65 + plate.hover * .75;
        plate.dx = -Math.sin(plate.angle) * tangent;
        plate.dy = Math.cos(plate.angle) * tangent;
        plate.light = reduced ? 0 : plate.hover * .07 + listening * (.017 + envelope * .03)
          + speaking * envelope * (.032 + Math.abs(voiceBeat) * .018);
      }
      for (let i = 0; i < count; i++) {
        const tile = tiles[i], plate = plates[membership[i]], target = border[i], n = i * 4;
        const dx = tile.x - plate.x, dy = tile.y - plate.y;
        const localX = plate.x + dx * plate.c - dy * plate.s + plate.dx;
        const localY = plate.y + dx * plate.s + dy * plate.c + plate.dy;
        const circleX = width / 2 + localX * c - localY * s + (reduced ? 0 : hoverLeanX);
        const circleY = height / 2 + localX * s + localY * c + (reduced ? 0 : hoverLeanY - listening * 1.1);
        const blend = target ? reduced ? Number(board >= .5) : smooth((board - plate.delay) / (1 - plate.delay)) : 0;
        if (blend === 1) {
          poses[n] = target.x; poses[n + 1] = target.y; poses[n + 2] = target.rotation ?? 0;
        } else {
          poses[n] = circleX + ((target?.x ?? circleX) - circleX) * blend;
          poses[n + 1] = circleY + ((target?.y ?? circleY) - circleY) * blend;
          // Use a short interpolation to the frame after many indexed turns.
          const rotation = wrap(commonAngle + plate.rotation);
          poses[n + 2] = rotation + wrap((target?.rotation ?? rotation) - rotation) * blend;
        }
        poses[n + 3] = clamp(opacity[i] * (1 - blend * .3) + plate.light * (1 - blend));
      }
      return poses;
    },
  };
}
