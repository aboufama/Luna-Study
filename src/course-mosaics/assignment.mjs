import { COURSE_MOSAIC_IDS, COURSE_MOSAIC_VERSION, normalizeCourseTitle } from '../../shared/course-mosaic-catalog.mjs';

const ids = new Set(COURSE_MOSAIC_IDS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RETRY_AFTER_MS = 15 * 60 * 1000;
export const testCourseTitle = test => normalizeCourseTitle(test.className || test.title || '');

export function selectedCourseId(test) {
  const saved = test.courseMosaic;
  return saved?.version === COURSE_MOSAIC_VERSION && saved.classifiedTitle === testCourseTitle(test)
    && saved.source === 'jev' && ids.has(saved.courseId) ? saved.courseId : null;
}

export function needsCourseAssignment(test, now = Date.now()) {
  const title = testCourseTitle(test);
  if (!title || title.length > 100 || selectedCourseId(test)) return false;
  const saved = test.courseMosaic;
  return !saved || saved.classifiedTitle !== title || saved.version !== COURSE_MOSAIC_VERSION
    || !Number.isFinite(saved.attemptedAt) || saved.attemptedAt > now
    || now - saved.attemptedAt >= RETRY_AFTER_MS;
}

/** Names alone leave the browser. Saved material and study state never do. */
export async function requestCourseAssignment(test, { signal, fetchImpl = fetch, now = Date.now } = {}) {
  const title = testCourseTitle(test), body = { title };
  if (UUID.test(test.id)) body.testId = test.id;
  let decision = { courseId: null, source: 'fallback', reason: 'unavailable' };
  try {
    const response = await fetchImpl('/api/course-mosaic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal, body: JSON.stringify(body),
    });
    if (response.ok) {
      const result = await response.json();
      if (result.classifiedTitle === title && result.source === 'jev' && ids.has(result.courseId)) {
        decision = { courseId: result.courseId, source: 'jev' };
      } else if (result.source === 'fallback') {
        decision.reason = ['unavailable', 'timeout', 'invalid-response', 'provider-error', 'missing-key'].includes(result.reason) ? result.reason : 'unavailable';
      }
    }
  } catch (error) { if (signal?.aborted) throw error; }
  return { ...decision, classifiedTitle: title, version: COURSE_MOSAIC_VERSION, attemptedAt: now() };
}

/** A late reply may never overwrite the art for a newly assigned name. */
export function applyCourseAssignment(tests, id, title, decision) {
  if (decision.classifiedTitle !== title) return tests;
  let changed = false;
  const next = tests.map(test => {
    if (test.id !== id || testCourseTitle(test) !== title) return test;
    changed = true;
    return { ...test, courseMosaic: decision };
  });
  return changed ? next : tests;
}
