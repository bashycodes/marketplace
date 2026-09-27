import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { tmpDir } from '../helpers/tmp.mjs';
import { fakeTickTick } from '../helpers/fake-ticktick.mjs';
import { fakeFetch } from '../helpers/fake-fetch.mjs';
import { fakeClock } from '../helpers/fake-clock.mjs';
import { fixture } from '../helpers/fixtures.mjs';
import { writeToken } from '../../plugins/grill-over-ticktick/lib/token.mjs';
import { main } from '../../plugins/grill-over-ticktick/lib/cli.mjs';

const TOKEN = '0123456789abcdef-deliberately-wrong';
const ROUND = { effort: 'e', round: 1, host: { goal: 'g', decided: [], open: ['r1.1 q — ⭐ a'], notAsked: [] }, questions: [{ key: 'r1.1', title: 'q?', context: 'c', rec: { label: 'a', why: 'w' }, options: ['a', 'b'] }] };

/** @param {import('node:test').TestContext} t @param {{ fetch?: typeof fetch, token?: boolean, env?: Record<string,string> }} [o] */
async function harness(t, o = {}) {
  const home = tmpDir(t); const tt = fakeTickTick(); const clock = fakeClock();
  if (o.token !== false) await writeToken({ home, token: TOKEN });
  // Mutable so a test can force a *different* owner out of a second takeover — newOwner() is a
  // pure function of random(), so a constant random would otherwise make every takeover in a
  // test collide on the same owner string (verified against rounds.mjs's newOwner directly).
  let randomValue = 0.42;
  /** @param {string[]} argv @param {string} [input] */
  const run = async (argv, input) => {
    let out = '', err = '';
    const stdin = /** @type {any} */ (Readable.from(input === undefined ? [] : [input])); stdin.isTTY = false;
    const code = await main(argv, { stdin, stdout: /** @type {any} */ ({ write: (/** @type {string} */ s) => { out += s; return true; } }), stderr: /** @type {any} */ ({ write: (/** @type {string} */ s) => { err += s; return true; } }), env: { XDG_STATE_HOME: home + '/state', ...(o.env ?? {}) }, home, fetch: o.fetch ?? tt.fetch, now: clock.now, sleep: clock.sleep, random: () => randomValue });
    const json = /^[[{]/.test(out.trim()) ? JSON.parse(out) : null; // throws if stdout is not pure JSON (help text is the one non-JSON output)
    return { code, out, err, json, ejson: err.trim() ? JSON.parse(err.trim().split('\n').pop() ?? '') : null };
  };
  return { run, tt, home, clock, setRandom: (/** @type {number} */ v) => { randomValue = v; } };
}

test('usage errors: missing --effort, missing --owner, unknown flag, bad stdin json, tty stdin', async (t) => {
  const { run } = await harness(t);
  let r = await run(['pull']); assert.equal(r.code, 2); assert.equal(r.out, ''); assert.match(r.ejson.message, /--effort is required for pull/);
  r = await run(['push', '--effort', 'e'], '{}'); assert.equal(r.code, 2); assert.match(r.ejson.message, /--owner is required for push/);
  r = await run(['pull', '--effort', 'e', '--bogus']); assert.equal(r.code, 2);
  r = await run(['push', '--effort', 'e', '--owner', 'o'], '{nope'); assert.equal(r.code, 2); assert.match(r.ejson.message, /stdin is not valid JSON/);
  r = await run(['wait', '--effort', 'e', '--owner', 'o', '--every', 'soon']); assert.equal(r.code, 2); assert.match(r.ejson.message, /bad duration/);
  r = await run(['wait', '--effort', 'e', '--owner', 'o', '--every', '0s']); assert.equal(r.code, 2);
});

test('no token → exit 5 pointing at tt-grill auth; nothing on stdout', async (t) => {
  const { run } = await harness(t, { token: false });
  const r = await run(['efforts']);
  assert.equal(r.code, 5); assert.equal(r.out, ''); assert.match(r.ejson.message, /tt-grill auth/);
});

test('cli prints redacted stderr on 401 (exit 5) — token never on stdout/stderr', async (t) => {
  const f = fakeFetch([{ method: 'GET', path: '/project', reply: { status: 401, json: fixture('01_wrong_token_401').response.body } }]);
  const { run } = await harness(t, { fetch: f, env: { TT_GRILL_DEBUG: '1' } });
  const r = await run(['auth', 'status']);
  assert.equal(r.code, 5); assert.equal(r.out, '');
  assert.ok(!r.err.includes(TOKEN)); assert.equal(r.ejson.message, 'token rejected by TickTick (run: tt-grill auth)');
});

test('debug lines with a network error are redacted', async (t) => {
  const f = fakeFetch([{ method: 'GET', path: '/project', reply: new TypeError(`fail ${TOKEN}`) }]);
  const { run } = await harness(t, { fetch: f, env: { TT_GRILL_DEBUG: '1' } });
  const r = await run(['auth', 'status']);
  assert.equal(r.code, 1); assert.ok(r.err.includes('tt-grill: network error')); assert.ok(!r.err.includes(TOKEN));
});

test('auth status ok → {ok, projects}', async (t) => {
  const { run, tt } = await harness(t);
  tt.seedEffort('x');
  const r = await run(['auth', 'status']);
  assert.equal(r.code, 0); assert.deepEqual(r.json, { ok: true, projects: 1 });
});

test('auth without a TTY → exit 2 and no token file written', async (t) => {
  const { run, home } = await harness(t, { token: false });
  const r = await run(['auth']);
  assert.equal(r.code, 2); assert.match(r.ejson.message, /interactive terminal/);
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(`${home}/.config/tt-grill/token`), false);
});

test('full flow: takeover → push → pull → close → finish; pull of unknown effort → 6; owner mismatch → 3', async (t) => {
  const { run, tt } = await harness(t);
  let r = await run(['pull', '--effort', 'e']); assert.equal(r.code, 6);
  r = await run(['efforts']); assert.equal(r.code, 0); assert.deepEqual(r.json, []);
  r = await run(['takeover', '--effort', 'e']); assert.equal(r.code, 0);
  const owner = r.json.owner; assert.match(owner, /^o_/); assert.equal(r.json.gen, 1); assert.equal(r.json.created, true);
  r = await run(['push', '--effort', 'e', '--owner', owner], JSON.stringify(ROUND)); assert.equal(r.code, 0);
  assert.deepEqual(r.json.questions.map((/** @type {any} */ q) => [q.key, q.created]), [['r1.1', true]]);
  const taskId = r.json.questions[0].taskId;
  r = await run(['push', '--effort', 'e', '--owner', 'o_other'], JSON.stringify(ROUND)); assert.equal(r.code, 3); assert.equal(r.ejson.error, 'taken_over');
  tt.tick(taskId, 'b');
  r = await run(['pull', '--effort', 'e']); assert.equal(r.code, 0);
  assert.equal(r.json.questions[0].signal, 'tick'); assert.equal(r.json.host.owner, owner); assert.equal(r.json.truncated, false);
  r = await run(['efforts']); assert.deepEqual(r.json.map((/** @type {any} */ e) => [e.effort, e.open, e.answered]), [['e', 0, 1]]);
  r = await run(['close', '--effort', 'e', '--owner', owner], JSON.stringify({ answered: ['r1.1'] })); assert.equal(r.code, 0); assert.deepEqual(r.json.closed, ['r1.1']);
  r = await run(['finish', '--effort', 'e']); assert.equal(r.code, 0); assert.equal(r.json.archived, true); assert.equal(r.json.decisions[0].ticked[0], 'b');
  r = await run(['pull', '--effort', 'e']); assert.equal(r.code, 6); // archived lists are not efforts any more
});

test('wait: answered → exit 0 reason all; takeover mid-wait → 3; --max → 4', async (t) => {
  const { run, tt, clock, setRandom } = await harness(t);
  let r = await run(['takeover', '--effort', 'e']); const owner = r.json.owner;
  r = await run(['push', '--effort', 'e', '--owner', owner], JSON.stringify(ROUND)); const taskId = r.json.questions[0].taskId;
  tt.tick(taskId, '⭐ a');
  r = await run(['wait', '--effort', 'e', '--owner', owner, '--every', '1s', '--settle', '5s', '--grace', '1s', '--max', '1m']);
  assert.equal(r.code, 0); assert.equal(r.json.reason, 'all'); assert.equal(r.json.questions[0].signal, 'tick');
  assert.deepEqual(clock.sleeps.slice(-2), [1000, 1000]);
  tt.tick(taskId, '⭐ a', false);
  setRandom(0.9); // a different owner than `owner` — newOwner() is a pure function of random()
  r = await run(['takeover', '--effort', 'e']);
  r = await run(['wait', '--effort', 'e', '--owner', owner, '--every', '1s', '--max', '1m']); assert.equal(r.code, 3);
  r = await run(['wait', '--effort', 'e', '--owner', r.ejson.owner, '--every', '1s', '--max', '3s']); assert.equal(r.code, 4);
});

test('wait polls cost one filter + one host GET each', async (t) => {
  const { run, tt } = await harness(t);
  let r = await run(['takeover', '--effort', 'e']); const owner = r.json.owner;
  await run(['push', '--effort', 'e', '--owner', owner], JSON.stringify(ROUND));
  const start = tt.calls.length;
  r = await run(['wait', '--effort', 'e', '--owner', owner, '--every', '1s', '--max', '3s']); assert.equal(r.code, 4);
  const polls = tt.calls.slice(start).filter((c) => c.path === '/task/filter').length;
  const gets = tt.calls.slice(start).filter((c) => c.method === 'GET' && /\/task\//.test(c.path)).length;
  assert.equal(polls, 4); assert.equal(gets, 4); // initial + 3 polls
  assert.equal(tt.calls.slice(start).filter((c) => c.path === '/project/group').length, 1);
});

test('help', async (t) => {
  const { run } = await harness(t, { token: false });
  const r = await run(['--help']); assert.equal(r.code, 0); assert.match(r.out, /takeover/);
});
