const TAU = Math.PI * 2;
const SETTLE_MS = 600;
const FREQUENCY = 24;
const FIELDS = ['x', 'y', 'rotation', 'tutorMix'];
const shortest = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function normalizeTarget(target, index) {
  if (!target || typeof target !== 'object') throw new TypeError(`Missing mosaic target ${index}.`);
  if (Object.hasOwn(target, 'scale') && target.scale !== 1) throw new TypeError(`Mosaic target ${index} must keep scale 1.`);
  const pose = {
    x: target.x, y: target.y, rotation: target.rotation ?? 0, scale: 1,
    role: target.role ?? 'stage', id: target.id ?? `stone-${index}`,
    tutorMix: target.tutorMix ?? Number(target.role === 'tutor'),
  };
  if (FIELDS.some(field => !Number.isFinite(pose[field])) || pose.tutorMix < 0 || pose.tutorMix > 1
      || typeof pose.role !== 'string' || !(typeof pose.id === 'string' || typeof pose.id === 'number' && Number.isFinite(pose.id))) {
    throw new TypeError(`Invalid mosaic target ${index}.`);
  }
  return pose;
}

/**
 * Retarget a fixed pool of rigid tiles without moving their displayed poses at
 * setTargets time. Arrays stay in tile order; identities and source geometry
 * belong to the caller. No target objects are retained or mutated.
 *
 * setTargets(targets, { immediate }) validates the complete array and returns
 * the stable poses array. The first assignment is immediate. Later assignments
 * preserve both current positions and spring velocities; equivalent targets
 * do not restart a transition. role/id change immediately, while tutorMix fades
 * between 0 and 1 (defaulting to 1 for role === 'tutor'). Tile scale stays 1;
 * targets may omit scale or explicitly supply 1, but cannot resize a tile.
 *
 * step(dt, reduced) takes milliseconds and returns the same array and objects.
 * Each changed tile settles exactly within 600 ms; reduced motion settles on
 * the next step, including step(0, true). Rotation uses the shortest turn and
 * may finish at an equivalent unwrapped angle to avoid a numerical jump.
 */
export function createMosaicTargetMotion(count) {
  if (!Number.isInteger(count) || count < 0) throw new TypeError('Mosaic tile count must be a non-negative integer.');
  const poses = Array.from({ length: count }, (_, index) => ({ x: 0, y: 0, rotation: 0, scale: 1, role: 'stage', id: `stone-${index}`, tutorMix: 0 }));
  const velocities = Array.from({ length: count }, () => Object.fromEntries(FIELDS.map(field => [field, 0])));
  const goals = new Array(count), elapsed = new Float64Array(count), active = new Uint8Array(count);
  let initialized = false;

  function settle(index) {
    const pose = poses[index], goal = goals[index], velocity = velocities[index];
    for (const field of FIELDS) { pose[field] = goal[field]; velocity[field] = 0; }
    elapsed[index] = SETTLE_MS; active[index] = 0;
  }

  function setTargets(targets, { immediate = false } = {}) {
    if (!Array.isArray(targets) || targets.length !== count) throw new TypeError(`Expected ${count} mosaic targets.`);
    // Normalize before updating any state, so a rejected scene cannot apply in part.
    const next = Array.from(targets, normalizeTarget);
    for (let index = 0; index < count; index++) {
      const target = next[index], previous = goals[index], pose = poses[index];
      const unchanged = previous && target.x === previous.x && target.y === previous.y
        && Math.abs(shortest(target.rotation - previous.rotation)) < 1e-12
        && target.tutorMix === previous.tutorMix;
      pose.role = target.role; pose.id = target.id;
      if (unchanged && !immediate) continue;
      target.rotation = initialized ? pose.rotation + shortest(target.rotation - pose.rotation) : target.rotation;
      goals[index] = target;
      elapsed[index] = 0; active[index] = 1;
      if (!initialized || immediate) settle(index);
    }
    initialized = true;
    return poses;
  }

  function step(dt, reduced = false) {
    const milliseconds = Number.isFinite(dt) ? clamp(dt, 0, SETTLE_MS) : 0;
    for (let index = 0; index < count; index++) {
      if (!active[index]) continue;
      elapsed[index] += milliseconds;
      if (reduced || elapsed[index] >= SETTLE_MS) { settle(index); continue; }
      if (!milliseconds) continue;
      const seconds = milliseconds / 1000, decay = Math.exp(-FREQUENCY * seconds);
      const pose = poses[index], goal = goals[index], velocity = velocities[index];
      for (const field of FIELDS) {
        const offset = pose[field] - goal[field], tangent = velocity[field] + FREQUENCY * offset;
        pose[field] = goal[field] + (offset + tangent * seconds) * decay;
        velocity[field] = (velocity[field] - FREQUENCY * tangent * seconds) * decay;
        // A rapid reversal may carry a spring through its target. Keep display
        // weights meaningful while preserving spatial momentum.
        const bounded = field === 'tutorMix' ? clamp(pose[field], 0, 1) : pose[field];
        if (bounded !== pose[field]) { pose[field] = bounded; velocity[field] = 0; }
      }
    }
    return poses;
  }

  return { setTargets, step, poses };
}
