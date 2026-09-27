import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeTickTick } from '../helpers/fake-ticktick.mjs';

test('fake: create project/task, filter includes status -1, deleted excluded from filter but GET still 200', async () => {
  const tt = fakeTickTick();
  const call = (/** @type {string} */ m, /** @type {string} */ p, /** @type {unknown} */ b) => tt.fetch(`https://api.ticktick.com/open/v1${p}`, { method: m, body: b === undefined ? undefined : JSON.stringify(b) }).then((r) => /** @type {Promise<any>} */ (r.json()));
  const p = await call('POST', '/project', { name: 'x', viewMode: 'kanban' });
  const t = await call('POST', '/task', { title: 'q', projectId: p.id, kind: 'CHECKLIST', tags: ['grill'], items: [{ title: 'a' }] });
  const e1 = t.etag;
  tt.setStatus(t.id, -1);
  const f = await call('POST', '/task/filter', { projectIds: [p.id], tag: ['grill'] });
  assert.equal(f.length, 1); assert.equal(f[0].status, -1); assert.notEqual(f[0].etag, e1);
  tt.deleteTask(t.id);
  assert.equal((await call('POST', '/task/filter', { projectIds: [p.id], tag: ['grill'] })).length, 0);
  const r = await tt.fetch(`https://api.ticktick.com/open/v1/project/${p.id}/task/${t.id}`);
  assert.equal(r.status, 200);
});
