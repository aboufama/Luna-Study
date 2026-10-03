const clamp = value => Math.max(0, Math.min(1, value));
const settle = value => { const t = clamp(value); return t * t * t * (10 + t * (-15 + t * 6)); };

// This is the normal voice stage's fixed anchor, independent of the hidden
// board-mode button. Caption height and the button's CSS transition cannot move it.
export function mosaicCircleCenter(width, height, unit = 1) {
  return { x: width / 2, y: height / 2 - (width < 520 ? 75 : 70) - 5 * unit };
}

// One continuous construction clock, with a small phase offset per destination.
// The top opens from its center, both sides follow together, and the bottom
// closes toward its center. Inner masonry courses settle just behind outer ones.
// Reversing the target retains clock velocity, so interrupted gestures never snap.
export function createMosaicTransition(count, initiallyOpen = false) {
  const phases = new Float32Array(count), progress = new Float32Array(count);
  let position = Number(initiallyOpen), velocity = 0, lastTarget = position, elapsed = 1000;
  progress.fill(position);

  function setTargets(targets, pitch = 7.3) {
    if (!targets.length) return;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const target of targets) {
      left = Math.min(left, target.x); right = Math.max(right, target.x);
      top = Math.min(top, target.y); bottom = Math.max(bottom, target.y);
    }
    const halfWidth = Math.max(1, (right - left) / 2), frameHeight = Math.max(1, bottom - top);
    for (let index = 0; index < count; index++) {
      const target = targets[index];
      if (!target) { phases[index] = 0; continue; }
      const topDistance = target.y - top, bottomDistance = bottom - target.y;
      const sideDistance = Math.min(target.x - left, right - target.x);
      const edgeDistance = Math.min(topDistance, bottomDistance, sideDistance);
      const horizontal = clamp(Math.abs(target.x - (left + right) / 2) / halfWidth);
      const course = Math.min(5, Math.max(0, edgeDistance / Math.max(1, pitch)));
      const phase = topDistance <= Math.min(bottomDistance, sideDistance)
        ? horizontal * .035
        : bottomDistance <= sideDistance
          ? .245 + (1 - horizontal) * .035
          : .10 + clamp(topDistance / frameHeight) * .10;
      phases[index] = phase + course * .008;
    }
  }

  function step(open, dt, reduced = false) {
    const target = Number(Boolean(open));
    if (target !== lastTarget) { lastTarget = target; elapsed = 0; }
    if (reduced) { position = target; velocity = 0; elapsed = 1000; progress.fill(target); return progress; }
    const seconds = Math.max(0, Math.min(80, Number.isFinite(dt) ? dt : 0)) / 1000;
    if (seconds > 0) {
      elapsed += seconds * 1000;
      const frequency = 6.2, offset = position - target, tangent = velocity + frequency * offset;
      const decay = Math.exp(-frequency * seconds);
      position = clamp(target + (offset + tangent * seconds) * decay);
      velocity = (velocity - frequency * tangent * seconds) * decay;
      // The fifth-order local easing has already settled within a fraction of
      // a pixel; finish the asymptotic clock so closing also has an exact end.
      if (elapsed >= 1000 || Math.abs(position - target) < .00001 && Math.abs(velocity) < .0001) { position = target; velocity = 0; }
    }
    for (let index = 0; index < count; index++) progress[index] = settle((position - phases[index]) / .65);
    return progress;
  }

  return { setTargets, step, progress };
}
