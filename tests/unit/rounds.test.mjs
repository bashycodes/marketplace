import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.mjs';
import { fakeTickTick } from '../helpers/fake-ticktick.mjs';
import { body } from '../helpers/fixtures.mjs';
import { createApi } from '../../plugins/grill-over-ticktick/lib/api.mjs';
import { createLogger } from '../../plugins/grill-over-ticktick/lib/log.mjs';
import { readBlock } from '../../plugins/grill-over-ticktick/lib/state.mjs';
import { parseDesc, classifyItems, OTHER_TITLE, buildDesc, REC_PREFIX } from '../../plugins/grill-over-ticktick/lib/desc.mjs';
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
  bad((r) => { r.round = 0; }, /round/);
  bad((r) => { r.questions = []; }, /questions/);
  bad((r) => { r.questions[0].key = 'q1'; }, /key/);
  bad((r) => { r.questions[1].key = 'r2.1'; }, /duplicate/);
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
  assert.deepEqual(readBlock(tt.find(a.hostId).content), { prose: '📍 e extra', state: { v: 1, owner: b.owner, gen: 2, round: 3 } });
});

test('push: writes host body first, creates questions one at a time with desc/items/tag/parent, logs pushlog', async (t) => {
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
  assert.deepEqual([q1.kind, q1.parentId, q1.projectId, q1.tags, q1.title], ['CHECKLIST', hostId, listId, ['grill'], 'Where does the token live?']);
  assert.deepEqual(q1.items.map((/** @type {any} */ i) => i.title), ['⭐ file', 'env', OTHER_TITLE]);
  assert.equal(q1.desc, buildDesc(ROUND.questions[0]));
  assert.equal(parseDesc(q1.desc).key, 'r2.1');
  assert.equal(readFileSync(join(ctx.pushlogDir, `${listId}.log`), 'utf8'), `creating r2.1\nr2.1 ${q1.id}\ncreating r2.2\nr2.2 ${r.questions[1].taskId}\n`);
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
  assert.deepEqual(r.questions[0].items[0], { title: '⭐ file', ticked: true, isRec: true, isOther: false });
  assert.equal(r.questions[5].taskId, id('r2.6')); assert.equal(r.questions[5].etag, null);
  assert.deepEqual({ owner: r.host.owner, gen: r.host.gen, round: r.host.round }, { owner, gen: 1, round: 2 });
  assert.equal(r.truncated, false);
  assert.ok(r.host.prose.startsWith('📍 e'));
});

test('pull ignores tasks that belong to another host or have no key', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.db.tasks.push({ id: 'tx', projectId: listId, title: 'stray tagged', kind: 'TEXT', status: 0, tags: ['grill'], etag: 'z' });
  tt.db.tasks.push({ id: 'ty', projectId: listId, parentId: 'someone-else', title: 'other host', kind: 'CHECKLIST', status: 0, tags: ['grill'], etag: 'z', desc: buildDesc({ key: 'r9.9', context: 'c', rec: { label: 'a', why: 'w' } }) });
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
  for (const f of [() => pull(ctx), () => close({ ...ctx, owner: 'o', input: {} }), () => finish(ctx)]) {
    await assert.rejects(f(), (/** @type {any} */ e) => e.exitCode === 6 && /not found in folder Claude/.test(e.message));
  }
});

test('close: status-only writes for answered/wontdo/reopen; unknown keys skipped; owner enforced; bad input → 2', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  const before = tt.calls.length;
  const r = await close({ ...ctx, owner, input: { answered: ['r2.1'], wontdo: ['r2.2'], reopen: ['r9.9'] } });
  assert.deepEqual(r, { closed: ['r2.1'], wontdo: ['r2.2'], reopened: [], skipped: ['r9.9'] });
  const writes = tt.calls.slice(before).filter((c) => c.method === 'POST' && c.path !== '/task/filter');
  assert.deepEqual(writes.map((c) => c.body), [{ id: p.questions[0].taskId, projectId: p.listId, status: 2 }, { id: p.questions[1].taskId, projectId: p.listId, status: -1 }]);
  assert.equal(tt.find(p.questions[0].taskId).status, 2);
  assert.equal(tt.find(p.questions[0].taskId).desc, buildDesc(ROUND.questions[0])); // desc untouched
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

test('finish exports prose + decisions and archives the list', async (t) => {
  const { tt, ctx } = setup(t);
  const { owner, listId } = await takeover(ctx);
  const p = await push({ ...ctx, owner, round: structuredClone(ROUND) });
  tt.tick(p.questions[0].taskId, 'env');
  const r = await finish(ctx);
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
  assert.ok(log.endsWith('ingested r2.1\ningested r2.2\n'), log);
  tt.deleteTask(p.questions[1].taskId);
  r = await pull(ctx);
  assert.deepEqual(r.questions.map((q) => [q.key, q.signal, q.ingested]), [['r2.1', 'done', true], ['r2.2', 'missing', true], ['r2.3', 'none', false]]);
});
