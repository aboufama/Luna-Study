const QUIET_DELAY = 700;
const ACTIVITY_HOLD = 450;
const RETURN_DURATION = 260;
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * t * (10 + t * (-15 + t * 6)); };

/**
 * Rest is a small, newly sampled arrangement each time the mosaic relaxes.
 * Randomness chooses a destination once, never adds noise to an animation frame.
 * Every fragment is one to three neighboring rigid stones; its common transform
 * keeps the little patch intact throughout departure and the fast return.
 */
export function createMosaicRest(tiles, { random = Math.random } = {}) {
  const count = tiles.length;
  const x = new Float32Array(count), y = new Float32Array(count), rotation = new Float32Array(count);
  const focusRotation = new Float32Array(count), focusBands = new Uint8Array(count);
  let focusTime = Infinity;
  const candidates = [], faintCandidates = [];
  for (let index = 0; index < count; index++) {
    const tile = tiles[index], radius = Math.hypot(tile.x, tile.y);
    const course = Math.floor((radius - 2.9) / 6.8) + 1;
    if (Number.isFinite(radius) && course >= 19 && course <= 21) focusBands[index] = 22 - course;
    if (!Number.isFinite(radius) || radius < 128 || radius > 146) continue;
    const edge = tile.edge ?? 1;
    const opacity = Math.min(.9, .60 + (tile.strength ?? .6) * .18 + (tile.seed ?? .5) * .08 + (tile.motifStrength ?? 0) * .13) * edge;
    if (!Number.isFinite(opacity)) continue;
    const candidate = { index, radius, x: tile.x, y: tile.y };
    if (radius >= 140 && edge >= .16 && edge < .74 && opacity >= .10) faintCandidates.push(candidate);
    else if (radius <= 142 && edge >= .74 && opacity >= .58) candidates.push(candidate);
  }
  const sample = () => { const value = random(); return Number.isFinite(value) ? Math.max(0, Math.min(.999999999, value)) : .5; };
  function shuffled(values) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(sample() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  const indices = [], groups = [];
  let plans = [], hasRested = false;
  function arrange() {
    indices.length = groups.length = 0;
    const used = new Set(), fragments = [];
    // No angular slots: an irregular shuffle supplies neighborhoods around the
    // rim, separated only enough to keep distinct fragments from colliding.
    const sizes = shuffled([1, 1, 2, 2, 3, ...(sample() < .65 ? [1] : [])]);
    // A few translucent rim stones participate too, with shorter departures.
    // Keep them separate from the opaque pool so neither texture disappears.
    const requests = [
      ...sizes.map(wanted => ({ wanted, pool: candidates, faint: false })),
      ...shuffled([1, 2, ...(sample() < .45 ? [1] : [])]).map(wanted => ({ wanted, pool: faintCandidates, faint: true })),
    ];
    for (const { wanted, pool, faint } of requests) {
      let chosen = null;
      for (const anchor of shuffled(pool)) {
        if (used.has(anchor.index) || !fragments.every(fragment => fragment.every(member => Math.hypot(anchor.x - member.x, anchor.y - member.y) > (faint ? 23 : 33)))) continue;
        // A loose neighboring pair of fragments gives an off-center rhythm,
        // then the rest scatter freely. There is deliberately no radial grid.
        if (!faint && fragments.length === 1 && Math.hypot(anchor.x - fragments[0][0].x, anchor.y - fragments[0][0].y) > 58) continue;
        const fragment = [anchor];
        while (fragment.length < wanted) {
          const neighbors = shuffled(pool).filter(candidate => !used.has(candidate.index) && !fragment.includes(candidate)
            && Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y) < 16
            && fragment.some(member => Math.hypot(candidate.x - member.x, candidate.y - member.y) < 10.5)
            && fragments.every(other => other.every(member => Math.hypot(candidate.x - member.x, candidate.y - member.y) > (faint ? 18 : 24))));
          if (!neighbors.length) break;
          fragment.push(neighbors[0]);
        }
        if (fragment.length === wanted) { chosen = fragment; break; }
      }
      if (!chosen) continue;
      chosen.faint = faint;
      fragments.push(chosen);
      for (const member of chosen) { used.add(member.index); indices.push(member.index); }
      groups.push(chosen.map(member => member.index));
    }
    const depths = shuffled([3.5 + sample() * 3, 7 + sample() * 4, 12 + sample() * 4, 18 + sample() * 4, 23 + sample() * 4, 8 + sample() * 15]);
    let delay = sample() * 60;
    plans = fragments.map((fragment, slot) => {
      const cx = fragment.reduce((sum, member) => sum + member.x, 0) / fragment.length;
      const cy = fragment.reduce((sum, member) => sum + member.y, 0) / fragment.length;
      const radius = Math.hypot(cx, cy), direction = Math.atan2(cy, cx) + (sample() - .5) * .26;
      const plan = {
        members: fragment.map(member => ({ index: member.index, x: member.x - cx, y: member.y - cy })),
        ux: Math.cos(direction), uy: Math.sin(direction), distance: fragment.faint ? 4 + sample() * 10 : depths[slot],
        tangent: (sample() - .5) * 3.5,
        turn: (sample() - .5) * .20,
        delay, duration: 3100 + sample() * 1700,
        tx: 0, ty: 0, angle: 0, returnX: 0, returnY: 0, returnRotation: 0,
      };
      delay += 95 + sample() * 280;
      // All selected material must be on the original edge, even for test data.
      if (!Number.isFinite(radius)) plan.distance = 0;
      return plan;
    });
  }
  arrange();
  let phase = 'locked', quiet = 0, hold = 0, driftTime = 0, returnTime = 0;

  function apply(plan, dx, dy, turn) {
    plan.tx = dx; plan.ty = dy; plan.angle = turn;
    const cos = Math.cos(turn) - 1, sin = Math.sin(turn);
    for (const member of plan.members) {
      x[member.index] = dx + member.x * cos - member.y * sin;
      y[member.index] = dy + member.x * sin + member.y * cos;
      rotation[member.index] = turn;
    }
  }
  function lock() {
    for (const plan of plans) apply(plan, 0, 0, 0);
    phase = 'locked'; driftTime = returnTime = 0;
  }
  function beginReturn(allowFocus) {
    if (phase !== 'drifting') return;
    if (allowFocus && plans.some(plan => Math.hypot(plan.tx, plan.ty) > .8)) focusTime = 0;
    for (const plan of plans) { plan.returnX = plan.tx; plan.returnY = plan.ty; plan.returnRotation = plan.angle; }
    phase = 'returning'; returnTime = 0;
  }
  function step({ dt = 0, resting = false, engaged = false, reduced = false, allowFocus = true } = {}) {
    if (reduced) { lock(); quiet = hold = 0; focusTime = Infinity; focusRotation.fill(0); return; }
    const elapsed = Math.max(0, Math.min(80, Number.isFinite(dt) ? dt : 0));
    if (!elapsed) return;
    if (engaged || !resting) { quiet = 0; hold = ACTIVITY_HOLD; beginReturn(allowFocus); }
    else {
      const held = Math.min(hold, elapsed);
      hold -= held;
      if (!hold && phase !== 'drifting') quiet += elapsed - held;
    }
    // An in-flight twist finishes smoothly if a board or document takes over;
    // allowFocus prevents new accents, and the renderer blends into its target.
    if (Number.isFinite(focusTime)) {
      focusTime += elapsed;
      // The scattered fragments arrive first. Three complete outer courses
      // then turn as nested dials and seat, with no scale/radius deformation.
      const angles = [0, .060, -.032, .015];
      for (let index = 0; index < count; index++) {
        const band = focusBands[index];
        const progress = clamp((focusTime - RETURN_DURATION - (band - 1) * 32) / 340);
        const pulse = progress < .30 ? ease(progress / .30) : 1 - ease((progress - .30) / .70);
        focusRotation[index] = band ? angles[band] * pulse : 0;
      }
      if (focusTime >= RETURN_DURATION + 404) { focusTime = Infinity; focusRotation.fill(0); }
    }
    if (phase === 'returning') {
      returnTime = Math.min(RETURN_DURATION, returnTime + elapsed);
      const remaining = 1 - ease(returnTime / RETURN_DURATION);
      for (const plan of plans) apply(plan, plan.returnX * remaining, plan.returnY * remaining, plan.returnRotation * remaining);
      if (returnTime === RETURN_DURATION) lock();
      return;
    }
    if (phase === 'locked') {
      if (!resting || engaged || hold || quiet < QUIET_DELAY) return;
      // Resample only when every old fragment is exactly home. A brief activity
      // can never teleport an old fragment into a new randomized arrangement.
      if (hasRested) arrange();
      hasRested = true; phase = 'drifting'; driftTime = quiet - QUIET_DELAY;
    } else driftTime += elapsed;
    for (const plan of plans) {
      const progress = clamp((driftTime - plan.delay) / plan.duration), amount = ease(progress);
      const radial = plan.distance * amount;
      const tangent = plan.tangent * (amount + Math.sin(progress * Math.PI) * .22);
      apply(plan, plan.ux * radial - plan.uy * tangent, plan.uy * radial + plan.ux * tangent, plan.turn * amount);
    }
  }
  return { step, x, y, rotation, focusRotation, indices, groups };
}
