const TAU = Math.PI * 2;
const MAX_COORDINATE = 1_000_000;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const shortest = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;

// Stone dimensions stay fixed. These are gaps between complete stone courses,
// not a responsive unit or a scale factor.
const STAGE_PITCH = 7.8;
const MAX_STAGE_COURSES = 4;
const STONE_GAP = .6;
const STAGE_CORNER_CORE = 24;

/** Records intrinsic content measurement before the real pool is allocated. */
export function measureStageLayout({ width, height, contentWidth = 0, contentHeight = 0 } = {}) {
  return layoutGeometry({ width: clamp(finite(width, 440), 1, MAX_COORDINATE),
    height: clamp(finite(height, 700), 1, MAX_COORDINATE), unit: 1,
    contentWidth: Math.max(0, finite(contentWidth, 0)), contentHeight: Math.max(0, finite(contentHeight, 0)) });
}

function stageFrame(width, height, courses, x = 0, y = 0) {
  return { type: 'frame', x, y, width, height, pitch: STAGE_PITCH, courses,
    cornerRadius: courses * STAGE_PITCH + STAGE_CORNER_CORE };
}

function packingCourses(shape, depth) {
  return frameCourses(shape).map(course => {
    const guide = roundedCourse(course.x + depth, course.y + depth,
      Math.max(0, course.width - depth * 2), Math.max(0, course.height - depth * 2), Math.max(0, course.radius - depth));
    return { perimeter: guide.perimeter, at(fraction) {
      const pose = guide.at(fraction);
      // Sample an inward guide, then return to the course centerline. This
      // preserves enough room between full-size stones around curved corners.
      return { x: pose.x + Math.sin(pose.angle) * depth,
        y: pose.y - Math.cos(pose.angle) * depth, angle: pose.angle };
    } };
  });
}

function layoutGeometry(request, material = { length: 0, depth: 3.5, maximum: 0 }) {
  const { width: w, contentWidth, contentHeight } = request;
  const mobile = w < 600;
  const margin = Math.min(mobile ? 16 : 28, w * .08);
  const top = 28, dockReserve = mobile ? 68 : 71, captionGap = 14, captionHeight = 40;
  const contentTopGap = request.height < 460 ? 40 : 56;
  const maximumInset = MAX_STAGE_COURSES * STAGE_PITCH + 3;
  // A physically narrower viewport may scroll horizontally; stones cannot be
  // compressed into less than their own footprint.
  const maximumBoardWidth = Math.max(maximumInset * 2 + 32, Math.min(1000, w - margin * 2));
  const capacity = (width, height, courses) => packingCourses(stageFrame(width, height, courses), material.depth)
    .reduce((sum, course) => sum + course.perimeter, 0);
  // One maximum stone per course leaves room for indivisible lane allocation.
  const demand = courses => material.length + material.maximum * courses;
  const requiredHeightAt = width => {
    let low = Math.max(210, maximumInset * 2 + contentTopGap + 70), high = Math.max(low, material.length);
    for (let iteration = 0; iteration < 40; iteration++) {
      const middle = (low + high) / 2;
      if (capacity(width, middle, MAX_STAGE_COURSES) >= demand(MAX_STAGE_COURSES)) high = middle;
      else low = middle;
    }
    return high;
  };
  // Four courses cap frame weight. A small equation leaves breathing room
  // within a material-sized board instead of leaving a second pile of stones.
  let lowWidth = Math.min(360, maximumBoardWidth), highWidth = maximumBoardWidth;
  for (let iteration = 0; iteration < 40; iteration++) {
    const middle = (lowWidth + highWidth) / 2;
    if (capacity(middle, Math.max(210, middle / 1.6), MAX_STAGE_COURSES) >= demand(MAX_STAGE_COURSES)) highWidth = middle;
    else lowWidth = middle;
  }
  const minimumBoardWidth = highWidth;
  const boardWidth = clamp(Math.max(minimumBoardWidth, contentWidth + maximumInset * 2 + 32), minimumBoardWidth, maximumBoardWidth);
  const minimumBoardHeight = requiredHeightAt(boardWidth);
  const minimumHeight = Math.ceil(top + minimumBoardHeight + captionGap + captionHeight + dockReserve);
  const h = Math.max(request.height, minimumHeight), dockTop = h - dockReserve;
  const maximumBoardHeight = Math.max(minimumBoardHeight, dockTop - top - captionGap - captionHeight);
  const desiredBoardHeight = Math.max(minimumBoardHeight, contentHeight + maximumInset * 2 + contentTopGap + 16);
  const boardHeight = Math.min(desiredBoardHeight, maximumBoardHeight);
  let courses = 2;
  while (courses < MAX_STAGE_COURSES && capacity(boardWidth, boardHeight, courses) < demand(courses)) courses++;
  const frameInset = courses * STAGE_PITCH + 3;
  const x = (w - boardWidth) / 2;
  const y = top + Math.max(0, (dockTop - top - boardHeight - captionGap - captionHeight) / 2);
  const board = { x, y, width: boardWidth, height: boardHeight,
    inner: { x: x + frameInset, y: y + frameInset,
      width: Math.max(0, boardWidth - frameInset * 2), height: Math.max(0, boardHeight - frameInset * 2) } };
  const content = { x: board.inner.x + 16, y: board.inner.y + contentTopGap,
    width: Math.max(0, board.inner.width - 32), height: Math.max(0, board.inner.height - contentTopGap - 16) };
  const tutorRadius = Math.min(44, boardWidth / 2, boardHeight / 2);
  const tutor = { x: x + boardWidth - tutorRadius, y: y + boardHeight - tutorRadius, radius: tutorRadius };
  const captionWidth = Math.min(680, boardWidth);
  const captions = { x: x + (boardWidth - captionWidth) / 2, y: y + boardHeight + captionGap,
    width: captionWidth, height: captionHeight };
  return { ...request, height: h, requestedHeight: request.height, requiredHeight: minimumHeight,
    mobile, arrangement: 'integrated', margin, top, bottomReserve: h - (y + boardHeight), dockTop, frameInset,
    pitch: STAGE_PITCH, courses, board, tutor, captions, content, contentTopGap,
    maxContentWidth: Math.max(1, Math.min(750, maximumBoardWidth - maximumInset * 2 - 32)) };
}

