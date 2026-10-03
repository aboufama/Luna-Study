import { createHash } from 'node:crypto';

// Short-lived and server-local: this suppresses duplicate audio, never setup
// validation or source-readiness checks. Keep hashes, not uploaded source text.
export function createSessionUsage({ now = Date.now, greetingWindowMs = 5 * 60_000, maxTests = 128 } = {}) {
  const spoken = new Map();
  function fingerprint(input) {
    if (!input?.testId) return null;
    return createHash('sha256').update(JSON.stringify([
      input.title, input.date, input.difficulty, input.indexStatus,
      input.materials.map(({ id, name, text }) => [id, name, text]),
    ])).digest('hex');
  }
  function prune() {
    const cutoff = now() - greetingWindowMs;
    for (const [id, entry] of spoken) if (entry.at <= cutoff) spoken.delete(id);
    while (spoken.size > maxTests) spoken.delete(spoken.keys().next().value);
  }
  return {
    needsGreeting(input) {
      prune();
      const signature = fingerprint(input), previous = spoken.get(input?.testId);
      return !signature || !previous || previous.signature !== signature;
    },
    markGreetingAudio(input) {
      const signature = fingerprint(input);
      if (!signature) return;
      spoken.delete(input.testId);
      spoken.set(input.testId, { signature, at: now() });
      prune();
    },
    clear() { spoken.clear(); },
  };
}
