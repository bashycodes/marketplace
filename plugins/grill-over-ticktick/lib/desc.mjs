import { createHash } from 'node:crypto';

export const OTHER_TITLE = 'Other → type after ✍️';
export const ANSWER_MARKER = '✍️ Answer:';
export const REC_PREFIX = '⭐ ';
export const KEY_RE = /^r\d+\.\d+$/;
const FOOTER_RE = /^⌁ (r\d+\.\d+) ([0-9a-f]{8})$/;
export const NEXT_PREFIX = 'Next → ';
/**
 * Which task field carries the "Next →" link. TickTick renders markdown links in a TEXT task's
 * `content`; for CHECKLIST tasks we put it in `desc`. Flip to `'content'` if the phone does not
 * render it there (then `desc` carries no link and `content` is just the link line).
 * @type {'desc' | 'content'}
 */
export const LINK_FIELD = 'desc';
/* `[i/N] ` ordering prefix on a question title; tolerate TickTick's markdown escapes. */
const TITLE_PREFIX_RE = /^\\?\[(\d+)\/(\d+)\\?\] /;

/** Backslash-escapes TickTick's server inserts around markdown-special punctuation. */
const ESCAPE_RE = /\\([\\`*_{}\[\]()#+\-.!|<>~])/g;

/** @param {string} text @returns {string} */
export function unescapeMarkdown(text) {
  return text.replace(ESCAPE_RE, '$1');
}

/** @param {string} text @returns {string} */
export function normalise(text) {
  const lines = unescapeMarkdown(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** @param {string} text @returns {string} */
export function hashText(text) {
  return createHash('sha256').update(normalise(text), 'utf8').digest('hex').slice(0, 8);
}

/** @typedef {{ label: string, url: string }} NextLink */

/** @param {string} listId @param {string} taskId @returns {string} */
export function taskUrl(listId, taskId) {
  return `https://ticktick.com/webapp/#p/${listId}/tasks/${taskId}`;
}

/** @param {NextLink} next @returns {string} */
export function nextLine({ label, url }) {
  return `${NEXT_PREFIX}[${label}](${url})`;
}

/** @param {string} title @param {number} position 1-based @param {number} total @returns {string} */
export function prefixTitle(title, position, total) {
  return `[${position}/${total}] ${title}`;
}

/** @param {string | null | undefined} title @returns {{ position: number | null, total: number | null }} */
export function parseTitlePrefix(title) {
  const m = TITLE_PREFIX_RE.exec(title ?? '');
  return m ? { position: Number(m[1]), total: Number(m[2]) } : { position: null, total: null };
}

/**
 * The footer hash covers everything above it, including the Next line.
 * @param {{ key: string, context: string, rec: { label: string, why: string }, next?: NextLink | null }} q
 * @returns {string}
 */
export function buildDesc({ key, context, rec, next = null }) {
  const link = next ? `\n\n${nextLine(next)}` : '';
  const body = `${context.trim()}\n\n⭐ Recommended: ${rec.label} — ${rec.why}\n\n${ANSWER_MARKER}${link}`;
  return `${body}\n\n⌁ ${key} ${hashText(body)}`;
}

/**
 * @param {string | undefined | null} desc
 * @returns {{ key: string | null, hash: string | null, body: string, changed: boolean, answerText: string | null }}
 */
export function parseDesc(desc) {
  const text = normalise(desc ?? '');
  if (!text) return { key: null, hash: null, body: '', changed: true, answerText: null };
  const lines = text.split('\n');
  const m = FOOTER_RE.exec(lines[lines.length - 1]);
  const body = m ? normalise(lines.slice(0, -1).join('\n')) : text;
  const key = m ? m[1] : null;
  const hash = m ? m[2] : null;
  const changed = !m || hashText(body) !== hash;
  const at = body.indexOf(ANSWER_MARKER);
  /** @type {string | null} */ let answerText = null;
  if (at >= 0) {
    // The answer ends at the (last) `Next →` line after the marker, else at the footer.
    const after = body.slice(at + ANSWER_MARKER.length).split('\n');
    let j = after.length - 1;
    while (j >= 0 && !after[j].startsWith(NEXT_PREFIX)) j--;
    answerText = (j < 0 ? after : after.slice(0, j)).join('\n').trim();
  }
  return { key, hash, body, changed, answerText };
}

/**
 * @param {string[]} options
 * @param {string} recLabel
 * @returns {{ title: string }[]}
 */
export function buildItems(options, recLabel) {
  return [{ title: REC_PREFIX + recLabel }, ...options.filter((o) => o !== recLabel).map((o) => ({ title: o })), { title: OTHER_TITLE }];
}

/**
 * @param {{ title: string, status?: number }[] | undefined | null} items
 * @returns {{ title: string, ticked: boolean, isRec: boolean, isOther: boolean }[]}
 */
export function classifyItems(items) {
  return (items ?? []).map((it) => ({
    title: it.title,
    ticked: it.status === 1,
    isRec: it.title.startsWith(REC_PREFIX),
    isOther: it.title === OTHER_TITLE,
  }));
}
