import test from 'node:test';
import assert from 'node:assert/strict';
import { openaiErrorMessage } from '../openai-errors.mjs';

test('deactivated API account points to the actual credential source, separately from OAuth', () => {
  const error = { code: 'account_deactivated' };
  assert.match(openaiErrorMessage(error), /server’s OPENAI_API_KEY.*deactivated/);
  const temporary = openaiErrorMessage(error, { source: 'connection' });
  assert.match(temporary, /API key added in Connections/);
  assert.match(temporary, /separately from your Codex OAuth login/);
});
test('configuration errors and model permissions are distinguishable from authentication', () => {
  assert.match(openaiErrorMessage({ code: 'unknown_parameter', param: 'session.audio.input.format' }), /session.audio.input.format/);
  assert.match(openaiErrorMessage({ code: 'model_not_found' }), /project’s model access/);
  assert.match(openaiErrorMessage({}, { status: 401 }), /authenticate/);
});
test('raw provider messages, arbitrary parameters and unknown codes cannot leak credentials', () => {
  const secret = 'sk-private-do-not-expose';
  for (const error of [{ code: secret, message: secret }, { code: 'invalid_value', param: secret, message: secret }, { code: 'account_deactivated', message: secret }]) {
    assert.ok(!openaiErrorMessage(error).includes(secret));
  }
});
