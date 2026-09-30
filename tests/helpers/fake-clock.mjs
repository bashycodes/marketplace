/** @param {number} [start] */
export function fakeClock(start = 0) {
  let t = start;
  /** @type {number[]} */
  const sleeps = [];
  return {
    now: () => t,
    /** @param {number} ms */
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    sleeps,
    /** @param {number} ms */
    advance(ms) { t += ms; },
  };
}
