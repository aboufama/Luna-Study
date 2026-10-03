// Question identity is deliberately conservative: punctuation inside a question
// may be an operator, grouping, decimal, factorial, ratio, or prime. NFC keeps
// superscripts/subscripts distinct, unlike compatibility normalization (NFKC).
// Ignore only capitalization, whitespace, and the final question terminator.
export function normalizeQuestionIdentity(value) {
  const text = value.normalize('NFC').toLowerCase().trim()
    .replace(/[?？]+$/u, '')
    .replace(/\u2212/gu, '-');
  return (text.match(/[\p{L}\p{M}\p{N}]+|[^\s]/gu) || []).join(' ');
}
