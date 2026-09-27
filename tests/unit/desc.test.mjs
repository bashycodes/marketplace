import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise, hashText, buildDesc, parseDesc, buildItems, classifyItems, OTHER_TITLE, KEY_RE } from '../../plugins/grill-over-ticktick/lib/desc.mjs';

const Q = { key: 'r2.1', context: 'Where does the token live?\nTwo options matter.', rec: { label: '~/.config/tt-grill/token', why: 'survives uninstall' } };

test('normalise: CRLF, trailing spaces, trailing blank lines', () => {
  assert.equal(normalise('a  \r\nb\t\r\n\r\n\n'), 'a\nb');
  assert.equal(normalise(''), '');
});

test('hashText is 8 lowercase hex and stable across normalisation', () => {
  assert.match(hashText('x'), /^[0-9a-f]{8}$/);
  assert.equal(hashText('a \r\nb\n\n'), hashText('a\nb'));
});

test('buildDesc has the exact layout and a footer that parses back unchanged', () => {
  const d = buildDesc(Q);
  assert.equal(d, `Where does the token live?\nTwo options matter.\n\n⭐ Recommended: ~/.config/tt-grill/token — survives uninstall\n\n✍️ Answer:\n\n⌁ r2.1 ${hashText('Where does the token live?\nTwo options matter.\n\n⭐ Recommended: ~/.config/tt-grill/token — survives uninstall\n\n✍️ Answer:')}`);
  const p = parseDesc(d);
  assert.equal(p.key, 'r2.1'); assert.equal(p.changed, false); assert.equal(p.answerText, '');
});

test('normalises CRLF and trailing whitespace before hashing (app re-serialisation is not an edit)', () => {
  const d = buildDesc(Q).replace(/\n/g, '\r\n') + '\r\n\r\n';
  const mangled = d.split('\r\n').map((l) => l + '  ').join('\r\n');
  assert.equal(parseDesc(mangled).changed, false);
});

test('typed answer → changed:true and answerText (inline and next-line)', () => {
  const d = buildDesc(Q);
  const nextLine = d.replace('✍️ Answer:\n', '✍️ Answer:\nenv only, laptop is shared\n');
  assert.equal(parseDesc(nextLine).changed, true);
  assert.equal(parseDesc(nextLine).answerText, 'env only, laptop is shared');
  const inline = d.replace('✍️ Answer:', '✍️ Answer: file');
  assert.equal(parseDesc(inline).answerText, 'file');
  assert.equal(parseDesc(inline).key, 'r2.1');
});

test('edited context (not the answer) still counts as changed; marker removed → answerText null', () => {
  const d = buildDesc(Q).replace('Two options', 'Three options');
  assert.equal(parseDesc(d).changed, true);
  const noMarker = buildDesc(Q).replace('✍️ Answer:', '');
  assert.equal(parseDesc(noMarker).answerText, null); assert.equal(parseDesc(noMarker).changed, true);
});

test('missing/garbled footer → key null, changed true; empty desc handled', () => {
  assert.deepEqual(parseDesc(undefined), { key: null, hash: null, body: '', changed: true, answerText: null });
  const p = parseDesc('hello\n⌁ r1.1 zzzzzzzz');
  assert.equal(p.key, null); assert.equal(p.changed, true);
});

test('footer must be the last non-blank line', () => {
  const d = buildDesc(Q) + '\n\nps: typed below';
  assert.equal(parseDesc(d).key, null);
});

test('buildItems: rec first with ⭐, others in order, Other last, no duplicate of rec', () => {
  assert.deepEqual(buildItems(['a', 'b', 'c'], 'b'), [{ title: '⭐ b' }, { title: 'a' }, { title: 'c' }, { title: OTHER_TITLE }]);
});

test('classifyItems maps status 1 → ticked and flags rec/other', () => {
  assert.deepEqual(classifyItems([{ title: '⭐ b', status: 1 }, { title: 'a', status: 0 }, { title: OTHER_TITLE }]), [
    { title: '⭐ b', ticked: true, isRec: true, isOther: false },
    { title: 'a', ticked: false, isRec: false, isOther: false },
    { title: OTHER_TITLE, ticked: false, isRec: false, isOther: true },
  ]);
  assert.deepEqual(classifyItems(undefined), []);
});

test('KEY_RE', () => { assert.ok(KEY_RE.test('r10.3')); assert.ok(!KEY_RE.test('r1')); assert.ok(!KEY_RE.test('R1.1')); });
