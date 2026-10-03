const TAU = Math.PI * 2;

// Silhouettes define occupied stone; motifs define its mineral pigments. Both
// describe subjects, with open space between the branches, strands, and rings.
function curve(evaluate, steps = 160, start = 0, end = 1) {
  return Array.from({ length: steps + 1 }, (_, index) => evaluate(start + (end - start) * index / steps));
}

function ellipse(cx, cy, rx, ry = rx, rotation = 0, start = 0, end = TAU) {
  const cosine = Math.cos(rotation), sine = Math.sin(rotation);
  const steps = Math.max(16, Math.ceil(Math.abs(end - start) * Math.max(rx, ry) / 2.3));
  return curve(angle => {
    const x = rx * Math.cos(angle), y = ry * Math.sin(angle);
    return { x: cx + x * cosine - y * sine, y: cy + x * sine + y * cosine };
  }, Math.min(steps, 399), start, end);
}

const path = (points, width = 12, layer = 'ink', strength = 1, closed = false) => ({ points, width, layer, strength, closed });
const line = (ax, ay, bx, by, width = 12, layer = 'ink', strength = 1) => path([{ x: ax, y: ay }, { x: bx, y: by }], width, layer, strength);
const dot = (x, y, diameter = 18, layer = 'accent', strength = 1) => line(x - .2, y, x + .2, y, diameter, layer, strength);
const polygon = (cx, cy, radius, count, phase = 0) => Array.from({ length: count }, (_, index) => ({ x: cx + radius * Math.cos(phase + index * TAU / count), y: cy + radius * Math.sin(phase + index * TAU / count) }));
const rotate = (point, angle) => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
const filled = points => ({ points, closed: true, fill: true });
const ribbon = (points, width) => ({ points, width });
const loop = points => [...points, points[0]];
const square = (x, y, size) => [{ x: x - size / 2, y: y - size / 2 }, { x: x + size / 2, y: y - size / 2 }, { x: x + size / 2, y: y + size / 2 }, { x: x - size / 2, y: y + size / 2 }];
const star = (x, y, radius) => Array.from({ length: 8 }, (_, i) => {
  const distance = i % 2 ? radius * .27 : radius;
  return { x: x + distance * Math.cos(i * Math.PI / 4), y: y + distance * Math.sin(i * Math.PI / 4) };
});

function mathematics() {
  const roof = [
    { x: -110, y: -74 }, { x: -87, y: -96 }, { x: 107, y: -96 },
    { x: 103, y: -57 }, { x: -69, y: -57 }, { x: -87, y: -45 }, { x: -110, y: -45 },
  ];
  const leftLeg = [
    { x: -67, y: -64 }, { x: -25, y: -64 }, { x: -26, y: 18 }, { x: -35, y: 69 },
    { x: -59, y: 108 }, { x: -96, y: 103 }, { x: -74, y: 62 }, { x: -66, y: 13 },
  ];
  const rightLeg = [
    { x: 30, y: -64 }, { x: 72, y: -64 }, { x: 64, y: 42 }, { x: 70, y: 74 },
    { x: 93, y: 65 }, { x: 103, y: 97 }, { x: 78, y: 110 }, { x: 49, y: 104 },
    { x: 31, y: 85 }, { x: 25, y: 57 },
  ];
  return {
    silhouette: [filled(roof), filled(leftLeg), filled(rightLeg)],
    motifs: [
      line(-90, -76, 98, -76, 35, 'ink', .96),
      path([{ x: -47, y: -55 }, { x: -47, y: 17 }, { x: -55, y: 67 }, { x: -75, y: 99 }], 34, 'ink', .92),
      path([{ x: 50, y: -55 }, { x: 47, y: 38 }, { x: 48, y: 63 }], 32, 'ink', .88),
      path([{ x: 48, y: 69 }, { x: 59, y: 86 }, { x: 77, y: 92 }, { x: 93, y: 85 }], 29, 'accent', .87),
    ],
  };
}

