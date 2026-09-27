/** @typedef {{ v: 1, owner: string | null, gen: number, round: number }} HostState */
/** @typedef {{ goal: string, decided: string[], open: string[], notAsked: string[] }} HostProse */

const BLOCK_RE = /(?:^|\n)```grill\n([\s\S]*?)\n```\s*$/;

/** @param {string} effort @returns {string} */
export function hostTitle(effort) { return `📍 ${effort}`; }

/**
 * @param {string | undefined | null} body
 * @returns {{ prose: string, state: HostState | null }}
 */
export function readBlock(body) {
  const text = (body ?? '').replace(/\r\n?/g, '\n');
  const m = BLOCK_RE.exec(text);
  if (!m) return { prose: text, state: null };
  /** @type {any} */
  let parsed;
  try { parsed = JSON.parse(m[1]); } catch { return { prose: text, state: null }; }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.gen !== 'number') return { prose: text, state: null };
  const state = { v: /** @type {1} */ (1), owner: typeof parsed.owner === 'string' ? parsed.owner : null, gen: parsed.gen, round: typeof parsed.round === 'number' ? parsed.round : 0 };
  return { prose: text.slice(0, m.index).trimEnd(), state };
}

/**
 * @param {string} prose
 * @param {HostState} state
 * @returns {string}
 */
export function writeBlock(prose, state) {
  return `${prose.trimEnd()}\n\n\`\`\`grill\n${JSON.stringify(state)}\n\`\`\`\n`;
}

/**
 * @param {{ effort: string, host: HostProse }} args
 * @returns {string}
 */
export function renderHostProse({ effort, host }) {
  const parts = [hostTitle(effort), `Goal: ${host.goal?.trim() || '—'}`];
  const section = (/** @type {string} */ title, /** @type {string[]} */ items) => { if (items?.length) parts.push([title, ...items.map((i) => `- ${i}`)].join('\n')); };
  section('Decided', host.decided);
  section('Open', host.open);
  section('Not asked yet', host.notAsked);
  return parts.join('\n\n');
}
