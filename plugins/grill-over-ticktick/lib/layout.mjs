import { hostTitle, writeBlock } from './state.mjs';

export const FOLDER = 'Claude';
export const COLUMN = '📍';
export const TAG = 'grill';

/** @typedef {import('./api.mjs').Api} Api */
/** @typedef {{ groupId: string, listId: string, columnId: string | null, hostId: string, created: boolean }} Layout */

/** @param {Api} api */
async function findGroup(api) {
  /** @type {any[]} */ const groups = (await api.get('/project/group')) ?? [];
  return groups.find((g) => g.name === FOLDER) ?? null;
}

/** @param {Api} api @param {string} groupId @param {string} effort */
async function findList(api, groupId, effort) {
  /** @type {any[]} */ const projects = (await api.get('/project')) ?? [];
  return projects.find((p) => p.groupId === groupId && p.name === effort && !p.closed) ?? null;
}

/** @param {any} data @param {string} effort */
function hostIn(data, effort) {
  const title = hostTitle(effort);
  return (data.tasks ?? []).find((/** @type {any} */ t) => t.kind === 'NOTE' && t.title === title) ?? null;
}

/** @param {any} data */
function columnIn(data) {
  return (data.columns ?? []).find((/** @type {any} */ c) => c.name === COLUMN) ?? null;
}

/**
 * @param {Api} api
 * @param {string} effort
 * @returns {Promise<Layout | null>}
 */
export async function findLayout(api, effort) {
  const group = await findGroup(api); if (!group) return null;
  const list = await findList(api, group.id, effort); if (!list) return null;
  const data = await api.get(`/project/${list.id}/data`);
  const host = hostIn(data, effort); if (!host) return null;
  return { groupId: group.id, listId: list.id, columnId: columnIn(data)?.id ?? null, hostId: host.id, created: false };
}

/**
 * @param {Api} api
 * @param {string} effort
 * @returns {Promise<Layout>}
 */
export async function ensureLayout(api, effort) {
  let created = false;
  let group = await findGroup(api);
  if (!group) { group = await api.post('/project/group', { name: FOLDER }); created = true; }
  let list = await findList(api, group.id, effort);
  if (!list) { list = await api.post('/project', { name: effort, groupId: group.id, viewMode: 'kanban', kind: 'TASK' }); created = true; }
  const data = await api.get(`/project/${list.id}/data`);
  let column = columnIn(data);
  if (!column) { column = await api.post(`/project/${list.id}/column`, { name: COLUMN, sortOrder: 0 }); created = true; }
  let host = hostIn(data, effort);
  if (!host) {
    host = await api.post('/task', {
      title: hostTitle(effort), projectId: list.id, kind: 'NOTE', columnId: column.id,
      content: writeBlock(hostTitle(effort), { v: 1, owner: null, gen: 0, round: 0 }),
    });
    created = true;
  }
  return { groupId: group.id, listId: list.id, columnId: column.id, hostId: host.id, created };
}

/**
 * @param {Api} api
 * @returns {Promise<boolean>} true if created
 */
export async function ensureTag(api) {
  /** @type {any[]} */ const tags = (await api.get('/tag')) ?? [];
  if (tags.some((t) => t.name === TAG)) return false;
  await api.post('/tag', { name: TAG, label: TAG });
  return true;
}

/**
 * @param {Api} api
 * @returns {Promise<{ effort: string, listId: string, hostId: string }[]>}
 */
export async function listEfforts(api) {
  const group = await findGroup(api); if (!group) return [];
  /** @type {any[]} */ const projects = (await api.get('/project')) ?? [];
  /** @type {{ effort: string, listId: string, hostId: string }[]} */ const out = [];
  for (const p of projects.filter((p) => p.groupId === group.id && !p.closed)) {
    const data = await api.get(`/project/${p.id}/data`);
    const host = hostIn(data, p.name);
    if (host) out.push({ effort: p.name, listId: p.id, hostId: host.id });
  }
  return out;
}

/** @param {Api} api @param {string} listId */
export async function archiveList(api, listId) {
  await api.post(`/project/${listId}`, { closed: true });
}
