import { normalizeQuestionIdentity } from './question-identity.mjs';

const limit = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
const publicTurn = turn => ['user', 'assistant'].includes(turn?.role) && typeof turn.content === 'string';
const boardTranscript = turn => turn.role === 'assistant' && turn.content.startsWith('Shown on the whiteboard: ');

function publicQuestion(tracked) {
  const question = tracked?.question;
  if (!question || typeof question !== 'object' || typeof question.question !== 'string') return null;
  const result = {};
  for (const key of ['id', 'topicId', 'topicTitle', 'difficulty', 'question']) {
    if (typeof question[key] === 'string') result[key] = question[key];
  }
  result.sourceIds = Array.isArray(question.sourceIds) ? question.sourceIds.filter(id => typeof id === 'string') : [];
  result.attempts = Number.isInteger(tracked.attempts) && tracked.attempts >= 0 ? tracked.attempts : 0;
  result.assisted = tracked.assisted === true;
  return result;
}

// Keep all unique memory evidence. Remove only copies already present at the
// top level; do not use keyword guesses to decide which preference still matters.
function compactSessionMemory(memory) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return null;
  const result = structuredClone(memory);
  if (Array.isArray(result.recentSessions)) for (const session of result.recentSessions) {
    if (Array.isArray(session.notes)) {
      session.notes = session.notes.filter(note => !(result.notes || []).some(other => other?.text === note?.text && other?.sessionId === session.id));
      if (!session.notes.length) delete session.notes;
    }
    if (session.resume?.text === result.resume || session.resume === null) delete session.resume;
  }
  return result;
}

/** A speaking-only projection. The caller keeps original history for grading.
 * Earlier turns are packed verbatim, not semantically summarized or truncated.
 * A recent-window budget is therefore not a cap on the learner's remembered
 * requests. Repeat references point to an earlier zero-based history entry. */
export function buildTutorContext({ conversation = [], activeQuestion, whiteboardContext, sessionMemory } = {}, options = {}) {
  const maxRecentTurns = limit(options.maxRecentTurns, 8, 1, 32);
  const maxRecentChars = limit(options.maxRecentChars, 8000, 1, 32000);
  const history = Array.isArray(conversation) ? conversation : [];
  const entries = history.flatMap((turn, entry) => publicTurn(turn) ? [{ entry, role: turn.role, content: turn.content }] : []);
  let start = entries.length, recentChars = 0;
  while (start > 0 && entries.length - start < maxRecentTurns) {
    const size = entries[start - 1].content.length;
    // Never split the latest message, even when it alone exceeds the budget.
    if (start < entries.length && recentChars + size > maxRecentChars) break;
    recentChars += size; start--;
  }
  const result = {
    conversation: entries.slice(start).map(({ role, content }) => ({ role, content })),
    activeQuestion: publicQuestion(activeQuestion),
  };
  if (start || entries.length !== history.length || recentChars > maxRecentChars) {
    const seen = new Map();
    const earlierTurns = entries.slice(0, start).map(({ entry, role, content }) => {
      const prior = seen.get(content), repeat = prior === undefined ? null : { repeat: prior };
      if (repeat && JSON.stringify(repeat).length < JSON.stringify(content).length) return [entry, role, repeat];
      if (prior === undefined) seen.set(content, entry);
      return [entry, role, content];
    });
    result.conversationMemory = {
      format: 'indexed-verbatim-v1', earlierTurns,
      recentEntryIndexes: entries.slice(start).map(turn => turn.entry), totalEntries: history.length,
      omittedPublicTurns: 0,
      ...(entries.length !== history.length ? { ignoredNonConversationEntries: history.length - entries.length } : {}),
      ...(recentChars > maxRecentChars ? { recentMessageExceedsBudget: true } : {}),
    };
  }
  const latestStudent = entries.findLast(turn => turn.role === 'user');
  const latestTutor = entries.findLast(turn => turn.role === 'assistant' && !boardTranscript(turn));
  const currentProblem = {};
  if (latestStudent) currentProblem.latestStudent = { entry: latestStudent.entry, content: latestStudent.content };
  if (latestTutor) currentProblem.latestTutor = { entry: latestTutor.entry, content: latestTutor.content };
  if (result.activeQuestion) {
    const identity = normalizeQuestionIdentity(result.activeQuestion.question);
    const asked = entries.findLast(turn => turn.role === 'assistant' && !boardTranscript(turn) && (turn.content.match(/[^?？]*[?？]/gu) || []).some(sentence => {
      const normalized = normalizeQuestionIdentity(sentence);
      return normalized === identity || normalized.endsWith(` ${identity}`);
    }));
    if (asked) currentProblem.evidenceEntries = { from: asked.entry, through: entries.at(-1).entry };
  }
  if (whiteboardContext?.board) currentProblem.whiteboard = {
    title: whiteboardContext.board.title,
    visible: whiteboardContext.visible === true,
    ...(typeof whiteboardContext.board.revision === 'string' ? { revision: whiteboardContext.board.revision } : {}),
  };
  if (Object.keys(currentProblem).length) result.currentProblem = currentProblem;
  const memory = compactSessionMemory(sessionMemory);
  if (memory) result.sessionMemory = memory;
  return result;
}
