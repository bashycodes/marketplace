import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
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
  /** @param {string[]} argv @param {string | (string | Buffer)[]} [input] @param {{ isTTY?: boolean }} [runOpts] */
  const run = async (argv, input, runOpts = {}) => {
    let out = '', err = '';
    const items = input === undefined ? [] : Array.isArray(input) ? input : [input];
    const stdin = /** @type {any} */ (Readable.from(items)); stdin.isTTY = runOpts.isTTY ?? false;
    const code = await main(argv, { stdin, stdout: /** @type {any} */ ({ write: (/** @type {string} */ s) => { out += s; return true; } }), stderr: /** @type {any} */ ({ write: (/** @type {string} */ s) => { err += s; return true; } }), env: { XDG_STATE_HOME: home + '/state', ...(o.env ?? {}) }, home, fetch: o.fetch ?? tt.fetch, now: clock.now, sleep: clock.sleep, random: () => randomValue });
    const json = /^[[{]/.test(out.trim()) ? JSON.parse(out) : null; // throws if stdout is not pure JSON (help text is the one non-JSON output)
    return { code, out, err, json, ejson: err.trim() ? JSON.parse(err.trim().split('\n').pop() ?? '') : null };
  };
  return { run, tt, home, clock, setRandom: (/** @type {number} */ v) => { randomValue = v; } };
}

/** A minimal fake TTY stdin for the `auth` prompt: an EventEmitter shaped like promptHidden wants. */
function fakeTtyStdin() {
  const stdin = /** @type {any} */ (new EventEmitter());
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  stdin.setEncoding = () => {};
  return stdin;
}

/**
 * Runs `main(['auth'], …)` against a fake TTY, then feeds it TOKEN + Enter once the prompt's
 * data listener is attached (main runs synchronously up to that `await`, so scheduling the
 * emit on the next tick is safely after the listener is registered).
 * @param {{ home: string, fetch: typeof fetch }} o
 */
async function runPromptedAuth(o) {
  let out = '', err = '';
  const stdin = fakeTtyStdin();
  const p = main(['auth'], { stdin, stdout: /** @type {any} */ ({ write: (/** @type {string} */ s) => { out += s; return true; } }), stderr: /** @type {any} */ ({ write: (/** @type {string} */ s) => { err += s; return true; } }), env: {}, home: o.home, fetch: o.fetch, now: () => 0, sleep: async () => {}, random: () => 0.42 });
  process.nextTick(() => stdin.emit('data', TOKEN + '\r'));
  const code = await p;
  const json = /^[[{]/.test(out.trim()) ? JSON.parse(out) : null;
  // On success, stderr holds only the prompt text (no JSON error line) — only try to parse an
  // error line when the command actually failed.
  const lastLine = err.trim().split('\n').pop() ?? '';
  return { code, out, err, json, ejson: code !== 0 && /^[[{]/.test(lastLine) ? JSON.parse(lastLine) : null };
}

test('usage errors: missing --effort, missing --owner, unknown flag, bad stdin json, tty stdin', async (t) => {
  const { run } = await harness(t);
  let r = await run(['pull']); assert.equal(r.code, 2); assert.equal(r.out, ''); assert.match(r.ejson.message, /--effort is required for pull/);
  r = await run(['push', '--effort', 'e'], '{}'); assert.equal(r.code, 2); assert.match(r.ejson.message, /--owner is required for push/);
  r = await run(['pull', '--effort', 'e', '--bogus']); assert.equal(r.code, 2);
  r = await run(['push', '--effort', 'e', '--owner', 'o_aaaaaa'], '{nope'); assert.equal(r.code, 2); assert.match(r.ejson.message, /stdin is not valid JSON/);
  r = await run(['wait', '--effort', 'e', '--owner', 'o_aaaaaa', '--every', 'soon']); assert.equal(r.code, 2); assert.match(r.ejson.message, /bad duration/);
  r = await run(['wait', '--effort', 'e', '--owner', 'o_aaaaaa', '--every', '0s']); assert.equal(r.code, 2);
});

test('push with a TTY stdin (no piped input) → usage, exit 2', async (t) => {
  const { run } = await harness(t);
  const r = await run(['push', '--effort', 'e', '--owner', 'o_aaaaaa'], undefined, { isTTY: true });
  assert.equal(r.code, 2); assert.equal(r.out, ''); assert.match(r.ejson.message, /push expects JSON on stdin/);
});

test('unexpected positional arguments are rejected before the token is read', async (t) => {
  const { run, home } = await harness(t, { token: false });
  let r = await run(['efforts', 'foo']); assert.equal(r.code, 2); assert.equal(r.out, ''); assert.match(r.ejson.message, /unexpected argument: foo/);
  r = await run(['auth', 'stauts']); assert.equal(r.code, 2); assert.match(r.ejson.message, /unexpected argument: stauts/);
  assert.equal(existsSync(`${home}/.config/tt-grill/token`), false); // no prompt, no write
});

test('unknown command via main() → usage, exit 2', async (t) => {
  const { run } = await harness(t);
  const r = await run(['bogus']);
  assert.equal(r.code, 2); assert.equal(r.out, ''); assert.equal(r.ejson.error, 'usage'); assert.match(r.ejson.message, /unknown command: bogus/);
});

test('readStdin reassembles a multi-byte UTF-8 character split across chunks', async (t) => {
  const { run } = await harness(t);
  let r = await run(['takeover', '--effort', 'e']); const owner = r.json.owner;
  const buf = Buffer.from(JSON.stringify(ROUND), 'utf8');
  const cut = buf.indexOf(Buffer.from('⭐')) + 1; // split inside the 3-byte ⭐ sequence
  r = await run(['push', '--effort', 'e', '--owner', owner], [buf.subarray(0, cut), buf.subarray(cut)]);
  assert.equal(r.code, 0);
  r = await run(['pull', '--effort', 'e']);
  assert.equal(r.code, 0); assert.ok(r.json.host.prose.includes('r1.1 q — ⭐ a'));
});

test('auth prompt: 401 → exit 5, no token file, token never printed', async (t) => {
  const home = tmpDir(t);
  const f = fakeFetch([{ method: 'GET', path: '/project', reply: { status: 401, json: fixture('01_wrong_token_401').response.body } }]);
  const r = await runPromptedAuth({ home, fetch: f });
  assert.equal(r.code, 5); assert.equal(r.out, '');
  assert.ok(!r.out.includes(TOKEN)); assert.ok(!r.err.includes(TOKEN));
  assert.equal(existsSync(`${home}/.config/tt-grill/token`), false);
});

test('auth prompt: success → exit 0, {ok, path}, token file written 0600', async (t) => {
  const home = tmpDir(t);
  const tt = fakeTickTick();
  const r = await runPromptedAuth({ home, fetch: tt.fetch });
  assert.equal(r.code, 0); assert.equal(r.json.ok, true); assert.ok(r.json.path.endsWith('.config/tt-grill/token'));
  assert.equal(readFileSync(r.json.path, 'utf8'), TOKEN + '\n');
  assert.equal(statSync(r.json.path).mode & 0o777, 0o600);
  assert.ok(!r.err.includes(TOKEN));
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
  assert.equal(existsSync(`${home}/.config/tt-grill/token`), false);
});

test('full flow: takeover → push → pull → close → finish; pull of unknown effort → 6; owner mismatch → 3', async (t) => {
  const { run, tt } = await harness(t);
  let r = await run(['pull', '--effort', 'e']); assert.equal(r.code, 6); assert.equal(r.out, '');
  r = await run(['efforts']); assert.equal(r.code, 0); assert.deepEqual(r.json, []);
  r = await run(['takeover', '--effort', 'e']); assert.equal(r.code, 0);
  const owner = r.json.owner; assert.match(owner, /^o_/); assert.equal(r.json.gen, 1); assert.equal(r.json.created, true);
  r = await run(['push', '--effort', 'e', '--owner', owner], JSON.stringify(ROUND)); assert.equal(r.code, 0);
  assert.deepEqual(r.json.questions.map((/** @type {any} */ q) => [q.key, q.created]), [['r1.1', true]]);
  const taskId = r.json.questions[0].taskId;
  r = await run(['push', '--effort', 'e', '--owner', 'o_zzzzzz'], JSON.stringify(ROUND)); assert.equal(r.code, 3); assert.equal(r.out, ''); assert.equal(r.ejson.error, 'taken_over');
  tt.tick(taskId, 'b');
  r = await run(['pull', '--effort', 'e']); assert.equal(r.code, 0);
  assert.equal(r.json.questions[0].signal, 'tick'); assert.equal(r.json.host.owner, owner); assert.equal(r.json.truncated, false);
  r = await run(['efforts']); assert.deepEqual(r.json.map((/** @type {any} */ e) => [e.effort, e.open, e.answered]), [['e', 0, 1]]);
  r = await run(['close', '--effort', 'e', '--owner', owner], JSON.stringify({ answered: ['r1.1'] })); assert.equal(r.code, 0); assert.deepEqual(r.json.closed, ['r1.1']);
  r = await run(['pull', '--effort', 'e']); assert.equal(r.code, 0); assert.equal(r.json.questions[0].ingested, true);
  r = await run(['finish', '--effort', 'e']); assert.equal(r.code, 2); assert.match(r.ejson.message, /--owner is required for finish/);
  r = await run(['finish', '--effort', 'e', '--owner', owner]); assert.equal(r.code, 0); assert.equal(r.json.archived, true); assert.equal(r.json.decisions[0].ticked[0], 'b');
  r = await run(['pull', '--effort', 'e']); assert.equal(r.code, 6); assert.equal(r.out, ''); // archived lists are not efforts any more
});

test('wait: answered → exit 0 reason all; takeover mid-wait → 3; --max → 4', async (t) => {
  const { run, tt, clock, setRandom } = await harness(t);
  let r = await run(['takeover', '--effort', 'e']); const owner = r.json.owner;
  r = await run(['push', '--effort', 'e', '--owner', owner], JSON.stringify(ROUND)); const taskId = r.json.questions[0].taskId;
  tt.tick(taskId, '⭐ a');
  const before = clock.sleeps.length;
  r = await run(['wait', '--effort', 'e', '--owner', owner, '--every', '1s', '--settle', '5s', '--grace', '1s', '--max', '1m']);
  assert.equal(r.code, 0); assert.equal(r.json.reason, 'all'); assert.equal(r.json.questions[0].signal, 'tick');
  assert.deepEqual(clock.sleeps.slice(before), [1000]); // already answered at the first poll → straight to grace
  r = await run(['close', '--effort', 'e', '--owner', owner], JSON.stringify({ answered: ['r1.1'] })); assert.equal(r.code, 0);
  const ROUND2 = { ...ROUND, round: 2, host: { ...ROUND.host, open: ['r2.1 q2 — ⭐ a'] }, questions: [{ ...ROUND.questions[0], key: 'r2.1', title: 'q2?' }] };
  r = await run(['push', '--effort', 'e', '--owner', owner], JSON.stringify(ROUND2)); assert.equal(r.code, 0);
  r = await run(['wait', '--effort', 'e', '--owner', owner, '--every', '1s', '--settle', '1s', '--grace', '1s', '--max', '3s']); assert.equal(r.code, 4); assert.equal(r.out, ''); // r1.1 answered+closed is not a round-2 answer
  assert.deepEqual([r.ejson.answered, r.ejson.total], [0, 1]);
  tt.tick(taskId, '⭐ a', false);
  setRandom(0.9); // a different owner than `owner` — newOwner() is a pure function of random()
  r = await run(['takeover', '--effort', 'e']);
  r = await run(['wait', '--effort', 'e', '--owner', owner, '--every', '1s', '--max', '1m']); assert.equal(r.code, 3); assert.equal(r.out, '');
  r = await run(['wait', '--effort', 'e', '--owner', r.ejson.owner, '--every', '1s', '--max', '3s']); assert.equal(r.code, 4); assert.equal(r.out, '');
});

test('wait polls cost one filter + one /project/{id}/data GET each', async (t) => {
  const { run, tt } = await harness(t);
  let r = await run(['takeover', '--effort', 'e']); const owner = r.json.owner;
  await run(['push', '--effort', 'e', '--owner', owner], JSON.stringify(ROUND));
  const start = tt.calls.length;
  r = await run(['wait', '--effort', 'e', '--owner', owner, '--every', '1s', '--max', '3s']); assert.equal(r.code, 4); assert.equal(r.out, '');
  const polls = tt.calls.slice(start).filter((c) => c.path === '/task/filter').length;
  const data = tt.calls.slice(start).filter((c) => c.method === 'GET' && /^\/project\/[^/]+\/data$/.test(c.path)).length;
  assert.equal(polls, 4); assert.equal(data, 1 + 4); // 1 layout resolve + initial + 3 polls
  assert.ok(!tt.calls.slice(start).some((c) => c.method === 'GET' && /\/task\//.test(c.path)));
  assert.equal(tt.calls.slice(start).filter((c) => c.path === '/project/group').length, 1);
});

test('wait: host deleted mid-wait → exit 6', async (t) => {
  const tt = fakeTickTick();
  let n = 0; let hostId = '';
  // delete the host just before the second poll's /data read (1st /data = layout resolve, 2nd = initial pull)
  const f = /** @type {typeof fetch} */ (async (url, init) => { if (/\/project\/[^/]+\/data$/.test(new URL(String(url)).pathname) && hostId && ++n === 3) tt.deleteTask(hostId); return tt.fetch(url, init); });
  const { run } = await harness(t, { fetch: f });
  let r = await run(['takeover', '--effort', 'e']); const owner = r.json.owner;
  r = await run(['push', '--effort', 'e', '--owner', owner], JSON.stringify(ROUND)); assert.equal(r.code, 0);
  hostId = r.json.hostId;
  r = await run(['wait', '--effort', 'e', '--owner', owner, '--every', '1s', '--max', '1m']);
  assert.equal(r.code, 6); assert.equal(r.out, ''); assert.match(r.ejson.message, /host "📍 e" is gone from TickTick/);
  assert.equal(n, 3);
});

test('help', async (t) => {
  const { run } = await harness(t, { token: false });
  const r = await run(['--help']); assert.equal(r.code, 0); assert.match(r.out, /takeover/);
});

test('every --effort is checked against the effort-name rule before the token is read (exit 2)', async (t) => {
  const { run, home } = await harness(t, { token: false });
  for (const argv of [['takeover'], ['pull'], ['finish', '--owner', 'o'], ['close', '--owner', 'o'], ['push', '--owner', 'o'], ['wait', '--owner', 'o']]) {
    const r = await run([...argv, '--effort', '$(touch pwned)'], '{}');
    assert.equal(r.code, 2, argv.join(' ')); assert.equal(r.out, ''); assert.match(r.ejson.message, /effort name must match/);
  }
  assert.equal(existsSync(`${home}/.config/tt-grill/token`), false);
});

test('--owner must match ^o_[a-z2-7]{6}$ (exit 2, before the token is read)', async (t) => {
  const { run } = await harness(t, { token: false });
  for (const bad of ['o', 'o_other', 'o_ABCDEF', 'o_abcde1', 'o_abcdefg', 'x_abcdef', 'o_abc"ef']) {
    for (const cmd of ['push', 'close', 'wait', 'finish']) {
      const r = await run([cmd, '--effort', 'e', '--owner', bad], '{}');
      assert.equal(r.code, 2, `${cmd} ${bad}`); assert.equal(r.out, ''); assert.match(r.ejson.message, /--owner must match \^o_\[a-z2-7\]\{6\}\$/);
    }
  }
});

test('<cmd> --help / -h prints help (exit 0); no args → help on stderr, exit 2, stdout empty', async (t) => {
  const { run } = await harness(t, { token: false });
  for (const argv of [['push', '--help'], ['wait', '-h'], ['pull', '--effort', 'e', '--help']]) {
    const r = await run(argv); assert.equal(r.code, 0, argv.join(' ')); assert.match(r.out, /tt-grill wait --effort E/);
  }
  let out = '', err = '';
  const code = await main([], { stdout: /** @type {any} */ ({ write: (/** @type {string} */ s) => { out += s; return true; } }), stderr: /** @type {any} */ ({ write: (/** @type {string} */ s) => { err += s; return true; } }), env: {}, home: '/nonexistent' });
  assert.equal(code, 2); assert.equal(out, ''); assert.match(err, /tt-grill takeover --effort E/);
});

test('stdin JSON with a leading UTF-8 BOM is accepted', async (t) => {
  const { run } = await harness(t);
  let r = await run(['takeover', '--effort', 'e']); const owner = r.json.owner;
  r = await run(['push', '--effort', 'e', '--owner', owner], ['\uFEFF' + JSON.stringify(ROUND)]); assert.equal(r.code, 0, r.err);
  r = await run(['close', '--effort', 'e', '--owner', owner], [Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')]); assert.equal(r.code, 0, r.err);
});
