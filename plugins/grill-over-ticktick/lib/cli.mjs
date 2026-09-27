// plugins/grill-over-ticktick/lib/cli.mjs
export const COMMANDS = ['auth', 'efforts', 'push', 'pull', 'close', 'takeover', 'wait', 'finish'];

export const HELP = `tt-grill — relay grilling rounds to TickTick (JSON in/out)

  tt-grill auth                       store a personal API token (own terminal only)
  tt-grill auth status                → {ok, user}
  tt-grill efforts                    → [{effort, listId, hostId, owner, round, open, answered}]
  tt-grill takeover --effort E        → {owner, gen, created}
  tt-grill push --effort E --owner O  stdin: round JSON → {listId, hostId, owner, gen, round, questions}
  tt-grill pull --effort E            → {host, questions, truncated}
  tt-grill close --effort E --owner O stdin: {answered, wontdo, reopen} → {closed, wontdo, reopened}
  tt-grill wait --effort E --owner O [--every 3m] [--settle 10m] [--grace 90s] [--max 24h]
  tt-grill finish --effort E          → {decisions, archived}

exit codes: 0 ok · 1 error · 2 usage · 3 taken over · 4 gave up waiting · 5 auth · 6 not found
`;

/**
 * @typedef {object} Io
 * @property {NodeJS.ReadStream & {isTTY?: boolean}} stdin
 * @property {NodeJS.WritableStream} stdout
 * @property {NodeJS.WritableStream} stderr
 */

/**
 * @param {string[]} argv
 * @param {Partial<Io>} [io]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cmd = argv[0];
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') { stdout.write(HELP); return 0; }
  if (!cmd) { stdout.write(HELP); return 2; }
  if (!COMMANDS.includes(cmd)) {
    stderr.write(JSON.stringify({ error: 'usage', message: `unknown command: ${cmd}` }) + '\n');
    return 2;
  }
  stderr.write(JSON.stringify({ error: 'usage', message: `not implemented yet: ${cmd}` }) + '\n');
  return 2;
}
