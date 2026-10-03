import React, { useEffect, useRef, useState } from 'react';
import { ART_SIZE, createCourseTiles, createCourseAtlas, drawCourse } from './renderer.mjs';

// Course objects are stable theme definitions. Weak keys keep a removed custom
// theme collectible; each theme has only its mineral and graphite tile sets.
const tileCache = new WeakMap();
const atlasCache = new Map();
const MAX_ATLASES = 16;

function tilesFor(course, monochrome) {
  let variants = tileCache.get(course);
  if (!variants) { variants = new Map(); tileCache.set(course, variants); }
  if (!variants.has(monochrome)) variants.set(monochrome, createCourseTiles(course, monochrome));
  return variants.get(monochrome);
}

function atlasFor(tiles, resolution) {
  // The cache is deliberately small: detail dialogs can reuse their artwork
  // after closing, without retaining every palette and density indefinitely.
  for (const [key, entry] of atlasCache) {
    if (entry.tiles === tiles && entry.resolution === resolution) {
      atlasCache.delete(key);
      atlasCache.set(key, entry);
      return entry.atlas;
    }
  }
  const entry = { tiles, resolution, atlas: createCourseAtlas(tiles, resolution) };
  atlasCache.set(entry, entry);
  if (atlasCache.size > MAX_ATLASES) atlasCache.delete(atlasCache.keys().next().value);
  return entry.atlas;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches);
    change();
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

export default function CourseCanvas({
  course,
  monochrome = false,
  moving = true,
  enlarged = false,
  size = ART_SIZE,
  className = 'cm-canvas',
  decorative = false,
}) {
  const ref = useRef(null), restartRef = useRef(null);
  const reduced = useReducedMotion();
  const motionRef = useRef(moving && !reduced);
  const logicalSize = enlarged ? 560 : size;
  const resolution = enlarged ? 3 : 2;

  // Motion controls touch only the scheduler, never the atlas or its observer.
  useEffect(() => {
    motionRef.current = moving && !reduced;
    restartRef.current?.();
  }, [moving, reduced]);

  useEffect(() => {
    const canvas = ref.current;
    let ctx, tiles, atlas, animation = null, visible = false, disposed = false;
    let last = null, elapsed = 0;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    const paint = () => {
      // Both geometry work and the large sprite canvas are deferred until this
      // particular mosaic first intersects the viewport in a visible document.
      if (!ctx) {
        canvas.width = Math.round(logicalSize * ratio);
        canvas.height = Math.round(logicalSize * ratio);
        ctx = canvas.getContext('2d');
        if (!ctx) return;
        tiles = tilesFor(course, monochrome);
        atlas = atlasFor(tiles, resolution);
      }
      drawCourse(ctx, tiles, { size: logicalSize, ratio, atlas, time: elapsed, motion: motionRef.current });
    };

    const stop = () => {
      if (animation !== null) cancelAnimationFrame(animation);
      animation = null;
      last = null;
    };
    const frame = time => {
      animation = null;
      if (disposed || !visible || document.hidden) return;
      if (last !== null) elapsed += Math.min(50, time - last);
      last = time;
      paint();
      if (motionRef.current) animation = requestAnimationFrame(frame);
    };
    const restart = () => {
      stop();
      if (disposed || !visible || document.hidden) return;
      if (motionRef.current) animation = requestAnimationFrame(frame);
      else paint();
    };
    restartRef.current = restart;

    let observer;
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting === visible) return;
        visible = entry.isIntersecting;
        restart();
      });
      observer.observe(canvas);
    } else {
      visible = true;
      restart();
    }
    document.addEventListener('visibilitychange', restart);
    return () => {
      disposed = true;
      stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', restart);
      if (restartRef.current === restart) restartRef.current = null;
    };
  }, [course, monochrome, logicalSize, resolution]);

  return <canvas ref={ref} width={logicalSize} height={logicalSize} className={className}
    aria-hidden={decorative ? true : undefined}
    role={decorative ? undefined : 'img'}
    aria-label={decorative ? undefined : `${course.name}: ${course.description}`} />;
}
