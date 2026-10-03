const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const approach = (current, target, milliseconds, dt) => current + (target - current) * (1 - Math.exp(-dt / milliseconds));

/**
 * Frame-rate independent behavior, separate from the dot renderer.
 * Audio, pointer, voice state, and document dragging are inputs to one small
 * state machine; future interactions can reuse these signals without adding
 * event handling or animation timing to the drawing loop.
 */
export function createParticleDynamics({ reducedMotion = false } = {}) {
  let previousTime = null, envelope = 0, phase = 0, lastRipple = -Infinity;
  let dragEase = 0, dragX = 0, dragY = 0;
  let pointerEase = 0, pointerForce = 0, previousPointer = null;
  const ripples = [];
  return {
    step({ state = 'idle', rms = 0, pointer = {}, dragging = false, dragPoint = {}, now = 0, reduced = reducedMotion } = {}) {
      const timestamp = Number.isFinite(now) ? now : previousTime || 0;
      const dt = previousTime === null ? 16 : clamp(timestamp - previousTime, 0, 100);
      previousTime = timestamp;
      const raw = Math.max(0, (Number.isFinite(rms) ? rms : 0) - .008);
      const target = clamp(Math.pow(raw * 14, .7));
      const previousEnvelope = envelope;
      envelope = approach(envelope, target, target > envelope ? 90 : 340, dt);
      dragEase = reduced ? 0 : approach(dragEase, Number(dragging), dragging ? 180 : 280, dt);
      if (dragging) {
        dragX = approach(dragX, Number.isFinite(dragPoint.x) ? dragPoint.x : 0, 100, dt);
        dragY = approach(dragY, Number.isFinite(dragPoint.y) ? dragPoint.y : 0, 100, dt);
      }

      const pointerX = Number.isFinite(pointer.x) ? pointer.x : 0;
      const pointerY = Number.isFinite(pointer.y) ? pointer.y : 0;
      const pointerActive = Boolean(pointer.active) && !reduced && !dragging;
      const travel = previousPointer && pointerActive ? Math.hypot(pointerX - previousPointer.x, pointerY - previousPointer.y) : 0;
      pointerForce = reduced ? 0 : Math.max(clamp(travel / 25), pointerForce * Math.exp(-dt / 260));
      pointerEase = reduced ? 0 : approach(pointerEase, Number(pointerActive), 180, dt);
      previousPointer = { x: pointerX, y: pointerY };

      if (!reduced && envelope > .12 && timestamp - lastRipple > 360 && (envelope - previousEnvelope > .025 || timestamp - lastRipple > 850)) {
        ripples.push({ born: timestamp, strength: envelope });
        lastRipple = timestamp;
      }
      while (ripples.length && (reduced || timestamp - ripples[0].born > 1700)) ripples.shift();
      if (!reduced) phase += ((state === 'speaking' ? .025 : state === 'thinking' ? .016 : .007) + envelope * .022) * dt / 33;
      return {
        envelope,
        phase,
        scale: reduced ? .97 : .97 + envelope * .075 + Math.sin(phase * .65) * .005,
        drag: { active: Boolean(dragging), x: dragX, y: dragY, influence: dragEase, reach: 60 * dragEase * clamp(Math.hypot(dragX, dragY) / 100) },
        ripples,
        pointer: { x: pointerX, y: pointerY, influence: pointerEase, force: pointerForce },
      };
    },
  };
}
