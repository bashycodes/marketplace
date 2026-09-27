import { findLayout, ensureLayout, ensureTag, listEfforts, archiveList, TAG } from './layout.mjs';
import { buildDesc, parseDesc, buildItems, classifyItems, KEY_RE } from './desc.mjs';
import { readBlock, writeBlock, renderHostProse, hostTitle } from './state.mjs';
import { createPushlog } from './pushlog.mjs';
import { usage, notFound, takenOver } from './errors.mjs';

/** @typedef {import('./api.mjs').Api} Api */
/** @typedef {import('./log.mjs').Logger} Logger */
/** @typedef {import('./layout.mjs').Layout} Layout */
/** @typedef {import('./state.mjs').HostState} HostState */
/** @typedef {{ key: string, title: string, context: string, rec: { label: string, why: string }, options: string[] }} Question */
/** @typedef {{ effort: string, round: number, host: import('./state.mjs').HostProse, questions: Question[] }} Round */
/** @typedef {'none'|'tick'|'text'|'tick+text'|'other-only'|'done'|'wontdo'|'missing'} Signal */
/** @typedef {ReturnType<typeof classifyItems>} Items */
/** @typedef {{ key: string, taskId: string, etag: string | null, status: number | null, title: string | null, items: Items, desc: string | null, descChanged: boolean, answerText: string | null, signal: Signal }} PulledQuestion */
/** @typedef {{ host: { id: string, etag: string | null, owner: string | null, gen: number, round: number, body: string, prose: string }, questions: PulledQuestion[], truncated: boolean }} PullResult */
/** @typedef {{ api: Api, effort: string, pushlogDir: string, log: Logger, random?: () => number, layout?: Layout }} Ctx */

export const MAX_TEXT = 100000;
export const FILTER_CAP = 200;
export const ANSWERED = new Set(/** @type {Signal[]} */ (['tick', 'text', 'tick+text']));
export const TOUCHED = new Set(/** @type {Signal[]} */ ([...ANSWERED, 'other-only']));
export const FINAL = new Set(/** @type {Signal[]} */ ([...ANSWERED, 'done', 'wontdo', 'missing']));
const OWNER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** @param {unknown} input @returns {Round} */
export function validateRound(input) {
  const fail = (/** @type {string} */ m) => usage(`round JSON: ${m}`);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('expected an object');
  const r = /** @type {any} */ (input);
  if (typeof r.effort !== 'string' || !r.effort.trim()) throw fail('effort must be a non-empty string');
  if (!Number.isInteger(r.round) || r.round < 1) throw fail('round must be a positive integer');
  if (!r.host || typeof r.host !== 'object') throw fail('host must be an object {goal, decided, open, notAsked}');
  const host = { goal: typeof r.host.goal === 'string' ? r.host.goal : '', decided: strList(r.host.decided, 'host.decided'), open: strList(r.host.open, 'host.open'), notAsked: strList(r.host.notAsked, 'host.notAsked') };
  if (!Array.isArray(r.questions) || r.questions.length === 0) throw fail('questions must be a non-empty array');
  /** @type {Set<string>} */ const seen = new Set();
  /** @type {Question[]} */ const questions = r.questions.map((/** @type {any} */ q, /** @type {number} */ i) => {
    const at = `questions[${i}]`;
    if (!q || typeof q !== 'object') throw fail(`${at} must be an object`);
    if (typeof q.key !== 'string' || !KEY_RE.test(q.key)) throw fail(`${at}.key must match ^r\\d+\\.\\d+$`);
    if (seen.has(q.key)) throw fail(`duplicate key ${q.key}`);
    seen.add(q.key);
    if (typeof q.title !== 'string' || !q.title.trim() || q.title.length > 80) throw fail(`${at}.title must be 1–80 chars`);
    if (typeof q.context !== 'string') throw fail(`${at}.context must be a string`);
    const options = strList(q.options, `${at}.options`);
    if (options.length === 0) throw fail(`${at}.options must have at least one entry`);
    if (!q.rec || typeof q.rec.label !== 'string' || typeof q.rec.why !== 'string') throw fail(`${at}.rec must be {label, why}`);
    if (!options.includes(q.rec.label)) throw fail(`${at}.rec.label must be one of options`);
    const desc = buildDesc({ key: q.key, context: q.context, rec: q.rec });
    if (desc.length > MAX_TEXT) throw fail(`${at} desc exceeds ${MAX_TEXT} chars`);
    return { key: q.key, title: q.title, context: q.context, rec: { label: q.rec.label, why: q.rec.why }, options };
  });
  if (renderHostProse({ effort: r.effort, host }).length > MAX_TEXT) throw fail(`host prose exceeds ${MAX_TEXT} chars`);
  return { effort: r.effort, round: r.round, host, questions };

  /** @param {unknown} v @param {string} name @returns {string[]} */
  function strList(v, name) {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw fail(`${name} must be an array of strings`);
    return v;
  }
}

