import { redact } from './log.mjs';

export const EXIT = Object.freeze({ OK: 0, ERROR: 1, USAGE: 2, TAKEN_OVER: 3, GAVE_UP: 4, AUTH: 5, NOT_FOUND: 6 });
export const AUTH_MESSAGE = 'token rejected by TickTick (run: tt-grill auth)';
export const NO_TOKEN_MESSAGE = 'no token found (run: tt-grill auth, or set TICKTICK_TOKEN)';

export class TtError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} exitCode
   * @param {Record<string, unknown>} [extra]
   */
  constructor(code, message, exitCode, extra = {}) {
    super(message);
    this.name = 'TtError';
    this.code = code;
    this.exitCode = exitCode;
    this.extra = extra;
  }
}

/** @param {string} msg @param {Record<string, unknown>} [extra] */
export const usage = (msg, extra) => new TtError('usage', msg, EXIT.USAGE, extra);
/** @param {string} msg @param {Record<string, unknown>} [extra] */
export const apiError = (msg, extra) => new TtError('api', msg, EXIT.ERROR, extra);
/** @param {string} msg @param {Record<string, unknown>} [extra] */
export const takenOver = (msg, extra) => new TtError('taken_over', msg, EXIT.TAKEN_OVER, extra);
/** @param {string} msg @param {Record<string, unknown>} [extra] */
export const gaveUp = (msg, extra) => new TtError('gave_up', msg, EXIT.GAVE_UP, extra);
/** @param {string} [msg] */
export const authError = (msg = AUTH_MESSAGE) => new TtError('auth', msg, EXIT.AUTH);
/** @param {string} msg @param {Record<string, unknown>} [extra] */
export const notFound = (msg, extra) => new TtError('not_found', msg, EXIT.NOT_FOUND, extra);

/**
 * @param {unknown} err
 * @param {readonly string[]} [secrets]
 * @returns {{ exitCode: number, json: { error: string, message: string, [k: string]: unknown } }}
 */
export function toExit(err, secrets = []) {
  if (err instanceof TtError) {
    const extra = Object.fromEntries(Object.entries(err.extra).map(([k, v]) => [k, typeof v === 'string' ? redact(v, secrets) : v]));
    return { exitCode: err.exitCode, json: { error: err.code, message: redact(err.message, secrets), ...extra } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { exitCode: EXIT.ERROR, json: { error: 'internal', message: redact(message, secrets) } };
}

/**
 * Boundary check for a 200 body that must be a list: null/empty → [], an array passes, anything
 * else is exit 1 (not a TypeError deep in the caller).
 * @param {unknown} v @param {string} what
 * @returns {any[]}
 */
export function asArray(v, what) {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw apiError('unexpected response shape', { what });
  return v;
}

/** Shape every TickTick id must have before it reaches a URL path, the pushlog path or a pushlog line. */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Boundary check for an id returned by TickTick (exit 1 on anything else).
 * @param {unknown} id @param {string} what
 * @returns {string}
 */
export function serverId(id, what) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw apiError('unexpected id from server', { what });
  return id;
}
