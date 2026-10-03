// Subject silhouettes determine where hand-cut stones exist. The remaining
// paths tint those stones with mineral pigments; nothing is drawn on top.
const point = (x, y) => ({ x, y });

function cubic(a, b, c, d) {
  // A cubic's derivative is bounded by three times its largest control edge.
  // This keeps even a sharply accelerating turn below a three-pixel sample.
  const longestEdge = Math.max(
    Math.hypot(b[0] - a[0], b[1] - a[1]),
    Math.hypot(c[0] - b[0], c[1] - b[1]),
    Math.hypot(d[0] - c[0], d[1] - c[1]),
  );
  const steps = Math.max(2, Math.ceil(longestEdge * 3 / 2.8));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps, u = 1 - t;
    return point(
      u ** 3 * a[0] + 3 * u ** 2 * t * b[0] + 3 * u * t ** 2 * c[0] + t ** 3 * d[0],
      u ** 3 * a[1] + 3 * u ** 2 * t * b[1] + 3 * u * t ** 2 * c[1] + t ** 3 * d[1],
    );
  });
}

function join(...parts) {
  return parts.flatMap((part, index) => index ? part.slice(1) : part);
}

const line = (a, b) => [point(...a), point(...b)];
const trace = (points, width = 11, layer = 'ink', strength = 1, closed = false) => ({
  points, width, layer, strength, ...(closed ? { closed: true } : {}),
});

const fill = points => ({ points, closed: true, fill: true });
const polygon = vertices => fill(vertices.map(([x, y]) => point(x, y)));
const band = (points, width) => ({ points, width });
const rectangle = (left, top, right, bottom) => polygon([[left, top], [right, top], [right, bottom], [left, bottom]]);

const growth = join(
  cubic([-111, 21], [-79, -2], [-48, -14], [-19, -33]),
  cubic([-19, -33], [20, -59], [53, -91], [94, -100]),
);
const bars = [
  [-104, 55, -66, 98],
  [-51, 17, -13, 98],
  [2, -18, 40, 98],
  [55, -54, 96, 98],
];
const economics = {
  id: 'economics',
  name: 'Economics',
  category: 'Society & systems',
  subtitle: 'The shape of possibility',
  description: 'Four stone pillars rise at measured intervals beneath a sweeping ochre curve. Their open spaces and ascending rhythm turn growth into a small piece of architecture.',
  palette: { ink: '#59777e', accent: '#b58e53', stone: '#b3bbb3' },
  silhouette: [
    ...bars.map(([left, top, right, bottom]) => polygon([[left + 2, top], [right - 2, top], [right, bottom], [left, bottom]])),
    band(growth, 17),
    polygon([[107, -113], [98, -78], [74, -101]]),
    rectangle(-109, 107, 106, 121),
  ],
  motifs: [
    ...bars.map(([left, top, right, bottom], index) => trace(line([(left + right) / 2 - 4, top + 5], [(left + right) / 2 - 4, bottom]), 26, index === 2 ? 'accent' : 'ink', .8)),
    trace(growth, 22, 'accent'),
    trace(line([95, -101], [99, -97]), 40, 'accent'),
    trace(line([-109, 117], [106, 117]), 12, 'ink', .63),
    ...bars.map(([left, top, right]) => trace(line([left + 4, top + 7], [right - 4, top + 7]), 8, 'accent', .5)),
  ],
  detail: 'Blue slate · yellow ochre',
};

