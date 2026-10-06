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
  'wayfind-with-ticktick': { allowedTools: 'Bash(tt-grill *), Bash(git *)', manual: true },
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

test('wayfinding.md documents the local-tracker recipe and idempotency', () => {
  const t = readFileSync(join(root, 'references', 'wayfinding.md'), 'utf8');
  for (const needle of ['## Frontier', '## Claim', '## Resolve', '## Idempotency', 'Blocked by:', 'Status: claimed', 'Status: resolved', '## Answer', 'Decided over TickTick', 'wayfinder(<effort>): resolve NN <title>', 'git commit -- ']) {
    assert.ok(t.includes(needle), `wayfinding.md lacks: ${needle}`);
  }
  assert.ok(!/git add (-A|\.)|git commit -a/.test(t), 'never stage everything');
});

test('wayfind-with-ticktick: loop rules are present and unsafe git forms are absent', () => {
  const { body } = frontmatter(readFileSync(join(root, 'skills', 'wayfind-with-ticktick', 'SKILL.md'), 'utf8'));
  for (const needle of [
    'wayfinding.md', 'local-markdown', 'Blocked by', 'frontier', 'Status: claimed', 'Claimed-by',
    'tt-grill takeover', 'tt-grill wait', 'tt-grill close', 'tt-grill finish', 'timeout: 7200000',
    'idempotent', 'never resolve on a guess', 'one list per map', 'effort-name rule', 'git commit',
    'no push', 'Not yet specified',
  ]) assert.ok(body.includes(needle), `wayfind-with-ticktick lacks: ${needle}`);
  assert.ok(!/git add (-A|\.)|git commit -a|--no-verify|git push/.test(body.replace(/never `git push`|No push\./g, '')), 'unsafe git form');
});

test('grill-with-ticktick: ticket mode is documented and plain mode is unchanged', () => {
  const { fm, body } = frontmatter(readFileSync(join(root, 'skills', 'grill-with-ticktick', 'SKILL.md'), 'utf8'));
  assert.match(fm['argument-hint'], /--ticket/);
  const i = body.indexOf('## Ticket mode');
  assert.ok(i > body.indexOf('## Procedure') && i < body.indexOf('## Rules'), 'Ticket mode sits between Procedure and Rules');
  const section = body.slice(i, body.indexOf('## Rules'));
  for (const needle of ['--ticket', 'wayfinding.md', 'Resolve', 'one ticket', '/wayfind-with-ticktick', 'instead of handing', 'Grilling tickets: call the Skill tool', 'do not offer `tt-grill finish`', '`--once` does not apply']) assert.ok(section.includes(needle), `ticket mode lacks: ${needle}`);
  assert.match(body, /timeout: 7200000/);
});

test('setup-ticktick: optional wayfinding step, no writes for other trackers', () => {
  const { body } = frontmatter(readFileSync(join(root, 'skills', 'setup-ticktick', 'SKILL.md'), 'utf8'));
  for (const needle of ['Also wire wayfinder?', '## Wayfinding over TickTick', 'docs/agents/issue-tracker.md', 'local-markdown', 'Grilling tickets: call the Skill tool', 'one list per map', 'Nothing is written for other trackers', 'Clean up']) assert.ok(body.includes(needle), `setup lacks: ${needle}`);
  assert.ok(body.indexOf('Also wire wayfinder?') < body.indexOf('Clean up'), 'wayfinding step comes before clean-up');
});
