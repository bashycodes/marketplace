import * as nodeFs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { authError, usage, NO_TOKEN_MESSAGE } from './errors.mjs';

/** @typedef {Pick<typeof nodeFs, 'mkdir' | 'writeFile' | 'readFile' | 'chmod'>} TokenFs */

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
  try { raw = await fs.readFile(tokenPath(home), 'utf8'); } catch { raw = ''; }
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
  await fs.writeFile(p, token.trim() + '\n', { mode: 0o600 });
  await fs.chmod(p, 0o600);
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
    const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); };
    /** @param {string | Buffer} chunk */
    const onData = (chunk) => {
      for (const c of String(chunk)) {
        if (c === '\r' || c === '\n') { cleanup(); stdout.write('\n'); resolve(buf); return; }
        if (c === '\u0003') { cleanup(); stdout.write('\n'); reject(usage('aborted')); return; }
        if (c === '\u007f' || c === '\b') { buf = buf.slice(0, -1); continue; }
        buf += c;
      }
    };
    stdout.write(prompt);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}
