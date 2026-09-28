import * as nodeFs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { authError, usage, NO_TOKEN_MESSAGE, TtError, EXIT } from './errors.mjs';

/** @typedef {Pick<typeof nodeFs, 'mkdir' | 'writeFile' | 'readFile' | 'chmod' | 'lstat' | 'rename' | 'unlink'>} TokenFs */

/** @param {string} home @returns {string} */
export function tokenPath(home) { return join(home, '.config', 'tt-grill', 'token'); }

/**
 * @param {{ env: NodeJS.ProcessEnv | Record<string, string | undefined>, home: string, fs?: TokenFs }} opts
 * @returns {Promise<string>}
 */
export async function readToken({ env, home, fs = nodeFs }) {
  const fromEnv = (env.TICKTICK_TOKEN ?? '').trim();
  if (fromEnv) return fromEnv;
  let raw = '';
  try {
    raw = await fs.readFile(tokenPath(home), 'utf8');
  } catch (/** @type {any} */ err) {
    if (err && err.code === 'ENOENT') { raw = ''; }
    else throw new TtError('token_read', `cannot read ${tokenPath(home)}: ${err.code ?? err.message}`, EXIT.ERROR);
  }
  const tok = raw.trim();
  if (!tok) throw authError(NO_TOKEN_MESSAGE);
  return tok;
}

/**
 * @param {{ home: string, token: string, fs?: TokenFs }} opts
 * @returns {Promise<string>} the path written
 */
export async function writeToken({ home, token, fs = nodeFs }) {
  const p = tokenPath(home);
  await fs.mkdir(dirname(p), { recursive: true, mode: 0o700 });
  await fs.chmod(dirname(p), 0o700);
  // Never write through a symlink: the token would land in (and chmod) the link's target.
  try {
    if ((await fs.lstat(p)).isSymbolicLink()) throw usage(`refusing to write the token: ${p} is a symlink`);
  } catch (/** @type {any} */ err) { if (err instanceof TtError || err?.code !== 'ENOENT') throw err; }
  // Atomic replace: a fresh 0600 temp file (O_EXCL, so it is never a pre-planted file or link),
  // then rename over the target. A crash mid-write leaves the old token intact.
  const tmp = `${p}.tmp-${process.pid}`;
  try { await fs.unlink(tmp); } catch (/** @type {any} */ err) { if (err?.code !== 'ENOENT') throw err; }
  try {
    await fs.writeFile(tmp, token.trim() + '\n', { flag: 'wx', mode: 0o600 });
    await fs.chmod(tmp, 0o600);   // exact mode regardless of umask
    await fs.rename(tmp, p);
  } catch (err) {
    try { await fs.unlink(tmp); } catch { /* already gone */ }
    throw err;
  }
  return p;
}

/**
 * Raw-mode hidden prompt. Never echoes. Enter resolves, Backspace deletes, Ctrl-C rejects.
 * @param {any} stdin  (NodeJS.ReadStream-like: isTTY, setRawMode, resume, pause, setEncoding, on/off)
 * @param {NodeJS.WritableStream} stdout
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export function promptHidden(stdin, stdout, prompt) {
  if (!stdin || !stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(usage('tt-grill auth needs an interactive terminal; run it yourself, not through Claude'));
  }
  return new Promise((resolve, reject) => {
    let buf = '';
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('close', onEnd);
      stdin.off('error', onError);
    };
    /** @param {string | Buffer} chunk */
    const onData = (chunk) => {
      for (const c of String(chunk)) {
        if (c === '\r' || c === '\n') { cleanup(); stdout.write('\n'); resolve(buf); return; }
        if (c === '\u0003') { cleanup(); stdout.write('\n'); reject(usage('aborted')); return; }
        if (c === '\u007f' || c === '\b') { buf = buf.slice(0, -1); continue; }
        buf += c;
      }
    };
    const onEnd = () => { cleanup(); reject(usage('input closed before a token was entered')); };
    /** @param {Error} err */
    const onError = (err) => { cleanup(); reject(usage(`input error: ${err.message}`)); };
    stdout.write(prompt);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('close', onEnd);
    stdin.on('error', onError);
  });
}
