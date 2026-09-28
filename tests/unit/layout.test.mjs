import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeTickTick } from '../helpers/fake-ticktick.mjs';
import { createApi } from '../../plugins/grill-over-ticktick/lib/api.mjs';
import { createLogger } from '../../plugins/grill-over-ticktick/lib/log.mjs';
import { readBlock, hostTitle } from '../../plugins/grill-over-ticktick/lib/state.mjs';
import { findLayout, ensureLayout, ensureTag, listEfforts, archiveList, FOLDER, COLUMN, TAG } from '../../plugins/grill-over-ticktick/lib/layout.mjs';

function setup() {
  const tt = fakeTickTick();
  const log = createLogger({ stderr: /** @type {any} */ ({ write() { return true; } }) });
  const api = createApi({ fetch: tt.fetch, token: 'T', log, sleep: async () => {} });
  return { tt, api };
}

test('ensureLayout on an empty account creates folder, kanban list, 📍 column, NOTE host with empty state block', async () => {
  const { tt, api } = setup();
  const L = await ensureLayout(api, 'my effort');
  assert.equal(L.created, true);
  assert.equal(tt.db.groups[0].name, FOLDER);
  assert.deepEqual([tt.db.projects[0].name, tt.db.projects[0].viewMode, tt.db.projects[0].groupId], ['my effort', 'kanban', L.groupId]);
  assert.equal(tt.db.columns[0].name, COLUMN);
  const host = tt.find(L.hostId);
  assert.equal(host.kind, 'NOTE'); assert.equal(host.title, hostTitle('my effort')); assert.equal(host.columnId, L.columnId);
  assert.deepEqual(readBlock(host.content).state, { v: 1, owner: null, gen: 0, round: 0 });
});

test('ensureLayout is idempotent: second call creates nothing and makes no POSTs', async () => {
  const { tt, api } = setup();
  const a = await ensureLayout(api, 'e');
  const before = tt.calls.length;
  const b = await ensureLayout(api, 'e');
  assert.deepEqual({ ...b, created: false }, { ...a, created: false }); assert.equal(b.created, false);
  assert.ok(tt.calls.slice(before).every((c) => c.method === 'GET'));
});

test('ensureLayout reuses an existing Claude folder and ignores archived lists of the same name', async () => {
  const { tt, api } = setup();
  const seeded = tt.seedEffort('e');
  tt.db.projects[0].closed = true;
  const L = await ensureLayout(api, 'e');
  assert.equal(L.groupId, seeded.groupId); assert.notEqual(L.listId, seeded.listId); assert.equal(tt.db.groups.length, 1);
});

test('ensureLayout adds a missing host/column to an existing list', async () => {
  const { tt, api } = setup();
  const s = tt.seedEffort('e');
  tt.db.tasks.length = 0; tt.db.columns.length = 0;
  const L = await ensureLayout(api, 'e');
  assert.equal(L.listId, s.listId); assert.equal(L.created, true); assert.ok(L.hostId); assert.ok(L.columnId);
  assert.equal(tt.find(L.hostId).columnId, L.columnId);
});

test('ensureLayout moves a pre-existing host into the 📍 column', async () => {
  const { tt, api } = setup();
  const s = tt.seedEffort('e');
  tt.db.columns.length = 0;
  const before = tt.calls.length;
  const L = await ensureLayout(api, 'e');
  assert.notEqual(L.columnId, s.columnId);
  assert.equal(tt.find(L.hostId).columnId, L.columnId);
  const taskPosts = tt.calls.slice(before).filter((c) => c.method === 'POST' && c.path === `/task/${s.hostId}`);
  assert.equal(taskPosts.length, 1);
});

test('findLayout is read-only and null when anything is missing', async () => {
  const { tt, api } = setup();
  assert.equal(await findLayout(api, 'e'), null);
  const s = tt.seedEffort('e');
  const L = await findLayout(api, 'e');
  assert.deepEqual(L, { ...s, created: false });
  assert.ok(tt.calls.every((c) => c.method === 'GET'));
  assert.equal(await findLayout(api, 'other'), null);
});

test('ensureLayout round-trips an effort name with spaces, quotes and emoji', async () => {
  const { tt, api } = setup();
  const name = `it's "tricky" 🔥 name`;
  const L = await ensureLayout(api, name);
  assert.equal(tt.db.projects[0].name, name);
  assert.equal(tt.find(L.hostId).title, `📍 ${name}`);
  assert.deepEqual(await findLayout(api, name), { ...L, created: false });
});

test('ensureTag creates grill once', async () => {
  const { tt, api } = setup();
  assert.equal(await ensureTag(api), true); assert.equal(await ensureTag(api), false);
  assert.deepEqual(tt.db.tags.map((t) => t.name), [TAG]);
  assert.deepEqual(tt.calls.filter((c) => c.method === 'POST' && c.path === '/tag').map((c) => c.body), [{ name: TAG, label: TAG }]);
});

test('listEfforts lists only open lists in Claude with a 📍 host; archiveList sets closed', async () => {
  const { tt, api } = setup();
  const a = tt.seedEffort('a'); tt.seedEffort('b'); tt.db.projects.push({ id: 'px', name: 'stray', groupId: a.groupId });
  const c = tt.seedEffort('c'); await archiveList(api, c.listId);
  assert.equal(tt.db.projects.find((p) => p.id === c.listId).closed, true);
  assert.deepEqual((await listEfforts(api)).map((x) => x.effort), ['a', 'b']);
});

test('ensureLayout refuses a non-empty list of the same name that has no 📍 host (exit 2, nothing written); an empty one is adopted', async () => {
  const { tt, api } = setup();
  const s = tt.seedEffort('e');
  tt.db.tasks.length = 0; tt.db.columns.length = 0;
  tt.db.tasks.push({ id: 'mine', projectId: s.listId, title: 'buy milk', kind: 'TEXT', status: 0, tags: [] });
  const before = tt.calls.length;
  await assert.rejects(ensureLayout(api, 'e'), (/** @type {any} */ e) => e.exitCode === 2 && e.message === 'list "e" exists in folder Claude but is not a tt-grill list; rename it or pick another effort');
  assert.ok(tt.calls.slice(before).every((c) => c.method === 'GET'));
  tt.db.tasks.length = 0;
  const L = await ensureLayout(api, 'e');
  assert.equal(L.listId, s.listId); assert.equal(tt.find(L.hostId).title, '📍 e');
});

test('listEfforts skips lists whose name is not a valid effort name', async () => {
  const { tt, api } = setup();
  tt.seedEffort('ok one'); tt.seedEffort('bad"$(x)"');
  /** @type {string[]} */ const lines = [];
  const log = createLogger({ stderr: /** @type {any} */ ({ write: (/** @type {string} */ s) => { lines.push(s); return true; } }), debug: true });
  assert.deepEqual((await listEfforts(api, log)).map((x) => x.effort), ['ok one']);
  assert.ok(lines.some((l) => /skipping list with an invalid effort name/.test(l)));
});
