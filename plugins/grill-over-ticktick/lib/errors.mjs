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
