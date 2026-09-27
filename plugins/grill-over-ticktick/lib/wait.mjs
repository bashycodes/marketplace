import { ANSWERED, TOUCHED, FINAL } from './rounds.mjs';
import { usage, takenOver, gaveUp } from './errors.mjs';

/** @typedef {import('./rounds.mjs').PullResult} PullResult */

export const DEFAULTS = Object.freeze({ every: '3m', settle: '10m', grace: '90s', max: '24h' });
const UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** @param {string} s @returns {number} */
export function parseDuration(s) {
  const m = /^(\d+)(ms|s|m|h)$/.exec(String(s).trim());
  if (!m) throw usage(`bad duration "${s}" (use e.g. 90s, 3m, 24h)`);
  if (Number(m[1]) === 0) throw usage(`duration must be > 0: "${s}"`);
  return Number(m[1]) * UNITS[/** @type {keyof typeof UNITS} */ (m[2])];
}

/**
 * The questions `wait` judges: this round's (`r<host.round>.`) that no `close` has consumed yet.
 * Earlier rounds keep their tick/text signal after being closed, so counting them would settle
 * every wait from round 2 on without a new answer.
 * @param {PullResult} r
 */
const current = (r) => r.questions.filter((q) => q.key.startsWith(`r${r.host.round}.`) && !q.ingested);

/** @param {PullResult} r @returns {string} */
export function fingerprint(r) {
  return current(r).map((q) => `${q.key}=${q.etag ?? '-'}`).join(',');
}

/**
 * @param {{ pull: () => Promise<PullResult>, owner: string, every: number, settle: number, grace: number, max: number, now: () => number, sleep: (ms: number) => Promise<void>, log: import('./log.mjs').Logger }} o
 * @returns {Promise<{ reason: 'all' | 'settled' } & PullResult>}
 */
export async function wait(o) {
  const checkOwner = (/** @type {PullResult} */ r) => { if (r.host.owner !== o.owner) throw takenOver(`effort taken over by ${r.host.owner ?? 'nobody'}`, { owner: r.host.owner }); };
  const t0 = o.now();
  let lastChange = t0;
  let r = await o.pull(); checkOwner(r);
  let fp = fingerprint(r);
  for (;;) {
    await o.sleep(o.every);
    r = await o.pull(); checkOwner(r);
    const fp2 = fingerprint(r);
    if (fp2 !== fp) { fp = fp2; lastChange = o.now(); o.log.debug(`change seen: ${fp}`); }
    const qs = current(r);
    if (qs.length > 0 && qs.every((q) => FINAL.has(q.signal))) {
      await o.sleep(o.grace);
      const r2 = await o.pull(); checkOwner(r2);
      const fp3 = fingerprint(r2);
      if (fp3 === fp) return { reason: 'all', ...r2 };
      fp = fp3; lastChange = o.now(); r = r2;
    } else if (qs.some((q) => TOUCHED.has(q.signal)) && o.now() - lastChange >= o.settle) {
      return { reason: 'settled', ...r };
    }
    if (o.now() - t0 >= o.max) throw gaveUp(`no complete answer after ${Math.round(o.max / 60000)} min`, { answered: qs.filter((q) => ANSWERED.has(q.signal)).length, total: qs.length });
  }
}