const columnCenters = [-82, -27, 28, 83];
const history = {
  id: 'world-history',
  name: 'World History',
  category: 'Humanities',
  subtitle: 'Built across centuries',
  description: 'A classical temple assembled from sandstone fragments: a broad triangular pediment, four subtly tapered columns, and three stepped foundation courses. Light passes freely between the columns.',
  palette: { ink: '#876d57', accent: '#bd995f', stone: '#bcafa0' },
  silhouette: [
    polygon([[-115, -49], [0, -115], [115, -49]]),
    rectangle(-112, -43, 112, -20),
    ...columnCenters.flatMap(x => [
      rectangle(x - 22, -20, x + 22, -5),
      polygon([[x - 14, -8], [x + 14, -8], [x + 17, 70], [x - 17, 70]]),
      rectangle(x - 22, 69, x + 22, 82),
    ]),
    rectangle(-104, 86, 105, 98),
    rectangle(-112, 102, 113, 111),
    rectangle(-121, 115, 122, 125),
  ],
  motifs: [
    trace([point(-99, -56), point(0, -105), point(99, -56)], 11, 'accent'),
    trace(line([-112, -38], [112, -38]), 10, 'ink', .78),
    trace(line([-103, -22], [104, -22]), 8, 'accent', .82),
    ...columnCenters.flatMap(x => [
      trace(line([x - 7, -3], [x - 9, 66]), 8.5, 'ink', .8),
      trace(line([x + 7, -3], [x + 9, 66]), 7.5, 'accent', .55),
      trace(line([x - 19, 78], [x + 19, 78]), 8, 'ink', .55),
    ]),
    trace(line([-115, 119], [116, 119]), 11, 'ink', .75),
    trace(line([-107, 105], [108, 105]), 8, 'accent', .75),
    trace(line([-2, -79], [2, -79]), 18, 'accent', .75),
  ],
  detail: 'Sandstone · warm bronze',
};

// A bound volume seen slightly from above: the page shoulders rise away from
// its gutter, and both lower edges descend into the same broad central V.
const leftPageTop = cubic([-117, -79], [-77, -88], [-33, -69], [-6, -40]);
const rightPageTop = cubic([6, -40], [33, -69], [77, -88], [117, -79]);
const leftPageBottom = cubic([-115, 44], [-77, 39], [-35, 64], [-6, 89]);
const rightPageBottom = cubic([6, 89], [35, 64], [77, 39], [115, 44]);
const leftPage = join(
  leftPageTop,
  line([-6, -40], [-6, 89]),
  [...leftPageBottom].reverse(),
  cubic([-115, 44], [-119, 8], [-119, -45], [-117, -79]),
);
const rightPage = join(
  rightPageTop,
  cubic([117, -79], [119, -45], [119, 8], [115, 44]),
  [...rightPageBottom].reverse(),
  line([6, 89], [6, -40]),
);
const bookCover = join(
  cubic([-119, 59], [-78, 54], [-33, 84], [0, 105]),
  cubic([0, 105], [33, 84], [78, 54], [119, 59]),
);
const literature = {
  id: 'literature',
  name: 'Literature',
  category: 'Humanities',
  subtitle: 'A world unfolding',
  description: 'An open book in warm ivory stone, with curved paper leaves, a plum-gray binding, and a fine cover beneath. Six spare lines follow the natural sweep of the pages, leaving their pale surfaces open and quiet.',
  palette: { ink: '#6b6174', accent: '#aa9a85', stone: '#dfd9cc' },
  silhouette: [
    fill(leftPage), fill(rightPage),
    band(line([0, -40], [0, 99]), 12),
    band(bookCover, 12),
  ],
  motifs: [
    trace(leftPageTop, 8.5, 'accent', .68),
    trace(rightPageTop, 8.5, 'accent', .68),
    trace(leftPageBottom, 8, 'accent', .48),
    trace(rightPageBottom, 8, 'accent', .48),
    trace(line([0, -40], [0, 101]), 13, 'ink', 1),
    trace(cubic([-93, -47], [-71, -46], [-49, -35], [-27, -20]), 8, 'ink', .65),
    trace(cubic([-93, -18], [-72, -18], [-48, -6], [-27, 10]), 8, 'ink', .6),
    trace(cubic([-92, 11], [-72, 11], [-49, 22], [-29, 37]), 8, 'ink', .56),
    trace(cubic([27, -20], [49, -35], [71, -46], [93, -47]), 8, 'ink', .65),
    trace(cubic([27, 10], [48, -6], [72, -18], [93, -18]), 8, 'ink', .6),
    trace(cubic([29, 37], [49, 22], [72, 11], [92, 11]), 8, 'ink', .56),
    trace(bookCover, 15, 'ink', .95),
  ],
  detail: 'Ivory limestone · plum-gray binding',
};

