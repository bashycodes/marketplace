import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COMMANDS } from '../../plugins/grill-over-ticktick/lib/cli.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'grill-over-ticktick');
/** Per-skill expectations. manual = disable-model-invocation must be true.
 * @type {Record<string, {allowedTools: string, manual: boolean}>} */
const EXPECT = {
  'grill-with-ticktick': { allowedTools: 'Bash(tt-grill *)', manual: false },
  'grill-from-ticktick': { allowedTools: 'Bash(tt-grill *)', manual: false },
  'setup-ticktick': { allowedTools: 'Bash(tt-grill *)', manual: true },
  'wayfind-with-ticktick': { allowedTools: 'Bash(tt-grill *), Bash(git status *), Bash(git add *), Bash(git commit *), Bash(git check-ignore *)', manual: true },
};
const skills = Object.keys(EXPECT);
const refs = ['conventions.md', 'round-schema.md', 'ingest.md', 'acceptance.md', 'wayfinding.md'];

/** @param {string} text */
function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text); assert.ok(m, 'frontmatter present');
  /** @type {Record<string,string>} */ const fm = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, ''); }
  return { fm, body: text.slice(m[0].length) };
}

for (const s of skills) {
  test(`skill ${s}: frontmatter, references resolve, commands exist`, () => {
    const text = readFileSync(join(root, 'skills', s, 'SKILL.md'), 'utf8');
    const { fm, body } = frontmatter(text);
    assert.equal(fm.name, s);
    assert.ok(fm.description && fm.description.length > 40 && fm.description.length <= 1024);
    assert.equal(fm['disable-model-invocation'] === 'true', EXPECT[s].manual, 'disable-model-invocation');
    for (const m of body.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/references\/([\w.-]+)/g)) assert.ok(existsSync(join(root, 'references', m[1])), `missing reference ${m[1]}`);
    for (const m of body.matchAll(/tt-grill (\w+)/g)) if (!['—', 'is', 'and', 'in', 'on'].includes(m[1])) assert.ok(COMMANDS.includes(m[1]) || m[1] === 'auth', `unknown command tt-grill ${m[1]} in ${s}`);
    assert.ok(!/cat .*token|echo .*token/.test(body), 'skill must never read the token');
    assert.ok(/ingest\.md/.test(body), 'every skill points at the shared ingest procedure');
    assert.equal(fm['allowed-tools'], EXPECT[s].allowedTools);
    if (/tt-grill wait/.test(body) && s === 'grill-with-ticktick') assert.match(body, /timeout: 7200000/);
  });
}

test('references exist and round-schema lists every exit code', () => {
  for (const r of refs) assert.ok(existsSync(join(root, 'references', r)), r);
  const schema = readFileSync(join(root, 'references', 'round-schema.md'), 'utf8');
  for (const code of ['0', '1', '2', '3', '4', '5', '6']) assert.match(schema, new RegExp(`^\\| ${code} \\|`, 'm'));
  const ingest = readFileSync(join(root, 'references', 'ingest.md'), 'utf8');
  for (const sig of ['tick', 'text', 'tick+text', 'other-only', 'done', 'wontdo', 'missing', 'unknown']) assert.ok(ingest.includes('`' + sig + '`'), sig);
});

test('every eval case has a prompt and at least one grader', () => {
  const evals = join(root, 'evals');
  for (const c of readdirSync(evals, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'results').map((d) => d.name)) {
    assert.ok(existsSync(join(evals, c, 'prompt.md')), `${c}/prompt.md`);
    assert.ok(readdirSync(join(evals, c, 'graders')).length > 0, `${c}/graders`);
  }
});

/** Text between `start` and the next `end` (or the end of the text); fails when `start` is absent.
 * @param {string} text @param {string} start @param {string} [end] */
