import * as nodeFs from 'node:fs/promises';
import { join } from 'node:path';
import { TtError, EXIT, usage } from './errors.mjs';

const KEY_RE = /^r\d+\.\d+$/;
const TASK_ID_RE = /^[A-Za-z0-9_-]+$/;

/** @typedef {Pick<typeof nodeFs, 'mkdir' | 'appendFile' | 'readFile'>} LogFs */
/** @typedef {{ taskId: string | null, ingested: boolean }} PushlogEntry */
/** @typedef {{ path: string, creating: (key: string) => Promise<void>, created: (key: string, taskId: string) => Promise<void>, ingested: (key: string) => Promise<void>, load: () => Promise<Map<string, PushlogEntry>> }} Pushlog */

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} home
 * @returns {string}
 */
export function defaultStateDir(env, home) {
  return env.XDG_STATE_HOME ? join(env.XDG_STATE_HOME, 'tt-grill') : join(home, '.local', 'state', 'tt-grill');
}

/**
 * @param {{ dir: string, listId: string, fs?: LogFs }} opts
 * @returns {Pushlog}
 */
export function createPushlog({ dir, listId, fs = nodeFs }) {
  const path = join(dir, `${listId}.log`);
  const append = async (/** @type {string} */ line) => {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.appendFile(path, line + '\n', 'utf8');
  };
  return {
    path,
    creating: (key) => append(`creating ${key}`),
    created: (key, taskId) => append(`${key} ${taskId}`),
    // `ingested <key>`: close set this question to 2 / −1 after the skill read its answer.
    ingested: async (key) => {
      if (!KEY_RE.test(key)) throw usage(`pushlog: bad key "${key}"`);
      await append(`ingested ${key}`);
    },
    async load() {
      /** @type {string} */
      let text = '';
      try {
        text = await fs.readFile(path, 'utf8');
      } catch (err) {
        const code = err && typeof err === 'object' && 'code' in err ? /** @type {any} */ (err).code : undefined;
        if (code === 'ENOENT') return new Map();
        const msg = err instanceof Error ? err.message : String(err);
        throw new TtError('pushlog_read', `cannot read ${path}: ${code ?? msg}`, EXIT.ERROR);
      }
      const rawLines = text.split('\n');
      if (!text.endsWith('\n') && rawLines.length) rawLines.pop();
      /** @type {Map<string, PushlogEntry>} */
      const map = new Map();
      for (const raw of rawLines) {
        const line = raw.trim(); if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts.length !== 2) continue;
        const [a, b] = parts;
        if (a === 'creating' && KEY_RE.test(b)) { if (!map.has(b)) map.set(b, { taskId: null, ingested: false }); }
        else if (a === 'ingested' && KEY_RE.test(b)) { const e = map.get(b); if (e) e.ingested = true; else map.set(b, { taskId: null, ingested: true }); }
        else if (KEY_RE.test(a) && TASK_ID_RE.test(b)) map.set(a, { taskId: b, ingested: map.get(a)?.ingested ?? false });
      }
      return map;
    },
  };
}
