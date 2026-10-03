import test from 'node:test';
import assert from 'node:assert/strict';
import { createTutorOutput } from '../server/tutor-output.mjs';
import { createSpeechTextBuffer } from '../server/speech-stream.mjs';

test('closed say flushes spoken tail before a later board, at every tag split', () => {
  const prefix = '<say>Consider this.</say>';
  for (let split = 0; split <= prefix.length; split++) {
    const writes = [];
    const chunks = createSpeechTextBuffer(text => writes.push(text));
    let ended = 0;
    const output = createTutorOutput({ onText: delta => chunks.push(delta), onSpeechEnd() { ended++; chunks.finish(); } });
    output.push(prefix.slice(0, split));
    if (split < prefix.length) assert.equal(writes.length, 0);
    output.push(prefix.slice(split));
    assert.equal(ended, 1);
    assert.deepEqual(writes, ['Consider this. ']);
    output.push('<board>{"title":"Question","blocks":[{"type":"text","content":"What is two plus two?"}]}</board>');
    const result = output.finish(); chunks.finish();
    assert.equal(writes.length, 1);
    assert.equal(result.board.title, 'Question');
  }
});

test('board tag strings and unmatched closing say never signal spoken completion', () => {
  let ended = 0;
  const output = createTutorOutput({ onSpeechEnd() { ended++; } });
  output.push('</say><board>{"title":"Bad","blocks":[{"type":"text","content":"</say>"}]}</board>');
  output.finish();
  assert.equal(ended, 0);
});