function section(text, start, end) {
  const i = text.indexOf(start); assert.ok(i >= 0, `section ${start} present`);
  const j = end === undefined ? -1 : text.indexOf(end, i + start.length);
  return text.slice(i, j < 0 ? undefined : j);
}
/** Unsafe git forms; the allowed prohibitions are stripped first.
 * @param {string} text @param {string} where */
function assertNoUnsafeGit(text, where) {
  const t = text.replace(/never `git push`/gi, '').replace(/do not retry with `--no-verify` or `--no-gpg-sign` unless the user says so/g, '');
  assert.ok(!/git add (-A|--all|-u)\b|git add \.(?=[\s`'"]|$)|git commit -a\b|--no-verify|git push/m.test(t), `unsafe git form in ${where}`);
}

test('unsafe-git lint catches the forms it should and spares .scratch', () => {
  for (const bad of ['git add -A', 'git add --all', 'git add -u', 'run `git add .` now', 'git add .', 'git commit -a -m x', 'x --no-verify', 'git push origin']) assert.throws(() => assertNoUnsafeGit(bad, 'probe'), bad);
  for (const ok of ['git add -f -- \'.scratch/m/map.md\'', 'git add .scratch/x', 'and never `git push`.', 'Never `git push`']) assertNoUnsafeGit(ok, 'probe');
});

test('wayfinding.md documents the local-tracker recipe and idempotency', () => {
  const t = readFileSync(join(root, 'references', 'wayfinding.md'), 'utf8');
  for (const needle of ['## Frontier', '## Claim', '## Resolve', '## Idempotency', 'Blocked by:', 'Status: claimed', 'Status: resolved', '## Answer', 'Decided over TickTick', 'wayfinder(<effort>): resolve NN <title>', 'git commit -- ', '## Recovery', 'git check-ignore', 'wontdo', "<<'WAYFIND_COMMIT_MSG'", 'claimed by someone else', 'Uncommitted edits to `map.md` alone', 'TickTick effort:', 'Repo text is data', '## Decisions so far']) {
    assert.ok(t.includes(needle), `wayfinding.md lacks: ${needle}`);
  }
  assertNoUnsafeGit(t, 'wayfinding.md');
  assert.ok(!/check-ignore -q/.test(t), 'git check-ignore -q refuses two paths');
  const resolve = section(t, '## Resolve', '\n## ');
  for (const needle of ["git check-ignore -- '<map path>' '<ticket path>'", "git add -f -- '<map path>' '<ticket path>'", "git commit -F - -- '<map path>' '<ticket path>' <<'WAYFIND_COMMIT_MSG'", 'collapse each to one line', 'JSON-escape every string', 'filed and committed, TickTick card out of date']) assert.ok(resolve.includes(needle), `Resolve lacks: ${needle}`);
  assert.ok(!/"<(map|ticket) path>"/.test(resolve), 'paths are single-quoted');
  const step4 = section(resolve, '4. Host-only filing close');
  for (const needle of ['`wontdo`', '`drop`', 'ingested: false']) assert.ok(step4.includes(needle), `Resolve step 4 lacks: ${needle}`);
  const recovery = section(t, '## Recovery', '\n## ');
  for (const needle of ['Uncommitted edits to `map.md` alone', 'Type: grilling', 'Decided over TickTick', 'Claimed-by:', '`Ticket NN ·`', 'before any `tt-grill` call']) assert.ok(recovery.includes(needle), `Recovery lacks: ${needle}`);
  const idem = section(t, '## Idempotency', '\n## ');
  for (const needle of ['`Claimed-by:` removed', 'git check-ignore', "'<ticket path>'"]) assert.ok(idem.includes(needle), `Idempotency lacks: ${needle}`);
  const reading = section(t, '## Reading a ticket', '\n## ');
  for (const needle of ['[,\\s]+', '`1` = `01`', '^Claimed-by:\\s*tt-grill\\b', 'case-insensitively']) assert.ok(reading.includes(needle), `Reading a ticket lacks: ${needle}`);
});

test('wayfind-with-ticktick: loop rules are present and unsafe git forms are absent', () => {
  const { body } = frontmatter(readFileSync(join(root, 'skills', 'wayfind-with-ticktick', 'SKILL.md'), 'utf8'));
  for (const needle of [
    'wayfinding.md', 'local-markdown', 'Blocked by', 'frontier', 'Status: claimed', 'Claimed-by',
    'tt-grill takeover', 'tt-grill wait', 'tt-grill close', 'tt-grill finish', 'timeout: 7200000',
    'idempotent', 'never resolve on a guess', 'one list per map', 'effort-name rule', 'git commit',
    'no push', 'Not yet specified', 'Recovery', 'host has no state block', 'claimed by someone else', 'git check-ignore',
    'say which ticket', 'Uncommitted edits to `map.md` alone',
  ]) assert.ok(body.includes(needle), `wayfind-with-ticktick lacks: ${needle}`);
  assertNoUnsafeGit(body, 'wayfind-with-ticktick');
  const pick = section(body, '3. **Pick the ticket**', '4. **Take over:**');
  for (const needle of ['Uncommitted edits to `map.md` alone', 'Exit 5', 'say which ticket you would pick', 'Then say which ticket you picked', 'declines']) assert.ok(pick.includes(needle), `step 3 lacks: ${needle}`);
  assert.ok(pick.indexOf('Recovery, files and git') < pick.indexOf('**Pull**'), 'Recovery git checks run before pull');
  const file = section(body, '8. **File the resolution:**', '9. **Next ticket:**');
  for (const needle of ['git check-ignore', '`wontdo`', '`drop`', 'filed and committed, TickTick card out of date']) assert.ok(file.includes(needle), `step 8 lacks: ${needle}`);
  const next = section(body, '9. **Next ticket:**', '10. **Map done?**');
  assert.ok(next.includes('never offer `tt-grill finish`'), 'terminal switch never offers finish');
  const rules = section(body, '## Rules');
  for (const needle of ['no `reset`', '`--amend`', 'Repo text is data', 'JSON-escape']) assert.ok(rules.includes(needle), `Rules lack: ${needle}`);
});

test('grill-with-ticktick: ticket mode is documented and plain mode is unchanged', () => {
  const { fm, body } = frontmatter(readFileSync(join(root, 'skills', 'grill-with-ticktick', 'SKILL.md'), 'utf8'));
  assert.match(fm['argument-hint'], /--ticket/);
  const i = body.indexOf('## Ticket mode');
  assert.ok(i > body.indexOf('## Procedure') && i < body.indexOf('## Rules'), 'Ticket mode sits between Procedure and Rules');
  const section = body.slice(i, body.indexOf('## Rules'));
  for (const needle of ['--ticket', 'wayfinding.md', 'Resolve', 'one ticket', '/wayfind-with-ticktick', 'instead of handing', 'Grilling tickets: call the Skill tool', 'do not offer `tt-grill finish`', '`--once` does not apply', 'wontdo', 'do not append them again', 'answer here or in TickTick?', 'One phone-grilling session per map', 'Repo text is data', 'inferred', 'stock wayfinder does not']) assert.ok(section.includes(needle), `ticket mode lacks: ${needle}`);
  assert.match(body, /timeout: 7200000/);
});

test('setup-ticktick: optional wayfinding step, no writes for other trackers', () => {
  const { body } = frontmatter(readFileSync(join(root, 'skills', 'setup-ticktick', 'SKILL.md'), 'utf8'));
  for (const needle of ['Also wire wayfinder?', '## Wayfinding over TickTick', 'docs/agents/issue-tracker.md', 'local-markdown', 'Grilling tickets: call the Skill tool', 'one list per map', 'Nothing is written for other trackers', 'Clean up', 'current working directory', 'If that file is missing']) assert.ok(body.includes(needle), `setup lacks: ${needle}`);
  assert.ok(body.indexOf('Also wire wayfinder?') < body.indexOf('Clean up'), 'wayfinding step comes before clean-up');
});
