import { createMosaicChoreography } from '../mosaic-choreography.mjs';
import { createMosaicTransition } from '../mosaic-transition.mjs';

export const meta = { id: 'original', title: 'Original', description: 'The current tutor. The same course motion, stone flips, and staged frame assembly.', seed: 0 };
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// Use the production motion engines unchanged. Only the viewport anchor moves
// to the center of the comparison card, instead of the app's voice stage.
export function createVariant({ tiles, width = 560, height = 460, border }) {
  const choreography = createMosaicChoreography(tiles), transition = createMosaicTransition(tiles.length);
  transition.setTargets(border, 7.3);
  const result = new Float32Array(tiles.length * 4), tiltX = new Float32Array(tiles.length), tiltY = new Float32Array(tiles.length);
  let lastTime = null;
  function step({ time = 0, dt = 0, state = 'idle', level = 0, pointer, boardOpen, boardProgress = 0, reduced = false }) {
    const elapsed = Math.max(0, Math.min(80, dt));
    if (lastTime === time && !reduced && elapsed === 0) return result;
    lastTime = time;
    const formation = transition.step(boardOpen ?? boardProgress >= .5, elapsed, reduced);
    choreography.step(state, level, time, reduced);
    const activity = !reduced && pointer?.active ? Math.exp(-Math.max(0, time - pointer.movedAt) / 210) : 0;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i], radius = Math.hypot(tile.x, tile.y) * .97;
      const turn = choreography.rotation[i], theta = Math.atan2(tile.y, tile.x) + turn, morph = formation[i];
      const x = width / 2 + Math.cos(theta) * radius, y = height / 2 + Math.sin(theta) * radius, target = border[i];
      const offset = i * 4;
      result[offset] = x + (target.x - x) * morph;
      result[offset + 1] = y + (target.y - y) * morph;
      result[offset + 2] = turn * (1 - morph) + target.rotation * morph;
      const ink = Math.min(.9, .60 + tile.strength * .18 + tile.seed * .08 + tile.motifStrength * .13) * tile.edge;
      const shade = choreography.ink[i] * (1 - morph) + choreography.borderInk[i] * morph;
      result[offset + 3] = Math.min(.94, Math.max(0, ink * (1 - morph * .48) + shade * tile.edge));
      const dx = result[offset] - (pointer?.x || 0), dy = result[offset + 1] - (pointer?.y || 0), distance = Math.hypot(dx, dy);
      const amount = activity * ease(1 - distance / 17) * .314;
      const ux = (pointer?.dx ?? 1) * .8 + (distance > .1 ? dx / distance * .2 : 0), uy = (pointer?.dy ?? 0) * .8 + (distance > .1 ? dy / distance * .2 : 0);
      const length = Math.max(.01, Math.hypot(ux, uy));
      const response = 1 - Math.exp(-elapsed / (amount > Math.hypot(tiltX[i], tiltY[i]) ? 75 : 290));
      tiltX[i] = reduced ? 0 : tiltX[i] + (amount * ux / length - tiltX[i]) * response;
      tiltY[i] = reduced ? 0 : tiltY[i] + (amount * uy / length - tiltY[i]) * response;
    }
    return result;
  }
  return { step, tiltX, tiltY };
}