function physics() {
  const orbits = [0, Math.PI / 3, -Math.PI / 3].map(rotation => ellipse(0, 0, 102, 39, rotation));
  const electrons = [{ x: 102, y: 0 }, { x: -51, y: -88.3 }, { x: -51, y: 88.3 }];
  return {
    silhouette: [
      ...orbits.map(points => ribbon(points, 20)),
      { ...filled(ellipse(0, 0, 21)), intact: true },
      ...electrons.map(({ x, y }) => filled(ellipse(x, y, 12))),
    ],
    motifs: [
      path(orbits[0], 17, 'ink', .9),
      path(orbits[1], 17, 'accent', .95),
      path(orbits[2], 17, 'ink', .7),
      dot(0, 0, 42, 'accent'),
      ...electrons.map(({ x, y }) => dot(x, y, 25, 'ink', .96)),
    ],
  };
}

function chemistry() {
  const ring = loop(polygon(-10, 0, 57, 6));
  const bonds = [
    [{ x: 47, y: 0 }, { x: 92, y: 0 }],
    [{ x: -38.5, y: -49.36 }, { x: -61, y: -88 }],
    [{ x: -38.5, y: 49.36 }, { x: -61, y: 88 }],
  ];
  const atoms = [{ x: 92, y: 0 }, { x: -61, y: -88 }, { x: -61, y: 88 }];
  const inner = polygon(-10, 0, 35, 6);
  const doubleBonds = [0, 2, 4].map(index => [inner[index], inner[(index + 1) % 6]]);
  return {
    silhouette: [
      ribbon(ring, 25), ...bonds.map(points => ribbon(points, 22)),
      ...atoms.map(({ x, y }) => filled(polygon(x, y, 21, 8, Math.PI / 8))),
      ...doubleBonds.map(points => ribbon(points, 9)),
    ],
    motifs: [
      path(ring, 20, 'ink', .91), ...bonds.map(points => path(points, 16, 'ink', .84)),
      ...atoms.map(({ x, y }) => dot(x, y, 43, 'accent', 1)),
      ...doubleBonds.map(points => path(points, 9, 'accent', .96)),
    ],
  };
}

function biology() {
  const xAt = y => 39 * Math.sin(y / 105 * Math.PI * 1.3 + .2);
  const turn = point => rotate(point, -.16);
  const links = [-88, -66, -44, -22, 0, 22, 44, 66, 88].flatMap(y => {
    const x = xAt(y);
    return Math.abs(x) < 12 ? [] : [[turn({ x: -x, y }), turn({ x, y })]];
  });
  const left = curve(y => turn({ x: xAt(y), y }), 190, -105, 105);
  const right = curve(y => turn({ x: -xAt(y), y }), 190, -105, 105);
  return {
    silhouette: [ribbon(left, 23), ribbon(right, 23), ...links.map(points => ribbon(points, 10))],
    motifs: [
      ...links.map(points => path(points, 9, 'accent', .6)),
      path(left, 20, 'ink', .95), path(right, 20, 'accent', .97),
    ],
  };
}

function computing() {
  const routes = [
    [{ x: 0, y: 99 }, { x: 0, y: 45 }],
    [{ x: 0, y: 45 }, { x: -52, y: 45 }, { x: -52, y: -17 }],
    [{ x: 0, y: 45 }, { x: 52, y: 45 }, { x: 52, y: -17 }],
    [{ x: -52, y: -17 }, { x: -88, y: -17 }, { x: -88, y: -74 }],
    [{ x: -52, y: -17 }, { x: -28, y: -17 }, { x: -28, y: -96 }],
    [{ x: 52, y: -17 }, { x: 28, y: -17 }, { x: 28, y: -96 }],
    [{ x: 52, y: -17 }, { x: 88, y: -17 }, { x: 88, y: -74 }],
  ];
  const terminals = [[-88, -74], [-28, -96], [28, -96], [88, -74]];
  return {
    silhouette: [
      ...routes.map(points => ribbon(points, 23)),
      ...terminals.map(([x, y]) => filled(square(x, y, 36))),
      filled(square(0, 96, 33)),
    ],
    motifs: [
      ...routes.map(points => path(points, 16, 'ink', .94)),
      ...terminals.map(([x, y], index) => line(x - 6, y, x + 6, y, 34, index % 2 ? 'ink' : 'accent', .94)),
      dot(0, 96, 36, 'accent', .97),
    ],
  };
}