function roundedCourse(x, y, width, height, radius) {
  const r = clamp(radius, 0, Math.min(width, height) / 2);
  const horizontal = Math.max(0, width - r * 2);
  const vertical = Math.max(0, height - r * 2);
  const arc = r * Math.PI / 2;
  const segments = [
    { length: horizontal, x: x + r, y, angle: 0 },
    { length: arc, cx: x + width - r, cy: y + r, start: -Math.PI / 2 },
    { length: vertical, x: x + width, y: y + r, angle: Math.PI / 2 },
    { length: arc, cx: x + width - r, cy: y + height - r, start: 0 },
    { length: horizontal, x: x + width - r, y: y + height, angle: Math.PI },
    { length: arc, cx: x + r, cy: y + height - r, start: Math.PI / 2 },
    { length: vertical, x, y: y + height - r, angle: -Math.PI / 2 },
    { length: arc, cx: x + r, cy: y + r, start: Math.PI },
  ];
  const perimeter = 2 * horizontal + 2 * vertical + 4 * arc;
  return { x, y, width, height, radius: r, perimeter, at(fraction) {
    if (!perimeter) return { x, y, angle: 0 };
    let distance = (fraction * perimeter + horizontal / 2) % perimeter;
    for (const segment of segments) {
      if (segment.length <= 0) continue;
      if (distance > segment.length) { distance -= segment.length; continue; }
      if (segment.start !== undefined) {
        const angle = segment.start + distance / r;
        return { x: segment.cx + Math.cos(angle) * r, y: segment.cy + Math.sin(angle) * r, angle: angle + Math.PI / 2 };
      }
      return { x: segment.x + Math.cos(segment.angle) * distance,
        y: segment.y + Math.sin(segment.angle) * distance, angle: segment.angle };
    }
    return { x: x + width / 2, y, angle: 0 };
  } };
}

function frameCourses(shape) {
  const count = Math.min(shape.courses ?? 2, Math.max(1, Math.floor(Math.min(shape.width, shape.height) / (shape.pitch * 2))));
  return Array.from({ length: count }, (_, index) => {
    // Centers stay inside the outer frame by half a stone, including corners.
    const inset = shape.pitch * (index + .5);
    return roundedCourse(shape.x + Math.min(inset, shape.width / 2), shape.y + Math.min(inset, shape.height / 2),
      Math.max(0, shape.width - inset * 2), Math.max(0, shape.height - inset * 2),
      Math.max(0, (shape.cornerRadius ?? 18) - inset));
  });
}

