const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const shortest = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const RECEIVER_FADE_MS = 60;
const SOURCE_STAGE_MS = 50;

// Minimum total Euclidean travel pairs a source grid with a destination fan
// without intersecting straight paths. This small assignment runs only on drop,
// never per frame; at most63 stones are involved.
function assignOrigins(origins, targets) {
  const n = origins.length, cost = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cost[i * n + j] = Math.hypot(origins[i].x - targets[j].x, origins[i].y - targets[j].y);
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1), p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  const minimum = new Float64Array(n + 1), used = new Uint8Array(n + 1), assignment = new Int32Array(n);
  for (let i = 1; i <= n; i++) {
    p[0] = i; minimum.fill(Infinity); used.fill(0);
    let column = 0;
    do {
      used[column] = 1;
      const row = p[column]; let delta = Infinity, next = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const value = cost[(row - 1) * n + j - 1] - u[row] - v[j];
        if (value < minimum[j]) { minimum[j] = value; way[j] = column; }
        if (minimum[j] < delta) { delta = minimum[j]; next = j; }
      }
      for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minimum[j] -= delta; }
      column = next;
    } while (p[column] !== 0);
    do { const previous = way[column]; p[column] = p[previous]; column = previous; } while (column !== 0);
  }
  for (let j = 1; j <= n; j++) assignment[p[j] - 1] = j - 1;
  return assignment;
}

/** Reserve real stones once. Their stable indices survive every live layout. */
export function createMosaicIntake(tiles, positions, source, now, unit = 1) {
  const x = Number.isFinite(source.x) ? source.x : 0, y = Number.isFinite(source.y) ? source.y : 0;
  const files = Math.max(0, Math.min(7, Math.floor(Number(source.count) || 0)));
  const pool = tiles.map((tile, index) => ({ index, distance: Math.hypot(positions[index * 3] - x, positions[index * 3 + 1] - y), edge: tile.edge ?? 1 }))
    .filter(tile => tile.edge > .22)
    .sort((a, b) => a.distance - b.distance || a.index - b.index);
  const count = Math.min(files * 9, pool.length);
  const reserved = new Uint8Array(tiles.length), receiverAlpha = new Float32Array(tiles.length).fill(1), fragments = [];
  const targets = [], origins = [], spacing = 13 * unit;
  for (const candidate of pool) {
    const tx = positions[candidate.index * 3], ty = positions[candidate.index * 3 + 1];
    if (targets.some(target => Math.hypot(tx - target.x, ty - target.y) < spacing)) continue;
    targets.push({ index: candidate.index, x: tx, y: ty });
    if (targets.length === count) break;
  }
  // Very small fields may not have enough separated stones. Retain identity
  // and uniqueness even then, rather than synthesizing arbitrary receivers.
  if (targets.length < count) for (const candidate of pool) {
    if (targets.some(target => target.index === candidate.index)) continue;
    targets.push({ index: candidate.index, x: positions[candidate.index * 3], y: positions[candidate.index * 3 + 1] });
    if (targets.length === count) break;
  }
  for (let n = 0; n < count; n++) {
    const file = Math.floor(n / 9), cell = n % 9;
    origins.push({ x: x + ((cell % 3 - 1) * 8 + file * 10) * unit, y: y + ((Math.floor(cell / 3) - 1) * 8 - file * 8) * unit, delay: file * 65 + Math.floor(cell / 3) * 14 + cell % 3 * 4 });
  }
  const assignments = assignOrigins(origins, targets);
  for (let n = 0; n < count; n++) {
    const origin = origins[n], target = targets[assignments[n]], index = target.index;
    const distance = Math.hypot(target.x - origin.x, target.y - origin.y);
    const duration = Math.min(720, 380 + Math.sqrt(distance / Math.max(.1, unit)) * 18);
    const fromRotation = shortest(-(tiles[index].angle || 0));
    reserved[index] = 1;
    fragments.push({ tileId: tiles[index].id ?? `stone-${index}`, index, fromX: origin.x, fromY: origin.y, fromRotation, delay: origin.delay, duration, x: origin.x, y: origin.y, rotation: fromRotation, hoverMix: 0, alpha: 0, arrived: false, justArrived: false });
  }
  return { id: source.id, start: now, fragments, reserved, receiverAlpha, remaining: fragments.length, done: false };
}

/** Update existing poses in place. Each endpoint is the receiver's LIVE pose. */
export function advanceMosaicIntake(burst, positions, now, unit = 1, reduced = false) {
  if (burst.done) return false;
  for (const fragment of burst.fragments) {
    fragment.justArrived = false;
    if (fragment.arrived) continue;
    const elapsed = now - burst.start - fragment.delay;
    const progress = reduced ? 1 : clamp((elapsed - RECEIVER_FADE_MS - SOURCE_STAGE_MS) / fragment.duration), amount = ease(progress);
    const offset = fragment.index * 3;
    const targetX = positions[offset], targetY = positions[offset + 1], targetRotation = positions[offset + 2];
    if (progress === 1) {
      // Use exact numbers at handoff, rather than a last almost-finished frame.
      fragment.x = targetX; fragment.y = targetY; fragment.rotation = targetRotation;
      fragment.hoverMix = 1; fragment.alpha = reduced ? 0 : .96;
      fragment.arrived = true; fragment.justArrived = true;
      burst.reserved[fragment.index] = 0; burst.receiverAlpha[fragment.index] = 1; burst.remaining--;
    } else {
      // The real receiver fades first. Only afterward does its incoming sprite
      // appear, pause briefly in the document grid, and begin the quiet fan.
      burst.receiverAlpha[fragment.index] = 1 - ease(elapsed / RECEIVER_FADE_MS);
      fragment.x = fragment.fromX + (targetX - fragment.fromX) * amount;
      fragment.y = fragment.fromY + (targetY - fragment.fromY) * amount - Math.sin(progress * Math.PI) * 5 * unit;
      fragment.rotation = fragment.fromRotation + shortest(targetRotation - fragment.fromRotation) * amount;
      fragment.hoverMix = amount;
      fragment.alpha = clamp((elapsed - RECEIVER_FADE_MS) / 35) * (.88 + .08 * amount);
    }
  }
  if (burst.remaining === 0) { burst.done = true; return true; }
  return false;
}
