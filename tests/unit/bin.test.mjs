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

test('no args → help on stderr, exit 2, stdout empty', () => {
  const r = run([]);
  assert.equal(r.code, 2);
  assert.equal(r.out, ''); assert.match(r.err, /tt-grill takeover/);
});

test('bin without its lib/ → exit 1 with a clear "install is incomplete" JSON error', async (t) => {
  const { mkdtempSync, mkdirSync, copyFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(join(tmpdir(), 'tt-bin-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin')); copyFileSync(BIN, join(root, 'bin', 'tt-grill'));
  const r = spawnSync(process.execPath, [join(root, 'bin', 'tt-grill'), '--help'], { env: { PATH: process.env.PATH, HOME: '/nonexistent-home' }, encoding: 'utf8' });
  assert.equal(r.status, 1); assert.equal(r.stdout, '');
  assert.deepEqual(JSON.parse(r.stderr), { error: 'internal', message: 'tt-grill install is incomplete (lib/ missing)' });
});

test('Node < 20 → exit 2 with the standard usage JSON, before any module is loaded', () => {
  const fake = 'data:text/javascript,' + encodeURIComponent("Object.defineProperty(process.versions, 'node', { value: '18.19.0' });");
  const r = spawnSync(process.execPath, ['--import', fake, BIN, '--help'], { env: { PATH: process.env.PATH, HOME: '/nonexistent-home' }, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.deepEqual(JSON.parse(r.stderr), { error: 'usage', message: 'tt-grill requires Node >= 20' });
});