const brainLeft = join(
  cubic([-8, -85], [-30, -112], [-65, -105], [-76, -76]),
  cubic([-76, -76], [-111, -74], [-121, -43], [-103, -24]),
  cubic([-103, -24], [-122, 4], [-108, 36], [-82, 42]),
  cubic([-82, 42], [-79, 72], [-47, 83], [-26, 66]),
  cubic([-26, 66], [-2, 74], [-4, 45], [-10, 20]),
  cubic([-10, 20], [-21, -1], [-6, -32], [-8, -85]),
);
const brainRight = join(
  cubic([9, -88], [36, -109], [70, -100], [77, -73]),
  cubic([77, -73], [112, -72], [118, -41], [103, -23]),
  cubic([103, -23], [122, 4], [108, 38], [82, 42]),
  cubic([82, 42], [74, 72], [43, 82], [25, 66]),
  cubic([25, 66], [4, 76], [4, 44], [11, 20]),
  cubic([11, 20], [24, -2], [5, -32], [9, -88]),
);
const insetBrain = points => {
  const dx = points[0].x < 0 ? 6 : -6;
  return points.map(p => point(p.x + dx, p.y));
};
const psychology = {
  id: 'psychology',
  name: 'Psychology',
  category: 'Mind & behavior',
  subtitle: 'Patterns of thought',
  description: 'Two sculptural lobes are built from lavender and rose-earth stones. Winding folds move through their solid surfaces, divided by a narrow seam of light and joined at a small descending stem.',
  palette: { ink: '#68728f', accent: '#ab8987', stone: '#b6b2c0' },
  silhouette: [fill(insetBrain(brainLeft)), fill(insetBrain(brainRight)), band(cubic([-1, 60], [1, 79], [-5, 96], [-17, 106]), 24)],
  motifs: [
    ...[
    trace(line([56, -64], [57, 47]), 96, 'accent', .42),
    trace(line([-59, -66], [-59, 44]), 82, 'ink', .2),
    trace(join(
      cubic([-75, -74], [-49, -78], [-38, -63], [-43, -44]),
      cubic([-43, -44], [-65, -38], [-80, -19], [-65, -2]),
      cubic([-65, -2], [-42, 5], [-39, 29], [-50, 39]),
    ), 12, 'ink'),
    trace(join(
      cubic([-100, -24], [-79, -31], [-61, -21], [-65, -2]),
      cubic([-65, -2], [-82, 7], [-87, 21], [-79, 35]),
    ), 10.5, 'ink', .91),
    trace(cubic([-44, -46], [-22, -42], [-20, -23], [-23, -10]), 11, 'ink', .88),
    trace(cubic([-50, 39], [-37, 40], [-26, 50], [-26, 63]), 11, 'ink', .84),
    trace(join(
      cubic([75, -71], [52, -78], [36, -61], [42, -42]),
      cubic([42, -42], [65, -36], [80, -20], [66, -2]),
      cubic([66, -2], [43, 5], [38, 26], [51, 39]),
    ), 12, 'ink', .86),
    trace(join(
      cubic([102, -23], [79, -31], [60, -21], [66, -2]),
      cubic([66, -2], [83, 5], [85, 22], [79, 35]),
    ), 10.5, 'accent'),
    trace(cubic([42, -42], [22, -40], [21, -20], [25, -8]), 11, 'ink', .81),
    trace(cubic([51, 39], [37, 40], [27, 48], [26, 63]), 11, 'ink', .82),
    ].map(motif => ({ ...motif, points: insetBrain(motif.points) })),
    trace(cubic([-1, 66], [1, 81], [-5, 98], [-17, 106]), 14, 'ink', .75),
  ],
  detail: 'Blue lavender · rose earth',
};

