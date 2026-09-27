import { authError, notFound, apiError } from './errors.mjs';
import { redact } from './log.mjs';

export const BASE_URL = 'https://api.ticktick.com/open/v1';
export const RETRY_STATUSES = new Set([429, 502, 503, 504]);
export const MAX_ATTEMPTS = 5;
export const BASE_MS = 500;
export const CAP_MS = 8000;
export const TIMEOUT_MS = 20000;

/**
 * @param {number} attempt 1-based
 * @param {() => number} random
 * @returns {number}
 */
export function backoffMs(attempt, random) {
  const base = Math.min(CAP_MS, BASE_MS * 2 ** (attempt - 1));
  return Math.round(base * (0.75 + 0.5 * random()));
}

/**
 * @typedef {object} Api
 * @property {(path: string) => Promise<any>} get
 * @property {(path: string, body?: unknown) => Promise<any>} post
 * @property {(path: string) => Promise<any>} del
 */

/**
 * @param {{ fetch: typeof fetch, token: string, log: import('./log.mjs').Logger, sleep?: (ms: number) => Promise<void>, random?: () => number, baseUrl?: string, timeoutMs?: number }} opts
 * @returns {Api}
 */
export function createApi({ fetch, token, log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random, baseUrl = BASE_URL, timeoutMs = TIMEOUT_MS }) {
  const secrets = [token];
  const clean = (/** @type {string} */ s) => redact(s, secrets);

  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   * @returns {Promise<any>}
   */
  async function request(method, path, body) {
    const where = `${method} ${path}`;
    /** @type {string} */ let lastNote = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      /** @type {Response} */ let res;
      try {
        res = await fetch(baseUrl + path, {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastNote = clean(err instanceof Error ? err.message : String(err));
        log.debug(`network error on ${where} (attempt ${attempt}): ${lastNote}`);
        if (attempt < MAX_ATTEMPTS) { await sleep(backoffMs(attempt, random)); continue; }
        throw apiError(`network error after ${MAX_ATTEMPTS} attempts: ${where}: ${lastNote}`);
      }
      const text = await res.text();
      if (res.ok) return text.trim() ? JSON.parse(text) : null;
      if (res.status === 401) throw authError();
      /** @type {any} */ let parsed = null;
      try { parsed = text.trim() ? JSON.parse(text) : null; } catch { parsed = null; }
      const errorCode = parsed && typeof parsed === 'object' ? parsed.errorCode : undefined;
      const errorId = parsed && typeof parsed === 'object' ? parsed.errorId : undefined;
      const serverMsg = parsed && typeof parsed === 'object' && parsed.errorMessage ? clean(String(parsed.errorMessage)) : '';
      if (res.status === 404) throw notFound(`not found: ${where}`, { errorCode });
      if (RETRY_STATUSES.has(res.status)) {
        log.debug(`retryable ${res.status} on ${where} (attempt ${attempt})`);
        if (attempt < MAX_ATTEMPTS) { await sleep(backoffMs(attempt, random)); continue; }
        throw apiError(`gave up after ${MAX_ATTEMPTS} attempts: ${res.status} ${where}`, { status: res.status, errorCode });
      }
      throw apiError(`http ${res.status} ${where}${serverMsg ? ': ' + serverMsg : ''}`, { status: res.status, errorCode, errorId });
    }
    throw apiError(`unreachable: ${where}`);
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    del: (path) => request('DELETE', path),
  };
}
