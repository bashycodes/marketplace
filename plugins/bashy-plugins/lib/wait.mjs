import { ANSWERED, TOUCHED, FINAL } from './rounds.mjs';
import { usage, takenOver, gaveUp, TtError, EXIT } from './errors.mjs';

/** @typedef {import('./rounds.mjs').PullResult} PullResult */

export const DEFAULTS = Object.freeze({ every: '3m', settle: '10m', grace: '90s', max: '72h' });
const UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
/** Largest delay a Node timer honours (2^31-1 ms, ~24.8 days); longer ones fire after 1 ms. */
export const MAX_DURATION_MS = 2_147_483_647;
/** Consecutive failed polls (exit-1 errors) after which `wait` gives up and rethrows. */
export const MAX_POLL_FAILURES = 5;

/** @param {string} s @returns {number} */
export function parseDuration(s) {
  const m = /^(\d+)(ms|s|m|h)$/.exec(String(s).trim());
  if (!m) throw usage(`bad duration "${s}" (use e.g. 90s, 3m, 24h)`);
  if (Number(m[1]) === 0) throw usage(`duration must be > 0: "${s}"`);
  const ms = Number(m[1]) * UNITS[/** @type {keyof typeof UNITS} */ (m[2])];
  if (!Number.isFinite(ms) || ms > MAX_DURATION_MS) throw usage(`duration too long: "${s}" (max ${MAX_DURATION_MS} ms, ~596h)`);
  return ms;
}

/**
 * The questions `wait` judges: every question of any round that no `close` has consumed yet.
 * Consumed answers keep their tick/text signal after being closed, so `ingested` (not the
 * round) is what keeps them from settling a wait without a new answer; an earlier round's
 * still-open question does count, so answering it on the phone ends the wait.
 * @param {PullResult} r
 */
const current = (r) => r.questions.filter((q) => !q.ingested);

/** @param {PullResult} r @returns {string} */
export function fingerprint(r) {
  return current(r).map((q) => `${q.key}=${q.etag ?? '-'}`).join(',');
}

/** @param {number} ms @returns {string} */
const human = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/** Errors a poll may shrug off: anything that maps to exit 1 (network, 5xx, bad body, internal). */
const transient = (/** @type {unknown} */ e) => !(e instanceof TtError) || e.exitCode === EXIT.ERROR;

/**
 * Polls until every un-ingested question is final (then confirms after `grace`), or a touched
 * question has been quiet for `settle`, or `max` runs out. The first poll happens at once.
 * An exit-1 poll failure is logged and retried at the next poll; MAX_POLL_FAILURES in a row
 * rethrow the last one. Exit 3/5/6 errors propagate at once.
 * @param {{ pull: () => Promise<PullResult>, owner: string, every: number, settle: number, grace: number, max: number, now: () => number, sleep: (ms: number) => Promise<void>, log: import('./log.mjs').Logger }} o
 * @returns {Promise<{ reason: 'all' | 'settled' } & PullResult>}
 */
export async function wait(o) {
  const checkOwner = (/** @type {PullResult} */ r) => {
    if (!r.host.hasBlock) throw takenOver('host has no state block; run takeover', { owner: null });
    if (r.host.owner !== o.owner) throw takenOver(`effort taken over by ${r.host.owner ?? 'nobody'}`, { owner: r.host.owner });
  };
  let failures = 0;
  /** @returns {Promise<PullResult | null>} null = a tolerated failure */
  const poll = async () => {
    /** @type {PullResult} */ let r;
    try { r = await o.pull(); } catch (e) {
      if (!transient(e)) throw e;
      failures++;
      o.log.warn(`poll failed (${failures}/${MAX_POLL_FAILURES}): ${e instanceof Error ? e.message : String(e)}`);
      if (failures >= MAX_POLL_FAILURES) throw e;
      return null;
    }
    failures = 0; checkOwner(r); return r;
  };
  const t0 = o.now();
  let lastChange = t0;
  /** @type {PullResult | null} */ let last = null;
  /** @type {string | null} */ let fp = null;
  for (let first = true; ; first = false) {
    if (!first) {
      const left = o.max - (o.now() - t0);
      if (left <= 0) {
        const qs = last ? current(last) : [];
        throw gaveUp(`no complete answer after ${human(o.max)}`, { answered: qs.filter((q) => ANSWERED.has(q.signal)).length, total: qs.length });
      }
      await o.sleep(Math.min(o.every, left));
    }
    const r = await poll();
    if (!r) continue;
    last = r;
    const fp2 = fingerprint(r);
    if (fp === null) fp = fp2;
    else if (fp2 !== fp) { fp = fp2; lastChange = o.now(); o.log.debug(`change seen: ${fp}`); }
    const qs = current(r);
    if (qs.length > 0 && qs.every((q) => FINAL.has(q.signal))) {
      await o.sleep(o.grace);
      const r2 = await poll();
      if (!r2) continue;
      last = r2;
      const fp3 = fingerprint(r2);
      if (fp3 === fp) return { reason: 'all', ...r2 };
      fp = fp3; lastChange = o.now();
    } else if (qs.some((q) => TOUCHED.has(q.signal)) && o.now() - lastChange >= o.settle) {
      return { reason: 'settled', ...r };
    }
  }
}
