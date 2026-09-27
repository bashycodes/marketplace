import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COMMANDS } from '../../plugins/grill-over-ticktick/lib/cli.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'grill-over-ticktick');
const skills = ['grill-with-ticktick', 'grill-from-ticktick', 'setup-ticktick'];
const refs = ['conventions.md', 'round-schema.md', 'ingest.md', 'acceptance.md'];

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
    if (s === 'setup-ticktick') assert.equal(fm['disable-model-invocation'], 'true'); else assert.notEqual(fm['disable-model-invocation'], 'true');
    for (const m of body.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/references\/([\w.-]+)/g)) assert.ok(existsSync(join(root, 'references', m[1])), `missing reference ${m[1]}`);
    for (const m of body.matchAll(/tt-grill (\w+)/g)) if (!['—', 'is', 'and', 'in', 'on'].includes(m[1])) assert.ok(COMMANDS.includes(m[1]) || m[1] === 'auth', `unknown command tt-grill ${m[1]} in ${s}`);
    assert.ok(!/cat .*token|echo .*token/.test(body), 'skill must never read the token');
    assert.ok(/ingest\.md/.test(body), 'every skill points at the shared ingest procedure');
  });
}

test('references exist and round-schema lists every exit code', () => {
  for (const r of refs) assert.ok(existsSync(join(root, 'references', r)), r);
  const schema = readFileSync(join(root, 'references', 'round-schema.md'), 'utf8');
  for (const code of ['0', '1', '2', '3', '4', '5', '6']) assert.match(schema, new RegExp(`^\\| ${code} \\|`, 'm'));
  const ingest = readFileSync(join(root, 'references', 'ingest.md'), 'utf8');
  for (const sig of ['tick', 'text', 'tick+text', 'other-only', 'done', 'wontdo', 'missing']) assert.ok(ingest.includes('`' + sig + '`'), sig);
});

test('every eval case has a prompt and at least one grader', () => {
  const evals = join(root, 'evals');
  for (const c of readdirSync(evals, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'results').map((d) => d.name)) {
    assert.ok(existsSync(join(evals, c, 'prompt.md')), `${c}/prompt.md`);
    assert.ok(readdirSync(join(evals, c, 'graders')).length > 0, `${c}/graders`);
  }
});
