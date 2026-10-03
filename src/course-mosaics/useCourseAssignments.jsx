import { useEffect, useRef } from 'react';
import { COURSE_MOSAIC_VERSION } from '../../shared/course-mosaic-catalog.mjs';
import { applyCourseAssignment, needsCourseAssignment, requestCourseAssignment, testCourseTitle } from './assignment.mjs';

// Classification stays alongside the normal create/open flow. It neither
// delays voice nor reruns when materials, dates or mastery change.
export default function useCourseAssignments(tests, loaded, setTests) {
  const jobs = useRef(new Map());
  useEffect(() => () => {
    for (const job of jobs.current.values()) job.controller.abort();
    jobs.current.clear();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const current = new Map(tests.map(test => [test.id, test]));
    for (const [id, job] of jobs.current) {
      const test = current.get(id);
      if (!test || testCourseTitle(test) !== job.title || (job.decision && test.courseMosaic === job.decision)) {
        job.controller.abort();
        jobs.current.delete(id);
      }
    }
    for (const test of tests) {
      if (jobs.current.size >= 3) break;
      if (jobs.current.has(test.id) || !needsCourseAssignment(test)) continue;
      const title = testCourseTitle(test), controller = new AbortController();
      const job = { title, controller };
      jobs.current.set(test.id, job);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
      void requestCourseAssignment(test, { signal }).then(decision => {
        if (!controller.signal.aborted && jobs.current.get(test.id) === job) {
          // A pending effect may still see the previous, unassigned test.
          // Hold its slot until an effect observes this committed decision.
          job.decision = decision;
          setTests(previous => applyCourseAssignment(previous, test.id, title, decision));
        }
      }).catch(() => {
        // The request deadline is a saved unavailable result, so a failed
        // provider cannot create a paid request loop on unrelated renders.
        if (!controller.signal.aborted && jobs.current.get(test.id) === job) {
          const decision = {
            courseId: null, source: 'fallback', reason: 'timeout', classifiedTitle: title, version: COURSE_MOSAIC_VERSION, attemptedAt: Date.now(),
          };
          job.decision = decision;
          setTests(previous => applyCourseAssignment(previous, test.id, title, decision));
        }
      });
    }
  }, [tests, loaded, setTests]);
}
