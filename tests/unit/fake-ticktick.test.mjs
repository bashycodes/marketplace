import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeTickTick } from '../helpers/fake-ticktick.mjs';
import { body, fixture } from '../helpers/fixtures.mjs';

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

test('fidelity vs recorded fixtures: /data is undone-only, tags lowercased, create-child response has no parentId', async () => {
  const tt = fakeTickTick();
  const call = (/** @type {string} */ m, /** @type {string} */ p, /** @type {unknown} */ b) => tt.fetch(`https://api.ticktick.com/open/v1${p}`, { method: m, body: b === undefined ? undefined : JSON.stringify(b) }).then((r) => /** @type {Promise<any>} */ (r.json()));
  // (a) the real /data lists only status-0 tasks while the filter lists every status
  assert.ok(body('11_project_data_mixed_states').tasks.every((/** @type {any} */ t) => t.status === 0));
  assert.deepEqual([...new Set(body('11_filter_no_status').map((/** @type {any} */ t) => t.status))].sort(), [-1, 0, 2]);
  const p = await call('POST', '/project', { name: 'x' });
  const ids = [];
  for (const st of [0, 2, -1]) { const t = await call('POST', '/task', { title: `s${st}`, projectId: p.id }); if (st) tt.setStatus(t.id, st); ids.push(t.id); }
  assert.deepEqual((await call('GET', `/project/${p.id}/data`)).tasks.map((/** @type {any} */ t) => t.status), [0]);
  assert.deepEqual((await call('POST', '/task/filter', { projectIds: [p.id] })).map((/** @type {any} */ t) => t.status).sort(), [-1, 0, 2]);
  // (b) tags are lowercased on create
  const fx = fixture('15_create_task_mixedcase_tag');
  assert.deepEqual(fx.response.body.tags, fx.request.body.tags.map((/** @type {string} */ g) => g.toLowerCase()));
  const tagged = await call('POST', '/task', { title: 't', projectId: p.id, tags: fx.request.body.tags });
  assert.deepEqual(tagged.tags, fx.response.body.tags);
  // (c) the create response of a child omits parentId; the filter/GET carry it
  const real = fixture('05_create_child_checklist');
  const child = await call('POST', '/task', { ...real.request.body, projectId: p.id, parentId: ids[0] });
  /** fields the code reads from a task */
  const READ = ['id', 'etag', 'status', 'title', 'items', 'desc', 'parentId', 'kind'];
  assert.deepEqual(READ.filter((k) => k in child), READ.filter((k) => k in real.response.body));
  assert.deepEqual(Object.keys(child.items[0]).filter((k) => ['id', 'status', 'title'].includes(k)).sort(), Object.keys(real.response.body.items[0]).filter((k) => ['id', 'status', 'title'].includes(k)).sort());
  const f = await call('POST', '/task/filter', { projectIds: [p.id] });
  assert.equal(f.find((/** @type {any} */ t) => t.id === child.id).parentId, ids[0]);
  assert.ok(body('11_filter_no_status').some((/** @type {any} */ t) => t.parentId));
});
