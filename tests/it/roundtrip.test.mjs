import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { homedir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../plugins/grill-over-ticktick/lib/cli.mjs';
import { readToken } from '../../plugins/grill-over-ticktick/lib/token.mjs';
import { createApi } from '../../plugins/grill-over-ticktick/lib/api.mjs';
import { createLogger } from '../../plugins/grill-over-ticktick/lib/log.mjs';

const enabled = process.env.TT_GRILL_IT === '1';

test('live round trip against a throwaway effort', { skip: enabled ? false : 'set TT_GRILL_IT=1 (token via file or TICKTICK_TOKEN)', timeout: 120_000 }, async () => {
  const home = homedir();
  const state = mkdtempSync(join(tmpdir(), 'tt-grill-it-'));
  const effort = `it-${Date.now().toString(36)}`;
  /** @param {string[]} argv @param {string} [input] */
  const run = async (argv, input) => {
    let out = '', err = '';
    const stdin = /** @type {any} */ (Readable.from(input === undefined ? [] : [input])); stdin.isTTY = false;
    const code = await main(argv, { stdin, stdout: /** @type {any} */ ({ write: (/** @type {string} */ s) => { out += s; return true; } }), stderr: /** @type {any} */ ({ write: (/** @type {string} */ s) => { err += s; return true; } }), env: { ...process.env, XDG_STATE_HOME: state }, home });
    return { code, json: out.trim() ? JSON.parse(out) : null, err };
  };
  const token = await readToken({ env: process.env, home });
  const api = createApi({ fetch, token, log: createLogger({ stderr: process.stderr, secrets: [token] }) });
  /** @type {string | null} */ let listId = null;
  try {
    let r = await run(['takeover', '--effort', effort]); assert.equal(r.code, 0, r.err);
    const owner = r.json.owner; listId = r.json.listId;
    const round = { effort, round: 1, host: { goal: 'IT', decided: [], open: ['r1.1 ok? — ⭐ yes'], notAsked: [] }, questions: [{ key: 'r1.1', title: 'Integration test: ok?', context: 'auto', rec: { label: 'yes', why: 'it' }, options: ['yes', 'no'] }] };
    r = await run(['push', '--effort', effort, '--owner', owner], JSON.stringify(round)); assert.equal(r.code, 0, r.err);
    const taskId = r.json.questions[0].taskId;
    // tick "no" through the API like the phone would (items is a full replace)
    const task = await api.get(`/project/${listId}/task/${taskId}`);
    const items = task.items.map((/** @type {any} */ it) => ({ ...it, status: it.title === 'no' ? 1 : it.status }));
    await api.post(`/task/${taskId}`, { id: taskId, projectId: listId, items });
    r = await run(['wait', '--effort', effort, '--owner', owner, '--every', '2s', '--settle', '20s', '--grace', '2s', '--max', '90s']);
    assert.equal(r.code, 0, r.err); assert.equal(r.json.reason, 'all'); assert.equal(r.json.questions[0].signal, 'tick');
    assert.equal(r.json.questions[0].descChanged, false, 'server re-serialisation must not look like an edit');
    r = await run(['close', '--effort', effort, '--owner', owner], JSON.stringify({ answered: ['r1.1'] })); assert.equal(r.code, 0, r.err);
    r = await run(['finish', '--effort', effort]); assert.equal(r.code, 0, r.err); assert.equal(r.json.archived, true);
    assert.deepEqual(r.json.decisions[0].ticked, ['no']);
  } finally {
    if (listId) await api.del(`/project/${listId}`).catch(() => {});
  }
});
