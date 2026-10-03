import test from 'node:test';
import assert from 'node:assert/strict';
import { apiModelFor, backgroundModelFor, tutorModelFor, gradingModelFor } from '../server/model-config.mjs';

test('main tutor override leaves preparation, planning, and rendering on the background model', () => {
  const env = Object.freeze({ LUNA_API_MODEL: 'gpt-6-luna', LUNA_TUTOR_MODEL: 'gpt-5.6-terra' });
  assert.equal(tutorModelFor(env), 'gpt-5.6-terra');
  assert.equal(apiModelFor(env, { mode: 'voice' }), 'gpt-5.6-terra');
  assert.equal(backgroundModelFor(env), 'gpt-6-luna');
  for (const mode of ['background', 'organize', 'grade', 'planner', 'visual', undefined]) {
    assert.equal(apiModelFor(env, { mode }), 'gpt-6-luna');
  }
});

test('grading override is independent of tutor and background defaults',()=>{
  for(const value of [undefined,null,'','   ',42])assert.equal(gradingModelFor({LUNA_GRADING_MODEL:value,LUNA_API_MODEL:'background',LUNA_TUTOR_MODEL:'tutor'}),'gpt-5.6-terra');
  assert.equal(gradingModelFor({LUNA_GRADING_MODEL:' gpt-6-luna '}),'gpt-6-luna');
  const env={LUNA_GRADING_MODEL:'custom-grade',LUNA_API_MODEL:'background',LUNA_TUTOR_MODEL:'tutor'};
  assert.equal(gradingModelFor(env),'custom-grade');assert.equal(backgroundModelFor(env),'background');assert.equal(tutorModelFor(env),'tutor');
});

test('omitted tutor override preserves existing model configuration and default', () => {
  for (const value of [undefined, null, '', '   ', 42]) {
    assert.equal(tutorModelFor({ LUNA_TUTOR_MODEL: value, LUNA_API_MODEL: 'custom-background' }), 'custom-background');
    assert.equal(backgroundModelFor({ LUNA_API_MODEL: value }), 'gpt-6-luna');
  }
  assert.equal(tutorModelFor({}), 'gpt-6-luna');
  assert.equal(apiModelFor({}), 'gpt-6-luna');
  assert.equal(tutorModelFor({ LUNA_TUTOR_MODEL: ' gpt-5.6-terra ' }), 'gpt-5.6-terra');
});
