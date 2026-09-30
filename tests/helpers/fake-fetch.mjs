/**
 * @typedef {{status: number, json?: unknown, text?: string} | Error} Reply
 * @typedef {{method: string, path: string | RegExp, reply: Reply | Reply[] | ((req: {method: string, path: string, body: any}) => Reply)}} Route
 * @typedef {{method: string, path: string, body: any, headers: Record<string,string>}} Call
 */
/**
 * @param {Route[]} routes
 * @returns {typeof fetch & {calls: Call[]}}
 */
export function fakeFetch(routes) {
  const cursors = new Map();
  /** @type {Call[]} */
  const calls = [];
  const f = /** @type {any} */ (async (/** @type {string|URL} */ url, /** @type {RequestInit} */ init = {}) => {
    const u = new URL(String(url));
    const path = u.pathname.replace(/^\/open\/v1/, '') + (u.search || '');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    calls.push({ method, path, body, headers });
    const route = routes.find((r) => r.method === method && (r.path instanceof RegExp ? r.path.test(path) : r.path === path));
    if (!route) throw new Error(`unrouted ${method} ${path}`);
    let reply;
    if (typeof route.reply === 'function') reply = route.reply({ method, path, body });
    else if (Array.isArray(route.reply)) { const i = cursors.get(route) ?? 0; reply = route.reply[Math.min(i, route.reply.length - 1)]; cursors.set(route, i + 1); }
    else reply = route.reply;
    if (reply instanceof Error) throw reply;
    const text = reply.text ?? (reply.json === undefined ? '' : JSON.stringify(reply.json));
    return new Response(text, { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
  f.calls = calls;
  return f;
}
/** @param {unknown} json @param {number} status @returns {Reply} */
export const ok = (json, status = 200) => ({ status, json });
