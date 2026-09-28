/** @typedef {{ v: 1, owner: string | null, gen: number, round: number }} HostState */
/** @typedef {{ goal: string, decided: string[], open: string[], notAsked: string[] }} HostProse */

import { usage } from './errors.mjs';
import { unescapeMarkdown } from './desc.mjs';

/** Effort names end up in list titles and in shell commands the skills write, so the alphabet is closed. */
export const EFFORT_RE = /^[A-Za-z0-9](?:[A-Za-z0-9 ._-]{0,58}[A-Za-z0-9._-])?$/;
export const EFFORT_RULE = 'effort name must match ^[A-Za-z0-9](?:[A-Za-z0-9 ._-]{0,58}[A-Za-z0-9._-])?$ (1-60 chars: letters, digits, space, dot, underscore, hyphen; no leading or trailing space)';

/** @param {unknown} effort @returns {boolean} */
export function isValidEffort(effort) { return typeof effort === 'string' && EFFORT_RE.test(effort); }

/** @param {unknown} effort @returns {string} */
export function checkEffort(effort) {
  if (!isValidEffort(effort)) throw usage(`invalid effort ${JSON.stringify(effort)}: ${EFFORT_RULE}`);
  return /** @type {string} */ (effort);
}

/** A ```grill fence whose opener starts a line; group 1 = the JSON line(s), up to the first closing fence. */
const BLOCK_RE = /(?:^|\n)```grill\n([\s\S]*?)\n```[ \t]*(?=\n|$)/g;

/** @param {string} effort @returns {string} */
export function hostTitle(effort) { return `📍 ${effort}`; }

/**
 * Parse the LAST well-formed ```grill block anywhere in the body. Text typed below it on the
 * phone is returned as `trailing` (trimmed) instead of making the host look stateless.
 * @param {string | undefined | null} body
 * @returns {{ prose: string, state: HostState | null, trailing: string }}
 */
export function readBlock(body) {
  const text = (body ?? '').replace(/\r\n?/g, '\n');
  /** @type {{ prose: string, state: HostState, trailing: string } | null} */ let found = null;
  for (const m of text.matchAll(BLOCK_RE)) {
    /** @type {any} */ let parsed;
    try { parsed = JSON.parse(m[1]); }
    catch {
      try { parsed = JSON.parse(unescapeMarkdown(m[1])); }
      catch { continue; }
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.gen !== 'number') continue;
    const start = /** @type {number} */ (m.index) + (m[0].startsWith('\n') ? 1 : 0);
    const state = { v: /** @type {1} */ (1), owner: typeof parsed.owner === 'string' ? parsed.owner : null, gen: parsed.gen, round: typeof parsed.round === 'number' ? parsed.round : 0 };
    found = { prose: text.slice(0, start).trimEnd(), state, trailing: text.slice(/** @type {number} */ (m.index) + m[0].length).trim() };
  }
  return found ?? { prose: text, state: null, trailing: '' };
}

/**
 * The block is always written last; `trailing` (text the user typed below the old block) is
 * kept, moved above the new block.
 * @param {string} prose
 * @param {HostState} state
 * @param {string} [trailing]
 * @returns {string}
 */
export function writeBlock(prose, state, trailing = '') {
  const t = trailing.trim();
  return `${prose.trimEnd()}${t ? '\n\n' + t : ''}\n\n\`\`\`grill\n${JSON.stringify(state)}\n\`\`\`\n`;
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