/** @param {string} a @param {string} b */
export function compareKeys(a, b) {
  const pa = a.slice(1).split('.').map(Number), pb = b.slice(1).split('.').map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1];
}

/**
 * @param {{ status: number, items: Items, descChanged: boolean }} q
 * @returns {Signal}
 */
export function signalFor(q) {
  if (q.status === -1) return 'wontdo';
  const tick = q.items.some((i) => i.ticked && !i.isOther);
  if (tick && q.descChanged) return 'tick+text';
  if (tick) return 'tick';
  if (q.descChanged) return 'text';
  if (q.status === 2) return 'done';
  if (q.items.some((i) => i.ticked && i.isOther)) return 'other-only';
  return 'none';
}

/** @param {() => number} [random] @returns {string} */
export function newOwner(random = Math.random) {
  let s = 'o_';
  for (let i = 0; i < 6; i++) s += OWNER_ALPHABET[Math.min(31, Math.floor(random() * 32))];
  return s;
}

/** @param {Api} api @param {Layout} layout */
async function loadHost(api, layout) {
  const task = await api.get(`/project/${layout.listId}/task/${layout.hostId}`);
  const { prose, state } = readBlock(task.content);
  return { task, prose, state };
}

/** @param {Api} api @param {Layout} layout @param {string} prose @param {HostState} state */
async function writeHost(api, layout, prose, state) {
  await api.post(`/task/${layout.hostId}`, { id: layout.hostId, projectId: layout.listId, content: writeBlock(prose, state) });
}

/** @param {HostState | null} state @param {string} owner @param {string} effort */
function assertOwner(state, owner, effort) {
  const current = state?.owner ?? null;
  if (current !== owner) throw takenOver(`effort "${effort}" is owned by ${current ?? 'nobody'}, not ${owner}`, { owner: current });
}

/**
 * Resolve an effort to its layout, or throw not-found (exit 6). `ctx.layout` short-circuits
 * the three GETs so `wait` can resolve once and then poll with one filter + one host GET.
 * @param {{ api: Api, effort: string, layout?: Layout }} ctx
 * @returns {Promise<Layout>}
 */
export async function requireLayout(ctx) {
  if (ctx.layout) return ctx.layout;
  const layout = await findLayout(ctx.api, ctx.effort);
  if (!layout) throw notFound(`effort "${ctx.effort}" not found in folder Claude`, { effort: ctx.effort });
  return layout;
}

/**
 * One filter call + pushlog → this host's questions, classified and sorted.
 * @param {Ctx} ctx @param {Layout} layout
 * @returns {Promise<{ questions: PulledQuestion[], truncated: boolean }>}
 */
async function fetchQuestions(ctx, layout) {
  const pushlog = createPushlog({ dir: ctx.pushlogDir, listId: layout.listId });
  const entries = await pushlog.load();
  /** @type {Map<string, string>} */ const keyByTask = new Map();
  for (const [key, e] of entries) if (e.taskId) keyByTask.set(e.taskId, key);
  /** @type {any[]} */ const tasks = (await ctx.api.post('/task/filter', { projectIds: [layout.listId], tag: [TAG] })) ?? [];
  /** @type {Map<string, PulledQuestion>} */ const byKey = new Map();
  for (const t of tasks) {
    if (t.parentId !== layout.hostId) continue;
    const parsed = parseDesc(t.desc);
    const key = parsed.key ?? keyByTask.get(t.id) ?? null;
    if (!key) { ctx.log.debug(`ignoring unkeyed task ${t.id}`); continue; }
    const items = classifyItems(t.items);
    const q = { key, taskId: t.id, etag: t.etag ?? null, status: t.status ?? 0, title: t.title ?? null, items, desc: t.desc ?? null, descChanged: parsed.changed, answerText: parsed.answerText, signal: signalFor({ status: t.status ?? 0, items, descChanged: parsed.changed }) };
    const prev = byKey.get(key);
    if (prev) { ctx.log.warn(`duplicate question ${key}: ${prev.taskId} and ${t.id}`); if (entries.get(key)?.taskId !== t.id) continue; }
    byKey.set(key, q);
  }
  for (const [key, e] of entries) {
    if (e.taskId && !byKey.has(key)) byKey.set(key, { key, taskId: e.taskId, etag: null, status: null, title: null, items: [], desc: null, descChanged: false, answerText: null, signal: 'missing' });
  }
  const questions = [...byKey.values()].sort((a, b) => compareKeys(a.key, b.key));
  return { questions, truncated: tasks.length >= FILTER_CAP };
}

