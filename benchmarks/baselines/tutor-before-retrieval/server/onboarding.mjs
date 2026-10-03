import { validateMaterials } from './api.mjs';

const TYPES = new Set(['quiz', 'test', 'final']);
const INDEX_STATUSES = new Set(['empty', 'indexing', 'ready', 'error']);
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
function fail(message) { const error = new Error(message); error.status = 400; throw error; }
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
// The session's calendar day and an optional exam deadline are different facts.
// Prefer the browser's validated local day; the server clock is only a fallback.
export function tutorCalendar(input, { now = Date.now } = {}) {
  const today = validDate(input?.localToday)
    ? input.localToday
    : new Date(typeof now === 'function' ? now() : now).toISOString().slice(0, 10);
  return { today, sessionDate: today, examDate: validDate(input?.date) ? input.date : null };
}
function addDays(today, days) { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
export function validateVoiceSetup(body, previous) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Send valid test setup details.');
  const title = body.title === undefined ? previous?.title : body.title;
  if (typeof title !== 'string' || !title.trim() || title.length > 200) fail('Add a class or test name of 1 to 200 characters.');
  const difficulty = body.difficulty === undefined ? previous?.difficulty || 'test' : body.difficulty;
  if (!TYPES.has(difficulty)) fail('Choose quiz, test, or final.');
  const date = body.date === undefined ? previous?.date || '' : body.date;
  if (date !== '' && !validDate(date)) fail('Choose a valid test date in YYYY-MM-DD format, or leave it empty.');
  const localToday = body.localToday === undefined ? previous?.localToday || '' : body.localToday;
  if (localToday !== '' && !validDate(localToday)) fail('Send the current local date in YYYY-MM-DD format.');
  const materials = body.materials === undefined ? previous?.materials || [] : body.materials;
  if (!Array.isArray(materials)) fail('Send the materials as a list.');
  // The guide API deliberately retains its one-material minimum. Only voice
  // setup accepts an empty list, and all nonempty lists use the shared gate.
  const checked = materials.length ? validateMaterials({ title, materials }) : { title: title.trim(), materials: [] };
  const indexStatus = body.indexStatus === undefined ? previous?.indexStatus || (materials.length ? 'indexing' : 'empty') : body.indexStatus;
  if (!INDEX_STATUSES.has(indexStatus)) fail('Indexing status must be empty, indexing, ready, or error.');
  const testId = body.testId === undefined ? previous?.testId : body.testId;
  if (testId !== undefined && (typeof testId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(testId))) fail('Send a valid test ID.');
  const topics = body.topics === undefined ? previous?.topics || [] : body.topics;
  const ids = new Set(checked.materials.map(material => material.id));
  if (!Array.isArray(topics) || topics.length > 12 || topics.some(topic => !topic || typeof topic.title !== 'string' || !topic.title.trim() || topic.title.length > 200 || typeof topic.summary !== 'string' || !topic.summary.trim() || topic.summary.length > 2000 || !Array.isArray(topic.sourceIds) || !topic.sourceIds.length || topic.sourceIds.length > 100 || topic.sourceIds.some(id => !ids.has(id)))) fail('Send valid indexed topics with matching source references.');
  return { ...checked, date, difficulty, localToday, indexStatus, ...(testId ? { testId } : {}), topics: topics.map(({ title, summary, sourceIds }) => ({ title, summary, sourceIds: [...new Set(sourceIds)] })) };
}
export function spokenDate(date) { return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)); }
function description(input) { return /\b(?:quiz|test|final|exam)\b/i.test(input.title) ? input.title : `${input.title} ${input.difficulty}`; }
export function greeting(input, options) {
  return `${input.date ? `I have your ${description(input)} on ${spokenDate(input.date)}. ` : ''}${readinessPrompt(input, options)}`;
}
export function materialAcknowledgment(input, options) {
  const count = input.materials.length;
  if (!count) return `Your material list is empty now. ${readinessPrompt(input, options)}`;
  return `I now have ${count} ${count === 1 ? 'source' : 'sources'} for this test. ${readinessPrompt(input, options)}`;
}
export function setupReply(input, dateResult, options) {
  if (dateResult?.ambiguous) return 'I am not sure which date you mean. Please say the month and day, or how many days away it is.';
  return `${dateResult?.date ? `Got it, ${spokenDate(dateResult.date)}. ` : ''}${readinessPrompt(input, options)}`;
}
export function isStudyReady(input) { return Boolean(input.materials.length && input.indexStatus === 'ready'); }
export function readinessPrompt(input) {
  if (!input.materials.length) return 'Add your notes, readings, or slides so we have material to work with.';
  if (input.indexStatus === 'error') return 'Your sources are saved, but indexing needs a retry in Library. We need that finished before we start studying.';
  if (input.indexStatus !== 'ready') return 'Your sources are still indexing. We can work with them once that finishes.';
  return 'What would you like to work on?';
}

