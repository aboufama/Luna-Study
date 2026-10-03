const TAU = Math.PI * 2;
const RADIUS = 146;
const PITCH = 6.8;
const COURSES = 21;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// Integer hashing keeps the stone cuts identical across visits and machines.
function noise(index) {
  let value = (index + 0x6d2b79f5) | 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function segmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

function trace(distance, width = 1.7) {
  return Math.exp(-0.5 * (distance / width) ** 2);
}

// A meander unrolled from the outer band. Its interruptions suggest old stone,
// rather than putting a complete decorative border around the voice indicator.
const KEY = [[0, .82], [.23, .82], [.23, .18], [.73, .18], [.73, .63], [.48, .63], [.48, .42]];
function motifs(x, y, radius, theta) {
  let key = 0;
  if (radius > 116 && radius < 144) {
    const phase = ((theta / TAU + 1.018) % 1) * 20;
    const repeat = Math.floor(phase), u = phase - repeat;
    const length = TAU * 130 / 20;
    let distance = Infinity;
    for (let index = 1; index < KEY.length; index++) {
      const a = KEY[index - 1], b = KEY[index];
      distance = Math.min(distance, segmentDistance(u * length, radius - 119, a[0] * length, a[1] * 21, b[0] * length, b[1] * 21));
    }
    const fragment = noise(repeat + 880) < .27 ? .05 : .52 + noise(repeat + 900) * .4;
    key = trace(distance, 2.75) * fragment * smooth((radius - 116) / 4) * smooth((144 - radius) / 4);
  }
  // Two compass sweeps and a lightly broken construction triangle. They are
  // modulation in the stone, not separate line art or literal architecture.
  const sweepA = trace(Math.abs(Math.hypot(x + 17, y - 3) - 46), 3.1);
  const sweepB = trace(Math.abs(Math.hypot(x - 23, y - 3) - 46), 3.0);
  const triangle = Math.min(
    segmentDistance(x, y, -51, 32, 47, 32),
    segmentDistance(x, y, 47, 32, -2, -53),
    segmentDistance(x, y, -2, -53, -51, 32),
  );
  const worn = .66 + .17 * Math.sin(x * .067 + y * .042) + .12 * Math.cos(y * .091 - x * .029);
  const geometry = Math.max(sweepA * .48, sweepB * .37, trace(triangle, 2.8) * .43) * worn;
  return clamp(Math.max(key, geometry));
}

function boundary(course, theta) {
  const bend = Math.min(course / 3, 1);
  return 2.9 + course * PITCH + bend * (.34 * Math.sin(theta * 3 + course * .17) + .2 * Math.sin(theta * 7 - course * .21));
}

function stone(points, index, angle) {
  const x = points.reduce((sum, point) => sum + point.x, 0) / 4;
  const y = points.reduce((sum, point) => sum + point.y, 0) / 4;
  const radius = Math.hypot(x, y), seed = noise(index + 1901);
  const nx = x / RADIUS, ny = y / RADIUS;
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const facing = nx * .3 + ny * .44 + nz * .84;
  const glaze = Math.exp(-((x + 44) ** 2 / 4400 + (y + 53) ** 2 / 3700));
  const mineral = .032 * Math.sin(x * .045 + y * .019) + .023 * Math.cos(y * .07 - x * .021);
  const edge = smooth((RADIUS - radius - .25 + (seed - .5) * 1.1) / 8.8);
  const strength = clamp(.65 + .25 * facing - .17 * glaze + mineral + (seed - .5) * .075, .2, .96) * edge;
  let perimeter = 0;
  for (let i = 0; i < 4; i++) perimeter += Math.hypot(points[i].x - points[(i + 1) % 4].x, points[i].y - points[(i + 1) % 4].y);
  const tilt = (noise(index + 4301) * 2 - 1) * (5 + seed * 4) * Math.PI / 180;
  const cos = Math.cos(tilt), sin = Math.sin(tilt);
  return {
    x, y, r: radius / 150, seed, size: perimeter / 4, angle: angle + tilt,
    vertices: points.map(point => ({ x: (point.x - x) * cos - (point.y - y) * sin, y: (point.x - x) * sin + (point.y - y) * cos })),
    strength, motifStrength: motifs(x, y, radius, Math.atan2(y, x)), edge,
  };
}

/**
 * Canvas-space tesserae for a 292px medallion in a 440px canvas.
 * Vertices are offsets in canvas axes: translate by x/y; do not rotate again.
 * strength includes surface shading and edge fade. motifStrength is separate.
 * angle is the stone's tangent direction, available to the existing animation.
 */
export function createMosaicField() {
  const tiles = [stone([{ x: -1.8, y: -1.7 }, { x: 1.75, y: -1.9 }, { x: 1.9, y: 1.75 }, { x: -1.7, y: 1.9 }], 0, .06)];
  for (let course = 0; course < COURSES; course++) {
    const centerRadius = 2.9 + (course + .5) * PITCH;
    const count = Math.max(7, Math.round(TAU * centerRadius / 7.3));
    const weights = Array.from({ length: count }, (_, index) => .88 + noise(course * 401 + index + 53) * .24);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let theta = course * 2.399963229728653 + noise(course + 100) * .15;
    for (let index = 0; index < count; index++) {
      const width = weights[index] / total * TAU;
      const inset = .215 / centerRadius;
      const left = theta + inset, right = theta + width - inset;
      const skew = (noise(course * 409 + index + 103) - .5) * .12 / centerRadius;
      const point = (angle, radius) => ({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      const points = [
        point(left - skew, boundary(course, left) + .23),
        point(left + skew, boundary(course + 1, left) - .23),
        point(right + skew, boundary(course + 1, right) - .23),
        point(right - skew, boundary(course, right) + .23),
      ];
      tiles.push(stone(points, tiles.length, theta + width / 2 + Math.PI / 2));
      theta += width;
    }
  }
  // One small gap per group of four, distributed across every circular course.
  // Keep the complete round envelope; motifs affect tone, never occupancy.
  const fragments=tiles.filter((_,index)=>index===0||index%4!==Math.floor(noise(Math.floor(index/4)+17003)*4));
  return { tiles:fragments, radius: RADIUS, normalizationRadius: 150, canvasSize: 440, courseCount: COURSES };
}
