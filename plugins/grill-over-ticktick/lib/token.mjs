import * as nodeFs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { authError, usage, NO_TOKEN_MESSAGE, TtError, EXIT } from './errors.mjs';

/** @typedef {Pick<typeof nodeFs, 'mkdir' | 'writeFile' | 'readFile' | 'chmod' | 'lstat' | 'rename' | 'unlink'>} TokenFs */

/**
 * `$XDG_CONFIG_HOME/tt-grill/token` when XDG_CONFIG_HOME is set, else `~/.config/tt-grill/token`.
 * @param {string} home @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function tokenPath(home, env = {}) { return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'tt-grill', 'token'); }

/**
 * @param {{ env: NodeJS.ProcessEnv | Record<string, string | undefined>, home: string, fs?: TokenFs }} opts
 * @returns {Promise<string>}
 */
export async function readToken({ env, home, fs = nodeFs }) {
  const fromEnv = (env.TICKTICK_TOKEN ?? '').trim();
  if (fromEnv) return fromEnv;
  let raw = '';
  try {
    raw = await fs.readFile(tokenPath(home, env), 'utf8');
  } catch (/** @type {any} */ err) {
    if (err && err.code === 'ENOENT') { raw = ''; }
    else throw new TtError('token_read', `cannot read ${tokenPath(home, env)}: ${err.code ?? err.message}`, EXIT.ERROR);
  }
  const tok = raw.trim();
  if (!tok) throw authError(NO_TOKEN_MESSAGE);
  return tok;
}

/**
 * @param {{ home: string, token: string, env?: NodeJS.ProcessEnv | Record<string, string | undefined>, fs?: TokenFs }} opts
 * @returns {Promise<string>} the path written
 */
export async function writeToken({ home, token, env = {}, fs = nodeFs }) {
  const p = tokenPath(home, env);
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
 * Raw-mode hidden prompt. Never echoes. Enter resolves, Backspace deletes, Ctrl-C / Ctrl-D reject.
 * ESC sequences (arrow keys etc.: ESC `[` params final-byte) and a lone ESC are ignored.
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
    /** 0 = normal, 1 = just after ESC, 2 = inside `ESC [` until its final byte, 3 = one more char to drop (`ESC O x`) */
    let esc = 0;
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
        if (esc === 1) { esc = c === '[' ? 2 : c === 'O' ? 3 : 0; continue; }   // ESC x (Alt-key): x dropped too
        if (esc === 2) { if (c >= '\u0040' && c <= '\u007e') esc = 0; continue; }
        if (esc === 3) { esc = 0; continue; }
        if (c === '\u001b') { esc = 1; continue; }
        if (c === '\r' || c === '\n') { cleanup(); stdout.write('\n'); resolve(buf); return; }
        if (c === '\u0003' || c === '\u0004') { cleanup(); stdout.write('\n'); reject(usage('aborted')); return; }
        if (c === '\u007f' || c === '\b') { buf = buf.slice(0, -1); continue; }
        buf += c;
      }
      if (esc === 1) esc = 0;   // a lone ESC keypress arrives as its own chunk
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
