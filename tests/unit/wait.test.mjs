import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock } from '../helpers/fake-clock.mjs';
import { createLogger } from '../../plugins/grill-over-ticktick/lib/log.mjs';
import { parseDuration, fingerprint, wait, DEFAULTS } from '../../plugins/grill-over-ticktick/lib/wait.mjs';

const M = 60_000, S = 1000;
const log = createLogger({ stderr: /** @type {any} */ ({ write() { return true; } }) });
/** @param {[string, string | null, string][]} qs [key, etag, signal] @param {string} [owner] @returns {any} */
const R = (qs, owner = 'o_a') => ({ host: { id: 'h', etag: 'he', owner, gen: 1, round: 1, body: '', prose: '' }, questions: qs.map(([key, etag, signal]) => ({ key, taskId: key, etag, status: 0, title: null, items: [], desc: null, descChanged: false, answerText: null, signal })), truncated: false });
/** @param {any[]} seq */
function scripted(seq) { let i = 0; return { pull: async () => seq[Math.min(i++, seq.length - 1)], calls: () => i }; }
/** @param {any[]} seq @param {Partial<Parameters<typeof wait>[0]>} [over] */
function run(seq, over = {}) {
  const clock = fakeClock(); const s = scripted(seq);
  const p = wait({ pull: s.pull, owner: 'o_a', every: 3 * M, settle: 10 * M, grace: 90 * S, max: 24 * 60 * M, now: clock.now, sleep: clock.sleep, log, ...over });
  return { p, clock, s };
}

test('parseDuration + defaults', () => {
  assert.equal(parseDuration('90s'), 90 * S); assert.equal(parseDuration('3m'), 3 * M); assert.equal(parseDuration('24h'), 24 * 60 * M); assert.equal(parseDuration('250ms'), 250);
  assert.throws(() => parseDuration('3 m'), (/** @type {any} */ e) => e.exitCode === 2);
  assert.throws(() => parseDuration('soon'), (/** @type {any} */ e) => e.exitCode === 2);
  assert.deepEqual(DEFAULTS, { every: '3m', settle: '10m', grace: '90s', max: '24h' });
});

test('fingerprint uses key + etag, includes missing as -', () => {
  assert.equal(fingerprint(R([['r1.1', 'a', 'none'], ['r1.2', null, 'missing']])), 'r1.1=a,r1.2=-');
});

test('all answered → grace re-pull confirms → reason all', async () => {
  const open = R([['r1.1', 'a', 'none'], ['r1.2', 'b', 'none']]);
  const done = R([['r1.1', 'a2', 'tick'], ['r1.2', 'b2', 'text']]);
  const { p, clock } = run([open, done, done]);
  const r = await p;
  assert.equal(r.reason, 'all'); assert.equal(r.questions[1].signal, 'text');
  assert.deepEqual(clock.sleeps, [3 * M, 90 * S]);
});

test('all answered but a change during grace → keep waiting, then all', async () => {
  const open = R([['r1.1', 'a', 'none']]);
  const d1 = R([['r1.1', 'a2', 'tick']]); const d2 = R([['r1.1', 'a3', 'tick+text']]);
  const { p, clock } = run([open, d1, d2, d2, d2]);
  assert.equal((await p).reason, 'all');
  assert.deepEqual(clock.sleeps, [3 * M, 90 * S, 3 * M, 90 * S]);
});

test('done/wontdo/missing count as final for the all rule', async () => {
  const open = R([['r1.1', 'a', 'none'], ['r1.2', 'b', 'none'], ['r1.3', 'c', 'none']]);
  const fin = R([['r1.1', 'a2', 'done'], ['r1.2', 'b2', 'wontdo'], ['r1.3', null, 'missing']]);
  const { p } = run([open, fin, fin]);
  assert.equal((await p).reason, 'all');
});

test('partial answer → settled after 10 min without change', async () => {
  const open = R([['r1.1', 'a', 'none'], ['r1.2', 'b', 'none']]);
  const part = R([['r1.1', 'a2', 'tick'], ['r1.2', 'b', 'none']]);
  const { p, clock } = run([open, part]);
  const r = await p;
  assert.equal(r.reason, 'settled');
  // change seen at 3m; polls at 6, 9, 12 (9m since change), 15 (12m ≥ 10m) → settled
  assert.deepEqual(clock.sleeps, [3 * M, 3 * M, 3 * M, 3 * M, 3 * M]);
});

test('other-only starts the settle timer but never satisfies all', async () => {
  const open = R([['r1.1', 'a', 'none']]);
  const oth = R([['r1.1', 'a2', 'other-only']]);
  const { p, clock } = run([open, oth]);
  assert.equal((await p).reason, 'settled');
  assert.ok(!clock.sleeps.includes(90 * S));
});

test('owner change → taken over (3), immediately', async () => {
  const mine = R([['r1.1', 'a', 'none']]); const theirs = R([['r1.1', 'a', 'none']], 'o_b');
  const { p, clock } = run([mine, theirs]);
  await assert.rejects(p, (/** @type {any} */ e) => e.exitCode === 3);
  assert.deepEqual(clock.sleeps, [3 * M]);
  await assert.rejects(run([theirs]).p, (/** @type {any} */ e) => e.exitCode === 3);
});

test('max reached → gave up (4); zero questions never count as all', async () => {
  const { p } = run([R([['r1.1', 'a', 'none']])], { max: 10 * M });
  await assert.rejects(p, (/** @type {any} */ e) => e.exitCode === 4);
  const { p: p2 } = run([R([])], { max: 10 * M });
  await assert.rejects(p2, (/** @type {any} */ e) => e.exitCode === 4);
});

test('pull errors propagate (e.g. not found)', async () => {
  const { notFound } = await import('../../plugins/grill-over-ticktick/lib/errors.mjs');
  await assert.rejects(wait({ pull: async () => { throw notFound('gone'); }, owner: 'o_a', every: 1, settle: 1, grace: 1, max: 10, now: () => 0, sleep: async () => {}, log }), (/** @type {any} */ e) => e.exitCode === 6);
});
