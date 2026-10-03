// Tutor and grading quality can change independently of preparation/rendering.
const configured = value => typeof value === 'string' ? value.trim() : '';

export function backgroundModelFor(env = process.env) {
  return configured(env.LUNA_API_MODEL) || 'gpt-6-luna';
}

export function tutorModelFor(env = process.env) {
  return configured(env.LUNA_TUTOR_MODEL) || backgroundModelFor(env);
}

export function gradingModelFor(env = process.env) {
  return configured(env.LUNA_GRADING_MODEL) || 'gpt-5.6-terra';
}

export function apiModelFor(env = process.env, { mode = 'background' } = {}) {
  return mode === 'voice' ? tutorModelFor(env) : backgroundModelFor(env);
}
