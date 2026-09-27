import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBlock, writeBlock, renderHostProse, hostTitle } from '../../plugins/grill-over-ticktick/lib/state.mjs';

const S = { v: /** @type {1} */ (1), owner: 'o_7f3k2a', gen: 3, round: 2 };

test('hostTitle', () => { assert.equal(hostTitle('my effort'), '📍 my effort'); });

test('write → read round-trips state and keeps prose byte-identical', () => {
  const prose = '📍 e\n\nGoal: ship\n\nOpen\n- r1.1 x — ⭐ y';
  const body = writeBlock(prose, S);
  assert.equal(body, prose + '\n\n```grill\n' + JSON.stringify(S) + '\n```\n');
  assert.deepEqual(readBlock(body), { prose, state: S });
});

test('no block → state null, prose is whole body; empty/undefined body', () => {
  assert.deepEqual(readBlock('just text'), { prose: 'just text', state: null });
  assert.deepEqual(readBlock(undefined), { prose: '', state: null });
});

test('block followed by prose is ignored (must be last)', () => {
  const body = writeBlock('p', S) + '\nuser typed here';
  assert.equal(readBlock(body).state, null);
  assert.equal(readBlock(body).prose, body);
});

test('malformed json in block → state null', () => {
  assert.equal(readBlock('p\n\n```grill\n{oops\n```\n').state, null);
});

test('an earlier grill fence in the prose does not hide the last block', () => {
  const early = JSON.stringify({ v: 1, owner: null, gen: 0, round: 0 });
  const late = JSON.stringify({ v: 1, owner: 'o_aaaaaa', gen: 2, round: 1 });
  const body = `prose\n\n\`\`\`grill\n${early}\n\`\`\`\n\nmore text\n\n\`\`\`grill\n${late}\n\`\`\`\n`;
  const result = readBlock(body);
  assert.deepEqual(result.state, { v: 1, owner: 'o_aaaaaa', gen: 2, round: 1 });
  assert.ok(result.prose.endsWith('more text'));
});

test('CRLF body still parses', () => {
  const body = writeBlock('p\nq', S).replace(/\n/g, '\r\n');
  assert.deepEqual(readBlock(body).state, S);
  assert.equal(readBlock(body).prose, 'p\nq');
});

test('renderHostProse layout; empty sections omitted', () => {
  const out = renderHostProse({ effort: 'e', host: { goal: 'ship v1', decided: ['token file (r1.2)'], open: ['r2.1 Where? — ⭐ file'], notAsked: [] } });
  assert.equal(out, '📍 e\n\nGoal: ship v1\n\nDecided\n- token file (r1.2)\n\nOpen\n- r2.1 Where? — ⭐ file');
  assert.equal(renderHostProse({ effort: 'e', host: { goal: '', decided: [], open: [], notAsked: [] } }), '📍 e\n\nGoal: —');
});
