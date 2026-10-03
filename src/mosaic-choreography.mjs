const TAU = Math.PI * 2;
const COURSE_COUNT = 22;
const HISTORY_SIZE = 96;
const clamp = value => Math.max(0, Math.min(1, value));
const follow = (value, target, dt, duration) => value + (target - value) * (1 - Math.exp(-dt / duration));

/**
 * Shared course choreography, never individual-stone noise. All output arrays
 * are allocated once and reused. Offsets are in the medallion's original units;
 * the renderer applies only translation, rigid rotation and ink opacity.
 */
export function createMosaicChoreography(tiles) {
  const count = tiles.length;
  const radial = new Float32Array(count), rotation = new Float32Array(count);
  const ink = new Float32Array(count), borderInk = new Float32Array(count);
  const courses = new Uint8Array(count), angles = new Float32Array(count);
  const courseRotation = new Float32Array(COURSE_COUNT), courseInk = new Float32Array(COURSE_COUNT);
  const audio = new Float32Array(HISTORY_SIZE), times = new Float64Array(HISTORY_SIZE).fill(-Infinity);
  for (let i = 0; i < count; i++) {
    const tile = tiles[i], radius = Math.hypot(tile.x, tile.y);
    courses[i] = Math.max(0, Math.min(COURSE_COUNT - 1, Math.floor((radius - 2.9) / 6.8) + 1));
    angles[i] = Math.atan2(tile.y, tile.x);
  }
  let previousTime = null, thinking = 0, speaking = 0, listening = 0, envelope = 0;
  let compass = 0, construction = 0, voicePhase = 0, head = 0;

  function sampled(at) {
    let newer = (head + HISTORY_SIZE - 1) % HISTORY_SIZE;
    if (at >= times[newer]) return audio[newer];
    for (let offset = 1; offset < HISTORY_SIZE; offset++) {
      const older = (newer + HISTORY_SIZE - 1) % HISTORY_SIZE;
      if (times[older] <= at) {
        if (!Number.isFinite(times[older])) return 0;
        const fraction = clamp((at - times[older]) / Math.max(1, times[newer] - times[older]));
        return audio[older] + (audio[newer] - audio[older]) * fraction;
      }
      newer = older;
    }
    return 0;
  }

  function step(state, rms, now, reduced = false) {
    const timestamp = Number.isFinite(now) ? now : previousTime || 0;
    const dt = previousTime === null ? 16 : Math.max(0, Math.min(80, timestamp - previousTime));
    previousTime = timestamp;
    if (reduced) {
      radial.fill(0); rotation.fill(0); ink.fill(0); borderInk.fill(0);
      audio.fill(0); times.fill(-Infinity);
      thinking = speaking = listening = envelope = 0;
      return;
    }

    thinking = follow(thinking, Number(state === 'thinking'), dt, 340);
    speaking = follow(speaking, Number(state === 'speaking'), dt, state === 'speaking' ? 150 : 310);
    listening = follow(listening, Number(state === 'listening'), dt, 220);
    const hasAudio = state === 'speaking' || state === 'listening';
    const raw = hasAudio && Number.isFinite(rms) ? Math.max(0, rms - .008) : 0;
    const target = clamp(Math.pow(raw * 14, .7));
    envelope = follow(envelope, target, dt, target > envelope ? 65 : 190);
    audio[head] = envelope; times[head] = timestamp; head = (head + 1) % HISTORY_SIZE;
    construction = (construction + dt * .00072 * thinking) % TAU;
    compass = (compass + dt * .00034 * thinking) % TAU;
    voicePhase = (voicePhase + dt * .00022 * speaking * envelope) % TAU;

    for (let course = 0; course < COURSE_COUNT; course++) {
      const r = course / (COURSE_COUNT - 1), group = Math.floor(course / 3);
      const direction = group % 2 ? -1 : 1;
      // Speech turns complete courses like nested dials. No radius changes,
      // angular warping within a course, or individual-stone oscillation.
      const delayed = sampled(timestamp - group * 34);
      const earlier = sampled(timestamp - group * 34 - 160);
      const wave = delayed - earlier;
      const courseTurn = Math.sin(construction + group * .42) * direction;
      courseRotation[course] = thinking * courseTurn * .028 * (.52 + r * .48)
        + speaking * direction * (Math.sin(voicePhase + group * .42) * .048 + delayed * .010) * (.65 + r * .35)
        + listening * envelope * direction * .009;
      courseInk[course] = speaking * (delayed * .033 + Math.max(0, wave) * .15)
        + listening * envelope * .035;
    }

    for (let i = 0; i < count; i++) {
      const course = courses[i], theta = angles[i];
      const sweep = Math.max(0, Math.cos(theta - compass - .45)) ** 7;
      const opposite = Math.max(0, Math.cos(theta - compass + Math.PI - .45)) ** 10;
      // A broad moving change in ink reveals the compass, not a drawn spinner.
      const compassInk = thinking * (sweep * .105 + opposite * .032 - .009);
      radial[i] = 0;
      rotation[i] = courseRotation[course];
      ink[i] = compassInk + courseInk[course];
      // The whiteboard keeps its geometry completely still while speaking.
      borderInk[i] = compassInk * .45 + courseInk[course] * .65;
    }
  }

  return { step, radial, rotation, ink, borderInk };
}
