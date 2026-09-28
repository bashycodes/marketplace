import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFetch, ok } from '../helpers/fake-fetch.mjs';
import { fakeClock } from '../helpers/fake-clock.mjs';
import { fixture, body } from '../helpers/fixtures.mjs';
import { createLogger } from '../../plugins/grill-over-ticktick/lib/log.mjs';
import { createApi, backoffMs, RETRY_STATUSES } from '../../plugins/grill-over-ticktick/lib/api.mjs';

const TOKEN = '0123456789abcdef-deliberately-wrong'; // the exact string the 401 fixture echoes
/** @param {import('../helpers/fake-fetch.mjs').Route[]} routes */
function make(routes) {
  const f = fakeFetch(routes); const clock = fakeClock();
  /** @type {string[]} */ const lines = [];
  const log = createLogger({ stderr: /** @type {any} */ ({ write: (/** @type {string} */ s) => { lines.push(s); return true; } }), secrets: [TOKEN], debug: true });
  const api = createApi({ fetch: f, token: TOKEN, log, sleep: clock.sleep, random: () => 0.5 });
  return { api, f, clock, lines };
}

test('sends bearer + json headers, joins base url, parses json', async () => {
  const { api, f } = make([{ method: 'GET', path: '/project', reply: ok(body('01_get_project')) }]);
  const r = await api.get('/project');
  assert.equal(r[0].name, '👋Welcome');
  assert.equal(f.calls[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(f.calls[0].path, '/project');
});

test('post sends json body; empty body → null', async () => {
  const { api, f } = make([{ method: 'POST', path: /\/complete$/, reply: { status: 200, text: '' } }]);
  assert.equal(await api.post('/project/p/task/t/complete'), null);
  assert.equal(f.calls[0].headers['content-type'], 'application/json');
});

test('401 never leaks the token: exit 5, fixed message, no token in message or log', async () => {
  const fx = fixture('01_wrong_token_401');
  const { api, lines } = make([{ method: 'GET', path: '/project', reply: { status: 401, json: fx.response.body } }]);
  await assert.rejects(api.get('/project'), (/** @type {any} */ e) => {
    assert.equal(e.exitCode, 5);
    assert.equal(e.message, 'token rejected by TickTick (run: tt-grill auth)');
    assert.ok(!JSON.stringify({ m: e.message, x: e.extra }).includes(TOKEN));
    return true;
  });
  assert.ok(!lines.join('').includes(TOKEN));
});

test('404 → not found exit 6 with errorCode', async () => {
  const { api } = make([{ method: 'GET', path: /task/, reply: { status: 404, json: body('05_get_task_wrong_project_inbox') } }]);
  await assert.rejects(api.get('/project/inbox/task/x'), (/** @type {any} */ e) => e.exitCode === 6 && e.extra.errorCode === 'resource_not_found');
});

test('500 with errorCode → exit 1, no retry, errorCode surfaced', async () => {
  const { api, f, clock } = make([{ method: 'POST', path: /task/, reply: { status: 500, json: body('14_content_1MB_probe') } }]);
  await assert.rejects(api.post('/task/x', {}), (/** @type {any} */ e) => e.exitCode === 1 && e.extra.errorCode === 'app_runtime' && /task is too long/.test(e.message));
  assert.equal(f.calls.length, 1); assert.deepEqual(clock.sleeps, []);
});

test('retries 503 then succeeds; backoff 500ms ×2 with ±25% jitter capped at 8s', async () => {
  const { api, f, clock } = make([{ method: 'GET', path: '/project', reply: [{ status: 503, text: 'busy' }, { status: 502, text: '' }, ok([])] }]);
  assert.deepEqual(await api.get('/project'), []);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(clock.sleeps, [500, 1000]); // random()=0.5 → jitter factor 1.0
});

test('gives up after 5 attempts on retryable status → exit 1', async () => {
  const { api, f, clock } = make([{ method: 'GET', path: '/project', reply: { status: 429, text: '' } }]);
  await assert.rejects(api.get('/project'), (/** @type {any} */ e) => e.exitCode === 1 && /gave up after 5 attempts: 429/.test(e.message));
  assert.equal(f.calls.length, 5); assert.deepEqual(clock.sleeps, [500, 1000, 2000, 4000]);
});

test('network errors retry and are redacted', async () => {
  const boom = new TypeError(`fetch failed for ${TOKEN}`);
  const { api, f, lines } = make([{ method: 'GET', path: '/project', reply: [boom, ok([1])] }]);
  assert.deepEqual(await api.get('/project'), [1]);
  assert.equal(f.calls.length, 2);
  assert.ok(lines.length > 0);
  assert.ok(!lines.join('').includes(TOKEN));
  const { api: api2 } = make([{ method: 'GET', path: '/project', reply: boom }]);
  await assert.rejects(api2.get('/project'), (/** @type {any} */ e) => e.exitCode === 1 && !e.message.includes(TOKEN) && /network error after 5 attempts/.test(e.message));
});

test('abort during body read is retried like a network error', async () => {
  /** @type {string[]} */
  const lines = [];
  let n = 0;
  /** @type {any} */
  const flakyFetch = async () => {
    n += 1;
    if (n === 1) {
      return {
        ok: true,
        status: 200,
        text: async () => { throw Object.assign(new Error(`aborted ${TOKEN}`), { name: 'AbortError' }); },
      };
    }
    return new Response('[1]', { status: 200 });
  };
  const clock = fakeClock();
  const log = createLogger({ stderr: /** @type {any} */ ({ write: (/** @type {string} */ s) => { lines.push(s); return true; } }), secrets: [TOKEN], debug: true });
  const api = createApi({ fetch: flakyFetch, token: TOKEN, log, sleep: clock.sleep, random: () => 0.5 });
  assert.deepEqual(await api.get('/project'), [1]);
  assert.equal(n, 2);
  assert.deepEqual(clock.sleeps, [500]);
  assert.ok(!lines.join('').includes(TOKEN));
});

test('malformed 2xx JSON → exit 1 apiError, no retry', async () => {
  const { api, f } = make([{ method: 'GET', path: '/project', reply: { status: 200, text: '{not json' } }]);
  await assert.rejects(api.get('/project'), (/** @type {any} */ e) => e.exitCode === 1 && /invalid JSON/.test(e.message));
  assert.equal(f.calls.length, 1);
});

test('400 is not retried', async () => {
  const { api, f } = make([{ method: 'POST', path: '/task', reply: { status: 400, json: { errorCode: 'bad' } } }]);
  await assert.rejects(api.post('/task', {}), (/** @type {any} */ e) => e.exitCode === 1 && e.extra.status === 400);
  assert.equal(f.calls.length, 1);
});

test('backoffMs table', () => {
  assert.equal(backoffMs(1, () => 0.5), 500);
  assert.equal(backoffMs(4, () => 0.5), 4000);
  assert.equal(backoffMs(6, () => 0.5), 8000);      // cap
  assert.equal(backoffMs(1, () => 0), 375);          // −25 %
  assert.equal(backoffMs(1, () => 1), 625);          // +25 %
  assert.deepEqual([...RETRY_STATUSES].sort(), [429, 502, 503, 504]);
});

test('a body over 2 MiB → exit 1 "response too large", no retry (streamed body, no content-length)', async () => {
  const { MAX_BODY_BYTES } = await import('../../plugins/grill-over-ticktick/lib/api.mjs');
  assert.equal(MAX_BODY_BYTES, 2 * 1024 * 1024);
  const { api, f, clock } = make([{ method: 'GET', path: '/project', reply: { status: 200, text: 'x'.repeat(MAX_BODY_BYTES + 1) } }]);
  await assert.rejects(api.get('/project'), (/** @type {any} */ e) => e.exitCode === 1 && /response too large/.test(e.message));
  assert.equal(f.calls.length, 1); assert.deepEqual(clock.sleeps, []);
  // exactly at the cap is fine
  const { api: api2 } = make([{ method: 'GET', path: '/project', reply: { status: 200, text: JSON.stringify('x'.repeat(MAX_BODY_BYTES - 2)) } }]);
  assert.equal((await api2.get('/project')).length, MAX_BODY_BYTES - 2);
});

test('a declared content-length over 2 MiB is refused before reading; a stream-less response is capped too', async () => {
  const { MAX_BODY_BYTES } = await import('../../plugins/grill-over-ticktick/lib/api.mjs');
  const clock = fakeClock(); const log = createLogger({ stderr: /** @type {any} */ ({ write() { return true; } }) });
  let n = 0;
  /** @type {any} */ const declared = async () => { n++; return new Response('[]', { status: 200, headers: { 'content-length': String(MAX_BODY_BYTES + 1) } }); };
  await assert.rejects(createApi({ fetch: declared, token: TOKEN, log, sleep: clock.sleep }).get('/project'), (/** @type {any} */ e) => e.exitCode === 1 && /response too large/.test(e.message));
  assert.equal(n, 1);
  /** @type {any} */ const noStream = async () => ({ ok: true, status: 200, headers: new Headers(), body: null, text: async () => 'x'.repeat(MAX_BODY_BYTES + 1) });
  await assert.rejects(createApi({ fetch: noStream, token: TOKEN, log, sleep: clock.sleep }).get('/project'), (/** @type {any} */ e) => /response too large/.test(e.message));
});

test('post with retry:false (creates): a 5xx or network error throws on the first attempt; 429 is still retried', async () => {
  const { api, f, clock } = make([{ method: 'POST', path: '/task', reply: [{ status: 503, text: '' }, ok({ id: 't1' })] }]);
  await assert.rejects(api.post('/task', {}, { retry: false }), (/** @type {any} */ e) => e.exitCode === 1 && e.extra.status === 503);
  assert.equal(f.calls.length, 1); assert.deepEqual(clock.sleeps, []);
  const { api: a2, f: f2 } = make([{ method: 'POST', path: '/task', reply: [new TypeError('socket hang up'), ok({ id: 't1' })] }]);
  await assert.rejects(a2.post('/task', {}, { retry: false }), (/** @type {any} */ e) => e.exitCode === 1 && /network error \(not retried: create\)/.test(e.message));
  assert.equal(f2.calls.length, 1);
  const { api: a3, f: f3 } = make([{ method: 'POST', path: '/task', reply: [{ status: 429, text: '' }, ok({ id: 't1' })] }]);
  assert.deepEqual(await a3.post('/task', {}, { retry: false }), { id: 't1' });
  assert.equal(f3.calls.length, 2);
  // default (updates, filter) still retries
  const { api: a4, f: f4 } = make([{ method: 'POST', path: '/task/x', reply: [{ status: 503, text: '' }, ok({ id: 'x' })] }]);
  assert.deepEqual(await a4.post('/task/x', {}), { id: 'x' }); assert.equal(f4.calls.length, 2);
});