function fieldIds(tiles) {
  if (!Array.isArray(tiles) || tiles.length > 20_000) throw new TypeError('Mosaic tiles must be an array of at most 20000 tiles.');
  const ids = tiles.map((tile, index) => tile.id ?? index);
  if (ids.some(id => !['string', 'number'].includes(typeof id) || typeof id === 'number' && !Number.isFinite(id)) || new Set(ids).size !== ids.length) {
    throw new TypeError('Mosaic tile IDs must be unique strings or finite numbers.');
  }
  return ids;
}

function coordinate(value, label, minimum = -MAX_COORDINATE, maximum = MAX_COORDINATE) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new TypeError(`Invalid mosaic ${label}.`);
  return value;
}

function validateShape(shape, count) {
  if (!shape || typeof shape !== 'object') throw new TypeError('A mosaic group needs a shape.');
  switch (shape.type) {
    case 'frame':
      coordinate(shape.x, 'frame x'); coordinate(shape.y, 'frame y');
      coordinate(shape.width, 'frame width', 0); coordinate(shape.height, 'frame height', 0);
      coordinate(shape.pitch ?? 7.3, 'frame pitch', .01, 1000);
      if (!Number.isInteger(shape.courses ?? 2) || (shape.courses ?? 2) < 1 || (shape.courses ?? 2) > 16) throw new TypeError('Mosaic frame courses must be 1 to 16.');
      coordinate(shape.cornerRadius ?? 18, 'frame corner radius', 0);
      break;
    case 'circle':
      coordinate(shape.x, 'circle x'); coordinate(shape.y, 'circle y'); coordinate(shape.radius, 'circle radius', 0);
      break;
    case 'path':
      if (!Array.isArray(shape.points) || shape.points.length < 2 || shape.points.length > 1024) throw new TypeError('Mosaic paths need 2 to 1024 points.');
      shape.points.forEach(point => { coordinate(point.x, 'path x'); coordinate(point.y, 'path y'); });
      break;
    case 'poses':
      if (!Array.isArray(shape.poses) || shape.poses.length !== count) throw new TypeError('Mosaic poses must match the selected tile count.');
      shape.poses.forEach(pose => {
        coordinate(pose.x, 'pose x'); coordinate(pose.y, 'pose y');
        coordinate(pose.rotation ?? 0, 'pose rotation');
        if (Object.hasOwn(pose, 'scale') && pose.scale !== 1) throw new TypeError('Mosaic tiles have a fixed scale of 1.');
      });
      break;
    default: throw new TypeError(`Unsupported mosaic shape: ${shape.type}`);
  }
}

function sourceExtent(tiles, indices) {
  let extent = .001;
  for (const index of indices) {
    const tile = tiles[index];
    const x = finite(tile.x, 0), y = finite(tile.y, 0);
    extent = Math.max(extent, Math.hypot(x, y) + finite(tile.size, 0) / 2);
    for (const vertex of tile.vertices || []) extent = Math.max(extent, Math.hypot(x + finite(vertex.x, 0), y + finite(vertex.y, 0)));
  }
  return extent;
}