/**
 * @param {Ctx} ctx
 * @returns {Promise<{ owner: string, gen: number, created: boolean, listId: string, hostId: string }>}
 */
export async function takeover(ctx) {
  const layout = await ensureLayout(ctx.api, ctx.effort);
  await ensureTag(ctx.api);
  const { prose, state } = await loadHost(ctx.api, layout);
  const owner = newOwner(ctx.random);
  const next = { v: /** @type {1} */ (1), owner, gen: (state?.gen ?? 0) + 1, round: state?.round ?? 0 };
  await writeHost(ctx.api, layout, prose.trim() ? prose : hostTitle(ctx.effort), next);
  return { owner, gen: next.gen, created: layout.created, listId: layout.listId, hostId: layout.hostId };
}

/**
 * @param {Ctx & { owner: string, round: unknown }} args
 * @returns {Promise<{ listId: string, hostId: string, owner: string, gen: number, round: number, questions: { key: string, taskId: string, created: boolean }[] }>}
 */
export async function push(args) {
  const round = validateRound(args.round);
  if (round.effort !== args.effort) throw usage(`round.effort "${round.effort}" does not match --effort "${args.effort}"`);
  const layout = await ensureLayout(args.api, args.effort);
  await ensureTag(args.api);
  const { state } = await loadHost(args.api, layout);
  assertOwner(state, args.owner, args.effort);
  const next = { v: /** @type {1} */ (1), owner: args.owner, gen: state?.gen ?? 0, round: round.round };
  await writeHost(args.api, layout, renderHostProse({ effort: args.effort, host: round.host }), next);

  const pushlog = createPushlog({ dir: args.pushlogDir, listId: layout.listId });
  const entries = await pushlog.load();
  /** @type {Map<string, string>} */ const existing = new Map();
  if (round.questions.some((q) => entries.get(q.key)?.taskId === null)) {
    /** @type {any[]} */ const tasks = (await args.api.post('/task/filter', { projectIds: [layout.listId], tag: [TAG] })) ?? [];
    for (const t of tasks) { if (t.parentId !== layout.hostId) continue; const k = parseDesc(t.desc).key; if (k && !existing.has(k)) existing.set(k, t.id); }
  }
  /** @type {{ key: string, taskId: string, created: boolean }[]} */ const questions = [];
  for (const q of round.questions) {
    const e = entries.get(q.key);
    if (e?.taskId) { questions.push({ key: q.key, taskId: e.taskId, created: false }); continue; }
    const adopted = e ? existing.get(q.key) : undefined;
    if (adopted) { await pushlog.created(q.key, adopted); questions.push({ key: q.key, taskId: adopted, created: false }); continue; }
    await pushlog.creating(q.key);
    const t = await args.api.post('/task', {
      title: q.title, projectId: layout.listId, parentId: layout.hostId, kind: 'CHECKLIST',
      desc: buildDesc(q), items: buildItems(q.options, q.rec.label), tags: [TAG],
    });
    await pushlog.created(q.key, t.id);
    questions.push({ key: q.key, taskId: t.id, created: true });
  }
  return { listId: layout.listId, hostId: layout.hostId, owner: args.owner, gen: next.gen, round: round.round, questions };
}

/**
 * @param {Ctx} ctx
 * @returns {Promise<PullResult>}
 */
