import { authError, notFound, apiError, TtError } from './errors.mjs';
import { redact } from './log.mjs';

export const BASE_URL = 'https://api.ticktick.com/open/v1';
export const RETRY_STATUSES = new Set([429, 502, 503, 504]);
export const MAX_ATTEMPTS = 5;
export const BASE_MS = 500;
export const CAP_MS = 8000;
export const TIMEOUT_MS = 20000;
/** Largest response body accepted (the biggest legitimate body is ~480 KB). */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Read a response body with a hard size cap. Throws a TtError (never retried) past the cap;
 * stream/abort failures propagate as plain errors (retried like a network error).
 * @param {Response} res @param {string} where
 * @returns {Promise<string>}
 */
export async function readCapped(res, where) {
  const tooLarge = () => apiError(`response too large: ${where}`, { limit: MAX_BODY_BYTES });
  const declared = Number(res.headers?.get?.('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) { try { await res.body?.cancel(); } catch { /* ignore */ } throw tooLarge(); }
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (reader) {
    /** @type {Uint8Array[]} */ const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } throw tooLarge(); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = typeof res.arrayBuffer === 'function' ? Buffer.from(await res.arrayBuffer()).toString('utf8') : await res.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw tooLarge();
  return text;
}

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
 * @property {(path: string, body?: unknown, opts?: { retry?: boolean }) => Promise<any>} post
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
   * @param {boolean} [retry] false for non-idempotent creates: a network error, timeout or 5xx
   *   may mean the create committed, so it is not re-sent (429 = not processed; still retried).
   * @returns {Promise<any>}
   */
  async function request(method, path, body, retry = true) {
    const where = `${method} ${path}`;
    /** @type {string} */ let lastNote = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      /** @type {Response} */ let res;
      /** @type {string} */ let text;
      try {
        res = await fetch(baseUrl + path, {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        text = await readCapped(res, where);
      } catch (err) {
        if (err instanceof TtError) throw err;   // too large: a clean failure, not retried
        lastNote = clean(err instanceof Error ? err.message : String(err));
        log.debug(`network error on ${where} (attempt ${attempt}): ${lastNote}`);
        if (!retry) throw apiError(`network error (not retried: create): ${where}: ${lastNote}`);
        if (attempt < MAX_ATTEMPTS) { await sleep(backoffMs(attempt, random)); continue; }
        throw apiError(`network error after ${MAX_ATTEMPTS} attempts: ${where}: ${lastNote}`);
      }
      if (res.ok) {
        if (!text.trim()) return null;
        try { return JSON.parse(text); }
        catch { throw apiError(`invalid JSON from server: ${where}`, { status: res.status }); }
      }
      if (res.status === 401) throw authError();
      /** @type {any} */ let parsed = null;
      try { parsed = text.trim() ? JSON.parse(text) : null; } catch { parsed = null; }
      const errorCode = parsed && typeof parsed === 'object' ? parsed.errorCode : undefined;
      const errorId = parsed && typeof parsed === 'object' ? parsed.errorId : undefined;
      const serverMsg = parsed && typeof parsed === 'object' && parsed.errorMessage ? clean(String(parsed.errorMessage)) : '';
      if (res.status === 404) throw notFound(`not found: ${where}`, { errorCode });
      if (RETRY_STATUSES.has(res.status) && (retry || res.status === 429)) {
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
    post: (path, body = {}, opts = {}) => request('POST', path, body, opts.retry ?? true),
    del: (path) => request('DELETE', path),
  };
}
