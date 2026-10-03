// Keep media setup in the original click handler. Only the visible state
// change belongs in a transition; reduced-motion users get it immediately.
let currentTransition;
export function transitionStudyView(update, { document: doc = globalThis.document, reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches } = {}) {
  if (!doc?.startViewTransition || reduced) { update(); return null; }
  currentTransition?.skipTransition();
  const transition = doc.startViewTransition(update);
  currentTransition = transition;
  void transition.finished.catch(() => {}).finally(() => { if (currentTransition === transition) currentTransition = null; });
  return transition;
}
