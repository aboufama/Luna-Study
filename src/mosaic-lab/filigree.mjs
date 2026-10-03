export const meta = {
  id: 'filigree',
  title: 'Filigree',
  description: 'Fine interlaced currents turn individual stones, like light finding its way through carved threads.',
  seed: 194307251,
};

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const follow = (value, target, dt, ms) => value + (target - value) * (1 - Math.exp(-dt / ms));
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
function randomSource(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = Math.imul(value ^ value >>> 15, value | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * No shared moving plates: every tessera samples two crossing spatial threads
 * at its own coordinate. All vertices/atlas pixels remain immutable. The only
 * outputs are translation, rigid in-plane rotation, physical face-tip angles,
 * and mineral opacity. Buffers and seeded coefficients are allocated once.
 */
export function createVariant({ tiles, seed = meta.seed, width = 560, height = 460, border = [] }) {
  const random = randomSource(seed), count = tiles.length;
  const poses = new Float32Array(count * 4), tiltX = new Float32Array(count), tiltY = new Float32Array(count);
  const u = new Float32Array(count), v = new Float32Array(count), phase = new Float32Array(count);
  const polarity = new Float32Array(count), opacity = new Float32Array(count), delay = new Uint8Array(count);
  const hover = new Float32Array(count), departure = new Float32Array(count), bend = new Float32Array(count);
  const samples = new Float32Array(128), sampleTimes = new Float64Array(128).fill(-Infinity);
  const delayed = new Float32Array(64), previous = new Float32Array(64);
  const direction = (.15 + random() * .10) * Math.PI, ux = Math.cos(direction), uy = Math.sin(direction);
  const vx = -uy, vy = ux, threadOffset = random() * TAU, weaveSpeed = .00135 + random() * .00025;
  let thinking = 0, speaking = 0, listening = 0, envelope = 0, head = 0, lastTime = -Infinity;
  for (let i = 0; i < count; i++) {
    const tile = tiles[i], x = tile.x * .97, y = tile.y * .97;
    u[i] = x * ux + y * uy; v[i] = x * vx + y * vy;
    phase[i] = (random() - .5) * .32;
    // Alternating warp/weft is spatial, with tiny seeded offsets, never jitter.
    polarity[i] = Math.sin(u[i] * .27 + v[i] * .23 + threadOffset) >= 0 ? 1 : -1;
    delay[i] = Math.min(63, Math.max(0, Math.round((u[i] + 147) / 4.8)));
    opacity[i] = clamp(Math.min(.9, .60 + (tile.strength ?? .7) * .18 + (tile.seed ?? .5) * .08 + (tile.motifStrength ?? 0) * .13) * (tile.edge ?? 1));
    departure[i] = .16 * clamp((u[i] + 147) / 294) + random() * .035;
    bend[i] = (8 + random() * 5) * polarity[i];
  }
  function sample(at) {
    let newer = (head + 127) % 128;
    if (at >= sampleTimes[newer]) return samples[newer];
    for (let n = 1; n < 128; n++) {
      const older = (newer + 127) % 128;
      if (sampleTimes[older] <= at) {
        if (!Number.isFinite(sampleTimes[older])) return 0;
        const t = clamp((at - sampleTimes[older]) / Math.max(1, sampleTimes[newer] - sampleTimes[older]));
        return samples[older] + (samples[newer] - samples[older]) * t;
      }
      newer = older;
    }
    return 0;
  }
  return {
    tiltX, tiltY,
    step({ time = 0, dt = 16, state = 'idle', level = 0, pointer, boardProgress = 0, boardOpen, reduced = false } = {}) {
      const now = Number.isFinite(time) ? time : 0, delta = Number.isFinite(dt) ? Math.max(0, Math.min(80, dt)) : 16;
      const board = clamp(Number.isFinite(boardProgress) ? boardProgress : 0);
      const loudness = Number.isFinite(level) ? Math.sqrt(clamp((level - .006) * 4)) : 0;
      if (now < lastTime) { samples.fill(0); sampleTimes.fill(-Infinity); head = 0; }
      lastTime = now;
      if (reduced) {
        thinking = speaking = listening = envelope = 0;
        hover.fill(0); samples.fill(0); sampleTimes.fill(-Infinity);
      } else {
        thinking = follow(thinking, Number(state === 'thinking'), delta, 340);
        speaking = follow(speaking, Number(state === 'speaking'), delta, 150);
        listening = follow(listening, Number(state === 'listening'), delta, 240);
        envelope = follow(envelope, state === 'speaking' || state === 'listening' ? loudness : 0, delta, loudness > envelope ? 62 : 200);
      }
      if (delta > 0) { samples[head] = envelope; sampleTimes[head] = now; head = (head + 1) % 128; }
      for (let n = 0; n < 64; n++) { delayed[n] = sample(now - n * 5); previous[n] = sample(now - n * 5 - 110); }
      const pointerActive = !reduced && pointer?.active && Number.isFinite(pointer.x) && Number.isFinite(pointer.y);
      const px = pointerActive ? pointer.x - width / 2 : 0, py = pointerActive ? pointer.y - height / 2 : 0;
      for (let i = 0; i < count; i++) {
        const tile = tiles[i], target = border[i], n = i * 4;
        const x = tile.x * .97, y = tile.y * .97;
        // Two narrow looms travel diagonally in opposite directions. The finer
        // cross-thread changes each stone's turn instead of translating a band.
        const a = u[i] * .068 - now * weaveSpeed + threadOffset;
        const b = v[i] * .073 + now * weaveSpeed * .79 + phase[i];
        const threadA = Math.max(0, Math.cos(a)) ** 5, threadB = Math.max(0, Math.cos(b)) ** 5;
        const stitchA = Math.sin(v[i] * .32 + a * .37 + phase[i]);
        const stitchB = Math.sin(u[i] * .29 - b * .41 - phase[i]);
        const thoughtA = thinking * threadA * stitchA, thoughtB = thinking * threadB * stitchB;
        const amplitude = delayed[delay[i]], attack = amplitude - previous[delay[i]];
        const speech = speaking * (amplitude * Math.sin(now * .0038 - u[i] * .10 + v[i] * .065 + phase[i]) * .66 + attack * polarity[i] * .52);
        const listeningWave = listening * envelope * Math.sin(u[i] * .085 + v[i] * .031 - now * .0016 + phase[i]);
        const distance = pointerActive ? Math.hypot(x - px, y - py) : Infinity;
        const attention = smooth(1 - distance / 29);
        hover[i] = reduced ? 0 : follow(hover[i], attention, delta, attention > hover[i] ? 85 : 310);
        const contact = hover[i] * polarity[i];
        const dx = reduced ? 0 : (thoughtA * vx + thoughtB * ux) * .48 + speech * vx * .72 + listeningWave * ux * .20;
        const dy = reduced ? 0 : (thoughtA * vy + thoughtB * uy) * .48 + speech * vy * .72 + listeningWave * uy * .20 - hover[i] * .32;
        const turn = reduced ? 0 : (thoughtA - thoughtB) * .046 + speech * .052 + listeningWave * .018 + contact * .033;
        const idleTip = reduced ? 0 : (1 - Math.max(thinking, speaking, listening)) * threadA * Math.sin(v[i] * .22 + phase[i]) * .012;
        const progress = target ? reduced ? Number(boardOpen ?? board >= .5) : smooth((board - departure[i]) / (1 - departure[i])) : 0;
        const quiet = 1 - progress;
        tiltX[i] = reduced || quiet === 0 ? 0 : (thoughtA * .13 + speech * .14 + contact * .18 + idleTip) * quiet;
        tiltY[i] = reduced || quiet === 0 ? 0 : (thoughtB * .13 - speech * .10 + hover[i] * Math.sin(phase[i] + u[i] * .08) * .10 - idleTip) * quiet;
        if (progress === 1) {
          poses[n] = target.x; poses[n + 1] = target.y; poses[n + 2] = target.rotation ?? 0;
        } else {
          const sx = width / 2 + x + dx, sy = height / 2 + y + dy;
          const tx = target?.x ?? sx, ty = target?.y ?? sy, length = Math.max(1, Math.hypot(tx - sx, ty - sy));
          // Individual, alternating shuttle paths: short arcs between live
          // circle and frame poses, with no shared plate or rotating wedge.
          const arc = reduced ? 0 : Math.sin(progress * Math.PI) ** 2 * bend[i];
          poses[n] = sx + (tx - sx) * progress - (ty - sy) / length * arc;
          poses[n + 1] = sy + (ty - sy) * progress + (tx - sx) / length * arc;
          poses[n + 2] = turn + wrap((target?.rotation ?? 0) - turn) * progress;
        }
        // Hover is physical, never a traveling color trail. Tone only follows
        // thought/speech and the quiet frame; the mineral atlas supplies color.
        const glint = reduced ? 0 : thinking * (threadA + threadB) * .013 + speaking * Math.max(0, attack) * .035;
        poses[n + 3] = clamp(opacity[i] * (1 - progress * .46) + glint * quiet * (tile.edge ?? 1));
      }
      return poses;
    },
  };
}
