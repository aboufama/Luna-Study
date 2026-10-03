import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_MOSAIC_IDS, COURSE_MOSAIC_VERSION } from '../shared/course-mosaic-catalog.mjs';
import { COURSES } from '../src/course-mosaics/courses.mjs';
import { selectedCourseId, needsCourseAssignment, requestCourseAssignment, applyCourseAssignment, RETRY_AFTER_MS } from '../src/course-mosaics/assignment.mjs';

const row = { id: '4bbe0677-b371-4057-89da-3e34469b4bf1', className: 'Math 1920', materials: [{ text: 'Private source material' }], mastery: { overall: 42 } };
const decision = { courseId: 'mathematics', source: 'jev', classifiedTitle: 'Math 1920', version: COURSE_MOSAIC_VERSION, attemptedAt: 1000 };

test('the classifier catalogue and rendered artwork have exactly the same twelve identities', () => {
  assert.deepEqual(COURSES.map(c => c.id).sort(), [...COURSE_MOSAIC_IDS].sort());
  assert.equal(new Set(COURSES.map(c => c.id)).size, 12);
});

test('only a valid saved Jev choice for the current name displays as selected', () => {
  assert.equal(selectedCourseId({ ...row, courseMosaic: decision }), 'mathematics');
  for (const changed of [{ source: 'fallback' }, { courseId: 'invented' }, { classifiedTitle: 'Biology' }, { version: -1 }]) {
    assert.equal(selectedCourseId({ ...row, courseMosaic: { ...decision, ...changed } }), null);
  }
  assert.equal(selectedCourseId({ ...row, className: 'Math    1920 ', courseMosaic: decision }), 'mathematics');
});

test('saved successful choices do not rerun when materials or mastery change', () => {
  assert.equal(needsCourseAssignment({ ...row, courseMosaic: decision, materials: [], mastery: { overall: 92 } }, 999999999), false);
  assert.equal(needsCourseAssignment({ ...row, className: 'Astronomy', courseMosaic: decision }, 1001), true);
  assert.equal(needsCourseAssignment({ ...row, className: '', title: '' }), false);
});

test('fallback uses a bounded cooldown rather than repeated classification on renders', () => {
  const failed = { ...row, courseMosaic: { ...decision, courseId: null, source: 'fallback' } };
  assert.equal(needsCourseAssignment(failed, 1100), false);
  assert.equal(needsCourseAssignment(failed, 1000 + RETRY_AFTER_MS), true);
  assert.equal(needsCourseAssignment({ ...failed, className: 'Physics' }, 1100), true);
});

test('requests send only the normalized title and optional test identity', async () => {
  let received;
  const result = await requestCourseAssignment({ ...row, className: '  Math   1920 ' }, {
    now: () => 999,
    fetchImpl: async (url, options) => { received = { url, body: JSON.parse(options.body) }; return Response.json({ courseId: 'mathematics', source: 'jev', classifiedTitle: 'Math 1920', secret: 'discard' }); },
  });
  assert.deepEqual(received, { url: '/api/course-mosaic', body: { title: 'Math 1920', testId: row.id } });
  assert.deepEqual(result, { ...decision, attemptedAt: 999 });
  let body;
  await requestCourseAssignment({ ...row, id: 'legacy-sample' }, { fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return Response.json({ source: 'fallback' }); } });
  assert.deepEqual(body, { title: 'Math 1920' });
});

test('unexpected or mismatched choices cannot select artwork', async () => {
  for (const payload of [{ courseId: 'other', source: 'jev', classifiedTitle: 'Math 1920' }, { courseId: 'mathematics', source: 'jev', classifiedTitle: 'Different name' }, { courseId: 'mathematics', source: 'fallback', reason: 'raw secret' }]) {
    const result = await requestCourseAssignment(row, { fetchImpl: async () => Response.json(payload) });
    assert.equal(result.courseId, null); assert.equal(result.source, 'fallback'); assert.equal(result.reason, 'unavailable');
  }
});

test('a delayed old-name classification cannot overwrite renamed or removed tests', async () => {
  let finish;
  const pending = requestCourseAssignment(row, { fetchImpl: async () => { await new Promise(resolve => { finish = resolve; }); return Response.json(decision); } });
  const current = [{ ...row, className: 'Astronomy', courseMosaic: { ...decision, courseId: 'astronomy', classifiedTitle: 'Astronomy' } }];
  finish();
  assert.equal(applyCourseAssignment(current, row.id, row.className, await pending), current);
  const deleted = [];
  assert.equal(applyCourseAssignment(deleted, row.id, row.className, decision), deleted);
  const applied = applyCourseAssignment([row], row.id, row.className, decision);
  assert.equal(applied[0].courseMosaic, decision);
  assert.equal(applied[0].materials, row.materials);
  assert.equal(applied[0].mastery, row.mastery);
});