const lyreLeft = cubic([-83, -82], [-56, -44], [-87, 21], [-57, 63]);
const lyreRight = cubic([83, -82], [56, -44], [87, 21], [57, 63]);
const lyreBowl = join(
  cubic([-72, 36], [-71, 80], [-42, 109], [0, 109]),
  cubic([0, 109], [45, 109], [76, 78], [72, 36]),
  cubic([72, 36], [35, 53], [-35, 53], [-72, 36]),
);
const leftCurl = join(
  cubic([-83, -82], [-87, -109], [-116, -107], [-110, -81]),
  cubic([-110, -81], [-107, -64], [-92, -64], [-84, -74]),
);
const rightCurl = leftCurl.map(p => point(-p.x, p.y));
const stringPositions = [-44, -22, 0, 22, 44];
const music = {
  id: 'music-theory',
  name: 'Music Theory',
  category: 'Arts & expression',
  subtitle: 'Intervals in stone',
  description: 'A warm bronze lyre has substantial curled arms, a rounded stone soundbox, and five straight, evenly spaced strings. Gold inlay follows the bowl and the central string, giving its measured intervals a gentle radiance.',
  palette: { ink: '#7c6852', accent: '#bd9b53', stone: '#bcab8d' },
  silhouette: [
    band(lyreLeft, 29), band(lyreRight, 29), fill(lyreBowl),
    band(leftCurl, 20), band(rightCurl, 20),
    rectangle(-80, -73, 80, -52),
    ...stringPositions.map(x => band(line([x, -54], [x, 53]), 9.8)),
  ],
  motifs: [
    trace(lyreLeft, 17, 'ink', .92), trace(lyreRight, 17, 'ink', .92),
    trace(leftCurl, 17, 'accent', .92), trace(rightCurl, 17, 'accent', .92),
    trace(line([-78, -67], [78, -67]), 11, 'accent', .86),
    ...stringPositions.map(x => trace(line([x, -51], [x, 53]), 12, x === 0 ? 'accent' : 'ink', x === 0 ? 1 : .85)),
    trace(cubic([-55, 55], [-28, 70], [28, 70], [55, 55]), 13, 'accent', .97),
    trace(cubic([-48, 80], [-22, 103], [23, 103], [49, 80]), 12, 'ink', .84),
    trace(line([-2, 80], [2, 80]), 18, 'accent', .83),
  ],
  detail: 'Warm bronze · antique gold',
};

const fernStem = cubic([-35, 111], [-12, 66], [-11, -24], [26, -110]);
const fernLeaves = [
  { a: [-24, 77], tip: [-105, 44], outA: [-66, 34], outB: [-94, 34], backA: [-99, 69], backB: [-52, 89], vein: [-66, 58], accent: true },
  { a: [-22, 69], tip: [79, 63], outA: [14, 39], outB: [64, 43], backA: [65, 91], backB: [19, 103], vein: [33, 67] },
  { a: [-14, 42], tip: [-117, -4], outA: [-56, -9], outB: [-95, -6], backA: [-106, 30], backB: [-57, 57], vein: [-64, 23] },
  { a: [-7, 29], tip: [105, 3], outA: [28, -6], outB: [79, -4], backA: [98, 29], backB: [38, 58], vein: [51, 23], accent: true },
  { a: [0, -6], tip: [-92, -62], outA: [-44, -58], outB: [-65, -60], backA: [-81, -27], backB: [-35, 2], vein: [-49, -29], accent: true },
  { a: [9, -29], tip: [100, -52], outA: [48, -60], outB: [77, -54], backA: [83, -21], backB: [41, -1], vein: [56, -32] },
  { a: [18, -57], tip: [-49, -98], outA: [-5, -88], outB: [-24, -90], backA: [-41, -68], backB: [-13, -47], vein: [-14, -72] },
  { a: [25, -77], tip: [73, -111], outA: [47, -104], outB: [60, -105], backA: [73, -79], backB: [47, -64], vein: [53, -88], accent: true },
];
const fernCurl = join(
  cubic([26, -110], [30, -124], [47, -122], [49, -110]),
  cubic([49, -110], [50, -94], [33, -93], [34, -106]),
);
const environment = {
  id: 'environmental-science',
  name: 'Environmental Science',
  category: 'Living systems',
  subtitle: 'The shape of growth',
  description: 'A fern is assembled leaf by leaf from moss-green stones. Broad, asymmetrical blades taper toward their tips, and open air separates each pair as the stem rises into a small unfurling curl.',
  palette: { ink: '#4e755d', accent: '#aaa86e', stone: '#96a58e' },
  silhouette: [
    band(fernStem, 18),
    ...fernLeaves.map(({ a, tip, outA, outB, backA, backB }) => fill(join(cubic(a, outA, outB, tip), cubic(tip, backA, backB, a)))),
    band(fernCurl, 12),
  ],
  motifs: [
    trace(fernStem, 12, 'ink', .95),
    ...fernLeaves.map(({ a, tip, vein, accent }) => trace(cubic(a, vein, vein, tip), 10.5, accent ? 'accent' : 'ink', accent ? .98 : .83)),
    trace(fernCurl, 14, 'accent'),
  ],
  detail: 'Moss green · olive mineral',
};

export const HUMANITIES_COURSES = [economics, history, literature, psychology, music, environment];
