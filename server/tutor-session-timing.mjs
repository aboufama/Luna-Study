// Timers contain no study judgments. Only committed user activity or a real
// speech partial resets presence; silent microphone packets never call activity.
export function createTutorSessionTiming({ now = Date.now, setTimeout: schedule = setTimeout, clearTimeout: cancel = clearTimeout, idleMs = 60_000, checkInMs = 30_000, settleMs = 300, onLead, onCheckIn, onPause } = {}) {
  let timer = null, closed = false, blocked = true, paused = false, playbackUntil = 0;
  let lastActivity = now(), quietSince = now(), checking = false, lead = null;
  const delivered = new Set();
  function clear() { if (timer !== null) cancel(timer); timer = null; }
  function arm() {
    clear();
    if (closed || blocked || paused) return;
    const at = now(), settled = Math.max(quietSince, playbackUntil);
    const target = lead ? settled + settleMs : Math.max(lastActivity, settled) + (checking ? checkInMs : idleMs);
    timer = schedule(tick, Math.max(0, target - at)); timer?.unref?.();
  }
  function tick() {
    timer = null;
    if (closed || blocked || paused) return;
    if (lead) { const key = lead; lead = null; delivered.add(key); onLead?.(key); }
    else if (!checking) { checking = true; quietSince = now(); onCheckIn?.(); }
    else { paused = true; onPause?.(); }
    arm();
  }
  return {
    update(value = {}) {
      const wasBlocked = blocked;
      if (typeof value.blocked === 'boolean') blocked = value.blocked;
      if (typeof value.paused === 'boolean') paused = value.paused;
      if (Number.isFinite(value.playbackUntil)) playbackUntil = value.playbackUntil;
      if (wasBlocked && !blocked) quietSince = now();
      arm();
    },
    activity() { lastActivity = now(); checking = false; arm(); },
    requestLead(key) { if (typeof key === 'string' && !delivered.has(key)) lead = key; arm(); },
    cancelLead({ consumed = false } = {}) { if (consumed && lead) delivered.add(lead); lead = null; arm(); },
    close() { closed = true; clear(); },
  };
}
