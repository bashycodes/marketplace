/**
 * @param {string} text
 * @param {readonly string[]} secrets
 * @returns {string}
 */
export function redact(text, secrets) {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('[redacted]');
  return out;
}

/**
 * @typedef {{ warn: (msg: string) => void, debug: (msg: string) => void, addSecret: (s: string) => void }} Logger
 */

/**
 * @param {{ stderr: NodeJS.WritableStream, secrets?: string[], debug?: boolean }} opts
 * @returns {Logger}
 */
export function createLogger({ stderr, secrets = [], debug = false }) {
  const secretList = [...secrets];
  const line = (/** @type {string} */ msg) => { stderr.write(`tt-grill: ${redact(msg, secretList)}\n`); };
  return {
    warn: line,
    debug: (msg) => { if (debug) line(msg); },
    addSecret: (s) => { if (s && !secretList.includes(s)) secretList.push(s); },
  };
}
