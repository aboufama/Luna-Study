export const meta = {
  id: 'constellation',
  title: 'Constellation',
  description: 'A quiet geometric proof passes between small constellations of stone.',
  seed: 1532474799,
};

const TAU = Math.PI * 2;
const GROUPS = 7;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const follow = (value, target, dt, duration) => value + (target - value) * (1 - Math.exp(-dt / duration));
const shortest = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

function randomFor(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

/** Compact, rigid assemblies. The fixed outer courses retain the round seal. */
export function createVariant({ tiles, seed = meta.seed, width = 560, height = 460, border = [] }) {
  const random = randomFor(seed), count = tiles.length, result = new Float32Array(count * 4);
  const groupOf = new Int8Array(count).fill(-1), baseAlpha = new Float32Array(count);
  const centers = Array.from({ length: GROUPS }, () => ({ x: 0, y: 0, count: 0 }));
  const turnSign = new Float32Array(GROUPS), shiftX = new Float32Array(GROUPS), shiftY = new Float32Array(GROUPS);
  const turn = new Float32Array(GROUPS), ink = new Float32Array(GROUPS), hover = new Float32Array(GROUPS);
  const voiceFocus = new Float32Array(GROUPS), routeX = new Float32Array(GROUPS), routeY = new Float32Array(GROUPS);
  const routeRank = new Uint8Array(GROUPS);
  const originAngle = random() * TAU, pace = 1.35 + random() * .22;
  const anchors = [{ x: (random() - .5) * 12, y: (random() - .5) * 12 }];
  for (let group = 1; group < GROUPS; group++) {
    const angle = originAngle + (group - 1) * TAU / 6 + (random() - .5) * .15;
    const radius = 76 + random() * 12;
    anchors.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  for (let group = 0; group < GROUPS; group++) turnSign[group] = random() < .5 ? -1 : 1;
  for (let index = 0; index < count; index++) {
    const tile = tiles[index];
    baseAlpha[index] = Math.min(.91, .66 + (tile.strength ?? .6) * .22 + (tile.seed ?? .5) * .035) * (tile.edge ?? 1);
    if (Math.hypot(tile.x, tile.y) > 114) continue;
    let closest = 0, distance = Infinity;
    for (let group = 0; group < GROUPS; group++) {
      const d = (tile.x - anchors[group].x) ** 2 + (tile.y - anchors[group].y) ** 2;
      if (d < distance) { closest = group; distance = d; }
    }
    groupOf[index] = closest;
    centers[closest].x += tile.x; centers[closest].y += tile.y; centers[closest].count++;
  }
  for (let group = 0; group < GROUPS; group++) {
    const center = centers[group];
    center.x = center.count ? center.x / center.count : anchors[group].x;
    center.y = center.count ? center.y / center.count : anchors[group].y;
  }

  // Visit distant clusters instead of tracing a clockwise loading indicator.
  const order = [Math.floor(random() * GROUPS)], seen = new Set(order);
  while (order.length < GROUPS) {
    const from = centers[order.at(-1)]; let chosen = -1, best = -1;
    for (let group = 0; group < GROUPS; group++) if (!seen.has(group)) {
      const score = Math.hypot(centers[group].x - from.x, centers[group].y - from.y) * (.86 + random() * .14);
      if (score > best) { chosen = group; best = score; }
    }
    order.push(chosen); seen.add(chosen);
  }
  for (let index = 0; index < GROUPS; index++) {
    const group = order[index], from = centers[group], to = centers[order[(index + 1) % GROUPS]];
    const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
    routeRank[group] = index; routeX[group] = (to.x - from.x) / length; routeY[group] = (to.y - from.y) / length;
  }

  let thinking = 0, speaking = 0, listening = 0, envelope = 0, echo = 0, proofClock = 0;
  let accent = 0, lastAccent = -Infinity;

  function step({ time = 0, dt = 1000 / 30, state = 'idle', level = 0, pointer, boardProgress = 0, reduced = false } = {}) {
    const elapsed = Math.max(0, Math.min(80, Number.isFinite(dt) ? dt : 1000 / 30));
    const boardAmount = smooth(boardProgress), centerX = width / 2, centerY = height / 2;
    if (reduced) {
      thinking = speaking = listening = envelope = echo = 0;
      voiceFocus.fill(0); hover.fill(0);
    } else {
      thinking = follow(thinking, Number(state === 'thinking'), elapsed, 260);
      speaking = follow(speaking, Number(state === 'speaking'), elapsed, 150);
      listening = follow(listening, Number(state === 'listening'), elapsed, 210);
      const audible = state === 'speaking' || state === 'listening';
      const raw = audible && Number.isFinite(level) ? Math.max(0, level - .007) : 0;
      const target = clamp(Math.pow(raw * 12, .72)), previous = envelope;
      envelope = follow(envelope, target, elapsed, target > envelope ? 65 : 190);
      echo = follow(echo, envelope, elapsed, 135);
      if (state === 'speaking' && envelope > .15 && envelope - previous > .025 && time - lastAccent > 230) {
        accent = (accent + 1) % GROUPS; lastAccent = time;
      }
      proofClock += elapsed / 1000 * thinking;
    }
    const beat = proofClock / pace % GROUPS;
    const first = order[accent], second = order[(accent + 3) % GROUPS];
    for (let group = 0; group < GROUPS; group++) {
      const center = centers[group];
      const distance = Math.abs(routeRank[group] - beat);
      const focus = smooth(1 - Math.min(distance, GROUPS - distance) / .95) * thinking;
      const desiredVoice = group === first ? envelope : group === second ? echo * .7 : 0;
      voiceFocus[group] = reduced ? 0 : follow(voiceFocus[group], desiredVoice * speaking, elapsed, desiredVoice > voiceFocus[group] ? 90 : 220);
      const dx = (pointer?.x ?? 0) - centerX - center.x, dy = (pointer?.y ?? 0) - centerY - center.y;
      const pointerDistance = Math.hypot(dx, dy);
      const pointerInside = pointer?.active && Math.hypot(pointer.x - centerX, pointer.y - centerY) < 119;
      const hoverTarget = !reduced && pointerInside ? smooth(1 - pointerDistance / 54) : 0;
      hover[group] = reduced ? 0 : follow(hover[group], hoverTarget, elapsed, hoverTarget > hover[group] ? 90 : 280);
      const pointing = hover[group] * 1.5 / Math.max(1, pointerDistance);
      const voice = voiceFocus[group], listen = group === 0 ? listening * envelope : 0;
      shiftX[group] = routeX[group] * focus * 1.9 - routeY[group] * voice * 2.1 + dx * pointing;
      shiftY[group] = routeY[group] * focus * 1.9 + routeX[group] * voice * 2.1 + dy * pointing - listen * 1.3;
      turn[group] = turnSign[group] * (focus * .033 + voice * .031 + listen * .012 + hover[group] * .018);
      ink[group] = focus * .105 + voice * .10 + listen * .055 + hover[group] * .035;
    }
    for (let index = 0; index < count; index++) {
      const tile = tiles[index], group = groupOf[index], offset = index * 4;
      let x = tile.x + centerX, y = tile.y + centerY, rotation = 0, accentInk = 0;
      if (group >= 0) {
        const center = centers[group], angle = turn[group], cos = Math.cos(angle), sin = Math.sin(angle);
        // One rotation and translation for the entire assembly; no scaling,
        // projection, radial deformation, or relative motion inside a group.
        const dx = tile.x - center.x, dy = tile.y - center.y;
        x = centerX + center.x + dx * cos - dy * sin + shiftX[group];
        y = centerY + center.y + dx * sin + dy * cos + shiftY[group];
        rotation = angle; accentInk = ink[group] * (tile.edge ?? 1);
      }
      const target = border[index];
      if (target && boardAmount > 0) {
        x += (target.x - x) * boardAmount; y += (target.y - y) * boardAmount;
        rotation = boardAmount === 1 ? target.rotation : rotation + shortest(target.rotation - rotation) * boardAmount;
      }
      result[offset] = x; result[offset + 1] = y; result[offset + 2] = rotation;
      result[offset + 3] = clamp(baseAlpha[index] * (1 - boardAmount * .42) + accentInk * (1 - boardAmount * .78));
    }
    return result;
  }

  return { step };
}
