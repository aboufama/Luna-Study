export const meta = {
  id: 'palimpsest',
  title: 'Palimpsest',
  description: 'An invisible pen lifts each stone in passing, leaving the circle quietly intact.',
  seed: 2874319031,
};

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const follow = (value, target, elapsed, duration) => value + (target - value) * (1 - Math.exp(-elapsed / duration));
const shortest = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

function generator(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Each tessera has its own pressure, delay, heading and small rigid gesture.
 * The moving pen is only a field of influence, never a drawn mark or a group
 * transform. Neighbours enter and leave its wake individually.
 */
export function createVariant({ tiles, seed = meta.seed, width = 560, height = 460, border = [] }) {
  const random = generator(seed), count = tiles.length, result = new Float32Array(count * 4);
  const tiltX = new Float32Array(count), tiltY = new Float32Array(count);
  const x = new Float32Array(count), y = new Float32Array(count), alpha = new Float32Array(count);
  const gain = new Float32Array(count), edge = new Float32Array(count), nibX = new Float32Array(count), nibY = new Float32Array(count);
  const turnSign = new Float32Array(count), delay = new Float32Array(count), boardDelay = new Float32Array(count);
  const pressure = new Float32Array(count), relaxation = new Float32Array(count), hover = new Float32Array(count);
  const shiftX = new Float32Array(count), shiftY = new Float32Array(count), turns = new Float32Array(count);
  const phase = random() * TAU, pathAngle = (random() - .5) * .8, pathCos = Math.cos(pathAngle), pathSin = Math.sin(pathAngle);
  const pace = .40 + random() * .06, pathSkew = .32 + random() * .22;
  const centerX = width / 2, centerY = height / 2;
  for (let index = 0; index < count; index++) {
    const tile = tiles[index], radius = Math.hypot(tile.x, tile.y);
    x[index] = tile.x * .97; y[index] = tile.y * .97;
    alpha[index] = Math.min(.9, .60 + (tile.strength ?? .6) * .18 + (tile.seed ?? .5) * .08 + (tile.motifStrength ?? 0) * .13) * (tile.edge ?? 1);
    gain[index] = .80 + random() * .36;
    // The outside remains a quiet, readable circular silhouette.
    edge[index] = .28 + .72 * smooth((150 - radius) / 35);
    const angle = Math.sin(tile.x * .018 + phase) * .58 + Math.cos(tile.y * .024 - phase) * .46 + (random() - .5) * .3;
    nibX[index] = Math.cos(angle); nibY[index] = Math.sin(angle);
    turnSign[index] = Math.sin(tile.x * .052 + tile.y * .037 + phase + (random() - .5) * .22);
    delay[index] = 70 + random() * 125 + (tile.y + 146) * .19;
    boardDelay[index] = .08 * clamp((tile.y + 146) / 292) + random() * .045;
  }
  let thinking = 0, speaking = 0, listening = 0, envelope = 0, penClock = phase;

  function step({ dt = 1000 / 30, state = 'idle', level = 0, pointer, boardProgress = 0, reduced = false } = {}) {
    const elapsed = Math.max(0, Math.min(80, Number.isFinite(dt) ? dt : 0));
    const board = clamp(Number.isFinite(boardProgress) ? boardProgress : 0);
    if (reduced) {
      thinking = speaking = listening = envelope = 0;
      pressure.fill(0); relaxation.fill(0); hover.fill(0); shiftX.fill(0); shiftY.fill(0); turns.fill(0);
      tiltX.fill(0); tiltY.fill(0);
    } else {
      thinking = follow(thinking, Number(state === 'thinking'), elapsed, 230);
      speaking = follow(speaking, Number(state === 'speaking'), elapsed, 150);
      listening = follow(listening, Number(state === 'listening'), elapsed, 190);
      const raw = (state === 'speaking' || state === 'listening') && Number.isFinite(level) ? Math.max(0, level - .007) : 0;
      const desired = Math.pow(clamp(raw * 14), .72);
      envelope = follow(envelope, desired, elapsed, desired > envelope ? 55 : 150);
      penClock = (penClock + elapsed * .001 * pace * thinking) % TAU;
    }

    // Two differently weighted cursive strokes visit the whole disk. Their
    // curved paths are intentionally neither a circular spinner nor a ripple.
    const p = penClock, q = p + 2.15;
    const ax = 108 * Math.sin(p), ay = 92 * Math.sin(p * 2 + pathSkew);
    const bx = 100 * Math.sin(q), by = 87 * Math.sin(q * 2 + pathSkew);
    const aX = ax * pathCos - ay * pathSin, aY = ax * pathSin + ay * pathCos;
    const bX = bx * pathCos - by * pathSin, bY = bx * pathSin + by * pathCos;
    const avx = 108 * Math.cos(p), avy = 184 * Math.cos(p * 2 + pathSkew);
    const bvx = 100 * Math.cos(q), bvy = 174 * Math.cos(q * 2 + pathSkew);
    const aLength = Math.max(1, Math.hypot(avx, avy)), bLength = Math.max(1, Math.hypot(bvx, bvy));
    const adx = (avx * pathCos - avy * pathSin) / aLength, ady = (avx * pathSin + avy * pathCos) / aLength;
    const bdx = (bvx * pathCos - bvy * pathSin) / bLength, bdy = (bvx * pathSin + bvy * pathCos) / bLength;
    const pointerActive = !reduced && pointer?.active && Number.isFinite(pointer.x) && Number.isFinite(pointer.y);
    const pointerX = pointerActive ? pointer.x - centerX : 0, pointerY = pointerActive ? pointer.y - centerY : 0;

    for (let index = 0; index < count; index++) {
      const offset = index * 4, bx0 = x[index], by0 = y[index];
      const dxA = bx0 - aX, dyA = by0 - aY, dxB = bx0 - bX, dyB = by0 - bY;
      const alongA = dxA * adx + dyA * ady, alongB = dxB * bdx + dyB * bdy;
      const penA = Math.exp(-(dxA * dxA + dyA * dyA) / 790) * thinking;
      const penB = Math.exp(-(dxB * dxB + dyB * dyB) / 600) * thinking * .58;
      const contact = penA + penB, individuality = gain[index] * edge[index];

      pressure[index] = follow(pressure[index], envelope, elapsed, delay[index]);
      relaxation[index] = follow(relaxation[index], pressure[index], elapsed, 250 + delay[index] * .35);
      const articulation = (pressure[index] - relaxation[index]) * speaking;
      const voice = pressure[index] * speaking;
      const attentive = pressure[index] * listening * (.42 + .58 * smooth((122 - Math.hypot(bx0, by0)) / 100));
      const px = pointerX - bx0, py = pointerY - by0, pointerDistance = Math.hypot(px, py);
      const desiredHover = pointerActive ? smooth(1 - pointerDistance / 24) : 0;
      hover[index] = follow(hover[index], desiredHover, elapsed, desiredHover > hover[index] ? 65 : 260);

      // Small individual pen-following steps and pressure releases; no stone
      // travels around the center and no large patch shares a rigid transform.
      const targetX = ((adx * penA + bdx * penB) * 2.05 + nibX[index] * articulation * 2.9 + nibY[index] * attentive * .65) * individuality;
      const targetY = ((ady * penA + bdy * penB) * 2.05 + nibY[index] * articulation * 2.9 - nibX[index] * attentive * .65) * individuality;
      const targetTurn = ((penA * Math.sin(alongA / 23) + penB * Math.sin(alongB / 22)) * .14
        + turnSign[index] * (voice * .055 + articulation * .095 + attentive * .035 + hover[index] * .085)) * individuality;
      shiftX[index] = follow(shiftX[index], targetX, elapsed, 100);
      shiftY[index] = follow(shiftY[index], targetY, elapsed, 100);
      turns[index] = follow(turns[index], targetTurn, elapsed, 90);

      const amount = board === 1 ? 1 : reduced ? board : smooth((board - boardDelay[index]) / (1 - boardDelay[index]));
      const circleWeight = 1 - amount;
      const pressureTilt = (contact * .16 + voice * .13 + attentive * .075) * individuality;
      const inversePointer = 1 / Math.max(1, pointerDistance);
      const targetTiltX = (nibX[index] * pressureTilt + px * inversePointer * hover[index] * .25) * circleWeight;
      const targetTiltY = (nibY[index] * pressureTilt + py * inversePointer * hover[index] * .25) * circleWeight;
      tiltX[index] = reduced || amount === 1 ? 0 : follow(tiltX[index], targetTiltX, elapsed, 95);
      tiltY[index] = reduced || amount === 1 ? 0 : follow(tiltY[index], targetTiltY, elapsed, 95);
      const tiltLength = Math.hypot(tiltX[index], tiltY[index]);
      if (tiltLength > .30) { tiltX[index] *= .30 / tiltLength; tiltY[index] *= .30 / tiltLength; }

      let outX = centerX + bx0 + shiftX[index], outY = centerY + by0 + shiftY[index], rotation = turns[index];
      const destination = border[index];
      if (destination && amount > 0) {
        // Fine stitch-like arcs are individual, vanish at both ends, and never
        // alter the destination used by document intake's live receiver poses.
        const toX = destination.x - outX, toY = destination.y - outY, length = Math.max(1, Math.hypot(toX, toY));
        const bow = Math.sin(amount * Math.PI) * turnSign[index] * 2.4;
        outX += toX * amount - toY / length * bow;
        outY += toY * amount + toX / length * bow;
        rotation = amount === 1 ? destination.rotation : rotation + shortest(destination.rotation - rotation) * amount;
      }
      result[offset] = outX; result[offset + 1] = outY; result[offset + 2] = rotation;
      result[offset + 3] = clamp(alpha[index] * (1 - amount * .38) + (contact * .025 + voice * .018 + attentive * .012) * circleWeight * (tiles[index].edge ?? 1));
    }
    return result;
  }

  return { step, tiltX, tiltY };
}
