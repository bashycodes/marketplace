import { hostTitle, writeBlock, isValidEffort } from './state.mjs';
import { serverId, usage } from './errors.mjs';

export const FOLDER = 'Claude';
export const COLUMN = '📍';
export const TAG = 'grill';

/** @typedef {import('./api.mjs').Api} Api */
/** @typedef {{ groupId: string, listId: string, columnId: string | null, hostId: string, created: boolean }} Layout */

/** @param {string} id */
const enc = (id) => encodeURIComponent(id);

/** @param {Api} api */
async function findGroup(api) {
  /** @type {any[]} */ const groups = (await api.get('/project/group')) ?? [];
  const g = groups.find((g) => g.name === FOLDER) ?? null;
  if (g) serverId(g.id, 'group');
  return g;
}

/** @param {Api} api @param {string} groupId @param {string} effort */
async function findList(api, groupId, effort) {
  /** @type {any[]} */ const projects = (await api.get('/project')) ?? [];
  const p = projects.find((p) => p.groupId === groupId && p.name === effort && !p.closed) ?? null;
  if (p) serverId(p.id, 'list');
  return p;
}

/** @param {any} data @param {string} effort */
function hostIn(data, effort) {
  const title = hostTitle(effort);
  const h = (data?.tasks ?? []).find((/** @type {any} */ t) => t.kind === 'NOTE' && t.title === title) ?? null;
  if (h) serverId(h.id, 'host');
  return h;
}

/** @param {any} data */
function columnIn(data) {
  const c = (data?.columns ?? []).find((/** @type {any} */ c) => c.name === COLUMN) ?? null;
  if (c) serverId(c.id, 'column');
  return c;
}

/**
 * @param {Api} api
 * @param {string} effort
 * @returns {Promise<Layout | null>}
 */
export async function findLayout(api, effort) {
  const group = await findGroup(api); if (!group) return null;
  const list = await findList(api, group.id, effort); if (!list) return null;
  const data = await api.get(`/project/${enc(list.id)}/data`);
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
  if (!group) { group = await api.post('/project/group', { name: FOLDER }); serverId(group?.id, 'group'); created = true; }
  let list = await findList(api, group.id, effort);
  const listExisted = !!list;
  if (!list) { list = await api.post('/project', { name: effort, groupId: group.id, viewMode: 'kanban', kind: 'TASK' }); serverId(list?.id, 'list'); created = true; }
  const data = await api.get(`/project/${enc(list.id)}/data`);
  let host = hostIn(data, effort);
  // Never convert a list the user already had: an existing list without our host note is only
  // adopted when it is empty.
  if (listExisted && !host && (data?.tasks ?? []).length > 0) throw usage(`list "${effort}" exists in folder Claude but is not a tt-grill list; rename it or pick another effort`);
  let column = columnIn(data);
  if (!column) { column = await api.post(`/project/${enc(list.id)}/column`, { name: COLUMN, sortOrder: 0 }); serverId(column?.id, 'column'); created = true; }
  if (!host) {
    host = await api.post('/task', {
      title: hostTitle(effort), projectId: list.id, kind: 'NOTE', columnId: column.id,
      content: writeBlock(hostTitle(effort), { v: 1, owner: null, gen: 0, round: 0 }),
    });
    serverId(host?.id, 'host');
    created = true;
  } else if (host.columnId !== column.id) {
    host = await api.post(`/task/${enc(host.id)}`, { id: host.id, projectId: list.id, columnId: column.id });
    serverId(host?.id, 'host');
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
 * Lists whose name is not a valid effort name are skipped: every effort this returns can be
 * pasted into a `--effort` argument.
 * @param {Api} api
 * @param {import('./log.mjs').Logger} [log]
 * @returns {Promise<{ effort: string, listId: string, hostId: string }[]>}
 */
export async function listEfforts(api, log) {
  const group = await findGroup(api); if (!group) return [];
  /** @type {any[]} */ const projects = (await api.get('/project')) ?? [];
  /** @type {{ effort: string, listId: string, hostId: string }[]} */ const out = [];
  for (const p of projects.filter((p) => p.groupId === group.id && !p.closed)) {
    if (!isValidEffort(p.name)) { log?.debug(`skipping list with an invalid effort name: ${JSON.stringify(p.name)}`); continue; }
    serverId(p.id, 'list');
    const data = await api.get(`/project/${enc(p.id)}/data`);
    const host = hostIn(data, p.name);
    if (host) out.push({ effort: p.name, listId: p.id, hostId: host.id });
  }
  return out;
}

/** @param {Api} api @param {string} listId */
export async function archiveList(api, listId) {
  await api.post(`/project/${enc(listId)}`, { closed: true });
}
