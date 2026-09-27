import { hostTitle, writeBlock } from '../../plugins/grill-over-ticktick/lib/state.mjs';

/** @typedef {{ method: string, path: string, body: any, headers: Record<string,string> }} Call */

export function fakeTickTick() {
  let n = 0; const id = (/** @type {string} */ p) => `${p}${++n}`;
  let e = 0; const etag = () => `e${++e}`;
  const db = { groups: /** @type {any[]} */ ([]), projects: /** @type {any[]} */ ([]), columns: /** @type {any[]} */ ([]), tasks: /** @type {any[]} */ ([]), tags: /** @type {any[]} */ ([]) };
  /** @type {Call[]} */ const calls = [];
  const json = (/** @type {number} */ status, /** @type {unknown} */ body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const notFound = (/** @type {string} */ what) => json(404, { errorId: 'x', errorCode: 'resource_not_found', errorMessage: `${what} not found`, data: null });
  const publicTask = (/** @type {any} */ t) => { const { deleted, ...rest } = t; return rest; };
  const touch = (/** @type {any} */ t) => { t.etag = etag(); t.modifiedTime = new Date().toISOString(); return t; };
  const find = (/** @type {string} */ tid) => db.tasks.find((t) => t.id === tid);

  /** @type {typeof fetch} */
  const fetchImpl = /** @type {any} */ (async (/** @type {string|URL} */ url, /** @type {RequestInit} */ init = {}) => {
    const u = new URL(String(url)); const path = u.pathname.replace(/^\/open\/v1/, '');
    const method = (init.method ?? 'GET').toUpperCase(); const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body, headers: Object.fromEntries(new Headers(init.headers).entries()) });
    /** @type {RegExpExecArray | null} */ let m;
    if (method === 'GET' && path === '/project/group') return json(200, db.groups);
    if (method === 'POST' && path === '/project/group') { const g = { id: id('g'), name: body.name, sortOrder: 0, showAll: true }; db.groups.push(g); return json(200, g); }
    if (method === 'GET' && path === '/project') return json(200, db.projects.map((p) => ({ ...p })));
    if (method === 'POST' && path === '/project') { const p = { id: id('p'), name: body.name, sortOrder: 0, viewMode: body.viewMode ?? 'list', kind: body.kind ?? 'TASK', ...(body.groupId ? { groupId: body.groupId } : {}) }; db.projects.push(p); return json(200, p); }
    if ((m = /^\/project\/([^/]+)\/data$/.exec(path)) && method === 'GET') { const p = db.projects.find((x) => x.id === m?.[1]); if (!p) return notFound('project'); return json(200, { project: p, tasks: db.tasks.filter((t) => t.projectId === p.id && !t.deleted).map(publicTask), columns: db.columns.filter((c) => c.projectId === p.id) }); }
    if ((m = /^\/project\/([^/]+)\/column$/.exec(path))) { const pid = m[1]; if (method === 'GET') return json(200, db.columns.filter((c) => c.projectId === pid)); const c = { id: id('c'), projectId: pid, name: body.name, sortOrder: body.sortOrder ?? 0 }; db.columns.push(c); return json(200, c); }
    if ((m = /^\/project\/([^/]+)\/task\/([^/]+)$/.exec(path)) && method === 'GET') { const t = find(m[2]); if (!t || t.projectId !== m[1]) return notFound('task'); return json(200, publicTask(t)); }
    if ((m = /^\/project\/([^/]+)$/.exec(path))) { const p = db.projects.find((x) => x.id === m?.[1]); if (!p) return notFound('project'); if (method === 'DELETE') { db.projects.splice(db.projects.indexOf(p), 1); return json(200, undefined); } Object.assign(p, body); return json(200, p); }
    if (method === 'POST' && path === '/task/filter') { const tags = /** @type {string[]} */ (body.tag ?? []); const out = db.tasks.filter((t) => !t.deleted && (body.projectIds ?? []).includes(t.projectId) && tags.every((g) => (t.tags ?? []).includes(g))); return json(200, out.slice(0, 200).map(publicTask)); }
    if (method === 'POST' && path === '/task') { const t = touch({ id: id('t'), projectId: body.projectId, title: body.title, kind: body.kind ?? 'TEXT', status: 0, priority: 0, tags: body.tags ?? [], ...(body.parentId ? { parentId: body.parentId } : {}), ...(body.columnId ? { columnId: body.columnId } : {}), ...(body.content !== undefined ? { content: body.content } : {}), ...(body.desc !== undefined ? { desc: body.desc } : {}), ...(body.items ? { items: body.items.map((/** @type {any} */ it) => ({ id: id('i'), status: 0, title: it.title, sortOrder: 0 })) } : {}), createdTime: new Date().toISOString() }); db.tasks.push(t); const parent = body.parentId && find(body.parentId); if (parent) parent.childIds = [...(parent.childIds ?? []), t.id]; return json(200, publicTask(t)); }
    if ((m = /^\/task\/([^/]+)$/.exec(path)) && method === 'POST') { const t = find(m[1]); if (!t) return notFound('task'); for (const k of ['status', 'title', 'content', 'desc']) if (body[k] !== undefined) t[k] = body[k]; if (body.items) t.items = body.items.map((/** @type {any} */ it) => ({ id: it.id ?? id('i'), status: it.status ?? 0, title: it.title, sortOrder: 0 })); touch(t); return json(200, publicTask(t)); }
    if (method === 'GET' && path === '/tag') return json(200, db.tags);
    if (method === 'POST' && path === '/tag') { const g = { name: body.name, label: body.label, sortOrder: 0, type: 1 }; db.tags.push(g); return json(200, g); }
    return notFound(`route ${method} ${path}`);
  });

  return {
    fetch: fetchImpl, calls, db, find,
    /** @param {string} taskId @param {string} itemTitle @param {boolean} [on] */
    tick(taskId, itemTitle, on = true) { const t = find(taskId); const it = t.items.find((/** @type {any} */ i) => i.title === itemTitle); if (!it) throw new Error(`no item ${itemTitle}`); it.status = on ? 1 : 0; touch(t); },
    /** @param {string} taskId @param {number} status */
    setStatus(taskId, status) { touch(find(taskId)).status = status; },
    /** @param {string} taskId @param {string} desc */
    editDesc(taskId, desc) { touch(find(taskId)).desc = desc; },
    /** @param {string} taskId */
    deleteTask(taskId) { touch(find(taskId)).deleted = true; },
    /** @param {string} effort @param {{ owner?: string | null, gen?: number, round?: number }} [st] */
    seedEffort(effort, st = {}) {
      let g = db.groups.find((x) => x.name === 'Claude'); if (!g) { g = { id: id('g'), name: 'Claude', sortOrder: 0, showAll: true }; db.groups.push(g); }
      const p = { id: id('p'), name: effort, sortOrder: 0, viewMode: 'kanban', kind: 'TASK', groupId: g.id }; db.projects.push(p);
      const c = { id: id('c'), projectId: p.id, name: '📍', sortOrder: 0 }; db.columns.push(c);
      const h = touch({ id: id('t'), projectId: p.id, title: hostTitle(effort), kind: 'NOTE', status: 0, priority: 0, tags: [], columnId: c.id, content: writeBlock(hostTitle(effort), { v: 1, owner: st.owner ?? null, gen: st.gen ?? 0, round: st.round ?? 0 }) }); db.tasks.push(h);
      if (!db.tags.some((t) => t.name === 'grill')) db.tags.push({ name: 'grill', label: 'grill', sortOrder: 0, type: 1 });
      return { groupId: g.id, listId: p.id, columnId: c.id, hostId: h.id };
    },
  };
}
