import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, statSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.mjs';
import { tokenPath, readToken, writeToken, promptHidden } from '../../plugins/grill-over-ticktick/lib/token.mjs';

test('tokenPath', () => { assert.equal(tokenPath('/h'), '/h/.config/tt-grill/token'); });

test('env wins over file; trimmed', async (t) => {
  const home = tmpDir(t);
  await writeToken({ home, token: 'from-file' });
  assert.equal(await readToken({ env: { TICKTICK_TOKEN: '  from-env\n' }, home }), 'from-env');
  assert.equal(await readToken({ env: { TICKTICK_TOKEN: '   ' }, home }), 'from-file');
  assert.equal(await readToken({ env: {}, home }), 'from-file');
});

test('missing/empty token → auth error exit 5', async (t) => {
  const home = tmpDir(t);
  await assert.rejects(readToken({ env: {}, home }), (/** @type {any} */ e) => e.exitCode === 5 && /tt-grill auth/.test(e.message));
  await writeToken({ home, token: '\n' });
  await assert.rejects(readToken({ env: {}, home }), (/** @type {any} */ e) => e.exitCode === 5);
});

test('writeToken creates 0700 dir and 0600 file, strips newline', async (t) => {
  const home = tmpDir(t);
  const p = await writeToken({ home, token: 'abc\n' });
  assert.equal(p, join(home, '.config', 'tt-grill', 'token'));
  assert.equal(readFileSync(p, 'utf8'), 'abc\n');
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.equal(statSync(join(home, '.config', 'tt-grill')).mode & 0o777, 0o700);
});

test('readToken maps non-ENOENT read errors to token_read exit 1, ENOENT to auth exit 5', async (t) => {
  const home = tmpDir(t);
  const deniedFs = /** @type {any} */ ({
    readFile: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
  });
  await assert.rejects(readToken({ env: {}, home, fs: deniedFs }), (/** @type {any} */ e) => e.exitCode === 1 && e.code === 'token_read');

  const missingFs = /** @type {any} */ ({
    readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
  });
  await assert.rejects(readToken({ env: {}, home, fs: missingFs }), (/** @type {any} */ e) => e.exitCode === 5);
});

test('writeToken tightens a pre-existing looser directory to 0700', async (t) => {
  const home = tmpDir(t);
  mkdirSync(join(home, '.config', 'tt-grill'), { recursive: true });
  chmodSync(join(home, '.config', 'tt-grill'), 0o755);
  await writeToken({ home, token: 'abc' });
  assert.equal(statSync(join(home, '.config', 'tt-grill')).mode & 0o777, 0o700);
});

/** @returns {any} */
function fakeTty() {
  const s = /** @type {any} */ (new EventEmitter());
  s.isTTY = true; s.raw = null;
  s.setRawMode = (/** @type {boolean} */ v) => { s.raw = v; }; s.resume = () => {}; s.pause = () => {}; s.setEncoding = () => {};
  return s;
}

test('promptHidden reads until Enter, handles backspace, echoes nothing, restores raw mode', async () => {
  const stdin = fakeTty();
  /** @type {string[]} */ const out = [];
  const stdout = /** @type {any} */ ({ write: (/** @type {string} */ s) => { out.push(s); return true; } });
  const p = promptHidden(stdin, stdout, 'Token: ');
  stdin.emit('data', 'ab'); stdin.emit('data', '\u007f'); stdin.emit('data', 'c\r');
  assert.equal(await p, 'ac');
  assert.deepEqual(out, ['Token: ', '\n']);
  assert.equal(stdin.raw, false);
});

test('promptHidden refuses without a TTY (usage, exit 2)', async () => {
  const stdin = fakeTty(); stdin.isTTY = false;
  await assert.rejects(promptHidden(stdin, /** @type {any} */ ({ write() { return true; } }), 'x'), (/** @type {any} */ e) => e.exitCode === 2 && /interactive terminal/.test(e.message));
});

test('promptHidden Ctrl-C rejects', async () => {
  const stdin = fakeTty();
  const p = promptHidden(stdin, /** @type {any} */ ({ write() { return true; } }), 'x');
  stdin.emit('data', '\u0003');
  await assert.rejects(p, (/** @type {any} */ e) => e.exitCode === 2);
});

test('promptHidden rejects if stdin ends before Enter', async () => {
  const stdin = fakeTty();
  const p = promptHidden(stdin, /** @type {any} */ ({ write() { return true; } }), 'x');
  stdin.emit('end');
  await assert.rejects(p, (/** @type {any} */ e) => e.exitCode === 2);
  assert.equal(stdin.raw, false);
});

test('promptHidden rejects on stdin error', async () => {
  const stdin = fakeTty();
  const p = promptHidden(stdin, /** @type {any} */ ({ write() { return true; } }), 'x');
  stdin.emit('error', new Error('x'));
  await assert.rejects(p, (/** @type {any} */ e) => e.exitCode === 2);
  assert.equal(stdin.raw, false);
});