const DEADLINE_SUBJECT = '(?:test|exam|quiz|final(?:\\s+exam)?)(?:\\s+(?:date|deadline))?';
const CALENDAR_VALUE = `(?:today|tomorrow|next|in|${MONTHS.flatMap(month => [month, month.slice(0, 3)]).join('|')}|\\d{1,4})\\b`;
const DEADLINE_VALUE = `(?:(?:on|for|to|now|actually|maybe|possibly|not|around)\\s+)*${CALENDAR_VALUE}`;
const DEADLINE_STATEMENT = new RegExp(`\\b${DEADLINE_SUBJECT}(?:\\s+(?:is|will\\s+be|falls|takes\\s+place|(?:is\\s+)?(?:scheduled|rescheduled)|on)\\s+|\\s*:\\s*)${DEADLINE_VALUE}|\\b(?:scheduled|rescheduled)\\s+(?:(?:my|our|the)\\s+)?${DEADLINE_SUBJECT}\\s+(?:for|to|on)\\s+${DEADLINE_VALUE}`, 'i');

export function isExamDeadlineStatement(text) {
  return typeof text === 'string' && DEADLINE_STATEMENT.test(text);
}

function calendarOnly(text) {
  const value = text.toLowerCase().replace(/[’]/g, "'");
  // Keep explicit deadline statements available to the strict date parser.
  // A loose mention of "final review" does not make today's date a deadline.
  if (isExamDeadlineStatement(value)) return false;
  return /\b(?:today'?s|current|calendar|session)\s+date\b|\bdate\s+(?:is\s+)?today\b|\btoday\s+is\b|\b(?:study|tutoring|this|our)\s+session\b|\b(?:what(?:'s| is)|which)\s+(?:day|date)\b|\bis\s+(?:it|this)\s+today\b/.test(value);
}

function calendarReplyContext(previousAssistant) {
  if (typeof previousAssistant !== 'string') return false;
  // A genuine deadline question can follow a statement of today's date.
  const question = previousAssistant.match(/[^.!?]*\?/g)?.at(-1) || '';
  if (/\b(?:test|exam|quiz|final|deadline)\b/i.test(question) && /\b(?:when|what\s+date|which\s+(?:day|date))\b/i.test(question)) return false;
  return calendarOnly(previousAssistant);
}
// Compatibility helpers only. Live conversation never classifies willingness
// or requires source-completeness consent before an ordinary study session.
function normalizedReply(text) {
  return typeof text === 'string' ? text.toLowerCase().replace(/[’]/g, "'").replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}
