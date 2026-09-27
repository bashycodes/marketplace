import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXIT, TtError, usage, authError, notFound, takenOver, gaveUp, apiError, toExit, AUTH_MESSAGE } from '../../plugins/grill-over-ticktick/lib/errors.mjs';

test('exit table matches the spec', () => {
  assert.deepEqual(EXIT, { OK: 0, ERROR: 1, USAGE: 2, TAKEN_OVER: 3, GAVE_UP: 4, AUTH: 5, NOT_FOUND: 6 });
});

test('factories set code + exitCode', () => {
  assert.equal(usage('x').exitCode, 2); assert.equal(usage('x').code, 'usage');
  assert.equal(apiError('x').exitCode, 1); assert.equal(apiError('x').code, 'api');
  assert.equal(takenOver('x').exitCode, 3); assert.equal(takenOver('x').code, 'taken_over');
  assert.equal(gaveUp('x').exitCode, 4); assert.equal(gaveUp('x').code, 'gave_up');
  assert.equal(authError().exitCode, 5); assert.equal(authError().message, AUTH_MESSAGE);
  assert.equal(notFound('x').exitCode, 6); assert.equal(notFound('x').code, 'not_found');
  assert.ok(usage('x') instanceof TtError && usage('x') instanceof Error);
});

test('toExit maps TtError with extra, and unknown errors to internal/1, redacting secrets', () => {
  const e = toExit(notFound('no list', { effort: 'e1' }));
  assert.deepEqual(e, { exitCode: 6, json: { error: 'not_found', message: 'no list', effort: 'e1' } });
  const u = toExit(new Error('boom tok123 boom'), ['tok123']);
  assert.deepEqual(u, { exitCode: 1, json: { error: 'internal', message: 'boom [redacted] boom' } });
  assert.equal(toExit('string thrown').json.message, 'string thrown');
});