function pathSampler(shape) {
  const points = shape.closed ? [...shape.points, shape.points[0]] : shape.points;
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return fraction => {
    let distance = total * fraction;
    for (let index = 0; index < lengths.length; index++) {
      if (distance > lengths[index] && index < lengths.length - 1) { distance -= lengths[index]; continue; }
      const a = points[index], b = points[index + 1];
      const progress = lengths[index] ? distance / lengths[index] : 0;
      return { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress,
        angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    return { ...points[0], angle: 0 };
  };
}

/**
 * Versioned, pure destination compiler. Groups select stable tile IDs; one
 * group may omit tileIds to take the remainder. Duplicate/unknown IDs fail.
 * Supported shapes: frame, circle (preserves source tessellation), path and
 * explicit poses. Tiles retain their source geometry and scale of 1.
 * Unassigned stones retain their source poses. No source objects are modified.
 * This is a rendering primitive, not permission to execute model-provided code.
 */
export function compileMosaicScene(tiles, scene) {
  const ids = fieldIds(tiles);
  if (scene?.version !== 1 || !Array.isArray(scene.groups) || scene.groups.length > 64) throw new TypeError('Mosaic scene version 1 supports at most 64 groups.');
  const unit = scene.unit ?? 1;
  if (unit !== 1) throw new TypeError('Mosaic scene unit must be 1 to preserve fixed tile size.');
  const lookup = new Map(ids.map((id, index) => [id, index]));
  const claimed = new Set(), groupIds = new Set();
  let remainder = false;
  const selections = scene.groups.map(group => {
    if (typeof group.id !== 'string' || !group.id || groupIds.has(group.id)) throw new TypeError('Mosaic group IDs must be unique nonempty strings.');
    if (group.role !== undefined && (typeof group.role !== 'string' || !group.role)) throw new TypeError('Mosaic group roles must be nonempty strings.');
    groupIds.add(group.id);
    if (group.tileIds === undefined) {
      if (remainder) throw new TypeError('Only one mosaic group can select remaining tiles.');
      remainder = true; return null;
    }
    if (!Array.isArray(group.tileIds)) throw new TypeError('Mosaic tileIds must be an array.');
    return group.tileIds.map(id => {
      const index = lookup.get(id);
      if (index === undefined || claimed.has(index)) throw new TypeError('Mosaic tile IDs must exist and cannot be assigned twice.');
      claimed.add(index); return index;
    });
  });
  const targets = tiles.map((tile, index) => ({ id: ids[index], role: 'unassigned', groupId: null,
    x: finite(tile.x, 0) * unit, y: finite(tile.y, 0) * unit, rotation: 0, scale: 1 }));
  const groups = [];
  scene.groups.forEach((group, groupIndex) => {
    const indices = selections[groupIndex] ?? tiles.map((_, index) => index).filter(index => !claimed.has(index));
    const shape = { ...group.shape, pitch: group.shape?.pitch ?? 7.3 * unit };
    validateShape(shape, indices.length);
    const put = (index, pose) => { targets[index] = { ...targets[index], role: group.role ?? group.id, groupId: group.id, ...pose }; };
    if (shape.type === 'circle') {
      const radius = indices.length ? sourceExtent(tiles, indices) * unit : 0;
      if (shape.radius + 1e-8 < radius) throw new TypeError('Mosaic circle is too small for its fixed-size tiles.');
      indices.forEach(index => put(index, { x: shape.x + finite(tiles[index].x, 0) * unit,
        y: shape.y + finite(tiles[index].y, 0) * unit, rotation: 0, scale: 1 }));
    } else if (shape.type === 'poses') {
      indices.forEach((index, rank) => put(index, { x: shape.poses[rank].x, y: shape.poses[rank].y,
        rotation: shape.poses[rank].rotation ?? 0, scale: 1 }));
    } else if (shape.type === 'path') {
      const at = pathSampler(shape);
      indices.forEach((index, rank) => {
        const pose = at(shape.closed ? rank / Math.max(1, indices.length) : indices.length < 2 ? .5 : rank / (indices.length - 1));
        put(index, { x: pose.x, y: pose.y, rotation: shortest(pose.angle - finite(tiles[index].angle, 0)), scale: 1 });
      });
    } else {
      const courses = frameCourses(shape);
      const ordered = [...indices].sort((a, b) => {
        const angle = index => (Math.atan2(tiles[index].y, tiles[index].x) + Math.PI * 2.5) % TAU;
        return angle(a) - angle(b) || a - b;
      });
      const counts = courses.map((_, index) => Math.floor((indices.length + courses.length - 1 - index) / courses.length));
      ordered.forEach((index, rank) => {
        const lane = rank % courses.length;
        const pose = courses[lane].at((Math.floor(rank / courses.length) + .5) / counts[lane]);
        put(index, { x: pose.x, y: pose.y, rotation: shortest(pose.angle - finite(tiles[index].angle, 0)), scale: 1 });
      });
    }
    groups.push({ id: group.id, count: indices.length });
  });
  return { version: 1, targets, groups };
}

/**
 * The complete pool becomes one continuous frame. The lower-right stones are
 * the tutor's presence within that frame, rather than a detached mini avatar.
 */
export function createMosaicStageTargets(tiles, layout) {
  const ids = fieldIds(tiles);
  const dimensions = tiles.map(tile => {
    const angle = -finite(tile.angle, 0), cosine = Math.cos(angle), sine = Math.sin(angle);
    let halfWidth = finite(tile.size, 0) / 2, halfDepth = halfWidth;
    if (tile.vertices?.length) {
      halfWidth = 0; halfDepth = 0;
      for (const vertex of tile.vertices) {
        halfWidth = Math.max(halfWidth, Math.abs(vertex.x * cosine - vertex.y * sine));
        halfDepth = Math.max(halfDepth, Math.abs(vertex.x * sine + vertex.y * cosine));
      }
    }
    return { width: Math.max(.1, halfWidth * 2) + STONE_GAP, depth: halfDepth };
  });
  const material = dimensions.reduce((sum, stone) => ({ length: sum.length + stone.width,
    depth: Math.max(sum.depth, stone.depth), maximum: Math.max(sum.maximum, stone.width) }),
  { length: 0, depth: 0, maximum: 0 });
  const request = { width: layout.width, height: layout.requestedHeight ?? layout.height, unit: 1,
    contentWidth: layout.contentWidth ?? 0, contentHeight: layout.contentHeight ?? 0 };
  const resolvedLayout = layoutGeometry(request, material);
  const shape = stageFrame(resolvedLayout.board.width, resolvedLayout.board.height, resolvedLayout.courses,
    resolvedLayout.board.x, resolvedLayout.board.y);
  const courses = packingCourses(shape, material.depth);
  const lanes = courses.map(() => ({ indices: [], length: 0 }));
  const ordered = tiles.map((_, index) => index).sort((a, b) => {
    const angle = index => (Math.atan2(tiles[index].y, tiles[index].x) + Math.PI * 2.5) % TAU;
    return angle(a) - angle(b) || a - b;
  });
  for (const index of ordered) {
    let lane = 0;
    for (let candidate = 1; candidate < lanes.length; candidate++) {
      if (lanes[candidate].length / Math.max(1, courses[candidate].perimeter)
        < lanes[lane].length / Math.max(1, courses[lane].perimeter)) lane = candidate;
    }
    lanes[lane].indices.push(index); lanes[lane].length += dimensions[index].width;
  }
  const poses = new Array(tiles.length);
  lanes.forEach((lane, laneIndex) => {
    const slack = Math.max(0, courses[laneIndex].perimeter - lane.length) / Math.max(1, lane.indices.length);
    let distance = 0;
    lane.indices.forEach(index => {
      const width = dimensions[index].width + slack;
      const pose = courses[laneIndex].at((distance + width / 2) / Math.max(1, courses[laneIndex].perimeter));
      poses[index] = { x: pose.x, y: pose.y, rotation: shortest(pose.angle - finite(tiles[index].angle, 0)), scale: 1 };
      distance += width;
    });
  });
  const right = resolvedLayout.board.x + resolvedLayout.board.width;
  const bottom = resolvedLayout.board.y + resolvedLayout.board.height;
  const presenceSize = resolvedLayout.tutor.radius * 2;
  const corner = poses.map((pose, index) => ({ index, distance: Math.hypot(right - pose.x, bottom - pose.y) }))
    .filter(({ index }) => poses[index].x >= right - presenceSize && poses[index].y >= bottom - presenceSize)
    .sort((a, b) => a.distance - b.distance || a.index - b.index);
  const tutorIndices = new Set(corner.slice(0, 60).map(({ index }) => index));
  const boardIndices = tiles.map((_, index) => index).filter(index => !tutorIndices.has(index));
  const tutor = [...tutorIndices];
  const scene = { version: 1, unit: 1, groups: [
    { id: 'board', tileIds: boardIndices.map(index => ids[index]), shape: { type: 'poses', poses: boardIndices.map(index => poses[index]) } },
    { id: 'tutor', tileIds: tutor.map(index => ids[index]), shape: { type: 'poses', poses: tutor.map(index => poses[index]) } },
  ] };
  return { ...compileMosaicScene(tiles, scene), scene, layout: resolvedLayout,
    boardCount: boardIndices.length, tutorCount: tutor.length };
}
