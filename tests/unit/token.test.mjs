import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, statSync, mkdirSync, chmodSync, writeFileSync, symlinkSync, lstatSync, readdirSync } from 'node:fs';
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

test('writeToken replaces a pre-existing looser token file atomically: new 0600 file, no temp file left', async (t) => {
  const home = tmpDir(t);
  const p = tokenPath(home);
  mkdirSync(join(home, '.config', 'tt-grill'), { recursive: true });
  writeFileSync(p, 'old\n'); chmodSync(p, 0o644);
  const before = statSync(p).ino;
  await writeToken({ home, token: 'new' });
  assert.equal(readFileSync(p, 'utf8'), 'new\n');
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.notEqual(statSync(p).ino, before, 'renamed over, not rewritten in place');
  assert.deepEqual(readdirSync(join(home, '.config', 'tt-grill')), ['token']);
  // a fresh home (no file yet) works too
  const home2 = tmpDir(t);
  await writeToken({ home: home2, token: 'x' });
  assert.equal(statSync(tokenPath(home2)).mode & 0o777, 0o600);
  assert.ok(!readdirSync(join(home2, '.config', 'tt-grill')).some((f) => f.includes('.tmp-')));
});

test('writeToken refuses a symlinked token path (exit 2) and leaves the link target untouched', async (t) => {
  const home = tmpDir(t);
  const p = tokenPath(home);
  mkdirSync(join(home, '.config', 'tt-grill'), { recursive: true });
  const target = join(home, 'elsewhere');
  writeFileSync(target, 'precious\n'); chmodSync(target, 0o644);
  symlinkSync(target, p);
  await assert.rejects(writeToken({ home, token: 'new' }), (/** @type {any} */ e) => e.exitCode === 2 && /symlink/.test(e.message));
  assert.equal(readFileSync(target, 'utf8'), 'precious\n');
  assert.equal(statSync(target).mode & 0o777, 0o644);
  assert.ok(lstatSync(p).isSymbolicLink());
  assert.ok(!readdirSync(join(home, '.config', 'tt-grill')).some((f) => f.includes('.tmp-')));
});

test('writeToken removes its temp file when the rename fails', async (t) => {
  const home = tmpDir(t);
  const fsp = await import('node:fs/promises');
  const failing = /** @type {any} */ ({ ...fsp, rename: async () => { throw Object.assign(new Error('boom'), { code: 'EXDEV' }); } });
  await assert.rejects(writeToken({ home, token: 'x', fs: failing }), /boom/);
  assert.deepEqual(readdirSync(join(home, '.config', 'tt-grill')), []);
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