function astronomy() {
  const ring = ellipse(0, 4, 107, 36, -.43);
  const stars = [{ x: -58, y: -88, radius: 18 }, { x: 79, y: -77, radius: 12 }, { x: -88, y: 68, radius: 13 }];
  return {
    silhouette: [
      { ...filled(ellipse(0, 4, 51)), intact: true }, ribbon(ring, 24),
      ...stars.map(({ x, y, radius }) => filled(star(x, y, radius))),
    ],
    motifs: [
      dot(0, 4, 106, 'accent', .78),
      path(ellipse(0, 4, 107, 36, -.43, Math.PI, TAU), 18, 'ink', .69),
      line(-37, -22, 29, -30, 10, 'accent', .95),
      line(-45, -3, 46, -12, 10, 'accent', .92),
      path(ellipse(0, 4, 45, 45, 0, Math.PI * .16, Math.PI * .87), 12, 'ink', .47),
      path(ellipse(0, 4, 107, 36, -.43, 0, Math.PI), 19, 'ink', .98),
      ...stars.map(({ x, y, radius }) => dot(x, y, radius * 2, 'accent', 1)),
    ],
  };
}

export const SCIENCE_COURSES = [
  {
    id: 'mathematics', name: 'Mathematics', category: 'Formal sciences',
    subtitle: 'The beauty of a pattern.',
    description: 'A bold pi symbol built entirely from hand-cut moss-dark stone. Its broad roof and gently curved legs make mathematics immediately recognisable, with a small ochre accent at the foot.',
    palette: { ink: '#4d6157', accent: '#aa8350', stone: '#c5c8be' },
    ...mathematics(),
    detail: 'Pi symbol · broad stone strokes · moss and ochre',
  },
  {
    id: 'physics', name: 'Physics', category: 'Natural sciences',
    subtitle: 'Everything is in relation.',
    description: 'Three crossing ribbons of lapis and blue-grey stone trace an atom around a substantial nucleus. Small dark electron clusters punctuate the open orbital silhouette.',
    palette: { ink: '#46617c', accent: '#829aa9', stone: '#c4c7c3' },
    ...physics(),
    detail: 'Three orbital ribbons · central nucleus · lapis and blue-grey',
  },
  {
    id: 'chemistry', name: 'Chemistry', category: 'Natural sciences',
    subtitle: 'Small bonds. Vast possibilities.',
    description: 'A substantial benzene ring branches into rose-coloured atom clusters. Plum bond ribbons, spare double bonds, and hand-cut edges give the molecular silhouette a tactile depth.',
    palette: { ink: '#665366', accent: '#ad7a79', stone: '#c8c3bf' },
    ...chemistry(),
    detail: 'Benzene ring · branching bonds · plum and rose atoms',
  },
  {
    id: 'biology', name: 'Biology', category: 'Life sciences',
    subtitle: 'The shape of living things.',
    description: 'Two substantial strands of pine and celadon stone twist into a gently tilted double helix. Short limestone bridges span the open spaces between them.',
    palette: { ink: '#41685e', accent: '#87a182', stone: '#c1c8bd' },
    ...biology(),
    detail: 'Double helix · paired bridges · pine and celadon',
  },
  {
    id: 'computer-science', name: 'Computer science', category: 'Computing',
    subtitle: 'An idea, branching outward.',
    description: 'A broad circuit tree branches from one root into four square terminals. Slate routes, pale stone edges, and terracotta endpoints make a precise, recognisable silhouette.',
    palette: { ink: '#4c5d6c', accent: '#aa765d', stone: '#c2c7c3' },
    ...computing(),
    detail: 'Branching tree · four terminals · slate and terracotta',
  },
  {
    id: 'astronomy', name: 'Astronomy', category: 'Space sciences',
    subtitle: 'A little piece of the infinite.',
    description: 'A solid gold-toned planet meets wide, tilted lapis rings, with three small tessellated stars nearby. The stones make Saturn’s silhouette, including its generous open spaces.',
    palette: { ink: '#4d566f', accent: '#b19a62', stone: '#c4c6c1' },
    ...astronomy(),
    detail: 'Solid ringed planet · tessellated stars · gold and twilight lapis',
  },
];
