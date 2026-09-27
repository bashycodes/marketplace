import * as nodeFs from 'node:fs/promises';
import { join } from 'node:path';

/** @typedef {Pick<typeof nodeFs, 'mkdir' | 'appendFile' | 'readFile'>} LogFs */
/** @typedef {{ path: string, creating: (key: string) => Promise<void>, created: (key: string, taskId: string) => Promise<void>, load: () => Promise<Map<string, { taskId: string | null }>> }} Pushlog */

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
    async load() {
      /** @type {string} */
      let text = '';
      try { text = await fs.readFile(path, 'utf8'); } catch { return new Map(); }
      /** @type {Map<string, { taskId: string | null }>} */
      const map = new Map();
      for (const raw of text.split('\n')) {
        const line = raw.trim(); if (!line) continue;
        const [a, b] = line.split(/\s+/);
        if (a === 'creating' && b) { if (!map.has(b)) map.set(b, { taskId: null }); }
        else if (a && b) map.set(a, { taskId: b });
      }
      return map;
    },
  };
}
