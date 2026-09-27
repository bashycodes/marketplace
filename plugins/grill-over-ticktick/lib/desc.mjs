import { createHash } from 'node:crypto';

export const OTHER_TITLE = 'Other → type after ✍️';
export const ANSWER_MARKER = '✍️ Answer:';
export const REC_PREFIX = '⭐ ';
export const KEY_RE = /^r\d+\.\d+$/;
const FOOTER_RE = /^⌁ (r\d+\.\d+) ([0-9a-f]{8})$/;

/** @param {string} text @returns {string} */
export function normalise(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** @param {string} text @returns {string} */
export function hashText(text) {
  return createHash('sha256').update(normalise(text), 'utf8').digest('hex').slice(0, 8);
}

/**
 * @param {{ key: string, context: string, rec: { label: string, why: string } }} q
 * @returns {string}
 */
export function buildDesc({ key, context, rec }) {
  const body = `${context.trim()}\n\n⭐ Recommended: ${rec.label} — ${rec.why}\n\n${ANSWER_MARKER}`;
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
  const answerText = at < 0 ? null : body.slice(at + ANSWER_MARKER.length).trim();
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