export async function pull(ctx) {
  const layout = await requireLayout(ctx);
  const { task, prose, state } = await loadHost(ctx.api, layout);
  const { questions, truncated } = await fetchQuestions(ctx, layout);
  return {
    host: { id: task.id, etag: task.etag ?? null, owner: state?.owner ?? null, gen: state?.gen ?? 0, round: state?.round ?? 0, body: task.content ?? '', prose },
    questions, truncated,
  };
}

/**
 * @param {Ctx & { owner: string, input: unknown }} args
 * @returns {Promise<{ closed: string[], wontdo: string[], reopened: string[], skipped: string[] }>}
 */
export async function close(args) {
  const inp = /** @type {any} */ (args.input);
  if (!inp || typeof inp !== 'object') throw usage('close JSON: expected {answered?, wontdo?, reopen?}');
  const list = (/** @type {string} */ name) => { const v = inp[name]; if (v === undefined) return /** @type {string[]} */ ([]); if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw usage(`close JSON: ${name} must be an array of keys`); return v; };
  const answered = list('answered'), wontdo = list('wontdo'), reopen = list('reopen');
  const layout = await requireLayout(args);
  const { state } = await loadHost(args.api, layout);
  assertOwner(state, args.owner, args.effort);
  // Resolve key → taskId the same way pull does: footer key first, pushlog reverse-lookup
  // as fallback. The pushlog alone is not enough — it can be lost (other machine, wiped
  // state dir) while the footer on the task itself survives.
  const { questions } = await fetchQuestions(args, layout);
  const byKey = new Map(questions.filter((q) => q.signal !== 'missing').map((q) => [q.key, q]));
  const out = { closed: /** @type {string[]} */ ([]), wontdo: /** @type {string[]} */ ([]), reopened: /** @type {string[]} */ ([]), skipped: /** @type {string[]} */ ([]) };
  /** @param {string[]} keys @param {number} status @param {string[]} into */
  const apply = async (keys, status, into) => {
    for (const key of keys) {
      const q = byKey.get(key);
      if (!q) { out.skipped.push(key); continue; }
      await args.api.post(`/task/${q.taskId}`, { id: q.taskId, projectId: layout.listId, status });
      into.push(key);
    }
  };
  await apply(answered, 2, out.closed);
  await apply(wontdo, -1, out.wontdo);
  await apply(reopen, 0, out.reopened);
  return out;
}

/**
 * @param {Ctx} ctx
 * @returns {Promise<{ effort: string, listId: string, prose: string, decisions: { key: string, title: string | null, signal: Signal, status: number | null, ticked: string[], answerText: string | null }[], archived: true }>}
 */
export async function finish(ctx) {
  const layout = await requireLayout(ctx);
  const { prose } = await loadHost(ctx.api, layout);
  const { questions } = await fetchQuestions(ctx, layout);
  const decisions = questions.filter((q) => q.signal !== 'missing').map((q) => ({ key: q.key, title: q.title, signal: q.signal, status: q.status, ticked: q.items.filter((i) => i.ticked && !i.isOther).map((i) => i.title.replace(/^⭐ /, '')), answerText: q.answerText }));
  await archiveList(ctx.api, layout.listId);
  return { effort: ctx.effort, listId: layout.listId, prose, decisions, archived: true };
}

/**
 * @param {{ api: Api, pushlogDir: string, log: Logger }} args
 * @returns {Promise<{ effort: string, listId: string, hostId: string, owner: string | null, round: number, open: number, answered: number }[]>}
 */
export async function efforts(args) {
  const lists = await listEfforts(args.api);
  /** @type {{ effort: string, listId: string, hostId: string, owner: string | null, round: number, open: number, answered: number }[]} */ const out = [];
  for (const l of lists) {
    const layout = { groupId: '', listId: l.listId, columnId: null, hostId: l.hostId, created: false };
    const { state } = await loadHost(args.api, layout);
    const { questions } = await fetchQuestions({ ...args, effort: l.effort }, layout);
    out.push({ effort: l.effort, listId: l.listId, hostId: l.hostId, owner: state?.owner ?? null, round: state?.round ?? 0,
      open: questions.filter((q) => q.signal === 'none' || q.signal === 'other-only').length,
      answered: questions.filter((q) => ANSWERED.has(q.signal)).length });
  }
  return out;
}
