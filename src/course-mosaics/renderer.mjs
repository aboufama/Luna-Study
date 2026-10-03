import { createMosaicField } from '../mosaic-field.mjs';

// Reuse Luna's hand-cut material, but let the SUBJECT define the silhouette.
// The voice tutor remains circular; course artwork has its own tile positions.
export const COURSE_FIELD = createMosaicField();
export const ART_SIZE = 360;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const noise = (seed, n) => { const v = Math.sin(seed * 197.17 + n * 89.71) * 43758.5453; return v - Math.floor(v); };
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const blend = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const tone = (base, shift = 0) => `rgb(${base.map(v => Math.round(clamp(v + shift, 0, 255))).join(',')})`;
const point = p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
const pathData = points => `M${points.map(point).join('L')}Z`;

function distanceToSegment(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

function influence(tile, motif) {
  let distance = Infinity;
  const points = motif.points;
  if (points.length === 1) distance = Math.hypot(tile.x - points[0].x, tile.y - points[0].y);
  for (let i = 1; i < points.length; i++) distance = Math.min(distance, distanceToSegment(tile.x, tile.y, points[i - 1], points[i]));
  if (motif.closed && points.length > 1) distance = Math.min(distance, distanceToSegment(tile.x, tile.y, points.at(-1), points[0]));
  return Math.exp(-.5 * (distance / (motif.width * .5)) ** 4) * (motif.strength ?? 1);
}

function contains(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function occupied(x, y, shapes) {
  return shapes.some(shape => shape.fill ? contains(x, y, shape.points) : influence({ x, y }, { ...shape, strength: 1 }) >= .55);
}

function subjectField(course) {
  if (!course.silhouette?.length) return COURSE_FIELD.tiles;
  const tiles = [], pitch = 6.65;
  const shapes = course.silhouette;
  const intactShapes = shapes.filter(shape => shape.intact);
  let row = 0;
  for (let y = -146; y <= 146; y += pitch, row++) {
    let column = 0;
    for (let x = -146; x <= 146; x += pitch, column++) {
      const seed = noise(row * 1.191 + column * 2.119, 43);
      const px = x + (row % 2 ? pitch * .22 : 0) + (noise(seed, 4) - .5) * .62;
      const py = y + (noise(seed, 5) - .5) * .62;
      if (!occupied(px, py, shapes)) continue;
      // Occasional small lacunae make the surface tactile without dissolving
      // delicate bonds, strings or leaf stems into a collection of dots.
      if (noise(seed, 9) < .045 && !occupied(px, py, intactShapes)
        && occupied(px - 5, py, shapes) && occupied(px + 5, py, shapes)
        && occupied(px, py - 5, shapes) && occupied(px, py + 5, shapes)) continue;
      const source = COURSE_FIELD.tiles[30 + Math.floor(noise(seed, 12) * (COURSE_FIELD.tiles.length - 30))];
      const turn = -source.angle + (noise(seed, 17) - .5) * .18;
      const cos = Math.cos(turn), sin = Math.sin(turn);
      const vertices = source.vertices.map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
      const edge = [occupied(px - 4, py, shapes), occupied(px + 4, py, shapes), occupied(px, py - 4, shapes), occupied(px, py + 4, shapes)].filter(Boolean).length;
      tiles.push({ ...source, x: px, y: py, vertices, seed,
        r: Math.hypot(px, py) / 150, edge: edge > 2 ? 1 : .84 + noise(seed, 29) * .16,
        strength: .65 + .15 * (1 - py / 150) + (seed - .5) * .1, motifStrength: 0,
      });
    }
  }
  return tiles;
}

export function createCourseTiles(course, monochrome = false) {
  const palette = monochrome
    ? { stone: '#bdbcb5', ink: '#484740', accent: '#787469' }
    : course.palette;
  const limestone = rgb(palette.stone), ink = rgb(palette.ink), accent = rgb(palette.accent);
  const shaped = Boolean(course.silhouette?.length);
  return subjectField(course).map((tile, index) => {
    let inkMix = 0, accentMix = 0;
    for (const motif of course.motifs) {
      const value = influence(tile, motif);
      if (motif.layer === 'accent') accentMix = Math.max(accentMix, value);
      else inkMix = Math.max(inkMix, value);
    }
    const radius = Math.hypot(tile.x, tile.y);
    // A quiet fragment of the original meander remains at the circumference.
    const rim = !shaped && radius > 119 ? tile.motifStrength * .63 : 0;
    const mineral = (noise(tile.seed, 21) - .5) * 22 + (tile.strength - .64) * 22;
    const foundation = shaped ? blend(limestone, ink, .20 + tile.seed * .14) : limestone;
    let base = blend(foundation, accent, clamp(accentMix * .90 + rim));
    base = blend(base, ink, clamp(inkMix * (.9 + tile.seed * .1)));
    // Soft, weathered mineral pigment: keep the subject readable while giving
    // the colorful courses the same quiet presence as Luna's neutral stone.
    if (shaped) {
      const luma = base[0] * .2126 + base[1] * .7152 + base[2] * .0722;
      base = blend(base, [luma + 1, luma, luma - 2], .30);
      base = blend(base, [242, 241, 235], .085);
    }
    const outline = [];
    tile.vertices.forEach((vertex, i) => {
      const prev = tile.vertices[(i + tile.vertices.length - 1) % tile.vertices.length], next = tile.vertices[(i + 1) % tile.vertices.length];
      const cut = .025 + noise(tile.seed, i + 31) * .055;
      outline.push({ x: vertex.x + (prev.x - vertex.x) * cut, y: vertex.y + (prev.y - vertex.y) * cut });
      outline.push({ x: vertex.x + (next.x - vertex.x) * cut, y: vertex.y + (next.y - vertex.y) * cut });
    });
    return { ...tile, id: `stone-${index}`, base, mineral, outline,
      face: outline.map(p => ({ x: p.x * .86 - .12, y: p.y * .86 - .16 })),
      alpha: (shaped ? .82 + tile.seed * .10 : .88 + tile.seed * .10) * tile.edge,
      pigment: Math.max(inkMix, accentMix),
    };
  });
}

function trace(ctx, points) {
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
}

function paintStone(ctx, tile) {
  const { outline, face, base, mineral } = tile;
  ctx.fillStyle = 'rgba(36,30,23,.13)'; trace(ctx, outline.map(p => ({ x: p.x + .55, y: p.y + 1.05 }))); ctx.fill();
  ctx.fillStyle = tone(base, mineral - 28); trace(ctx, outline.map(p => ({ x: p.x + .32, y: p.y + .55 }))); ctx.fill();
  ctx.fillStyle = tone(base, mineral - 8); trace(ctx, outline); ctx.fill();
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length, a = outline[i], b = outline[j];
    const dx = b.x - a.x, dy = b.y - a.y, light = (dy * -.6 + dx * .8) / Math.max(.01, Math.hypot(dx, dy));
    ctx.fillStyle = tone(base, mineral + (light > 0 ? light * 35 : light * 22));
    trace(ctx, [a, b, face[j], face[i]]); ctx.fill();
  }
  const grad = ctx.createLinearGradient(-3, -4, 3, 4);
  grad.addColorStop(0, tone(base, mineral + 19)); grad.addColorStop(.58, tone(base, mineral + 3)); grad.addColorStop(1, tone(base, mineral - 12));
  ctx.fillStyle = grad; trace(ctx, face); ctx.fill();
  ctx.save(); trace(ctx, face); ctx.clip();
  for (let g = 0; g < 7; g++) {
    ctx.fillStyle = g % 3 ? 'rgba(18,16,12,.10)' : 'rgba(248,240,220,.22)';
    const size = .16 + noise(tile.seed, g * 3 + 62) * .25;
    ctx.fillRect((noise(tile.seed, g * 3 + 60) - .5) * 8, (noise(tile.seed, g * 3 + 61) - .5) * 8, size, size * .7);
  }
  ctx.restore();
}

// High-resolution atlas avoids recomputing bevels or motif geometry per frame.
export function createCourseAtlas(tiles, resolution = 3) {
  const size = 20, cell = size * resolution, columns = 32;
  const canvas = document.createElement('canvas');
  canvas.width = columns * cell; canvas.height = Math.ceil(tiles.length / columns) * cell;
  const ctx = canvas.getContext('2d');
  const sprites = tiles.map((tile, i) => {
    const sx = i % columns * cell, sy = Math.floor(i / columns) * cell;
    ctx.setTransform(resolution, 0, 0, resolution, sx + cell / 2, sy + cell / 2);
    paintStone(ctx, tile);
    return { sx, sy };
  });
  return { canvas, sprites, size, cell };
}

export function drawCourse(ctx, tiles, { size = ART_SIZE, ratio = 1, atlas, time = 0, motion = false, background = null } = {}) {
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, size, size);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, size, size); }
  const scale = size / ART_SIZE;
  tiles.forEach((tile, i) => {
    // Rigid individual stones tilt softly; the silhouette never pulses in scale.
    const theta = Math.atan2(tile.y, tile.x);
    const phase = time / 1900 - tile.r * 4 + theta;
    const turn = motion ? Math.sin(phase) * .028 * (.35 + tile.pigment) : 0;
    const drift = motion ? Math.sin(phase) * .62 * Math.sin(tile.r * Math.PI) : 0;
    const light = motion ? Math.sin(time / 2200 - tile.r * 4 + theta * 2) * .024 * tile.edge : 0;
    const cos = Math.cos(turn), sin = Math.sin(turn), factor = ratio * scale;
    ctx.setTransform(cos * factor, sin * factor, -sin * factor, cos * factor, (size / 2 + (tile.x - Math.sin(theta) * drift) * scale) * ratio, (size / 2 + (tile.y + Math.cos(theta) * drift) * scale) * ratio);
    ctx.globalAlpha = clamp(tile.alpha + light);
    if (atlas) {
      const sprite = atlas.sprites[i];
      ctx.drawImage(atlas.canvas, sprite.sx, sprite.sy, atlas.cell, atlas.cell, -atlas.size / 2, -atlas.size / 2, atlas.size, atlas.size);
    } else paintStone(ctx, tile);
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
}

const escapeXML = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export function courseSVG(course, monochrome = false) {
  const tiles = createCourseTiles(course, monochrome);
  const defs = [], groups = [];
  tiles.forEach((tile, i) => {
    const { base, mineral, outline, face } = tile;
    defs.push(`<linearGradient id="g${i}" gradientUnits="userSpaceOnUse" x1="-3" y1="-4" x2="3" y2="4"><stop stop-color="${tone(base, mineral + 19)}"/><stop offset=".58" stop-color="${tone(base, mineral + 3)}"/><stop offset="1" stop-color="${tone(base, mineral - 12)}"/></linearGradient>`);
    const surfaces = [
      `<path d="${pathData(outline)}" fill="#241e17" opacity=".13" transform="translate(.55 1.05)"/>`,
      `<path d="${pathData(outline)}" fill="${tone(base, mineral - 28)}" transform="translate(.32 .55)"/>`,
      `<path d="${pathData(outline)}" fill="${tone(base, mineral - 8)}"/>`,
    ];
    outline.forEach((a, j) => {
      const k = (j + 1) % outline.length, b = outline[k], dx = b.x - a.x, dy = b.y - a.y;
      const light = (dy * -.6 + dx * .8) / Math.max(.01, Math.hypot(dx, dy));
      surfaces.push(`<path d="${pathData([a, b, face[k], face[j]])}" fill="${tone(base, mineral + (light > 0 ? light * 35 : light * 22))}"/>`);
    });
    surfaces.push(`<path d="${pathData(face)}" fill="url(#g${i})"/>`);
    groups.push(`<g id="${tile.id}" transform="translate(${(ART_SIZE / 2 + tile.x).toFixed(3)} ${(ART_SIZE / 2 + tile.y).toFixed(3)})" opacity="${tile.alpha.toFixed(4)}">${surfaces.join('')}</g>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1440" viewBox="0 0 ${ART_SIZE} ${ART_SIZE}" role="img" aria-labelledby="title desc"><title id="title">${escapeXML(course.name)} — Luna course mosaic</title><desc id="desc">${escapeXML(course.description)} ${tiles.length} hand-cut tesserae in mineral pigments.</desc><defs>${defs.join('')}</defs>${groups.join('')}</svg>`;
}
