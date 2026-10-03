// Keep normal speech intact. We close the whole paid session when unattended,
// rather than chopping quiet audio frames out of an active conversation.
export function createVoiceActivityGuard({
  onPause, now = Date.now, idleMs = 120_000, hiddenMs = 30_000,
  schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  let lastActivity = now(), hiddenAt = null, busy = false, timer = null, stopped = false;
  function arm() {
    cancel(timer); timer = null;
    if (stopped || busy) return;
    const idleDeadline = lastActivity + idleMs;
    const hiddenDeadline = hiddenAt === null ? Infinity : Math.max(lastActivity, hiddenAt) + hiddenMs;
    timer = schedule(() => {
      timer = null;
      if (stopped || busy) return;
      const reason = hiddenAt !== null && now() >= Math.max(lastActivity, hiddenAt) + hiddenMs
        ? 'background-idle' : now() >= lastActivity + idleMs ? 'inactive' : null;
      if (!reason) { arm(); return; }
      stop(); onPause(reason);
    }, Math.max(1, Math.min(idleDeadline, hiddenDeadline) - now()));
  }
  function touch() { if (!stopped) { lastActivity = now(); arm(); } }
  function setBusy(value) {
    if (stopped || busy === Boolean(value)) return;
    busy = Boolean(value);
    // Time spent listening to a complete tutor answer is intentional use.
    if (!busy) lastActivity = now();
    arm();
  }
  function setHidden(value) {
    if (stopped) return;
    if (value && hiddenAt === null) hiddenAt = now();
    if (!value && hiddenAt !== null) { hiddenAt = null; lastActivity = now(); }
    arm();
  }
  function stop() { stopped = true; cancel(timer); timer = null; }
  arm();
  return { touch, setBusy, setHidden, stop };
}
