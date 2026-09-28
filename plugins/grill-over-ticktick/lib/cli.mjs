import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createLogger } from './log.mjs';
import { toExit, usage } from './errors.mjs';
import { readToken, writeToken, promptHidden } from './token.mjs';
import { createApi } from './api.mjs';
import { defaultStateDir } from './pushlog.mjs';
import { takeover, push, pull, close, finish, efforts, requireLayout } from './rounds.mjs';
import { wait, parseDuration, DEFAULTS } from './wait.mjs';
import { checkEffort } from './state.mjs';

export const COMMANDS = ['auth', 'efforts', 'push', 'pull', 'close', 'takeover', 'wait', 'finish'];

export const HELP = `tt-grill — relay grilling rounds to TickTick (JSON in/out)

  tt-grill auth                       store a personal API token (own terminal only)
  tt-grill auth status                → {ok, projects}
  tt-grill efforts                    → [{effort, listId, hostId, owner, round, open, answered}]
  tt-grill takeover --effort E        → {owner, gen, created, listId, hostId}
  tt-grill push --effort E --owner O  stdin: round JSON → {listId, hostId, owner, gen, round, questions}
  tt-grill pull --effort E            → {host, questions, truncated}
  tt-grill close --effort E --owner O stdin: {answered, wontdo, reopen, drop, host?} → {closed, wontdo, reopened, dropped, skipped}
  tt-grill wait --effort E --owner O [--every ${DEFAULTS.every}] [--settle ${DEFAULTS.settle}] [--grace ${DEFAULTS.grace}] [--max ${DEFAULTS.max}]
  tt-grill finish --effort E --owner O → {effort, listId, prose, decisions, archived}

exit codes: 0 ok · 1 error · 2 usage · 3 taken over · 4 gave up waiting · 5 auth · 6 not found
effort names: ^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$
env: TICKTICK_TOKEN (CI/cloud only), TT_GRILL_DEBUG=1, XDG_STATE_HOME
`;

/**
 * @typedef {object} Io
 * @property {any} stdin
 * @property {NodeJS.WritableStream} stdout
 * @property {NodeJS.WritableStream} stderr
 * @property {Record<string, string | undefined>} env
 * @property {string} home
 * @property {typeof fetch} fetch
 * @property {() => number} now
 * @property {(ms: number) => Promise<void>} sleep
 * @property {() => number} random
 */

/** @param {any} stdin @returns {Promise<string>} */
export async function readStdin(stdin) {
  // Concatenate raw bytes before decoding once — decoding each chunk separately (e.g. via
  // string concatenation, which coerces a Buffer chunk with its own default utf8 decode) can
  // split a multi-byte UTF-8 character across a chunk boundary and corrupt it.
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const c of stdin) chunks.push(typeof c === 'string' ? Buffer.from(c, 'utf8') : c);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {string[]} argv
 * @param {Partial<Io>} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {}) {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const home = io.home ?? homedir();
  const fetchImpl = io.fetch ?? globalThis.fetch;
  const now = io.now ?? (() => performance.now());
  const sleep = io.sleep ?? ((/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)));
  const random = io.random ?? Math.random;
  /** @type {string[]} */
  const secrets = [];
  const log = createLogger({ stderr, secrets, debug: env.TT_GRILL_DEBUG === '1' });

  const cmd = argv[0];
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') { stdout.write(HELP); return 0; }
  if (!cmd) { stdout.write(HELP); return 2; }

  try {
    if (!COMMANDS.includes(cmd)) throw usage(`unknown command: ${cmd}`);
    /** @type {{ values: Record<string, string | undefined>, positionals: string[] }} */
    let parsed;
    try {
      parsed = /** @type {any} */ (parseArgs({ args: argv.slice(1), strict: true, allowPositionals: true, options: { effort: { type: 'string' }, owner: { type: 'string' }, every: { type: 'string' }, settle: { type: 'string' }, grace: { type: 'string' }, max: { type: 'string' } } }));
    } catch (e) { throw usage(e instanceof Error ? e.message : String(e)); }
    const { values, positionals } = parsed;
    // The only positional argument any command accepts is `status`, and only for `auth`.
    if (cmd === 'auth') {
      const bad = positionals.find((/** @type {string} */ p, /** @type {number} */ i) => !(i === 0 && p === 'status'));
      if (bad !== undefined) throw usage(`unexpected argument: ${bad}`);
    } else if (positionals.length) {
      throw usage(`unexpected argument: ${positionals[0]}`);
    }
    const need = (/** @type {'effort' | 'owner'} */ name) => { const v = values[name]; if (!v) throw usage(`--${name} is required for ${cmd}`); return name === 'effort' ? checkEffort(v) : v; };
    const readJson = async () => {
      if (stdin.isTTY) throw usage(`${cmd} expects JSON on stdin`);
      const text = await readStdin(stdin);
      try { return JSON.parse(text); } catch (e) { throw usage(`stdin is not valid JSON: ${e instanceof Error ? e.message : String(e)}`); }
    };
    const apiFor = (/** @type {string} */ token) => { secrets.push(token); log.addSecret(token); return createApi({ fetch: fetchImpl, token, log, sleep, random }); };
    const withToken = async () => apiFor(await readToken({ env, home }));
    const pushlogDir = defaultStateDir(env, home);

    /** @type {unknown} */
    let result;
    switch (cmd) {
      case 'auth': {
        if (positionals[0] === 'status') {
          const api = await withToken();
          /** @type {any[]} */
          const projects = (await api.get('/project')) ?? [];
          result = { ok: true, projects: projects.length };
        } else {
          const token = (await promptHidden(stdin, stderr, 'TickTick API token: ')).trim();
          if (!token) throw usage('empty token');
          await apiFor(token).get('/project');
          const path = await writeToken({ home, token });
          result = { ok: true, path };
        }
        break;
      }
      case 'efforts': result = await efforts({ api: await withToken(), pushlogDir, log }); break;
      case 'takeover': { const effort = need('effort'); result = await takeover({ api: await withToken(), effort, pushlogDir, log, random }); break; }
      case 'push': { const effort = need('effort'); const owner = need('owner'); const round = await readJson(); result = await push({ api: await withToken(), effort, owner, round, pushlogDir, log }); break; }
      case 'pull': { const effort = need('effort'); result = await pull({ api: await withToken(), effort, pushlogDir, log }); break; }
      case 'close': { const effort = need('effort'); const owner = need('owner'); const input = await readJson(); result = await close({ api: await withToken(), effort, owner, input, pushlogDir, log }); break; }
      case 'finish': { const effort = need('effort'); const owner = need('owner'); result = await finish({ api: await withToken(), effort, owner, pushlogDir, log }); break; }
      case 'wait': {
        const effort = need('effort'); const owner = need('owner');
        const every = parseDuration(values.every ?? DEFAULTS.every), settle = parseDuration(values.settle ?? DEFAULTS.settle), grace = parseDuration(values.grace ?? DEFAULTS.grace), max = parseDuration(values.max ?? DEFAULTS.max);
        const api = await withToken();
        const layout = await requireLayout({ api, effort });   // resolve once; each poll is then one filter + one /data GET
        result = await wait({ pull: () => pull({ api, effort, pushlogDir, log, layout }), owner, every, settle, grace, max, now, sleep, log });
        break;
      }
      default: throw usage(`unknown command: ${cmd}`);
    }
    stdout.write(JSON.stringify(result) + '\n');
    return 0;
  } catch (err) {
    const { exitCode, json } = toExit(err, secrets);
    stderr.write(JSON.stringify(json) + '\n');
    return exitCode;
  }
}
