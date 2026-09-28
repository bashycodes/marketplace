import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.mjs';
import { createPushlog, defaultStateDir } from '../../plugins/grill-over-ticktick/lib/pushlog.mjs';

test('defaultStateDir honours XDG_STATE_HOME', () => {
  assert.equal(defaultStateDir({}, '/h'), '/h/.local/state/tt-grill');
  assert.equal(defaultStateDir({ XDG_STATE_HOME: '/x' }, '/h'), '/x/tt-grill');
});

test('empty when file missing', async (t) => {
  const log = createPushlog({ dir: join(tmpDir(t), 'nested'), listId: 'L1' });
  assert.deepEqual(await log.load(), new Map());
});

test('creating then created; load distinguishes both; file format exact', async (t) => {
  const dir = tmpDir(t);
  const log = createPushlog({ dir, listId: 'L1' });
  await log.creating('r1.1'); await log.created('r1.1', 'T1'); await log.creating('r1.2');
  assert.equal(readFileSync(join(dir, 'L1.log'), 'utf8'), 'creating r1.1\nr1.1 T1\ncreating r1.2\n');
  assert.deepEqual(await log.load(), new Map([['r1.1', { taskId: 'T1', ingested: false }], ['r1.2', { taskId: null, ingested: false }]]));
});

test('re-open reads the same file; lists are isolated', async (t) => {
  const dir = tmpDir(t);
  await createPushlog({ dir, listId: 'A' }).created('r1.1', 'TA');
  assert.deepEqual(await createPushlog({ dir, listId: 'A' }).load(), new Map([['r1.1', { taskId: 'TA', ingested: false }]]));
  assert.deepEqual(await createPushlog({ dir, listId: 'B' }).load(), new Map());
});

test('load ignores a truncated last line and malformed lines', async (t) => {
  const dir = tmpDir(t);
  writeFileSync(join(dir, 'L1.log'), 'creating r1.1\nr1.1 T1\ngarbage line here\ncreating r1.2\nr1.2 T1', 'utf8');
  const log = createPushlog({ dir, listId: 'L1' });
  assert.deepEqual(await log.load(), new Map([['r1.1', { taskId: 'T1', ingested: false }], ['r1.2', { taskId: null, ingested: false }]]));
});

test('ingested line: exact format, marks the key, survives later lines, keeps taskId', async (t) => {
  const dir = tmpDir(t);
  const log = createPushlog({ dir, listId: 'L1' });
  await log.creating('r1.1'); await log.created('r1.1', 'T1'); await log.ingested('r1.1'); await log.creating('r1.1');
  assert.equal(readFileSync(join(dir, 'L1.log'), 'utf8'), 'creating r1.1\nr1.1 T1\ningested r1.1\ncreating r1.1\n');
  assert.deepEqual(await log.load(), new Map([['r1.1', { taskId: 'T1', ingested: true }]]));
  await assert.rejects(log.ingested('bogus'), (/** @type {any} */ e) => e.exitCode === 1);
});

test('ingested before a created line is kept; ingested of an unknown key is recorded', async (t) => {
  const dir = tmpDir(t);
  writeFileSync(join(dir, 'L1.log'), 'ingested r1.1\nr1.1 T1\ningested r1.2\n', 'utf8');
  assert.deepEqual(await createPushlog({ dir, listId: 'L1' }).load(), new Map([['r1.1', { taskId: 'T1', ingested: true }], ['r1.2', { taskId: null, ingested: true }]]));
});

test('load ignores a truncated ingested line and malformed ingested lines', async (t) => {
  const dir = tmpDir(t);
  writeFileSync(join(dir, 'L1.log'), 'r1.1 T1\ningested x1\ningested r1.1 extra\ningested\nr1.2 T2\ningested r1.2', 'utf8');
  assert.deepEqual(await createPushlog({ dir, listId: 'L1' }).load(), new Map([['r1.1', { taskId: 'T1', ingested: false }], ['r1.2', { taskId: 'T2', ingested: false }]]));
});

test('load rethrows non-ENOENT read errors as a pushlog_read TtError', async () => {
  const fakeFs = /** @type {any} */ ({ mkdir: async () => {}, appendFile: async () => {}, readFile: async () => { throw { code: 'EACCES' }; } });
  const log = createPushlog({ dir: '/irrelevant', listId: 'L1', fs: fakeFs });
  await assert.rejects(log.load(), (/** @type {any} */ err) => {
    assert.equal(err.code, 'pushlog_read');
    assert.equal(err.exitCode, 1);
    return true;
  });
});

test('createPushlog refuses a listId outside the server-id alphabet (no path traversal); created/creating/ingested assert shapes (exit 1)', async (t) => {
  const dir = tmpDir(t);
  for (const listId of ['../../../home/u/.bashrc#', 'a/b', '', 'x'.repeat(65), 'a\nb']) {
    assert.throws(() => createPushlog({ dir, listId }), (/** @type {any} */ e) => e.exitCode === 1 && /bad listId/.test(e.message), listId);
  }
  const log = createPushlog({ dir, listId: 'L1' });
  await assert.rejects(log.created('r1.1', 'abc\ningested r1.2'), (/** @type {any} */ e) => e.exitCode === 1 && /bad taskId/.test(e.message));
  await assert.rejects(log.created('r1.1', 'a b'), (/** @type {any} */ e) => e.exitCode === 1);
  await assert.rejects(log.created('x1', 'T1'), (/** @type {any} */ e) => e.exitCode === 1 && /bad key/.test(e.message));
  await assert.rejects(log.creating('r1.1\ningested r1.2'), (/** @type {any} */ e) => e.exitCode === 1);
  assert.deepEqual(await log.load(), new Map());
});