export function wantsToStudy(text) {
  const value = normalizedReply(text);
  return /\b(?:quiz|test|question) me\b|\b(?:explain|teach|show|ask|give|help) (?:me |us )?|\b(?:practice|study|start|begin|proceed|continue|move on|go ahead|get started|work on)\b|^(?:(?:okay|ok|yes|yeah|so) )?(?:what|why|how|which|when|where|can you|could you)\b/.test(value);
}
export function completenessReply(text) {
  const value = normalizedReply(text);
  if (!value) return null;
  // Deferral wins over an affirmative prefix or a quoted request to start.
  if (/\b(?:not yet|not ready|hold on|hang on|wait|not everything|not all|still uploading|still adding)\b|\b(?:don't|do not|can't|cannot) (?:start|begin|proceed|study|continue)\b|\b(?:adding|uploading) more\b|\b(?:have|need|add|upload) (?:to add |to upload )?(?:some |a |one )?more (?:material|materials|notes|sources|files|chapters|readings|to add|to upload)\b|\b(?:i|we) (?:have|need)(?: to add| to upload)? more$|\b(?:another|one more) (?:chapter|source|file|document|reading|set of notes)\b|^(?:no|nope|nah)(?:$| (?!more\b|need\b|(?:that's|that is|those are|these are) (?:all|everything|enough)\b))/.test(value)) return 'more';
  if (/^no more(?: (?:material|materials|notes|sources|files))?(?: to add)?$/.test(value)) return 'confirm';
  if (wantsToStudy(value)) return 'confirm';
  if (/^(?:yes|yep|yeah|yup|sure|absolutely|correct|okay|ok|sounds good|i think so|i believe so|that should (?:be|do)|that works)(?:\b|$)/.test(value)) return 'confirm';
  if (/^(?:(?:i'm|i am|we're|we are) )?(?:ready|all set)$|\b(?:that's|that is|those are|these are) (?:all|everything|enough)\b|\b(?:everything|all my materials|all the material|all the notes) (?:is |are |has been |have been )?(?:added|uploaded|here)\b|^(?:enough|all good)$/.test(value)) return 'confirm';
  return null;
}

// Deliberately narrow: ambiguous, negated, multiple, past-without-year, and
// locale-dependent numeric dates require clarification instead of a guess.
export function parseSpokenDate(text, localToday = '', { intentConfirmed = false } = {}) {
  if (typeof text !== 'string' || text.length > 4000) return { date: null, ambiguous: false };
  if (!intentConfirmed && calendarOnly(text)) return { date: null, ambiguous: false };
  const value = text.toLowerCase();
  const candidates = [];
  let mentioned = false, invalid = false;
  for (const match of value.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) { mentioned = true; validDate(match[1]) ? candidates.push(match[1]) : invalid = true; }
  for (const match of value.matchAll(/\b(today|tomorrow)\b/g)) {
    mentioned = true;
    if (validDate(localToday)) candidates.push(addDays(localToday, match[1] === 'today' ? 0 : 1)); else invalid = true;
  }
  for (const match of value.matchAll(/\bin\s+(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(days?|weeks?)\b/g)) {
    mentioned = true;
    const amount = Number(match[1]) || NUMBERS[match[1]], days = amount * (match[2].startsWith('week') ? 7 : 1);
    if (validDate(localToday) && days > 0 && days <= 365) candidates.push(addDays(localToday, days)); else invalid = true;
  }
  for (const match of value.matchAll(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)) {
    mentioned = true;
    if (!validDate(localToday)) { invalid = true; continue; }
    const current = new Date(`${localToday}T12:00:00Z`).getUTCDay();
    candidates.push(addDays(localToday, (WEEKDAYS.indexOf(match[1]) - current + 7) % 7 || 7));
  }
  const monthPattern = MONTHS.map((month) => `${month}|${month.slice(0, 3)}`).join('|');
  const absolute = new RegExp(`\\b(${monthPattern})\\.?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'g');
  for (const match of value.matchAll(absolute)) {
    mentioned = true;
    const month = MONTHS.findIndex((item) => item === match[1] || item.slice(0, 3) === match[1]) + 1;
    const year = match[3] || (validDate(localToday) ? localToday.slice(0, 4) : '');
    const candidate = `${year}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    if (!validDate(candidate) || (!match[3] && candidate < localToday)) invalid = true; else candidates.push(candidate);
  }
  if (/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(value) && !/\b\d{4}-\d{2}-\d{2}\b/.test(value)) { mentioned = true; invalid = true; }
  if (!mentioned && /\b(?:next week|sometime|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(value)) { mentioned = true; invalid = true; }
  const unique = [...new Set(candidates)];
  const uncertain = !intentConfirmed && /\b(?:or|maybe|possibly|between|around|sometime|not|isn't|isn’t)\b/.test(value);
  const ambiguous = mentioned && (invalid || uncertain || unique.length !== 1);
  return { date: !ambiguous && unique.length === 1 ? unique[0] : null, ambiguous };
}

export function isSetupDateReply(text, input, { previousAssistant = '' } = {}) {
  if (typeof text !== 'string' || calendarOnly(text)) return false;
  if (isExamDeadlineStatement(text)) return true;
  // Short replies inherit calendar intent; they do not silently become exam
  // deadlines after the tutor has just discussed today or the session's date.
  if (calendarReplyContext(previousAssistant)) return false;
  if (/\b(?:test|exam|quiz|final)\s+(?:is|will be|on|date)|\b(?:scheduled|rescheduled|date is)\b/i.test(text)) return true;
  // A direct correction such as "no, tomorrow" works after confirmation too.
  // Calendar-only wording excludes incidental facts like "cells divide in two
  // days" or "tomorrow the cells divide" from changing an existing test date.
  const direct = text.toLowerCase().trim().replace(/^(?:(?:no|yes|actually|um|uh)[,\s]+)?(?:(?:it'?s|it is)\s+)?/, '').replace(/[.,?!]/g, '');
  const allowed = new Set([...MONTHS, ...MONTHS.map(month => month.slice(0, 3)), ...WEEKDAYS, ...Object.keys(NUMBERS), 'in', 'on', 'next', 'today', 'tomorrow', 'day', 'days', 'week', 'weeks', 'or', 'maybe', 'possibly', 'between', 'around', 'sometime', 'not', 'the', 'and']);
  const tokens = direct.split(/\s+/);
  return tokens.length <= 12 && tokens.every(token => allowed.has(token) || /^(?:\d{1,4}(?:st|nd|rd|th)?|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)$/.test(token));
}
