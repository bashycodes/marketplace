import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.deepEqual(await log.load(), new Map([['r1.1', { taskId: 'T1' }], ['r1.2', { taskId: null }]]));
});

test('re-open reads the same file; lists are isolated', async (t) => {
  const dir = tmpDir(t);
  await createPushlog({ dir, listId: 'A' }).created('r1.1', 'TA');
  assert.deepEqual(await createPushlog({ dir, listId: 'A' }).load(), new Map([['r1.1', { taskId: 'TA' }]]));
  assert.deepEqual(await createPushlog({ dir, listId: 'B' }).load(), new Map());
});
