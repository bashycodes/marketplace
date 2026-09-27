import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const BIN = join(here, '..', '..', 'plugins', 'grill-over-ticktick', 'bin', 'tt-grill');

/** @param {string[]} args @param {{input?: string, env?: Record<string,string>}} [opts] */
export function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    input: opts.input ?? '',
    env: { PATH: process.env.PATH, HOME: opts.env?.HOME ?? '/nonexistent-home', ...opts.env },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('unknown command → exit 2 with usage JSON on stderr, nothing on stdout', () => {
  const r = run(['bogus']);
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
  const e = JSON.parse(r.err);
  assert.equal(e.error, 'usage');
  assert.match(e.message, /unknown command/);
});

test('--help → exit 0 and lists every command', () => {
  const r = run(['--help']);
  assert.equal(r.code, 0);
  for (const c of ['auth', 'efforts', 'push', 'pull', 'close', 'takeover', 'wait', 'finish']) assert.match(r.out, new RegExp(`\\b${c}\\b`));
});

test('no args → same as --help but exit 2', () => {
  const r = run([]);
  assert.equal(r.code, 2);
});
